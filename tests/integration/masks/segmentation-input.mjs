// Generate real engine previews for native segmentation input validation.
// The installed application is never launched and no source image is written.
import {EngineClient} from '../../support/engine-client.mjs';
import {resolve,join} from 'node:path';import {homedir} from 'node:os';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=resolve('artifacts/segmentation-input'),native=join(homedir(),'Applications/CaptRAW-0.26.app/Contents/Resources/native');mkdirSync(join(out,'inputs'),{recursive:true});
const engine=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(out,'cache')});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),rows=[];let revision=0;
try{
 for(const name of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const path=resolve('build/samples',name),before=hash(path),image=await engine.call('open',{path,sessionId:name});
  const wait=engine.preview(++revision,'fit',120000);await engine.call('update',{revision,adjustments:image.adjustments});const frame=await wait;
  const input=join(out,'inputs',name+'.png');copyFileSync(frame.file,input);assert.equal(hash(path),before);
  rows.push({source:path,sourceSHA256:before,input,inputSHA256:hash(input),width:frame.width,height:frame.height,fullWidth:frame.fullWidth,fullHeight:frame.fullHeight});
 }
}finally{await engine.stop();}
writeFileSync(join(out,'engine-inputs.json'),JSON.stringify({engine:join(native,'captraw-engine'),engineSHA256:hash(join(native,'captraw-engine')),offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,rows},null,2)+'\n');
console.log('PASS',rows.length,'real RAW sRGB PNG previews');
