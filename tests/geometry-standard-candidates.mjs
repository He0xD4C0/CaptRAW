// Frozen, falsifiable candidates only. Uses existing ART operators; no build,
// Adobe UI, reference writes, production adapter or formula-parity claim.
import assert from 'node:assert/strict';
import {access,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';
const run=promisify(execFile),arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(arg('analyze-plan')){
 const plan=resolve(arg('analyze-plan')),saved=JSON.parse(await readFile(plan)),capture=JSON.parse(await readFile(join(dirname(plan),'failure.json')));
 const paths=[plan,...Object.values(saved.baseline),...Object.values(saved.nativeBaseline),...saved.outputs.flatMap(row=>[row.path,row.reference])];
 const unchanged=Object.fromEntries(await Promise.all(paths.map(async path=>[path,hash(await readFile(path))])));
 const {stdout}=await analyze(plan);for(const [path,sha] of Object.entries(unchanged))assert.equal(hash(await readFile(path)),sha,path+' changed during read-only analysis');
 console.log(JSON.stringify({renderCohort:capture.cohort,analysisCodeSHA:hash(await readFile(new URL(import.meta.url))),readOnly:true,...JSON.parse(stdout)},null,2));
 process.exit(0);
}
const binary=resolve(arg('engine')||'build/native/captraw-engine');await access(binary);
const root=await mkdtemp(join(tmpdir(),'captraw-geometry-standard-'));
const refs=resolve('artifacts/stage-0/acr-reference'),old=join(refs,'geometry-manual-187/inputs'),hold=join(refs,'geometry-holdout-187');
const models=[{id:'pow-1p1',q:a=>Math.pow(1.1,a/100)},{id:'reciprocal-sqrt-linear',q:a=>Math.pow(1+Math.abs(a)/500,Math.sign(a)/2)}];
const baseline={landscape:join(old,'geometry-grid-neutral.tif'),portrait:join(hold,'inputs/portrait-neutral-render.tif')};
const source={landscape:join(refs,'source/acr-geometry-grid.tif'),portrait:join(hold,'portrait-input-800x1000.tif')};
const training=[
 ['aspect-plus25',25,100,0,0,join(old,'geometry-grid-aspect25-clean.tif')],
 ['aspect-minus25',-25,100,0,0],['aspect-plus50',50,100,0,0],
 ['x-plus10',0,100,10,0,join(old,'geometry-grid-x10.tif')],['x-minus10',0,100,-10,0],['x-plus20',0,100,20,0],
 ['y-plus10',0,100,0,10,join(old,'geometry-grid-y10.tif')],['y-minus10',0,100,0,-10],['y-plus20',0,100,0,20]
];
const heldout=[['aspect-minus50',-50,100,0,0],['scale90',0,90,0,0],['combined',25,110,10,10],['portrait-x10-y10',0,100,10,10]];
const cases=[...training.map(row=>({row,fold:'calibration'})),...heldout.map(row=>({row,fold:'holdout'}))].map(({row:[id,A,S,X,Y,path],fold})=>({id,A,S,X,Y,fold,orientation:id.startsWith('portrait')?'portrait':'landscape',reference:path||join(hold,'inputs',id+'-render.tif')}));
let core,passed=false,timer,cohort;const outputs=[];
try{
 const files=[binary,'tests/geometry-standard-candidates.mjs',...Object.values(source),...Object.values(baseline),...cases.map(c=>c.reference)];
 cohort=Object.fromEntries(await Promise.all(files.map(async path=>[path,hash(await readFile(path))])));
 if(arg('engine-sha'))assert.equal(cohort[binary],arg('engine-sha'));
 core=new EngineClient({executable:binary,cache:join(root,'cache'),env:{OMP_NUM_THREADS:'2'}});
 assert.equal((await core.ready).engineVersion,'CaptRAW-32_ART-1.26.10_LibRaw-3b20539','coordinated native32 required');
 timer=setTimeout(()=>core.child.kill('SIGTERM'),240000);
 const images={},nativeBaseline={};
 const render=async(orientation,name,perspective)=>{
  const image=images[orientation],path=source[orientation];
  const adjustments={...image.adjustments,crop:null,rotation:0,flipHorizontal:false,flipVertical:false,fineRotation:0,lensCorrections:false,lensManualDistortion:0,masks:[],spots:[],perspective};
  const composed=await core.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile,adjustments});
  const output=join(root,name+'.tiff');await core.call('export',{path,artProfile:composed.artProfile,output,format:'tiff',colorSpace:'srgb'});return output;
 };
 const neutral={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1,manualModel:'art-perspective-v1',scale:1,offsetX:0,offsetY:0,constrainCrop:false};
 for(const orientation of ['landscape','portrait']){
  images[orientation]=await core.call('open',{path:source[orientation],sessionId:orientation,effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
  assert.deepEqual([images[orientation].width,images[orientation].height],orientation==='portrait'?[800,1000]:[1000,800]);
  nativeBaseline[orientation]=await render(orientation,'native-neutral-'+orientation,neutral);
 }
 for(const model of models)for(const item of cases){
  const q=model.q(item.A),perspective={...neutral,aspect:1/(q*q),scale:item.S/100*Math.max(q,1/q),offsetX:.0072*item.X,offsetY:-.0072*item.Y};
  // ART's pure-aspect canvas fit produces (r,1) or (1,1/r).
  // The compensating uniform zoom above restores the proposed (1/q,q),
  // rather than treating ART's ratio control as the Adobe signed value.
  outputs.push({...item,model:model.id,derivedNative:perspective,path:await render(item.orientation,model.id+'-'+item.id,perspective)});
 }
 const plan=join(root,'plan.json');await writeFile(plan,JSON.stringify({outputs,baseline,nativeBaseline}));
 const {stdout}=await analyze(plan);
 const report=JSON.parse(stdout);await writeFile(join(root,'result.json'),JSON.stringify({cohort,...report},null,2));
 for(const [path,sha] of Object.entries(cohort))assert.equal(hash(await readFile(path)),sha,path+' changed during native diagnostics');
 passed=true;console.log(JSON.stringify({cohort,summary:report.summary,selectedByCalibrationOnly:report.selectedByCalibrationOnly,baselineMarkerErrors:report.baselineMarkerErrors,holdouts:report.rows.filter(r=>r.fold==='holdout'),limitations:report.limitations,scratchCleaned:true},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),diagnostics:core?.diagnostics,stdout:error.stdout,stderr:error.stderr,cohort,outputs},null,2));throw error;}
finally{clearTimeout(timer);if(core){const stopped=core.child.exitCode!==null||core.child.signalCode!==null?Promise.resolve():once(core.child,'exit');await core.stop();await stopped;}if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained candidate failure:',root);}
async function analyze(plan){
 return run(resolve('build/qa-venv/bin/python'),['-c',String.raw`
import json,sys,numpy as np,tifffile
from pathlib import Path
plan=json.loads(Path(sys.argv[1]).read_text())
def read(p):
 with tifffile.TiffFile(p) as t:
  assert t.pages[0].dtype==np.uint16 and 34675 in t.pages[0].tags
  return t.asarray()
def positions(mask,axis):
 score=mask.sum(axis=axis);idx=np.flatnonzero(score>5);groups=np.split(idx,np.flatnonzero(np.diff(idx)>1)+1)
 assert len(groups)==2 and all(len(g) for g in groups),'Cannot identify both independent color markers'
 return np.array([np.average(g,weights=score[g]) for g in groups])
def markers(a,portrait):
 r,g,b=a.astype(float).transpose(2,0,1);red=(r>30000)&(r>2*g)&(r>2*b);cyan=(g>20000)&(b>20000)&(r<.4*np.minimum(g,b))&(g>.7*b)&(b>.7*g)
 return dict(x=positions(red if portrait else cyan,0),y=positions(cyan if portrait else red,1))
def profile(a,axis):
 # Project only the fixed central half of the orthogonal axis. Full-canvas
 # quantiles mix ART's black invalid margins with genuine black grid lines;
 # ACR's white margins then make that statistic compare different content.
 # This ROI is identical for both candidates and all calibration/holdout data.
 lum=a.astype(float).mean(2);h,w=lum.shape
 lum=lum[h//4:3*h//4,:] if axis==0 else lum[:,w//4:3*w//4]
 return np.quantile(lum,.2,axis=axis)
def centers(s):
 idx=np.flatnonzero(s<15000);groups=np.split(idx,np.flatnonzero(np.diff(idx)>1)+1)
 return [float(g.mean()) for g in groups if len(g)>1 and g[0]>20 and g[-1]<len(s)-20]
def locate(s,pred):
 if not 20<pred<len(s)-20:return None
 out=[];lo=max(0,int(pred)-5);hi=min(len(s),int(pred)+6);black=float(np.quantile(s[lo:hi],.2))
 for base,direction,offset in [(float(np.median(s[int(pred)-14:int(pred)-8])),-1,-2.5),(float(np.median(s[int(pred)+9:int(pred)+15])),1,2.5)]:
  level=(base+black)/2;xs=[]
  for j in range(int(pred)-8,int(pred)+8):
   if (s[j]-level)*direction<=0 and (s[j+1]-level)*direction>0:xs.append(j+(level-s[j])/(s[j+1]-s[j]))
  if not xs:return None
  out.append(min(xs,key=lambda x:abs(x-(pred+offset))))
 return float(np.mean(out))
base={k:read(v) for k,v in plan['baseline'].items()};native_base={k:read(v) for k,v in plan['nativeBaseline'].items()};rows=[]
for row in plan['outputs']:
 portrait=row['orientation']=='portrait';a,b=read(row['path']),read(row['reference']);assert a.shape==b.shape
 # Prove the fixed projection ROI is away from the affine margins of BOTH
 # frozen hypotheses. Do not infer support from dark/light pixel values.
 h,w=a.shape[:2]
 for candidate_q in [1.1**(row['A']/100),(1+abs(row['A'])/500)**(np.sign(row['A'])/2)]:
  for size,stretch,shift in [(w,row['S']/100/candidate_q,.0072*row['X']*w),(h,row['S']/100*candidate_q,-.0072*row['Y']*h)]:
   left=size/2+(-.5-size/2)*stretch+shift;right=size/2+(size-.5-size/2)*stretch+shift
   assert size//4>left+2 and 3*size//4<right-2,(row['id'],'projection ROI crosses affine support')
 ma,mb=markers(a,portrait),markers(b,portrait);marker={axis:dict(native=ma[axis].tolist(),adobe=mb[axis].tolist(),maxPositionErrorPixels=float(abs(ma[axis]-mb[axis]).max())) for axis in ['x','y']}
 grids=[]
 for axis in [0,1]:
  pa,pb=profile(a,axis),profile(b,axis);ref=profile(base[row['orientation']],axis);size=len(ref);q=1.1**(row['A']/100)
  # The same loose association window is used for both candidates and the
  # reference. No registration or coefficient is fitted against holdout data.
  scale=row['S']/100*(1/q if axis==0 else q);shift=.0072*row['X']*size if axis==0 else -.0072*row['Y']*size;errors=[];samples=[]
  for x in centers(ref):
   pred=size/2+(x-size/2)*scale+shift;u,v=locate(pa,pred),locate(pb,pred)
   samples.append(dict(original=x,predicted=pred,visible=20<pred<size-20,native=u,adobe=v))
   if u is not None and v is not None:errors.append(u-v)
  assert len(errors)>=8,(row['model'],row['id'],'xy'[axis],'Insufficient independent grid lines',samples);e=np.array(errors)
  grids.append(dict(axis='xy'[axis],count=len(e),originalCenters=len(samples),visiblePredictions=sum(s['visible'] for s in samples),nativeFound=sum(s['native'] is not None for s in samples),adobeFound=sum(s['adobe'] is not None for s in samples),maxPositionErrorPixels=float(abs(e).max()),squaredError=float((e*e).sum())))
 rows.append(dict(id=row['id'],model=row['model'],fold=row['fold'],derivedNative=row['derivedNative'],markers=marker,grid=grids))
summary=[]
for model in sorted({r['model'] for r in rows}):
 folds={}
 for fold in ['calibration','holdout']:
  g=[g for r in rows if r['model']==model and r['fold']==fold for g in r['grid']];folds[fold]=dict(gridSamples=sum(x['count'] for x in g),rmsePixels=float(np.sqrt(sum(x['squaredError'] for x in g)/sum(x['count'] for x in g))),maxPositionErrorPixels=max(x['maxPositionErrorPixels'] for x in g))
 summary.append(dict(model=model,**folds))
winner=min(summary,key=lambda r:r['calibration']['rmsePixels'])['model']
base_errors={k:{axis:float(abs(markers(native_base[k],k=='portrait')[axis]-markers(base[k],k=='portrait')[axis]).max()) for axis in ['x','y']} for k in base}
print(json.dumps(dict(summary=summary,selectedByCalibrationOnly=winner,baselineMarkerErrors=base_errors,rows=rows,limitations=['Two fixed hypotheses; no Adobe formula is established','Location diagnostics are not color/pixel equivalence','Approximately half-pixel threshold/edge measurement; no fitted subpixel registration','Only zero Upright/H/V/perspective rotation and no Constrain are covered'])))
`,plan],{encoding:'utf8',maxBuffer:4*1024*1024});
}
