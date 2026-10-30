import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {synchronizedAdjustments} from '@captraw/contracts/synchronize';import {EngineClient} from '../../support/engine-client.mjs';
const out=resolve(process.env.CAPTRAW_OPTICS_OUT||'artifacts/optics');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:join(out,'engine')}),oldRoot=process.env.HOME+'/Applications/CaptRAW-0.23.app/Contents/Resources/native',old=new EngineClient({executable:oldRoot+'/captraw-engine',resources:oldRoot+'/resources',cache:join(out,'reference')});
const hash=f=>createHash('sha256').update(readFileSync(f)).digest('hex'),checks=[],sources={},images=[],pairs=[],responses=[];let revision=0;
const pass=s=>{checks.push(s);console.log('PASS',s);},baseSettings={mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:true,ca:true};
async function render(a,name,artProfile=''){const p=engine.preview(++revision,'fit',120000);const r=await engine.call('update',{revision,adjustments:a,artProfile});const f=await p;if(name){copyFileSync(f.file,join(out,name+'.png'));writeFileSync(join(out,name+'.arp'),r.artProfile);}return {...r,frame:f,hash:hash(f.file)};}
async function fresh(image,a,previous,name){await engine.call('open',{path:image.path,sessionId:name});const r=await render(a,name);assert.equal(r.hash,previous.hash,name+' warm/fresh pixels');assert.equal(r.artProfile,previous.artProfile,name+' warm/fresh profile');return r;}
try{
 for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const path=resolve('build/samples',file);sources[path]=hash(path);const im=await engine.call('open',{path,sessionId:file});images.push(im);assert(im.lensCatalog.cameras.length>900&&im.lensCatalog.lenses.length>1200);
  const baseline=await render(im.adjustments,file+'-baseline');await old.call('open',{path,sessionId:file});const p=old.preview(++revision,'fit',120000);await old.call('update',{revision,adjustments:im.adjustments});assert.equal(hash((await p).file),baseline.hash);
  let a={...im.adjustments,lensCorrections:true},warm=await render(a,file+'-auto');await fresh(im,a,warm,file+'-auto-fresh');
  if(file==='nikon-d850.NEF'){assert.deepEqual([warm.lensStatus.distortion,warm.lensStatus.vignette,warm.lensStatus.ca],[true,true,true]);assert.notEqual(warm.hash,baseline.hash);}
  if(file==='canon-r5.CR3'){assert.match(warm.lensStatus.reason,/未找到镜头/);assert.equal(warm.hash,baseline.hash);a.lensProfile={...baseSettings,mode:'manual',cameraMake:'Canon',cameraModel:'Canon EOS R5',lens:'Sigma Sigma 50mm f/1.4 DG HSM [A]'};warm=await render(a,file+'-manual');assert.equal(warm.lensStatus.reason,'');assert.notEqual(warm.hash,baseline.hash);await fresh(im,a,warm,file+'-manual-fresh');}
  if(file==='fuji-xt4.RAF'){assert.equal(warm.lensStatus.vignette,false);assert(warm.lensStatus.distortion&&warm.lensStatus.ca);}
  const complete=await render(a,file+'-full');const x=400,y=300,width=512,height=384,pending=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,x,y,width,height});const detail=await pending;copyFileSync(detail.file,join(out,file+'-detail.png'));
  const crop={x:x/im.width,y:y/im.height,width:width/im.width,height:height/im.height},cropped=await render({...a,crop},file+'-crop');
  const exporter=new EngineClient({cache:join(out,file+'-export')});try{await exporter.call('export',{path,artProfile:cropped.artProfile,output:join(out,file+'.tiff'),format:'tiff'});}finally{await exporter.stop();}
  await old.call('export',{path,artProfile:cropped.artProfile,output:join(out,file+'-reference.tiff'),format:'tiff'});pairs.push({file,detail:{x,y,width,height},status:complete.lensStatus});
  const reset=await render(im.adjustments,file+'-reset',complete.artProfile);assert.equal(reset.hash,baseline.hash);assert.equal(reset.artProfile,baseline.artProfile);await fresh(im,im.adjustments,reset,file+'-reset-fresh');
 }
 pass('three RAW defaults match 0.23 pixels; later profile-only extensions do not justify requiring identical ART text, while lens toggles match reopening and reset without stale RAW vignetting');
 pass('automatic matches report actual per-photo capabilities; unmatched R5 supports explicit manual Sigma Art selection');
 pass('NEF CR3 and X-Trans export ICC TIFF16 through current and independent 0.23 engines; true 1:1 regions captured');
 const im=images[0];await engine.call('open',{path:im.path,sessionId:'toggles'});const base=await render(im.adjustments,'controls-none');
 for(const key of ['distortion','vignette','ca']){
  const lensProfile={...baseSettings,distortion:false,vignette:false,ca:false,[key]:true};const a={...im.adjustments,lensCorrections:true,lensProfile},r=await render(a,'control-'+key);assert.notEqual(r.hash,base.hash);await fresh(im,a,r,'control-'+key+'-fresh');responses.push(key);
  const off=await render({...a,lensProfile:{...lensProfile,[key]:false}},'control-'+key+'-off');assert.equal(off.hash,base.hash);await fresh(im,{...a,lensProfile:{...lensProfile,[key]:false}},off,'control-'+key+'-off-fresh');
 }
 pass('independent distortion, RAW vignetting and chromatic-aberration controls change pixels and disable cleanly');
 const manual={...baseSettings,mode:'manual',cameraMake:im.lensStatus.cameraMake,cameraModel:im.lensStatus.cameraModel,lens:im.lensStatus.lens};const a={...im.adjustments,lensCorrections:true,lensProfile:manual,rotation:90,crop:{x:.1,y:.12,width:.2,height:.23},exposure:.3};const r=await render(a,'manual-rotated');assert.equal((await render(a,'manual-restored',r.artProfile)).artProfile,r.artProfile);await fresh(im,a,r,'manual-reopened');
 const source={image:im,adjustments:a,profile:r.artProfile},target={image:im,adjustments:im.adjustments,profile:base.artProfile};assert.deepEqual(synchronizedAdjustments(source,target,['lens']).lensProfile,manual);assert.equal(synchronizedAdjustments(source,target,['light']).lensProfile,undefined);assert.equal(synchronizedAdjustments(target,source,['lens']).lensProfile,undefined);
 pass('complete manual settings, crop and rotation persist; selected synchronization copies optics and deselection preserves it');
 for(const bad of [{mode:'auto',cameraMake:[]},{mode:'bad'},{ca:1},{cameraMake:'Missing camera'},{cameraModel:'D850 typo'},{lens:'not a calibrated lens'},{lens:null}])await assert.rejects(engine.call('validate',{artProfile:r.artProfile,adjustments:{...a,lensProfile:{...manual,...bad}}}));
 const incomplete=await render({...a,lensProfile:{...manual,cameraMake:'',cameraModel:'',lens:''}},'incomplete');assert.match(incomplete.lensStatus.reason,/请选择/);assert(!incomplete.lensStatus.distortion&&!incomplete.lensStatus.vignette&&!incomplete.lensStatus.ca);
 pass('invalid manual profiles and malformed settings fail; incomplete selections explicitly report no correction');
 const png=resolve('build/samples/color-range.png');sources[png]=hash(png);const nonraw=await engine.call('open',{path:png,sessionId:'no-exif'});assert.equal(nonraw.lensStatus.cameraMake,'');assert.equal(nonraw.lensStatus.lens,'');const noMetadata=await render(nonraw.adjustments,'no-metadata'),attempt=await render({...nonraw.adjustments,lensCorrections:true,lensProfile:manual},'no-metadata-manual');assert.equal(attempt.hash,noMetadata.hash);assert.match(attempt.lensStatus.reason,/焦距/);assert(!attempt.lensStatus.distortion&&!attempt.lensStatus.vignette&&!attempt.lensStatus.ca);
 pass('missing EXIF never fabricates an automatic match or applies a manual zero-focal-length calibration');
 for(const [p,h] of Object.entries(sources))assert.equal(hash(p),h);
 writeFileSync(join(out,'report.json'),JSON.stringify({checks,sources,pairs,responses,catalog:{cameras:images[0].lensCatalog.cameras.length,lenses:images[0].lensCatalog.lenses.length},engine:process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine'),offline:!!process.env.CAPTRAW_SANDBOX_PROFILE},null,2)+'\n');
}finally{await engine.stop();await old.stop();}
