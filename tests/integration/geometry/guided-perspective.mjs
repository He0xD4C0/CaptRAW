import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
import {patchGeometryMapping} from '../../../native/patches/patch-geometry.mjs';

const root=resolve(process.env.CAPTRAW_GUIDED_PERSPECTIVE_OUT||'artifacts/guided-perspective');
mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const python=resolve('build/qa-venv/bin/python');
const executable=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const installed=resolve(process.env.CAPTRAW_GUIDED_REFERENCE||join(homedir(),'Applications/CaptRAW-0.53.app/Contents/Resources/native'));
const pairedInstalled=resolve(process.env.CAPTRAW_GUIDED_PAIRED_REFERENCE||join(homedir(),'Applications/CaptRAW-0.54.app/Contents/Resources/native'));
const core=new EngineClient({executable,resources,cache:join(out,'cache')});
const reference=new EngineClient({executable:join(installed,'captraw-engine'),resources:join(installed,'resources'),cache:join(out,'reference-cache')});
const pairedReference=new EngineClient({executable:join(pairedInstalled,'captraw-engine'),resources:join(pairedInstalled,'resources'),cache:join(out,'paired-reference-cache')});
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const report={metadataRejections:[],pairedEquivalence:[],pairedInstalled,pairedReferenceSHA256:hash(join(pairedInstalled,'captraw-engine')),passed:false,executable,binarySHA256:hash(executable),referenceSHA256:hash(join(installed,'captraw-engine')),rows:[],checks:[],rejections:[],errors:[]};
for(const engine of [core,reference,pairedReference])engine.on('error',error=>report.errors.push(error));
let revision=0,sessionId,previewEvents=0;
core.on('preview',()=>++previewEvents);
const pass=message=>{report.checks.push(message);console.log('PASS',message);};
const runPython=(code,...args)=>execFileSync(python,['-c',code,...args],{encoding:'utf8'});
async function render(adjustments,artProfile,before=false){
 const pending=core.preview(++revision,before?'before':'fit');pending.catch(()=>{});
 const result=await core.call(before?'before':'update',{revision,adjustments,artProfile});
 return {...result,frame:await pending};
}
const solve=(lines,extra={})=>core.call('autoPerspective',{sessionId,revision,lines,...extra});
const map=(from,to,points)=>core.call('coordinates',{sessionId,revision,from,to,points});
function fields(profile,section,values){
 const pattern=new RegExp('\\['+section+'\\]\\n[\\s\\S]*?(?=\\n\\[|$)'),match=profile.match(pattern);assert(match);
 let text=match[0];for(const [key,value] of Object.entries(values)){
  const field=new RegExp('^'+key+'=.*$','m');assert(field.test(text));text=text.replace(field,key+'='+value);
 }
 return profile.replace(match[0],text);
}
// Pixel colors identify four separate lines even after coarse rotation. PCA and
// projection quantiles measure both their endpoints and residual independently
// of GeometryMap, the solver, and ART's perspective parameterization.
function measure(file,rotation){
 return JSON.parse(runPython(String.raw`
from PIL import Image
import numpy as np,sys,json,math
if sys.argv[1].endswith('.tiff'):
 import tifffile
 a=tifffile.imread(sys.argv[1]).astype(float)/257
else:a=np.asarray(Image.open(sys.argv[1])).astype(float)
r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
weights=[r-np.maximum(g,b),np.minimum(r,g)-b,np.minimum(g,b)-r,np.minimum(r,b)-g]
lines=[]
for i,w in enumerate(weights):
 y,x=np.where(w>65);assert len(x)>120,(i,len(x))
 xy=np.stack([x,y],axis=1)
 # Intersections of yellow and magenta can create isolated red pixels. Reject
 # these distant color mixtures before fitting the actual colored stroke.
 for iteration in range(3):
  center=xy.mean(axis=0);v=np.linalg.eigh(np.cov(xy.T))[1][:,-1];normal=np.array([-v[1],v[0]])
  offset=(xy-center)@normal;median=np.median(offset);mad=np.median(np.abs(offset-median))
  xy=xy[np.abs(offset-median)<max(8,4*mad)]
 center=xy.mean(axis=0);v=np.linalg.eigh(np.cov(xy.T))[1][:,-1]
 if v[0]<0:v=-v
 t=(xy-center)@v;lo,hi=np.quantile(t,[.12,.88]);p=center+lo*v;q=center+hi*v
 horizontal=(i<2) != (int(sys.argv[2])%180==90)
 angle=abs(math.degrees(math.atan2(v[1],v[0])));residual=min(angle,180-angle) if horizontal else abs(90-angle)
 lines.append(dict(axis='horizontal' if horizontal else 'vertical',start=dict(x=float(p[0]),y=float(p[1])),end=dict(x=float(q[0]),y=float(q[1])),residual=residual))
print(json.dumps(dict(width=a.shape[1],height=a.shape[0],lines=lines)))
`,file,String(rotation)));
}
function selected(measurement,direction){
 if(direction.startsWith('three-')){
  const majority=direction.slice(6),minority=measurement.lines.find(line=>line.axis!==majority);
  return measurement.lines.filter(line=>line.axis===majority||line===minority);
 }
 return measurement.lines.filter(line=>direction==='both'||line.axis===direction);
}
const guides=(measurement,direction)=>selected(measurement,direction).map(({axis,start,end})=>({axis,start,end}));
const residual=(measurement,direction)=>Math.max(...selected(measurement,direction).map(line=>line.residual));
async function reject(name,request){
 await assert.rejects(core.call('autoPerspective',request),error=>{
  assert.match(error.message,/[\u4e00-\u9fff]/);report.rejections.push({name,error:error.message});return true;
 });
}
try{
 // Replay only the geometry patch's six inputs from the pinned pristine archive,
 // avoiding a second full source tree. Clean up immediately even on failure.
 const replay=mkdtempSync(join(out,'patch-')),upstreamName='ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b';
 try{
  report.upstreamArchiveSHA256=hash(resolve('build/upstream/art.tar.gz'));
  assert.equal(report.upstreamArchiveSHA256,'cee0ccf71e10e13c195e7ab3fb426564ba051bbaaa39ad43e6ed4d0e997a1855');
  const files=['perspectivecorrection.h','perspectivecorrection.cc','ashift_dt.c','improcfun.h','iptransform.cc','improccoordinator.cc'];
  execFileSync('tar',['-xzf',resolve('build/upstream/art.tar.gz'),'-C',replay,...files.map(file=>`${upstreamName}/src/engine/${file}`)]);
  const fresh=join(replay,upstreamName);patchGeometryMapping(fresh);
  const first=files.map(file=>hash(join(fresh,'src/engine',file)));patchGeometryMapping(fresh);
  assert.deepEqual(files.map(file=>hash(join(fresh,'src/engine',file))),first,'Fresh patch replay must be idempotent');
  for(const file of files.slice(0,3))assert.equal(hash(join(fresh,'src/engine',file)),hash(resolve('build/upstream',upstreamName,'src/engine',file)),'Fresh and rebuilt incremental fit source differ: '+file);
  report.patchReplay=Object.fromEntries(files.map((file,i)=>[file,first[i]]));
 }finally{rmSync(replay,{recursive:true,force:true});}
 pass('Pinned fresh geometry patch replay is idempotent and matches rebuilt perspective/ashift sources');
 // General projective keystone with signed roll, independent of ART equations.
 // Supersampling keeps colored line locations accurate below one output pixel.
 runPython(String.raw`
from PIL import Image,ImageDraw,TiffImagePlugin
import numpy as np,sys,math,json
from pathlib import Path
p=Path(sys.argv[1]);scale=3;w,h=1000,800
im=Image.new('RGB',(w*scale,h*scale),(96,96,96));d=ImageDraw.Draw(im)
segments=[(180,240,820,240),(180,560,820,560),(320,120,320,680),(680,120,680,680)]
for points,color in zip(segments,[(240,20,20),(240,240,20),(20,240,240),(240,20,240)]):d.line(tuple(v*scale for v in points),fill=color,width=5*scale)
exif=Image.Exif();exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
for sign in [-1,1]:
 a=math.radians(sign*3);c,s=math.cos(a),math.sin(a)
 center=np.array([[1,0,-w/2],[0,1,-h/2],[0,0,1]])
 transform=np.array([[c,-s,0],[s,c,0],[sign*.00012,sign*.00018,1]])
 forward=np.linalg.inv(center)@transform@center
 sampling=np.diag([scale,scale,1]);inverse=np.linalg.inv(sampling@forward@np.linalg.inv(sampling));inverse/=inverse[2,2]
 result=im.transform(im.size,Image.Transform.PERSPECTIVE,inverse.flatten()[:8],Image.Resampling.BICUBIC,fillcolor=(96,96,96)).resize((w,h),Image.Resampling.LANCZOS)
 result.save(p/('keystone'+str(sign)+'.png'),exif=exif)
Image.new('RGB',(w,h),(96,96,96)).save(p/'blank.png')
`,out);
 await reject('no image',{sessionId:'none',revision,lines:[]});
 for(const sign of [-1,1])for(const rotation of [0,90,180,270]){
  const path=join(out,`keystone${sign}.png`),sourceHash=hash(path);
  sessionId=`s${sign}-r${rotation}`;
  const im=await core.call('open',{path,sessionId});
  await pairedReference.call('open',{path,sessionId});
  await reject('preview not ready',{sessionId,revision,lines:[]});
  const configurations=[{name:'neutral',fineRotation:0,existing:false,lens:false},
   {name:'existing',fineRotation:sign*4,existing:true,lens:false}];
  // Exercise actual lens correction and retained manual distortion/CA values.
  if(rotation===0)configurations.push({name:'lens',fineRotation:sign*4,existing:true,lens:true});
  for(const config of configurations){
   const settings={...im.adjustments,rotation,fineRotation:config.fineRotation,lensCorrections:config.lens,
    lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true},
    perspective:{...im.adjustments.perspective,enabled:config.existing,horizontal:sign*18,vertical:-sign*12,angle:sign*2,shear:sign*3,...(config.existing?{focalLength:24,cropFactor:1.5,aspect:1.1}:{})}};
   let profile=fields(im.artProfile,'Common Properties for Transformations',{AutoFill:rotation%180===0});
   if(config.lens){profile=fields(profile,'Distortion',{Enabled:true,Amount:.01});profile=fields(profile,'CACorrection',{Enabled:false,Red:.012,Blue:-.009});}
   for(const direction of ['horizontal','vertical','both','three-horizontal','three-vertical']){
    const before=await render(settings,profile),measured=measure(before.frame.file,rotation),lines=guides(measured,direction);
    assert.equal(measured.width,before.frame.fullWidth);assert.equal(measured.height,before.frame.fullHeight);
    if(config.lens)assert(before.lensStatus.distortion&&before.lensStatus.ca,'Fixture must activate real lens correction');
    const saved=await core.call('save'),events=previewEvents,previewHash=hash(before.frame.file);
    const sourcePoints=(await map('display','source',lines.flatMap(l=>[l.start,l.end]))).points;
    const started=Date.now(),solved=await solve(lines),elapsedMs=Date.now()-started;
    assert.deepEqual(await solve(lines),solved,'Repeated solve must be deterministic');
    assert.deepEqual(await solve(lines,{direction:'ignored: inferred from counts'}),solved);
    assert.deepEqual(await solve(lines.map(l=>({...l,start:l.end,end:l.start}))),solved,'Reversed stroke must agree');
    if(lines.length===3){
     assert.equal(solved.shear,0,'Three guides must fix shear to zero');
     for(const order of [[2,1,0],[1,2,0],[1,0,2],[0,2,1],[2,0,1]])assert.deepEqual(await solve(order.map(i=>lines[i])),solved,'Guide order must not change the fit');
    }else{
     const pending=pairedReference.preview(revision);pending.catch(()=>{});
     const old=await pairedReference.call('update',{revision,adjustments:settings,artProfile:before.artProfile});
     const oldFrame=await pending;
     assert.equal(old.artProfile,before.artProfile,'Installed core must receive identical current settings/profile');
     assert.equal(hash(oldFrame.file),previewHash,'Installed core must render identical input display pixels');
     const oldSolved=await pairedReference.call('autoPerspective',{sessionId,revision,lines});
     assert.deepEqual(solved,oldSolved,'Paired-guide settings must exactly match installed 0.54');
     report.pairedEquivalence.push({sessionId,config:config.name,direction,guideCount:lines.length,solved});
    }
    assert.deepEqual(await core.call('save'),saved,'Solve must preserve the complete active document');
    assert.equal(previewEvents,events,'Solve must not trigger rendering');assert.equal(hash(before.frame.file),previewHash);
    assert.deepEqual(Object.keys(solved).sort(),Object.keys(im.adjustments.perspective).sort());
    for(const key of ['focalLength','cropFactor','aspect'])assert.equal(solved[key],settings.perspective[key]);
    const corrected=await render({...settings,perspective:solved},before.artProfile),after=measure(corrected.frame.file,rotation);
    assert.equal(corrected.geometry.angle,config.fineRotation);
    for(const section of ['Rotation','LensProfile','Distortion','CACorrection']){
     const pattern=new RegExp('\\['+section+'\\]\\n[\\s\\S]*?(?=\\n\\[|$)');
     const original=before.artProfile.match(pattern),actual=corrected.artProfile.match(pattern);
     assert(original&&actual,'Missing profile section '+section);assert.equal(actual[0],original[0],section+' must stay unchanged');
    }
    const pixelResidual=residual(after,direction);
    if(pixelResidual>=.25){copyFileSync(before.frame.file,join(out,"failure-before.png"));copyFileSync(corrected.frame.file,join(out,"failure-after.png"));console.log(JSON.stringify({sessionId,config,direction,pixelResidual,lines,after,solved}));}
    const projected=(await map('source','display',sourcePoints)).points;
    let geometryResidual=0;
    for(let i=0;i<lines.length;++i){const a=projected[2*i],b=projected[2*i+1];assert(a&&b);
     const dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
     geometryResidual=Math.max(geometryResidual,Math.atan2(lines[i].axis==='horizontal'?dy:dx,lines[i].axis==='horizontal'?dx:dy)*180/Math.PI);
    }
    assert(geometryResidual<.05,JSON.stringify({sessionId,config,direction,geometryResidual}));
    assert(pixelResidual<.25,JSON.stringify({sessionId,config,direction,pixelResidual,geometryResidual,solved}));
    const afterSaved=await core.call('save'),again=await solve(guides(after,direction));
    assert.deepEqual(await core.call('save'),afterSaved,'Re-solving the corrected display is read-only');
    const repeated=await render({...settings,perspective:again},corrected.artProfile),repeatResidual=residual(measure(repeated.frame.file,rotation),direction);
    assert(repeatResidual<.25,JSON.stringify({sessionId,config,direction,repeatResidual}));
    const omittedResidual=lines.length===3?Math.max(...after.lines.filter(line=>!selected(after,direction).includes(line)).map(line=>line.residual)):null;
    report.rows.push({sessionId,config:config.name,direction,guideCount:lines.length,elapsedMs,pixelResidual,geometryResidual,repeatResidual,omittedResidual,solved});
    if(direction==='both'||lines.length===3){
     for(const [engine,name] of [[core,'current'],[reference,'reference']])await engine.call('export',{path,artProfile:corrected.artProfile,format:'tiff',output:join(out,name+'.tiff')});
     runPython(String.raw`
import tifffile,numpy as np,sys
with tifffile.TiffFile(sys.argv[1]) as x,tifffile.TiffFile(sys.argv[2]) as y:
 a,b=x.pages[0].asarray(),y.pages[0].asarray()
 assert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)
 assert x.pages[0].tags[34675].value==y.pages[0].tags[34675].value
`,join(out,'current.tiff'),join(out,'reference.tiff'));
     assert(residual(measure(join(out,'reference.tiff'),rotation),direction)<.25,'Installed fixed-profile render residual');
     if(config.name==='existing'&&direction==='both')copyFileSync(corrected.frame.file,join(out,sessionId+'-solved.png'));
    }
   }
   console.log('CHECKED',sessionId,config.name);
  }
  assert.equal(hash(path),sourceHash,'Source file must not change');
 }
 pass(`${report.rows.length} signed/coarse/existing-perspective/fine-rotation/lens cases (only selected guides): pixel residual <0.25°, mapped endpoint residual <0.05°, repeated corrected-display solve <0.25°`);
 pass('Installed 0.53 fixed-profile TIFF16 pixels and ICC agree; source hashes, fine rotation and lens configuration preserved');
 assert.equal(report.pairedEquivalence.length,report.rows.filter(row=>row.guideCount!==3).length);
 pass(`${report.pairedEquivalence.length} two/four-guide solves exactly match installed 0.54 on identical source, current profile/settings and display endpoints`);
 sessionId='invalid';const im=await core.call('open',{path:join(out,'blank.png'),sessionId});
 const settings={...im.adjustments,perspective:{...im.adjustments.perspective,enabled:true,horizontal:8,angle:2}};
 await render(settings,im.artProfile);const snapshot=await core.call('save');
 const h=[{axis:'horizontal',start:{x:120,y:200},end:{x:800,y:205}},{axis:'horizontal',start:{x:120,y:600},end:{x:800,y:595}}];
 const v=h.map(l=>({axis:'vertical',start:{x:l.start.y,y:l.start.x},end:{x:l.end.y,y:l.end.x-100}}));
 const valid={sessionId,revision,lines:h};
 for(const [name,lines] of [['null',null],['object',{}],['empty',[]],['one',[h[0]]],['five',[...h,...v,h[0]]],['one each',[h[0],v[0]]],['three horizontal',[...h,{...h[0],start:{x:100,y:300},end:{x:800,y:300}}]],['three vertical',[...v,{axis:'vertical',start:{x:400,y:100},end:{x:400,y:700}}]],['three plus one',[...h,{axis:'horizontal',start:{x:100,y:300},end:{x:800,y:300}},v[0]]],['one plus three',[h[0],...v,{axis:'vertical',start:{x:400,y:100},end:{x:400,y:700}}]],['four horizontal',[...h,{axis:'horizontal',start:{x:100,y:300},end:{x:800,y:300}},{axis:'horizontal',start:{x:100,y:400},end:{x:800,y:400}}]],['nonobject',[null,h[1]]]])await reject(name,{...valid,lines});
 for(const [name,patch] of [['unknown axis',{axis:'diagonal'}],['axis object',{axis:{}}],['missing start',{start:undefined}],['missing x',{start:{y:4}}],['string',{start:{x:'3',y:4}}],['null coordinate',{start:{x:null,y:4}}],['NaN',{start:{x:NaN,y:4}}],['Infinity',{start:{x:Infinity,y:4}}],['negative',{start:{x:-.01,y:4}}],['past width',{end:{x:1000,y:4}}],['past height',{end:{x:3,y:800}}],['degenerate',{end:h[0].start}]])await reject(name,{...valid,lines:[{...h[0],...patch},h[1]]});
 await reject('duplicate',{...valid,lines:[h[0],h[0]]});
 await reject('reverse duplicate',{...valid,lines:[h[0],{...h[0],start:h[0].end,end:h[0].start}]});
 const steepH=[
  {axis:'horizontal',start:{x:150,y:100},end:{x:650,y:450}},
  {axis:'horizontal',start:{x:150,y:300},end:{x:650,y:650}}];
 const steepV=[
  {axis:'vertical',start:{x:450,y:100},end:{x:100,y:600}},
  {axis:'vertical',start:{x:600,y:150},end:{x:250,y:650}}];
 for(const lines of [steepH,[...steepH,steepV[0]],[steepH[0],...steepV]])
  await reject('angle outside supported range '+lines.map(line=>line.axis[0]).join(''),{...valid,lines});
 for(const [name,patch] of [['stale session',{sessionId:'stale'}],['stale revision',{revision:revision-1}],['fractional revision',{revision:revision+.1}],['missing session',{sessionId:undefined}],['missing revision',{revision:undefined}]])await reject(name,{...valid,...patch});
 for(const direction of ['horizontal','vertical','both'])await reject('blank automatic '+direction,{sessionId,revision,direction});
 for(const direction of [undefined,null,{},'diagonal'])await reject('invalid automatic direction',{sessionId,revision,direction});
 assert.deepEqual(await core.call('save'),snapshot);
 await render(settings,im.artProfile,true);await reject('before comparison',{sessionId,revision,lines:h});
 await render(settings,im.artProfile);
 assert((await solve(h)).enabled,'Valid guided solve works on blank image without automatic detection');
 assert.deepEqual(await core.call('save'),snapshot);
 const sourceGuide={axis:'horizontal',start:{x:.1,y:.2},end:{x:.8,y:.3}};
 for(const [name,perspectiveGuides] of [
  ['not array',{}],['null',null],['more than four',Array(5).fill(sourceGuide)],
  ['bad axis',[{...sourceGuide,axis:'diagonal'}]],['missing axis',[{start:sourceGuide.start,end:sourceGuide.end}]],
  ['missing endpoint',[{...sourceGuide,end:undefined}]],['missing coordinate',[{...sourceGuide,start:{x:.1}}]],
  ['nonnumeric coordinate',[{...sourceGuide,end:{x:'0.5',y:.6}}]],['nonfinite coordinate',[{...sourceGuide,end:{x:Infinity,y:.6}}]]]){
  await assert.rejects(core.call('validate',{artProfile:im.artProfile,adjustments:{...settings,perspectiveGuides}}));
  report.metadataRejections.push(name);
 }
 for(const perspectiveGuides of [[],[sourceGuide],[sourceGuide,sourceGuide,{...sourceGuide,axis:'vertical'}],Array(4).fill(sourceGuide)])await core.call('validate',{artProfile:im.artProfile,adjustments:{...settings,perspectiveGuides}});
 assert.deepEqual(await core.call('save'),snapshot,'Metadata validation must be read-only');
 pass(`${report.metadataRejections.length} malformed perspectiveGuides metadata cases rejected through validate; valid 0/1/3/4 retained guides accepted`);
 pass(`${report.rejections.length} malformed, degenerate, stale and unavailable requests rejected in Chinese without document mutation`);
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}finally{
 await core.stop();await reference.stop();await pairedReference.stop();
 for(const name of ['cache','reference-cache','paired-reference-cache','current.tiff','reference.tiff'])rmSync(join(out,name),{recursive:true,force:true});
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('REPORT',join(out,'report.json'));
}
