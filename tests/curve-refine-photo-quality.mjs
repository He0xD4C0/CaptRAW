// Default: verify/crop frozen public inputs only. --run requires a frozen engine
// SHA; no build, download, GUI, source write or parameter fitting occurs here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {EngineClient} from './engine-client.mjs';
import {POINT_CURVE_PRESETS} from '@captraw/contracts';
import {iccLabPython} from './curve-refine-quality-math.mjs';
const {values:options}=parseArgs({options:{run:{type:'boolean'},'engine-sha':{type:'string'},'review-dir':{type:'string'}}});
if(options.run)assert.match(options['engine-sha']??'',/^[a-f0-9]{64}$/,'--run needs --engine-sha from the coordinated build');
assert(!options['review-dir']||options.run,'Review output requires actual native renders');
const work=mkdtempSync(join(tmpdir(),'captraw-curve-refine-photo-')),python=resolve('build/qa-venv/bin/python'),root=resolve('artifacts/stage-0/acr-reference'),photo=join(root,'curves-refine-photo-187');
const read=p=>JSON.parse(readFileSync(p,'utf8')),py=(code,...args)=>JSON.parse(execFileSync(python,['-c',code,...args],{encoding:'utf8',maxBuffer:8*1024*1024}));
async function sha(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
const fixtures=read('tests/fixtures.json'),nasa=read(join(photo,'sources.json')),texture=read(join(root,'output-sharpen-holdout-187/sources.json')),rendered=read(join(root,'rendered-references.json'));
const canon=fixtures.find(f=>f.name==='canon-r5.CR3'),fuji=fixtures.find(f=>f.name==='fuji-xt4.RAF');
assert.equal(canon.license,'CC0-1.0');assert.equal(fuji.license,'CC0-1.0');assert.match(nasa.license,/Public domain/);
const sources=[
 {id:'astronaut',path:join(photo,'input.tif'),sha256:'4d896792cbee8b6188c69f2d291524f9ac89beccf749978c9c2d670d491a2221',url:nasa.source,license:nasa.license,rawPath:join(photo,'source/astronaut.png'),rawSHA:'88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5',iccSHA:nasa.iccSHA256,precision:'512x512 original RGB8 multiplied by257: no added detail, no RAW/high-resolution skin claim',rois:{face:[176,72,104,102],cheek:[191,112,28,24],fabric:[30,246,154,118],helmetSpecular:[305,350,184,144]}},
 {id:'leaf-wood',path:join(root,'output-sharpen-holdout-187/inputs/texture-holdout-rendered-roi.tif'),sha256:'df8409808971dbb014552fdb49d15753abb5fce77673103b5ddcade4a1fb6b88',url:fuji.url,license:fuji.license,rawPath:resolve('build/samples/fuji-xt4.RAF'),rawSHA:fuji.sha256,iccSHA:texture.files.find(f=>f.file==='texture-holdout-rendered-roi.tif').iccSHA256,precision:'Pixel-exact crop of existing ACR TIFF16; source RAW sharpening40/ColorNR25 already baked; no new denoise/sharpening',rois:{leaves:[80,100,900,760],woodEdge:[1300,100,210,760]}},
 {id:'fruit',path:join(root,'renders/canon-r5-neutral.tif'),sha256:'f4ee526a77db2191c0613fab4cf2ca07320056939eeef7240aae78bf7e21dd35',url:canon.url,license:canon.license,rawPath:resolve('build/samples/canon-r5.CR3'),rawSHA:canon.sha256,iccSHA:rendered.references.find(f=>f.path.endsWith('canon-r5-neutral.tif')).iccSHA256,crop:[3200,2300,2048,2048],precision:'Pixel-exact crop of existing ACR TIFF16 fruit photograph; baked RAW rendering retained, no resampling',rois:{fruit:[0,0,2048,2048]}},
];
const prepare=String.raw`
from PIL import Image
s=json.loads(sys.argv[1]);path=sys.argv[2];a,icc=read_tiff(s['path'])
assert hashlib.sha256(icc).hexdigest()==s['iccSHA']
if s['id']=='astronaut':
 original=np.asarray(Image.open(s['rawPath'])).astype(np.uint16);assert a.shape==(512,512,3) and np.array_equal(a,original*257)
if s.get('crop'):
 x,y,w,h=s['crop'];a=a[y:y+h,x:x+w].copy();assert a.shape==(h,w,3)
assert np.isfinite(a).all()
for name,(x,y,w,h) in s['rois'].items():assert x>=0 and y>=0 and w>0 and h>0 and x+w<=a.shape[1] and y+h<=a.shape[0],name
tifffile.imwrite(path,a,photometric='rgb',extratags=[(34675,'B',len(icc),icc,False)])
print(json.dumps(dict(width=a.shape[1],height=a.shape[0],pixelSHA256=hashlib.sha256(a.tobytes()).hexdigest(),iccSHA256=hashlib.sha256(icc).hexdigest(),sourceMaxChannelSpread16=int(np.ptp(a.astype(np.int32),axis=2).max()))))
`;
const analyze=String.raw`
from PIL import Image,ImageDraw
scene=json.loads(sys.argv[1]);renders=json.loads(sys.argv[2]);references=json.loads(sys.argv[3]);review=sys.argv[4];rows=[];failures=[]
source,source_icc=read_tiff(scene['input']);source_lab=to_lab(source,source_icc)
source_chroma=np.linalg.norm(source_lab[:,:,1:],axis=2)
masks={'all':np.ones(source.shape[:2],bool),'source-high-chroma':source_chroma>=40,'source-near-neutral':(source_chroma<5)&(source_lab[:,:,0]>5)&(source_lab[:,:,0]<95),'source-highlights':source_lab[:,:,0]>=85}
for name,(x,y,w,h) in scene['rois'].items():
 m=np.zeros(source.shape[:2],bool);m[y:y+h,x:x+w]=True;masks[name]=m
wrap=lambda a:(a+180)%360-180
def stats(a):
 return None if not a.size else dict(mean=float(np.mean(a)),p95=float(np.percentile(a,95)),max=float(np.max(a)))
def change(a,b,ai,bi):
 la=to_lab(a,ai);lb=to_lab(b,bi);delta=lb.astype(np.float64)-la;ca=np.linalg.norm(la[:,:,1:],axis=2);cb=np.linalg.norm(lb[:,:,1:],axis=2)
 hue=np.abs(wrap(np.degrees(np.arctan2(lb[:,:,2],lb[:,:,1])-np.arctan2(la[:,:,2],la[:,:,1]))));valid=(ca>=5)&(cb>=5)
 added=(((b==0)&(a>0))|((b==65535)&(a<65535)));recovered=(((a==0)&(b>0))|((a==65535)&(b<65535)))
 # Central luminance differences measure edge/texture changes; source masks and
 # ROIs remain fixed for every candidate/reference, never selected after render.
 ga=np.hypot(la[1:-1,2:,0]-la[1:-1,:-2,0],la[2:,1:-1,0]-la[:-2,1:-1,0])
 gb=np.hypot(lb[1:-1,2:,0]-lb[1:-1,:-2,0],lb[2:,1:-1,0]-lb[:-2,1:-1,0])
 out={}
 for name,m in masks.items():
  if not m.any():out[name]=dict(pixels=0);continue
  inner=m[1:-1,1:-1];ma=float(ga[inner].mean()) if inner.any() else None;mb=float(gb[inner].mean()) if inner.any() else None
  out[name]=dict(pixels=int(m.sum()),deltaE76=stats(np.linalg.norm(delta[m],axis=1)),absDeltaL=stats(np.abs(delta[:,:,0][m])),signedChromaDeltaMean=float((cb-ca)[m].mean()),hueEligiblePixels=int((m&valid).sum()),absHueDeltaDeg=stats(hue[m&valid]),addedClippedPixels=int(np.any(added,axis=2)[m].sum()),addedClippedChannels=int(added[m].sum()),recoveredClippedPixels=int(np.any(recovered,axis=2)[m].sum()),maxSTDMarginAtNewClip16=int(np.where(b==0,a.astype(np.int32),65535-a.astype(np.int32))[added&m[:,:,None]].max()) if (added&m[:,:,None]).any() else 0,baselineMeanLuminanceGradient=ma,refinedMeanLuminanceGradient=mb,gradientRatio=mb/ma if ma else None)
 return out
for family in ['Linear','Medium Contrast','Strong Contrast']:
 group=[r for r in renders if r['family']==family];old=next(r for r in group if r['amount']=='legacy');base,bi=read_tiff(old['path'])
 assert base.shape==source.shape
 for row in group:
  a,ai=read_tiff(row['path']);assert a.shape==base.shape and ai==bi
  if row['amount'] in ['legacy',0] or family=='Linear':assert np.array_equal(a,base),('Legacy/zero/identity changed',scene['id'],family,row['amount'])
  if row['amount']=='legacy':continue
  quality=change(base,a,bi,ai);result=dict(scene=scene['id'],curve=family,amount=row['amount'],vsSameCurveLegacy=quality,outputICC_SHA256=hashlib.sha256(ai).hexdigest())
  # Preserve no-added-clip as an explicit gate. Hue/texture measurements are
  # review evidence, not silently converted to a generic "quality passed".
  if quality['all']['addedClippedPixels']:failures.append(dict(scene=scene['id'],curve=family,amount=row['amount'],addedClippedPixels=quality['all']['addedClippedPixels']))
  ref=next((r for r in references if r['curve']==family and (r['refine'] is None if family=='Linear' else r['refine']==row['amount'])),None)
  if ref:
   target,ti=read_tiff(ref['path']);assert target.shape==a.shape
   result['vsActualACR187']=change(target,a,ti,ai)
   lowref=next(r for r in references if r['curve']==family and (r['refine'] is None if family=='Linear' else r['refine']==0));low,li=read_tiff(lowref['path'])
   result['actualACR187RefineDelta']=change(low,target,li,ti)
  rows.append(result)
 if review:
  # Display-only RGB8 crops, with the native output ICC. Analysis above always
  # uses original uint16 files; a contact sheet cannot establish extra detail.
  shown=[r for r in group if r['amount'] in ['legacy',50,100]]
  for name,box in scene['rois'].items():
   x,y,w,h=box;sheet=Image.new('RGB',(384*len(shown),410),'#222222');draw=ImageDraw.Draw(sheet)
   for i,r in enumerate(shown):
    a,ai=read_tiff(r['path']);im=Image.fromarray(np.rint(a[y:y+h,x:x+w]/257).astype(np.uint8));im.thumbnail((384,384));sheet.paste(im,(384*i,24));draw.text((384*i+4,4),family+' '+str(r['amount']),fill='white')
   sheet.save(str(Path(review)/(scene['id']+'-'+family.replace(' ','-')+'-'+name+'.png')),icc_profile=bi)
print(json.dumps(dict(rows=rows,noAddedClipFailures=failures,scope='Actual native TIFF16 and embedded-ICC Lab diagnostics; fixed source ROIs; not App/preview/HDR acceptance or photographic blind-review completion; skin source is only 512x512 original RGB8')))
`;
let engine,passed=false,engineHash;const summaries=[],qualityFailures=[];
try{
 for(const scene of sources){
  assert.equal(await sha(scene.path),scene.sha256,scene.id+' input changed');assert.equal(await sha(scene.rawPath),scene.rawSHA,scene.id+' original changed');
  scene.input=join(work,scene.id+'.tif');Object.assign(scene,py(iccLabPython+prepare,JSON.stringify(scene),scene.input));
 }
 const referenceRows=read(join(photo,'results.json')).exports;
 for(const r of referenceRows){r.path=join(photo,r.output);assert.equal(await sha(r.path),r.sha256,'Actual ACR reference changed: '+r.id);}
 console.log(JSON.stringify({scope:'Frozen public inputs verified; pixel crops only; no candidate renders yet',sources:sources.map(({id,url,license,path,sha256,rawPath,rawSHA,crop,precision,rois,width,height,pixelSHA256,iccSHA256})=>({id,url,license,path,sha256,rawPath,rawSHA,crop,precision,rois,width,height,pixelSHA256,iccSHA256}))}));
 if(options.run){
  const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');engineHash=await sha(binary);assert.equal(engineHash,options['engine-sha'],'Frozen native identity mismatch');
  const review=options['review-dir']?resolve(options['review-dir']):'';if(review){assert(!existsSync(review),'Use a new review directory');mkdirSync(review,{recursive:true});}
  engine=new EngineClient({cache:join(work,'cache')});
  for(const scene of sources){
   const im=await engine.call('open',{path:scene.input,sessionId:'refine-photo-'+scene.id,effectsDefaults:'legacy',whiteBalanceDefaults:'current'}),renders=[];
   const base={...im.adjustments,colorProfile:{mode:'embedded'},incrementalTemperature:0,incrementalTint:0,relativeWBModel:'art-ctl-v1',exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,saturation:0,vibrance:0,sharpening:0,colorNoise:0,luminanceNoise:0,grain:0,glow:0,masks:[],spots:[],redCurve:POINT_CURVE_PRESETS.Linear,greenCurve:POINT_CURVE_PRESETS.Linear,blueCurve:POINT_CURVE_PRESETS.Linear};
   delete base.curveRefineModel;delete base.curveRefineSaturation;
   for(const family of ['Linear','Medium Contrast','Strong Contrast'])for(const amount of family==='Linear'?['legacy',100]:['legacy',0,50,100]){
    const adjustments={...base,curve:POINT_CURVE_PRESETS[family],curveName:family,...(amount==='legacy'?{}:{curveRefineModel:'weighted-std-v1',curveRefineSaturation:amount})},composed=await engine.call('compose',{path:scene.input,width:scene.width,height:scene.height,adjustments,artProfile:im.artProfile});
    if(amount!=='legacy')assert.match(composed.artProfile,/CaptRAWCurveRefineModel=weighted-std-v1/,'Engine lacks refinement patch');
    const stem=scene.id+'-'+family.replaceAll(' ','-')+'-'+amount,output=join(work,stem+'.tif');writeFileSync(join(work,stem+'.arp'),composed.artProfile);
    await engine.call('export',{path:scene.input,artProfile:composed.artProfile,output,format:'tiff',colorSpace:'srgb'});renders.push({family,amount,path:output});
   }
   const result=py(iccLabPython+analyze,JSON.stringify(scene),JSON.stringify(renders),JSON.stringify(scene.id==='astronaut'?referenceRows:[]),review);
   console.log(JSON.stringify(result));summaries.push(result);qualityFailures.push(...result.noAddedClipFailures);
   assert.equal(await sha(binary),engineHash,'Engine changed during run');
  }
  assert.equal(qualityFailures.length,0,JSON.stringify({noAddedClipFailures:qualityFailures}));
  console.log(JSON.stringify({scope:'Native contracts and no-added-clip gates only; hue/texture/highlight review remains required',engineHash,scenes:sources.length,humanQualityReviewRequired:true}));
 }
 for(const scene of sources){assert.equal(await sha(scene.path),scene.sha256);assert.equal(await sha(scene.rawPath),scene.rawSHA);}
 passed=true;
}catch(error){writeFileSync(join(work,'failure.json'),JSON.stringify({error:String(error),engineHash,qualityFailures,summaries},null,2));throw error;}
finally{if(engine)await engine.stop();if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
