import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';
const out=resolve(process.env.CAPTRAW_CROPPED_TONE_OUT||'artifacts/cropped-tone');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:join(out,'preview')}),exporter=new EngineClient({cache:join(out,'export')});
const referenceRoot=process.env.CAPTRAW_CROP_REFERENCE||join(process.env.HOME,'Applications/CaptRAW-0.39.app/Contents/Resources/native');
const old=new EngineClient({cache:join(out,'old'),executable:join(referenceRoot,'captraw-engine'),resources:join(referenceRoot,'resources')});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),cases=[],sources={};let revision=0,passed=false;
const tone={highlights:25,shadows:0,whites:0,blacks:0};
const linear={id:'tone',name:'局部明暗',type:'linear',enabled:true,inverted:false,feather:20,points:[],start:{x:.1,y:.15},end:{x:.85,y:.9},brightness:.25,contrast:0,saturation:0,tone};
const radial={...linear,id:'second',type:'radial',start:{x:.15,y:.2},end:{x:.85,y:.85},feather:40,tone:{highlights:-30,shadows:40,whites:-15,blacks:20},whiteBalance:{temperature:15,tint:-10}};
async function check(image,name,change={}){
 const adjustments={...image.adjustments,crop:{x:.15,y:.2,width:.55,height:.6},masks:[linear],...change};
 let pending=engine.preview(++revision);const {artProfile}=await engine.call('update',{revision,adjustments,maskId:adjustments.masks[0].id,luminance:true});const fit=await pending;
 const crop=artProfile.match(/\[Crop\]\n([^[]+)/)[1],get=k=>Number(crop.match(new RegExp('^'+k+'=(.+)$','m'))[1]);
 const rect={x:get('X'),y:get('Y'),width:get('W'),height:get('H')};
 pending=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,...rect});const frame=await pending;
 assert.deepEqual([frame.x,frame.y,frame.width,frame.height],Object.values(rect));
 copyFileSync(frame.file,join(out,name+'.png'));copyFileSync(fit.file,join(out,name+'-fit.png'));writeFileSync(join(out,name+'.arp'),artProfile);
 assert(frame.mask&&frame.luminance);for(const kind of ['mask','luminance']){assert.deepEqual([frame[kind].x,frame[kind].y,frame[kind].width,frame[kind].height],Object.values(rect));copyFileSync(frame[kind].file,join(out,name+'-'+kind+'.png'));}
 await exporter.call('export',{path:image.path,artProfile,output:join(out,name+'.tiff'),format:'tiff'});
 await old.call('export',{path:image.path,artProfile,output:join(out,name+'-old.tiff'),format:'tiff'});
 if(name==='nikon-d850.NEF'){
  await old.call('open',{path:image.path,sessionId:'old'});let p=old.preview(1);await old.call('update',{revision:1,adjustments});await p;
  p=old.preview(1,'detail',120000);await old.call('viewport',{revision:1,...rect});copyFileSync((await p).file,join(out,name+'-old-preview.png'));
 }
 // A second viewport must come from the same full-context cache without shifting planes.
 const pan={x:rect.x+13,y:rect.y+11,width:rect.width-26,height:rect.height-22};
 pending=engine.preview(revision,'detail');await engine.call('viewport',{revision,...pan});const cached=await pending;copyFileSync(cached.file,join(out,name+'-pan.png'));
 const record={name,rect,pan,fitSize:[fit.width,fit.height],fullSize:[fit.fullWidth,fit.fullHeight],source:image.path};
 execFileSync('build/qa-venv/bin/python',['-c',`from pathlib import Path
from PIL import Image
import numpy as np,tifffile,json,sys
p=Path(sys.argv[1]);c=json.loads(sys.argv[2]);n=c['name'];a=np.array(Image.open(p/(n+'.png')));b=tifffile.imread(p/(n+'.tiff'));old=tifffile.imread(p/(n+'-old.tiff'))
assert b.dtype==np.uint16 and np.array_equal(b,old),(n,'export changed')
reference=np.rint(b.astype(float)/257);d=np.abs(a-reference)
r={'name':n,'maximumDifference':float(d.max()),'differentSamples':int(np.count_nonzero(d)),'exportUnchanged':True}
if n=='nikon-d850.NEF':
 old_preview=np.array(Image.open(p/(n+'-old-preview.png')));r['oldPreviewDifference']=float(np.abs(old_preview-reference).max());assert r['oldPreviewDifference']>0,r
(p/(n+'-pixels.json')).write_text(json.dumps(r,indent=2));assert r['maximumDifference']==0,r
pan=np.array(Image.open(p/(n+'-pan.png')));assert np.array_equal(pan,a[11:-11,13:-13]),(n,'cached pan')
if c['fitSize']==c['fullSize']:
 f=np.array(Image.open(p/(n+'-fit.png')));q=c['rect'];assert np.array_equal(f[q['y']:q['y']+q['height'],q['x']:q['x']+q['width']],a),(n,'fit differs')
`,out,JSON.stringify(record)]);cases.push({...record,pixels:JSON.parse(readFileSync(join(out,name+'-pixels.json'),'utf8'))});console.log('PASS',name);
}
try{
 for(const file of ['local-tone.png','nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const path=resolve('build/samples',file);sources[path]=hash(path);const image=await engine.call('open',{path,sessionId:file});
  if(file==='local-tone.png'){
   await check(image,'linear');
   for(const rotation of [0,90,180,270])await check(image,'overlap-'+rotation,{rotation,masks:[linear,radial]});
   await check(image,'bottom-right',{crop:{x:.4,y:.45,width:.6,height:.55},masks:[{...radial,inverted:true}]});
   await check(image,'global-and-local',{highlights:-20,shadows:25,texture:10,masks:[linear,radial]});
  }else await check(image,file,file==='nikon-d850.NEF'?{crop:{x:900/image.width,y:1100/image.height,width:3101/image.width,height:2207/image.height}}:{});
 }
 for(const [path,before] of Object.entries(sources))assert.equal(hash(path),before);
 passed=true;
}finally{
 await engine.stop();await exporter.stop();await old.stop();
 writeFileSync(join(out,'report.json'),JSON.stringify({status:passed?'passed':'failed',engine:process.env.CAPTRAW_ENGINE||'development',referenceRoot,offline:!!process.env.CAPTRAW_SANDBOX_PROFILE,cases,sources},null,2)+'\n');
}
