import {EngineClient,explicitFreshCurveMode} from './engine-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=resolve('artifacts/repair');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:'build/repair-cache'}),checks=[];engine.on('error',()=>{});let revision=0;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const pass=s=>{checks.push(s);console.log('PASS',s);};
async function render(adjustments,name,artProfile=''){
 const p=engine.preview(++revision);const result=await engine.call('update',{revision,adjustments,artProfile});const frame=await p;
 cpSync(frame.file,join(out,name+'.png'));writeFileSync(join(out,name+'.arp'),result.artProfile);return {profile:result.artProfile,hash:hash(frame.file),frame};
}
const spot={id:'one',name:'仿制色块',enabled:true,method:'clone',source:{x:256/1023,y:200/767},target:{x:716/1023,y:200/767},radius:30,feather:50,opacity:100,detail:0,retainTexture:false};
try{
 const source=resolve('build/samples/repair-source.png'),originalHash=hash(source),image=await engine.call('open',{path:source,sessionId:'repair'}),a=image.adjustments;
 assert.deepEqual(a.spots,[]);const baseline=await render(a,'baseline');
 const legacy=new EngineClient({executable:process.env.HOME+'/Applications/CaptRAW-0.6.app/Contents/Resources/native/captraw-engine',resources:process.env.HOME+'/Applications/CaptRAW-0.6.app/Contents/Resources/native/resources',cache:'build/repair-old-cache'});
 try{const old=await legacy.call('open',{path:source,sessionId:'legacy'}),p=legacy.preview(1),r=await legacy.call('update',{revision:1,adjustments:old.adjustments});assert.equal(hash((await p).file),baseline.hash);assert.equal(explicitFreshCurveMode(r.artProfile),baseline.profile);}finally{await legacy.stop();}pass('neutral rendering matches 0.6 with explicit second-curve mode metadata');
 const cloned=await render({...a,spots:[spot]},'clone');assert.notEqual(cloned.hash,baseline.hash);
 assert.equal((await render({...a,spots:[{...spot,enabled:false}]},'disabled')).hash,baseline.hash);assert.equal((await render({...a,spots:[{...spot,opacity:0}]},'transparent')).hash,baseline.hash);
 await render({...a,spots:[{...spot,opacity:50}]},'half');await render({...a,spots:[{...spot,feather:0}]},'hard');pass('clone, feather and opacity use native processing; disabled and transparent points are neutral');
 const dust={...spot,source:{x:256/1023,y:460/767},target:{x:716/1023,y:460/767},radius:24,feather:50};
 await render({...a,spots:[dust]},'dust-clone');const healed=await render({...a,spots:[{...dust,method:'heal'}]},'heal');assert.notEqual(healed.hash,cloned.hash);await render({...a,spots:[{...dust,method:'heal',detail:3}]},'heal-detail');await render({...a,spots:[{...dust,retainTexture:true}]},'texture');
 for(const rotation of [90,180,270]){await render({...a,rotation,spots:[spot]},'rotate-'+rotation);const projected=await engine.call('open',{path:source,sessionId:'project',artProfile:readFileSync(join(out,'rotate-'+rotation+'.arp'),'utf8')});assert(Math.abs(projected.recipeSpots[0].source.x-spot.source.x)<.002);assert(Math.abs(projected.recipeSpots[0].target.y-spot.target.y)<.002);}pass('legacy rotated native geometry projects into stable image coordinates');
 const restored=await render({...a,spots:[spot]},'restored',cloned.profile);assert.equal(restored.hash,cloned.hash);const projected=await engine.call('open',{path:source,sessionId:'legacy-spots',artProfile:cloned.profile});assert.equal(projected.recipeSpots.length,1);
 assert.equal((await render({...a,spots:projected.recipeSpots},'projected',cloned.profile)).hash,cloned.hash);pass('legacy native repair entries restore without duplicate processing');
 const repeated=await render({...a,spots:[spot]},'repeat',cloned.profile);assert.equal(repeated.profile,cloned.profile);
 const pending=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:650,y:140,width:140,height:120});const detail=await pending;cpSync(detail.file,join(out,'detail.png'));writeFileSync(join(out,'detail.json'),JSON.stringify(detail));
 await render({...a,crop:{x:.6,y:.1,width:.25,height:.3},spots:[spot]},'crop');
 await engine.call('export',{path:source,artProfile:cloned.profile,output:join(out,'clone.tiff'),format:'tiff'});
 const independent=new EngineClient({cache:'build/repair-independent'});try{await independent.call('export',{path:source,artProfile:cloned.profile,output:join(out,'independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 const reference=resolve('build/reference/Contents/MacOS/captraw-art-reference');cpSync('build/native/captraw-art-reference',reference);
 execFileSync(reference,['-a','-o',join(out,'reference.tif'),'-p',join(out,'clone.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:['ignore','pipe','pipe']});pass('detail with offscreen source, crop and independent 16-bit export complete');
 for(const change of [{method:'fake'},{radius:201},{radius:1},{feather:-1},{opacity:101},{source:{x:-.1,y:.5}},{target:{x:1.1,y:.5}},{detail:4,method:'heal'},{enabled:'yes'}])await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...a,spots:[{...spot,...change}]}}));
 await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...a,spots:{}}}));pass('invalid repair data rejected at native boundary');
 const invalidProfile=cloned.profile.replace(/Spot1=.*\n/,'Spot1=99999;200;716;200;30;0.5;1;0;\n');
 await assert.rejects(engine.call('open',{path:source,sessionId:'invalid-geometry',artProfile:invalidProfile}),/超出/);
 await assert.rejects(engine.call('update',{revision:++revision,adjustments:a}),/No image/);
 await engine.call('open',{path:source,sessionId:'recovered'});assert.equal((await render(a,'recovered')).hash,baseline.hash);pass('post-load geometry failure closes mismatched core; reloading restores original image');
 assert.equal(hash(source),originalHash);
 const raw=[];for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){const path=resolve('build/samples',file),before=hash(path),img=await engine.call('open',{path,sessionId:file});const r=await render({...img.adjustments,spots:[{...spot,method:'heal',radius:100,source:{x:.3,y:.4},target:{x:.6,y:.4}}]},file);if(file==='nikon-d850.NEF'){await engine.call('export',{path,artProfile:r.profile,output:join(out,'raw.tiff'),format:'tiff'});execFileSync(reference,['-o',join(out,'raw-reference.tif'),'-p',join(out,file+'.arp'),'-t','-b16','-Y','-c',path],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:['ignore','pipe','pipe']});}assert.equal(hash(path),before);raw.push(file);}pass('NEF, CR3 and RAF repair previews render with unchanged sources');
 for(const threads of [1,2,8]){const e=new EngineClient({cache:'build/heal-threads-'+threads,env:{OMP_NUM_THREADS:String(threads)}});try{await e.call('export',{path:resolve('build/samples/nikon-d850.NEF'),artProfile:readFileSync(join(out,'nikon-d850.NEF.arp'),'utf8'),output:join(out,'threads-'+threads+'.tiff'),format:'tiff'});}finally{await e.stop();}}pass('healing exports complete in separate processes at 1, 2 and 8 OpenMP threads');
 const serial=new EngineClient({executable:process.env.HOME+'/Applications/CaptRAW-0.6.app/Contents/Resources/native/captraw-engine',resources:process.env.HOME+'/Applications/CaptRAW-0.6.app/Contents/Resources/native/resources',cache:'build/heal-serial-reference',env:{OMP_NUM_THREADS:'1'}});try{await serial.call('export',{path:resolve('build/samples/nikon-d850.NEF'),artProfile:readFileSync(join(out,'nikon-d850.NEF.arp'),'utf8'),output:join(out,'old-serial.tiff'),format:'tiff'});}finally{await serial.stop();}

 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,checks,raw},null,2)+'\n');
}finally{await engine.stop();}
