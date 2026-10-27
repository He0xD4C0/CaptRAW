import {EngineClient} from './engine-client.mjs';
import {mkdirSync,readFileSync,writeFileSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('artifacts/white-balance');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:'build/white-balance-cache'});engine.on('error',()=>{});let revision=0;
const results=[];
async function render(name,image,change={}){
 const pending=engine.preview(++revision);const response=await engine.call('update',{revision,adjustments:{...image.adjustments,...change}});const frame=await pending;
 cpSync(frame.file,join(out,name+'.png'));writeFileSync(join(out,name+'.arp'),response.artProfile);return response.artProfile;
}
try{
 for(const name of ['nikon-d850.NEF','fuji-xt4.RAF']){
  const image=await engine.call('open',{path:resolve('build/samples',name),sessionId:name});assert.equal(image.baselineVersion,4);
  assert.equal(image.adjustments.wbMultipliers.length,3);await render(name+'-initial',image);
  const camera=await engine.call('whiteBalance',{mode:'camera'});assert.equal(camera.wbMode,'camera');assert.deepEqual(camera.wbMultipliers,image.adjustments.wbMultipliers);
  const auto=await engine.call('whiteBalance',{mode:'auto'});assert.equal(auto.wbMode,'auto');await render(name+'-auto',image,auto);
  let preset;
  if(image.whiteBalancePresets.length){
   const entry=image.whiteBalancePresets[0];preset=await engine.call('whiteBalance',{mode:'preset',preset:entry.id});assert.equal(preset.wbMode,'preset:'+entry.id);
   const data=JSON.parse(readFileSync('build/native/resources/wbpresets.json','utf8').replace(/^\s*\/\/.*$/gm,''));
   const row=data.find(r=>r.make_model===image.camera.toUpperCase());assert(row,'Expected matched camera preset source');assert.deepEqual(preset.wbMultipliers,row.presets[Number(entry.id)].multipliers);
   await render(name+'-preset',image,preset);
  }
  await assert.rejects(engine.call('whiteBalance',{mode:'preset',preset:'missing'}));
  await assert.rejects(engine.call('whiteBalance',{mode:'sample',x:2,y:.5,size:11}));
  await assert.rejects(engine.call('whiteBalance',{mode:'sample',x:.5,y:.5,size:4}));
  results.push({name,presetCount:image.whiteBalancePresets.length,camera,auto,preset});
 }
 const source=resolve('build/samples/synthetic.dng'),image=await engine.call('open',{path:source,sessionId:'coordinates'}),point={x:300/(image.width-1),y:200/(image.height-1)};
 await render('sample-base',image);
 const sample=await engine.call('whiteBalance',{mode:'sample',...point,size:11});
 const coordinates=[];
 for(const rotation of [90,180,270]){
  await render('rotation-'+rotation,image,{rotation,crop:{x:.1,y:.1,width:.7,height:.7}});
  const result=await engine.call('whiteBalance',{mode:'sample',...point,size:11});
  const error=Math.max(...result.wbMultipliers.map((n,i)=>Math.abs(n-sample.wbMultipliers[i])));assert(error<1e-9,'Sampling moved across rotation: '+error);coordinates.push({rotation,maximumCoefficientDifference:error});
 }
 const profile=await render('sampled',image,sample);
 await engine.call('export',{path:source,artProfile:profile,output:join(out,'sampled.tiff'),format:'tiff'});
 await render('manual',image,{temperature:3500,tint:25,wbMode:'custom',wbMultipliers:null});
 for(const baselineVersion of [2,3,5,'4',null])await assert.rejects(engine.call('open',{path:source,sessionId:'obsolete',baselineVersion}),/Unsupported baseline/);
 const reopened=await engine.call('open',{path:source,sessionId:'current',baselineVersion:4});assert.equal(reopened.baselineVersion,4);assert.deepEqual(reopened.adjustments,image.adjustments);
 const independent=new EngineClient({cache:'build/white-balance-independent'});try{await independent.call('export',{path:source,artProfile:profile,output:join(out,'sampled-independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',results,coordinates,invalidRequestsRejected:true,sample,rejectedBaselines:[2,3,5,'4',null]},null,2)+'\n');console.log('White balance estimates, presets, sampling, coordinate invariance and obsolete baseline rejection completed');
}finally{await engine.stop();}
