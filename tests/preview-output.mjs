import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';
const out=resolve('artifacts/preview-output-acceptance');mkdirSync(out,{recursive:true});
const e=new EngineClient({cache:'build/preview-output-acceptance'}),results=[];let revision=0;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function check(name,path,image,a){
 const x=Math.min(3000,Math.floor(image.width*.3)),y=Math.min(2000,Math.floor(image.height*.3)),width=Math.min(512,image.width-x),height=Math.min(384,image.height-y);
 // Export the very same original-coordinate region; no resampling or secondary color conversion.
 a={...a,crop:{x:x/image.width,y:y/image.height,width:width/image.width,height:height/image.height}};
 let pending=e.preview(++revision);const r=await e.call('update',{revision,adjustments:a});const fit=await pending;
 pending=e.preview(revision,'detail');await e.call('viewport',{revision,x,y,width,height});const detail=await pending;cpSync(detail.file,join(out,name+'.png'));
 writeFileSync(join(out,name+'.arp'),r.artProfile);
 const independent=new EngineClient({cache:'build/preview-output-export'});try{await independent.call('export',{path,artProfile:r.artProfile,output:join(out,name+'.tiff'),format:'tiff'});
  if(name.endsWith('-camera')&&image.adjustments.wbMultipliers){const reference=r.artProfile.replace('Setting=CustomMult\n','Setting=Camera\n');assert.notEqual(reference,r.artProfile);await independent.call('export',{path,artProfile:reference,output:join(out,name+'-camera-reference.tiff'),format:'tiff'});}
 }finally{await independent.stop();}
 results.push({name,path,adjustments:a,fitMs:fit.elapsedMs,detail:{x,y,width,height},storedMultipliers:a.wbMultipliers});
 console.log('PASS rendered',name);writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,results},null,2)+'\n');
}
try{
 const fixtures=JSON.parse(readFileSync('tests/fixtures.json'));
 for(const fixture of fixtures){const path=resolve('build/samples',fixture.name);assert.equal(hash(path),fixture.sha256);const image=await e.call('open',{path,sessionId:fixture.name});await check(fixture.model+'-camera',path,image,image.adjustments);assert.equal(hash(path),fixture.sha256);}
 for(const name of ['embedded-srgb.png','local-tone.png']){const path=resolve('build/samples',name),before=hash(path),image=await e.call('open',{path,sessionId:name});await check(name,path,image,image.adjustments);assert.equal(hash(path),before);}
 const path=resolve('build/samples/nikon-d850.NEF'),before=hash(path),image=await e.call('open',{path,sessionId:'wb-modes'});
 const ready=e.preview(++revision);await e.call('update',{revision,adjustments:image.adjustments});await ready;
 for(const [name,request] of [['auto',{mode:'auto'}],['preset',{mode:'preset',preset:image.whiteBalancePresets[0].id}],['sample',{mode:'sample',x:.4,y:.4,size:11}]]){const wb=await e.call('whiteBalance',request);await check('D850-'+name,path,image,{...image.adjustments,...wb});}
 await check('D850-manual',path,image,{...image.adjustments,wbMode:'custom',wbMultipliers:null,temperature:3200,tint:20});
 await check('D850-coefficient-only',path,image,{...image.adjustments,wbMultipliers:image.adjustments.wbMultipliers.map((v,i)=>v*([.85,1,1.2][i]))});
 await check('D850-matrix',path,image,{...image.adjustments,colorProfile:{mode:'matrix',toneCurve:false,lookTable:false,hueSatMap:false,baselineExposure:false,illuminant:0}});
 await check('D850-curves',path,image,{...image.adjustments,curve:[{x:0,y:0},{x:.3,y:.2},{x:.7,y:.8},{x:1,y:1}],parametricCurve:{highlights:-35,lights:40,darks:-20,shadows:30,splits:[20,48,80]}});
 assert.equal(hash(path),before);
 const manifest=JSON.parse(readFileSync('artifacts/nikon-he-0.9/samples.json'));
 for(const mode of ['HE','HE*']){const sample=manifest.samples.find(s=>s.camera.includes('Z5')&&s.mode===mode);assert(sample);const path=resolve('build/samples/nikon-he',sample.name+'.NEF');assert.equal(hash(path),sample.sha256);const image=await e.call('open',{path,sessionId:sample.name});await check(sample.name+'-camera',path,image,image.adjustments);assert.equal(hash(path),sample.sha256);}
 const report=JSON.parse(readFileSync(join(out,'report.json')));report.sourceHashesUnchanged=true;writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}finally{await e.stop();}
