import {EngineClient,explicitFreshCurveMode} from '../../support/engine-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=resolve('artifacts/local-details');mkdirSync(out,{recursive:true});const engine=new EngineClient({cache:'build/local-details-cache'});engine.on('error',()=>{});let revision=0;
let peakSampledRSSKiB=0;const sampler=process.env.CAPTRAW_SANDBOX_PROFILE?setInterval(()=>{try{peakSampledRSSKiB=Math.max(peakSampledRSSKiB,Number(execFileSync('ps',['-p',String(engine.child.pid),'-o','rss='],{encoding:'utf8'}).trim()));}catch{}},100):undefined;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),checks=[];const pass=s=>{checks.push(s);console.log('PASS',s);};
async function render(adjustments,name,artProfile=''){
 const p=engine.preview(++revision);const result=await engine.call('update',{revision,adjustments,artProfile,maskId:'local'});const frame=await p;cpSync(frame.file,join(out,name+'.png'));if(frame.mask)cpSync(frame.mask.file,join(out,name+'-mask.png'));writeFileSync(join(out,name+'.arp'),result.artProfile);return {frame,profile:result.artProfile,hash:hash(frame.file)};
}
const details={hue:0,texture:0,clarity:0,noise:0,noiseDetail:50};
const mask={id:'local',name:'局部细节',type:'radial',enabled:true,inverted:false,feather:15,brightness:0,contrast:0,saturation:0,points:[],start:{x:.2,y:.15},end:{x:.8,y:.95}};
try{
 const source=resolve('build/samples/local-details.png'),sourceHash=hash(source),image=await engine.call('open',{path:source,sessionId:'local'}),a={...image.adjustments,masks:[mask]},baseline=await render(a,'baseline');
 const old=new EngineClient({executable:process.env.HOME+'/Applications/CaptRAW-0.7.app/Contents/Resources/native/captraw-engine',resources:process.env.HOME+'/Applications/CaptRAW-0.7.app/Contents/Resources/native/resources',cache:'build/local-details-old'});
 try{await old.call('open',{path:source,sessionId:'old'});const p=old.preview(1),r=await old.call('update',{revision:1,adjustments:a});assert.equal(hash((await p).file),baseline.hash);assert.equal(explicitFreshCurveMode(r.artProfile),baseline.profile);}finally{await old.stop();}pass('legacy mask pixels match 0.7 with explicit second-curve mode metadata');
 assert.equal((await render({...a,masks:[{...mask,details}]},'neutral')).profile,baseline.profile);pass('neutral optional controls preserve existing processing exactly');
 const values={hue:55,texture:70,clarity:60,noise:80};
 for(const [key,v] of Object.entries(values)){
  const m={...mask,details:{...details,[key]:v}},r=await render({...a,masks:[m]},key);assert.notEqual(r.hash,baseline.hash,key);
  const p=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:400,y:350,width:160,height:140});const frame=await p;cpSync(frame.file,join(out,key+'-detail.png'));writeFileSync(join(out,key+'-detail.json'),JSON.stringify(frame));
  const pan=engine.preview(++revision,'detail');await engine.call('viewport',{revision,x:520,y:410,width:120,height:100});const panned=await pan;cpSync(panned.file,join(out,key+'-pan.png'));if(panned.mask)cpSync(panned.mask.file,join(out,key+'-pan-mask.png'));writeFileSync(join(out,key+'-pan.json'),JSON.stringify(panned));
  const disabled=await render({...a,masks:[{...m,enabled:false}]},key+'-disabled',r.profile);const clean=await render({...a,masks:[]},'clean');assert.equal(disabled.hash,clean.hash,key+' disable');
  const reverted=await render(a,key+'-reverted',r.profile);assert.equal(reverted.profile,baseline.profile,key+' undo profile');assert.equal(reverted.hash,baseline.hash,key+' undo pixels');
 }
 pass('hue, texture, clarity and noise render, support detail views and revert without residue');
 const combo={...a,masks:[{...mask,details:{...details,hue:25,texture:35,clarity:25,noise:65}}]},r=await render(combo,'combined');
 await render({...combo,masks:combo.masks.map(m=>({...m,inverted:true}))},'inverted');
 const repeated=await render(combo,'repeated',r.profile);assert.equal(repeated.profile,r.profile);assert.equal(repeated.hash,r.hash);
 const clone=await render({...combo,masks:[...combo.masks,{...combo.masks[0],id:'copy',name:'副本'}]},'duplicated',r.profile);assert.notEqual(clone.hash,r.hash);assert.equal((await render(combo,'copy-removed',clone.profile)).hash,r.hash);pass('combined filters, inversion, repeated updates and duplicate removal preserve module ownership');
 await engine.call('export',{path:source,artProfile:r.profile,output:join(out,'current.tiff'),format:'tiff'});const independent=new EngineClient({cache:'build/local-details-independent'});try{await independent.call('export',{path:source,artProfile:r.profile,output:join(out,'independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 const reference=resolve('build/reference/Contents/MacOS/captraw-art-reference');cpSync('build/native/captraw-art-reference',reference);execFileSync(reference,['-a','-o',join(out,'reference.tif'),'-p',join(out,'combined.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:['ignore','pipe','pipe']});pass('saved local filters export in an independent worker and ART CLI');
 const inheritedProfile=baseline.profile.replace('[TextureBoost]\nEnabled=false\nStrength=0','[TextureBoost]\nEnabled=true\nStrength=0.25');const inherited=await render(a,'inherited',inheritedProfile);await render(combo,'inherited-plus-owned',inherited.profile);assert.equal((await render(a,'inherited-restored')).profile,inherited.profile);pass('active independent native detail settings survive add and removal of owned regions');
 const rotated=await render({...combo,rotation:90},'rotated');const region=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:250,y:300,width:180,height:160});const rotatedFrame=await region;cpSync(rotatedFrame.file,join(out,'rotated-detail.png'));writeFileSync(join(out,'rotated-detail.json'),JSON.stringify(rotatedFrame));
 for(const d of [{texture:101},{clarity:-101},{hue:181},{noise:-1},{noiseDetail:101}])await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...a,masks:[{...mask,details:{...details,...d}}]}}));pass('out-of-range local controls are rejected');
 const disabledInherited=baseline.profile.replace('[TextureBoost]\nEnabled=false\nStrength=0','[TextureBoost]\nEnabled=false\nStrength=0.5');
 // Unknown dormant native parameters must never silently become active.
 assert.notEqual(disabledInherited,baseline.profile);await assert.rejects(engine.call('update',{revision:++revision,artProfile:disabledInherited,adjustments:{...a,masks:[{...mask,details:{...details,texture:20}}]}}),/停用/);
 const raw=[];for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){const path=resolve('build/samples',file),before=hash(path),img=await engine.call('open',{path,sessionId:file}),recipe={...img.adjustments,masks:[{...mask,details:{...details,texture:25,clarity:15,noise:25}}]},r=await render(recipe,file);
  if(file==='nikon-d850.NEF'){const p=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,x:3000,y:2000,width:512,height:384});const f=await p;cpSync(f.file,join(out,'raw-detail.png'));const pan=engine.preview(++revision,'detail');await engine.call('viewport',{revision,x:3200,y:2100,width:512,height:384});const panned=await pan;raw.push({file,fitMs:r.frame.elapsedMs,detailMs:f.elapsedMs,panMs:panned.elapsedMs});await engine.call('export',{path,artProfile:r.profile,output:join(out,'raw-local.tiff'),format:'tiff'});execFileSync(reference,['-o',join(out,'raw-local-reference.tif'),'-p',join(out,file+'.arp'),'-t','-b16','-Y','-c',path],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:['ignore','pipe','pipe']});}else raw.push({file,fitMs:r.frame.elapsedMs});assert.equal(hash(path),before);
 }pass('three real RAW formats render local filters; D850 1:1 uses full context');
 assert.equal(hash(source),sourceHash);writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,checks,raw,peakSampledRSSKiB:peakSampledRSSKiB||null},null,2)+'\n');
}finally{if(sampler)clearInterval(sampler);await engine.stop();}
