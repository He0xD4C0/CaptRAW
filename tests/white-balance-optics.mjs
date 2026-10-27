import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';

const out=resolve(process.env.CAPTRAW_WB_OPTICS_OUT||'artifacts/wb-optics-regression');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:join(out,'cache')}),rows=[];let revision=0;
const oldRoot=resolve(process.env.HOME,'Applications/CaptRAW-0.35.app/Contents/Resources/native');
const old=new EngineClient({executable:join(oldRoot,'captraw-engine'),resources:join(oldRoot,'resources'),cache:join(out,'reference')});
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const inverse=(x,y,rotation)=>rotation===90?[y,1-x]:rotation===180?[1-x,1-y]:rotation===270?[1-y,x]:[x,y];
try{
 for(const file of ['wb-optics.png','wb-optics.dng']){
  const path=resolve('build/samples',file),before=hash(path);
  const image=await engine.call('open',{path,sessionId:file});
  await old.call('open',{path,sessionId:file});
  let reference;
  for(const mode of ['auto','manual'])for(const rotation of [0,90,180,270])for(const enabled of [false,true])for(const ca of enabled?[false,true]:[false]){
   const lensProfile={mode,cameraMake:mode==='manual'?image.lensStatus.cameraMake:'',cameraModel:mode==='manual'?image.lensStatus.cameraModel:'',lens:mode==='manual'?image.lensStatus.lens:'',distortion:true,vignette:false,ca};
   const adjustments={...image.adjustments,rotation,crop:{x:.02,y:.02,width:.96,height:.96},lensCorrections:enabled,lensProfile};
   const pending=engine.preview(++revision);
   const response=await engine.call('update',{revision,adjustments});
   const frame=await pending;
   const previous=old.preview(revision);await old.call('update',{revision,adjustments});const oldFrame=await previous;
   assert.equal(hash(frame.file),hash(oldFrame.file),'Fixed-recipe rendering must not change');
   if(enabled){assert(response.lensStatus.distortion);if(ca)assert(response.lensStatus.ca);}
   // Locate the actual rendered target, rather than duplicating the native warp.
   const xy=JSON.parse(execFileSync('build/qa-venv/bin/python',['-c',
    'from PIL import Image;import numpy as np,json,sys;a=np.array(Image.open(sys.argv[1]));y,x=np.where(a[:,:,2].astype(float)>a[:,:,0].astype(float)+30);k=(x<150)&(y<150);assert k.sum()>4;print(json.dumps([float(x[k].mean()),float(y[k].mean())]))',frame.file],{encoding:'utf8'}));
   const [x,y]=inverse(xy[0]/(frame.width-1),xy[1]/(frame.height-1),rotation);
   const value=await engine.call('whiteBalance',{mode:'sample',x,y,size:3});
   reference??=value;
   const difference=Math.max(...value.wbMultipliers.map((v,i)=>Math.abs(v-reference.wbMultipliers[i])));
   assert(difference<1e-9,`${file} ${rotation} optics=${enabled} CA=${ca}: ${difference}`);
   let oldValue;
   if(rotation===0&&enabled&&!ca){
    oldValue=await old.call('whiteBalance',{mode:'sample',x,y,size:3});
    assert(Math.abs(oldValue.wbMultipliers[0]-value.wbMultipliers[0])>.3,'Regression must fail in the previous core');
   }
   copyFileSync(frame.file,join(out,`${file}-${mode}-${rotation}-${enabled}-${ca}.png`));
   rows.push({file,mode,rotation,enabled,ca,xy,value,difference,oldValue,previewUnchanged:true});
  }
  assert.equal(hash(path),before);
 }
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',rows},null,2)+'\n');
 console.log(`PASS ${rows.length} rendered-target samples: RGB/Bayer, crop, four rotations, distortion and CA`);
}finally{await engine.stop();await old.stop();}
