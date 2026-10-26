import {EngineClient} from './engine-client.mjs';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const engine=new EngineClient({cache:'build/extended-controls-cache'});engine.on('error',()=>{});mkdirSync('artifacts/extended-controls',{recursive:true});
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');const results=[];
try{
 const image=await engine.call('open',{path:resolve('build/samples/nikon-d850.NEF'),sessionId:'extended'});let revision=0;
 async function render(adjustments){const fit=engine.preview(++revision);await engine.call('update',{revision,adjustments});await fit;const detail=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:2500,y:1700,width:800,height:600});return await detail;}
 const baseline=await render(image.adjustments),baseSHA=digest(baseline.file);
 const cases=[...Object.entries({highlights:60,shadows:60,whites:60,blacks:-60,dehaze:50,vignette:-70,grain:60,sharpening:120,luminanceNoise:70,colorNoise:70,lensCorrections:true}).map(([key,value])=>[key,{[key]:value}])];
 for(const key of ['redCurve','greenCurve','blueCurve'])cases.push([key,{[key]:[{x:0,y:0},{x:.4,y:.65},{x:1,y:1}]}]);
 for(const key of ['hue','saturation','luminance']){const hsl=structuredClone(image.adjustments.hsl);hsl[key][3]=70;cases.push(['green-'+key,{hsl}]);}
 for(const [name,change] of cases){const frame=await render({...image.adjustments,...change}),changed=digest(frame.file)!==baseSHA;
  results.push({name,changed,frame});console.log(name,changed,frame.elapsedMs);if(name!=='lensCorrections')assert(changed,`${name} produced no actual pixel change`);
 }
 writeFileSync('artifacts/extended-controls/report.json',JSON.stringify({baseline,results},null,2)+'\n');
}finally{await engine.stop();}
