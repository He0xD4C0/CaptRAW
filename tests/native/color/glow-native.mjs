import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CRS,CT,encode,property,lookup,readExtension,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {capturePreset} from '@captraw/contracts/presets';
import {synchronizedAdjustments} from '@captraw/contracts/synchronize';
const work=mkdtempSync(join(tmpdir(),'captraw-glow-native-')),reference=resolve('artifacts/stage-0/acr-reference/controls-187');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),python=resolve('build/qa-venv/bin/python'),checks=[];
const pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let engine,success=false;
const cases=['glow-diffusion40','glow-bloom40','glow-halation40','glow-halation40-range25','glow-halation40-spread75','glow-halation40-warmth30','glow-local30','glow-zero','glow-zero-same-mask'];
try{
 const evidence=JSON.parse(readFileSync(join(reference,'pixels.json'),'utf8'));
 for(const entry of evidence.outputs)assert.equal(hash(join(reference,entry.file)),entry.sha256,'Reference changed: '+entry.file);
 for(const stem of cases){
  const properties=(await xmp.read(join(reference,stem+'-render.xmp'))).properties,a=decodeAdjustments(properties).adjustments;
  assert.equal(a.glow,Number(lookup(properties,CRS,'Glow').value));assert.equal(a.glowStyle,['diffusion','bloom','halation'][Number(lookup(properties,CRS,'GlowStyle').value)]);
  for(const [key,name] of [['glowRange','GlowRange'],['glowSpread','GlowSpread'],['glowWarmth','GlowWarmth']]){const node=lookup(properties,CRS,name);if(node)assert.equal(a[key],Number(node.value));}
  if(stem==='glow-local30')assert(a.masks.some(m=>m.details?.glow===30),'Actual ACR LocalGlow .3 must become UI 30');
  const glow=Object.fromEntries(Object.entries(a).filter(([k])=>k.startsWith('glow'))),fields=[...encodeAdjustments(glow),property(CT,'EngineVersion',encode(ENGINE_VERSION))];
  const round=decodeAdjustments((await xmp.call('read',(await xmp.call('write','',fields)).packet)).properties).adjustments;
  for(const key of Object.keys(glow))assert.equal(round[key],a[key]);
 }
 for(const [key,values] of [['glow',[-1,101,.5]],['glowRange',[-1,101]],['glowSpread',[-1,101]],['glowWarmth',[-101,101]],['glowStyle',['other',3]]])for(const value of values)assert.throws(()=>encodeAdjustments({[key]:value}));
 pass('12个真实Adobe TIFF身份固定；9组Glow XMP三样式/单变量/实际LocalGlow=.3读取并经SDK标准往返');
 if(!process.argv.includes('--xmp-only')){
  const source=join(work,'bright.tif');execFileSync(python,['-c',`import numpy as np,tifffile,sys
y,x=np.mgrid[0:768,0:1024];a=np.full((768,1024,3),3500.,dtype=float)
for cx,cy,rgb in [(128,384,[64000,64000,62000]),(510,384,[65000,44000,25000]),(800,200,[30000,50000,64000])]:
 a+=np.exp(-((x-cx)**2+(y-cy)**2)/100.)[:,:,None]*rgb
tifffile.imwrite(sys.argv[1],np.clip(a,0,65535).astype(np.uint16),photometric='rgb')`,source]);
  const original=hash(source);engine=new EngineClient({cache:join(work,'core'),env:{OMP_NUM_THREADS:'2'}});
  const image=await engine.call('open',{path:source,sessionId:'glow',effectsDefaults:'legacy'}),base=image.adjustments;let profile=image.artProfile,revision=0;
  const render=async a=>{const n=++revision,p=engine.preview(n,'fit',120000),r=await engine.call('update',{artProfile:profile,adjustments:a,revision:n}),frame=await p;profile=r.artProfile;return {hash:hash(frame.file),frame,profile};};
  const legacy=await render(base),zero=await render({...base,glow:0,glowStyle:'halation',glowRange:100,glowSpread:100,glowWarmth:100});assert.equal(zero.hash,legacy.hash);assert(!zero.profile.includes('[CaptRAW Glow]'));
  const settings={...base,glow:40,glowStyle:'halation',glowRange:50,glowSpread:50,glowWarmth:0};
  const active=await render(settings);assert.match(active.profile,/\[CaptRAW Glow\]/);assert.notEqual(active.hash,legacy.hash);
  for(const [key,value] of [['glow',70],['glowStyle','diffusion'],['glowStyle','bloom'],['glowRange',25],['glowSpread',75],['glowWarmth',30]])assert.notEqual((await render({...settings,[key]:value})).hash,active.hash,key);
  assert.equal((await render(base)).hash,legacy.hash);assert.equal((await render(settings)).hash,active.hash);pass('真实ART连续处理：缺省/零值逐像素旁路、全部Glow控件实际响应、撤销/重做一致');
  const mask={id:'glow-mask',name:'Glow',type:'linear',enabled:true,initialized:true,inverted:false,feather:50,points:[],start:{x:.2,y:.5},end:{x:.8,y:.5},brightness:0,contrast:0,saturation:0,details:{hue:0,texture:0,clarity:0,noise:0,noiseDetail:50,glow:30}};
  const localSettings={...settings,glow:0,masks:[mask]},local=await render(localSettings);assert.notEqual(local.hash,legacy.hash);
  assert.notEqual((await render({...localSettings,glowStyle:'bloom'})).hash,local.hash);assert.notEqual((await render({...localSettings,masks:[{...mask,inverted:true}]})).hash,local.hash);assert.equal((await render({...localSettings,masks:[{...mask,enabled:false}]})).hash,legacy.hash);
  const preset=capturePreset({name:'Glow',group:'验证',groups:['effects','masks'],adjustments:localSettings});assert.equal(preset.adjustments.glowStyle,'halation');assert.equal(preset.adjustments.masks[0].details.glow,30);
  const synced=synchronizedAdjustments({image,profile,adjustments:localSettings},{image,profile:image.artProfile,adjustments:base},['effects','masks']);assert.equal(synced.masks[0].details.glow,30);pass('全局0时局部独立响应；共享样式/反选/开关/预设/同步携带同一正式字段');
  const large={...localSettings,glowSpread:100};const fitted=await render(large),fit=join(work,'fit.png');copyFileSync(fitted.frame.file,fit);
  const n=++revision,pending=engine.preview(n,'detail',120000);await engine.call('viewport',{x:150,y:320,width:160,height:128,revision:n});const detail=await pending;
  execFileSync(python,['-c',`from PIL import Image
import numpy as np,sys
a=np.asarray(Image.open(sys.argv[1]).convert('RGB'));b=np.asarray(Image.open(sys.argv[2]).convert('RGB'));assert np.array_equal(a[320:448,150:310],b),(a.shape,b.shape)`,fit,detail.file]);pass('大扩散核的1:1真实detail与完整上下文相同区域逐像素一致，非32px截断');
  const recipe={source:{path:source,size:readFileSync(source).length,sha256:original},artProfile:fitted.profile,adjustments:large},sidecar=join(work,'bright.xmp');writeFileSync(sidecar,await documents.serialize(recipe));const restored=await documents.read(sidecar);assert.equal(restored.adjustments.masks[0].details.glow,30);assert.equal(readExtension((await xmp.read(sidecar)).properties,'ARTAdjustments').glow,undefined);
  const composed=await engine.call('compose',{path:source,width:image.width,height:image.height,artProfile:restored.artProfile,adjustments:restored.adjustments}),output=join(work,'out.tif'),reopened=join(work,'reopened.tif');await engine.call('export',{path:source,artProfile:fitted.profile,output,format:'tiff',colorSpace:'srgb'});await engine.call('export',{path:source,artProfile:composed.artProfile,output:reopened,format:'tiff',colorSpace:'srgb'});
  execFileSync(python,['-c',`import tifffile,numpy as np,sys
with tifffile.TiffFile(sys.argv[1]) as f:assert f.pages[0].dtype.name=='uint16' and 34675 in f.pages[0].tags
assert np.array_equal(tifffile.imread(sys.argv[1]),tifffile.imread(sys.argv[2]))`,output,reopened]);assert.equal(hash(source),original);pass('全局标准XMP/局部typed RDF保存恢复，TIFF16与ICC、重开配方逐像素一致');
  const chart=join(work,'acr-chart.dng'),originalChart=resolve(reference,'../source/acr-chart.dng');copyFileSync(originalChart,chart);
  assert.equal(hash(chart),'fc59ff11236e6ef0cdd64edff1b4978aaa1ab79a0bcde459e636a5c672c83bce');
  const chartImage=await engine.call('open',{path:chart,sessionId:'reference',effectsDefaults:'legacy',sourceFramePolicy:'active-area-v1'});assert.equal(chartImage.width,1536);assert.equal(chartImage.height,1024);assert.equal(chartImage.sourceFrame.policy,'active-area-v1');profile=chartImage.artProfile;
  const nativeReference=[];
  for(const stem of ['glow-zero',...cases.filter(s=>!s.startsWith('glow-zero'))]){
   const actual=decodeAdjustments((await xmp.read(join(reference,stem+'-render.xmp'))).properties).adjustments;
   const controls=Object.fromEntries(Object.entries(actual).filter(([key])=>key.startsWith('glow')||key==='masks'));
   const frame=await render({...chartImage.adjustments,...controls}),path=join(work,stem+'.tif');await engine.call('export',{path:chart,artProfile:frame.profile,output:path,format:'tiff',colorSpace:'srgb'});nativeReference.push({stem,path});
  }
  const comparison=JSON.parse(execFileSync(python,['-c',`import tifffile,numpy as np,json,sys,os
cases=json.loads(sys.argv[1]);ref=sys.argv[2];b=tifffile.imread(cases[0]['path']).astype(float);ab=tifffile.imread(os.path.join(ref,'glow-zero.tif')).astype(float);out=[]
for case in cases[1:]:
 a=tifffile.imread(case['path']).astype(float);ad=tifffile.imread(os.path.join(ref,case['stem']+'.tif')).astype(float);assert a.shape==ad.shape and np.any(a!=b)
 delta=a-b;adelta=ad-ab;out.append(dict(case=case['stem'],deltaMAE16=float(np.abs(delta-adelta).mean()),candidateMAE16=float(np.abs(delta).mean()),adobeMAE16=float(np.abs(adelta).mean())))
print(json.dumps(out))`,JSON.stringify(nativeReference),reference],{encoding:'utf8'}));
  console.log(JSON.stringify({fixedACR18_7EffectDeltaComparison:comparison,scope:'RAW diagnostic only: same source and Glow/mask settings; remaining base adjustments use native defaults; no equivalence threshold passed',sourceFramePolicy:'active-area-v1',matchedBaseAdjustments:false}));
  assert.equal(hash(originalChart),hash(chart));pass('固定ACR源图和真实TIFF逐项记录效果增量差距；不以存在响应宣称画质同级');

 }
 success=true;console.log(JSON.stringify({checks,native:!process.argv.includes('--xmp-only'),acrPixelParity:false}));
}finally{if(engine)await engine.stop();if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
