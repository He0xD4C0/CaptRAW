import {EngineClient,explicitFreshCurveMode} from './engine-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=resolve('artifacts/black-white');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:'build/black-white-cache'});engine.on('error',()=>{});
const legacy=new EngineClient({executable:process.env.CAPTRAW_BW_LEGACY_ENGINE||process.env.HOME+'/Applications/CaptRAW-0.5.app/Contents/Resources/native/captraw-engine',resources:process.env.CAPTRAW_BW_LEGACY_RESOURCES||process.env.HOME+'/Applications/CaptRAW-0.5.app/Contents/Resources/native/resources',cache:'build/black-white-legacy'});legacy.on('error',()=>{});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let revision=0;
const report={engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,images:[],checks:[]};
async function render(image,adjustments,name,artProfile=''){
 const pending=engine.preview(++revision);const result=await engine.call('update',{revision,adjustments,artProfile});const frame=await pending;
 cpSync(frame.file,join(out,name+'.png'));writeFileSync(join(out,name+'.arp'),result.artProfile);
 return {profile:result.artProfile,sha256:hash(frame.file)};
}
try{
 for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const source=resolve('build/samples',file),sourceHash=hash(source),image=await engine.call('open',{path:source,sessionId:file});
  assert.deepEqual(image.adjustments.blackWhite.base.weights,[33,33,33]);assert.equal(image.adjustments.blackWhite.base.preset,'RGB-Rel');
  const original=await render(image,image.adjustments,file+'-color');
  const old=await legacy.call('open',{path:source,sessionId:'old'}),pending=legacy.preview(1),oldResult=await legacy.call('update',{revision:1,adjustments:old.adjustments});const oldFrame=await pending;
  assert.equal(original.sha256,hash(oldFrame.file),'Default preview changed');assert.equal(original.profile,explicitFreshCurveMode(oldResult.artProfile),'Default native parameters changed');
  const blackWhite={...image.adjustments.blackWhite,enabled:true,mixer:[20,-20,0,45,0,-40,15,0]};
  const mono=await render(image,{...image.adjustments,blackWhite},file+'-mono');assert.notEqual(mono.sha256,original.sha256);
  const restored=await render(image,{...image.adjustments,blackWhite:{...blackWhite,enabled:false}},file+'-restored');assert.equal(restored.sha256,original.sha256,'Switching to color changed prior edits');
  if(file==='nikon-d850.NEF'){
   await engine.call('export',{path:source,artProfile:mono.profile,output:join(out,'raw-mono.tiff'),format:'tiff'});
   const reference=resolve('build/reference/Contents/MacOS/captraw-art-reference');mkdirSync(resolve('build/reference/Contents/MacOS'),{recursive:true});cpSync('build/native/captraw-art-reference',reference);mkdirSync(resolve('build/reference/settings'),{recursive:true});cpSync('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/data/options/options.osx','build/reference/settings/options');if(!existsSync('build/reference/Contents/Resources'))symlinkSync(resolve('build/native/resources'),'build/reference/Contents/Resources');
   execFileSync(reference,['-o',join(out,'raw-reference.tif'),'-p',join(out,file+'-mono.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:['ignore','pipe','pipe']});
   writeFileSync(join(out,'legacy-05.captraw.json'),JSON.stringify({schemaVersion:1,engineVersion:'CaptRAW-4_ART-1.26.10_LibRaw-3b20539',baselineVersion:3,source:{path:source,size:readFileSync(source).length,sha256:sourceHash},artProfile:oldResult.artProfile,adjustments:old.adjustments},null,2));
  }
  assert.equal(hash(source),sourceHash);report.images.push({file,defaultMatches05:true,colorRestoreIdentical:true,sourceUnchanged:true});console.log('PASS color, B&W and restore',file);
 }
 const source=resolve('build/samples/bw-swatches.png'),image=await engine.call('open',{path:source,sessionId:'swatches'}),bw={...image.adjustments.blackWhite,enabled:true};
 await render(image,{...image.adjustments,blackWhite:bw},'swatches-neutral');
 for(let i=0;i<8;++i){const mixer=Array(8).fill(0);mixer[i]=60;await render(image,{...image.adjustments,blackWhite:{...bw,mixer}},'band-'+i);}
 const hsl=structuredClone(image.adjustments.hsl);hsl.saturation[3]=25;hsl.luminance[5]=-25;
 const edits={...image.adjustments,hsl,exposure:.3,curve:[{x:0,y:0},{x:.4,y:.5},{x:1,y:1}]};const edited=await render(image,edits,'edited-color');
 const mixed=await render(image,{...edits,blackWhite:{...bw,mixer:[20,0,-30,45,0,-40,15,0]}},'edited-mono');
 assert.equal((await render(image,{...edits,blackWhite:{...bw,enabled:false,mixer:[20,0,-30,45,0,-40,15,0]}},'edited-restored')).sha256,edited.sha256);
 const checked=await engine.call('validate',{artProfile:mixed.profile,adjustments:{...edits,blackWhite:{...bw,mixer:[20,0,-30,45,0,-40,15,0]}}});assert.deepEqual(checked.blackWhite.mixer,[20,0,-30,45,0,-40,15,0]);
 const independent=new EngineClient({cache:'build/black-white-independent'});try{await independent.call('export',{path:source,artProfile:mixed.profile,output:join(out,'saved.tiff'),format:'tiff'});}finally{await independent.stop();}
 await engine.call('export',{path:source,artProfile:mixed.profile,output:join(out,'current.tiff'),format:'tiff'});
 for(const blackWhite of [{...bw,mixer:[1]},{...bw,enabled:'yes'},{...bw,mixer:[101,0,0,0,0,0,0,0]},{...bw,mixer:[.5,0,0,0,0,0,0,0]}])await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...image.adjustments,blackWhite}}));
 const legacyProfile=edited.profile.replace(/\[Black & White\][\s\S]*?(?=\n\[)/,section=>section.replace('Enabled=false','Enabled=true').replace('GammaRed=0','GammaRed=-15').replace('Filter=None','Filter=Red'));
 const oldAdjustments={...edits};delete oldAdjustments.blackWhite;
 const migrated=await engine.call('validate',{artProfile:legacyProfile,adjustments:oldAdjustments});assert.equal(migrated.blackWhite.enabled,true);assert.equal(migrated.blackWhite.base.gamma[0],-15);assert.equal(migrated.blackWhite.base.filter,'Red');
 const restoredProfile=(await render(image,{...oldAdjustments,blackWhite:migrated.blackWhite},'legacy-bw',legacyProfile)).profile;
 await engine.call('export',{path:source,artProfile:restoredProfile,output:join(out,'legacy.tiff'),format:'tiff'});await legacy.call('export',{path:source,artProfile:legacyProfile,output:join(out,'legacy-reference.tiff'),format:'tiff'});
 report.checks=['eight bands render','color HSL and curve edits survive mode switching','saved native mixer reads back exactly','independent process exports saved B&W','legacy filter and gamma are retained','invalid mixer data is rejected'];
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}finally{await engine.stop();await legacy.stop();}
