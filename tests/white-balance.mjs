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
  const image=await engine.call('open',{path:resolve('build/samples',name),sessionId:name});assert.equal(image.baselineVersion,3);
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
 const legacy=await engine.call('open',{path:source,sessionId:'legacy',baselineVersion:2});assert.equal(legacy.baselineVersion,2);assert.equal(legacy.adjustments.wbMultipliers,null);
 const legacyProfile=await render('legacy',legacy);await engine.call('export',{path:source,artProfile:legacyProfile,output:join(out,'legacy.tiff'),format:'tiff'});
 const older=new EngineClient({executable:process.env.CAPTRAW_LEGACY_ENGINE||process.env.HOME+'/Applications/CaptRAW-0.3.app/Contents/Resources/native/captraw-engine',resources:process.env.CAPTRAW_LEGACY_RESOURCES||process.env.HOME+'/Applications/CaptRAW-0.3.app/Contents/Resources/native/resources',cache:'build/white-balance-legacy-reference'});
 try{
  const old=await older.call('open',{path:source,sessionId:'old'}),pending=older.preview(1);const result=await older.call('update',{revision:1,adjustments:old.adjustments});await pending;
  await older.call('export',{path:source,artProfile:result.artProfile,output:join(out,'legacy-reference.tiff'),format:'tiff'});

 }finally{await older.stop();}
 const independent=new EngineClient({cache:'build/white-balance-independent'});try{await independent.call('export',{path:source,artProfile:profile,output:join(out,'sampled-independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',results,coordinates,invalidRequestsRejected:true,sample,legacyBaseline:2},null,2)+'\n');console.log('White balance estimates, presets, sampling, coordinate invariance and legacy exports completed');
}finally{await engine.stop();}
