import {readDocument} from './xmp-test.mjs';
import {EngineClient} from './engine-client.mjs';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve,join} from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const out=resolve('artifacts/crop-workflow');mkdirSync(out,{recursive:true});const recipe=(await readDocument('artifacts/crop-workflow-gui/durable.xmp')),e=new EngineClient({cache:'build/crop-workflow-cache'}),checks=[];const pass=s=>{checks.push(s);console.log('PASS',s);};
try{
 await e.call('open',{path:recipe.source.path,sessionId:'crop',baselineVersion:recipe.baselineVersion});let profile,hash;
 for(const [i,aspect] of [recipe.adjustments.cropAspect,null].entries()){
  const p=e.preview(i+1),r=await e.call('update',{revision:i+1,adjustments:{...recipe.adjustments,cropAspect:aspect},artProfile:recipe.artProfile}),f=await p,h=createHash('sha256').update(readFileSync(f.file)).digest('hex');if(i){assert.equal(r.artProfile,profile);assert.equal(h,hash);}else{profile=r.artProfile;hash=h;}
 }pass('UI ratio locking does not add native processing or change the same crop pixels');
 for(const cropAspect of [0,-1,1e7,'square',[]])await assert.rejects(e.call('validate',{artProfile:recipe.artProfile,adjustments:{...recipe.adjustments,cropAspect}}));pass('invalid ratio metadata is rejected at the native boundary');
 await e.call('export',{path:recipe.source.path,artProfile:recipe.artProfile,output:join(out,'independent.tiff'),format:'tiff'});
 const old=new EngineClient({cache:'build/crop-workflow-012',executable:process.env.HOME+'/Applications/CaptRAW-0.12.app/Contents/Resources/native/captraw-engine',resources:process.env.HOME+'/Applications/CaptRAW-0.12.app/Contents/Resources/native/resources'});
 try{await old.call('export',{path:recipe.source.path,artProfile:recipe.artProfile,output:join(out,'previous.tiff'),format:'tiff'});}finally{await old.stop();}pass('new desktop crop exports independently through current and 0.12 native engines');
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,checks},null,2)+'\n');
}finally{await e.stop();}
