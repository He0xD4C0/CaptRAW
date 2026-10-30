import { EngineClient } from '../../support/engine-client.mjs';
import { resolve,join } from 'node:path';
import { readFileSync,writeFileSync,mkdirSync,cpSync,symlinkSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=process.cwd(),out=resolve(process.env.CAPTRAW_ACCEPTANCE_OUT||'artifacts/native-acceptance');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:join(out,'core-cache'),executable:process.env.CAPTRAW_ENGINE,resources:process.env.CAPTRAW_RESOURCES});
engine.on('error',()=>{});
const checksum=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const reference=join(out,'reference/Contents/MacOS/captraw-art-reference');
mkdirSync(join(out,'reference/Contents/MacOS'),{recursive:true});
cpSync(resolve('build/native/captraw-art-reference'),reference);
mkdirSync(join(out,'reference/settings'),{recursive:true});
cpSync(resolve('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/data/options/options.osx'),join(out,'reference/settings/options'));
if(!existsSync(join(out,'reference/Contents/Resources')))symlinkSync(resolve('build/native/resources'),join(out,'reference/Contents/Resources'));
const report={engine:process.env.CAPTRAW_ENGINE||'development native',platform:process.platform,arch:process.arch,images:[]};
let peakRSSKiB=0;
const sampler=setInterval(()=>{
 try{peakRSSKiB=Math.max(peakRSSKiB,Number(execFileSync('ps',['-p',String(engine.child.pid),'-o','rss='],{encoding:'utf8'}).trim()));}catch{}
},80);
let revision=0;
async function render(adjustments,profile){
 const frame=engine.preview(++revision);const start=performance.now();
 const result=await engine.call('update',{revision,adjustments,artProfile:profile||''});
 return {frame:await frame,profile:result.artProfile,ms:performance.now()-start};
}
try{
 await engine.ready;
 for(const fixture of JSON.parse(readFileSync('tests/fixtures/fixtures.json','utf8'))){
  const source=resolve('build/samples',fixture.name),start=performance.now();
  assert.equal(checksum(source),fixture.sha256);
  const image=await engine.call('open',{path:source,sessionId:fixture.model.replaceAll(' ','-')});
  const first=await render(image.adjustments);
  const item={source:fixture.name,mode:fixture.mode,width:image.width,height:image.height,firstPreviewMs:performance.now()-start,updates:[]};
  const output=join(out,`${fixture.model}.tiff`),profile=join(out,`${fixture.model}.arp`),ref=join(out,`${fixture.model}-reference.tif`);
  writeFileSync(profile,first.profile);
  await engine.call('export',{path:source,artProfile:first.profile,output,format:'tiff'});
  execFileSync(reference,['-o',ref,'-p',profile,'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:join(out,'reference/settings'),ART_CACHE:join(out,'reference/cache')},stdio:['ignore','pipe','pipe']});
  if(fixture.model==='D850'){
   for(let i=0;i<20;i++)item.updates.push((await render({...image.adjustments,exposure:(i%5)*.2})).ms);
   item.updateP95Ms=[...item.updates].sort((a,b)=>a-b)[Math.ceil(item.updates.length*.95)-1];
   assert(item.updateP95Ms<1000,`Update P95 ${item.updateP95Ms} exceeds target`);
   const adjusted=await render({...image.adjustments,exposure:1});
   const detail=engine.preview(revision,'detail');
   await engine.call('viewport',{revision,x:3000,y:2000,width:1024,height:768});
   item.detail=await detail;
   const before=engine.preview(++revision,'before');await engine.call('before',{revision});item.before=await before;
   const restored=await render({...image.adjustments,exposure:1});
   assert.equal(checksum(adjusted.frame.file),checksum(restored.frame.file),'Compare must restore exactly');
   item.adjusted=adjusted.frame;
  }
  assert(item.firstPreviewMs<5000,'First preview exceeds target');
  assert.equal(checksum(source),fixture.sha256,'Source was modified');
  report.images.push(item);console.log(fixture.model,item.firstPreviewMs,item.updateP95Ms||'');
 }
 const broken=join(out,'broken.NEF');writeFileSync(broken,'Not a RAW image');
 await assert.rejects(engine.call('open',{path:broken,sessionId:'broken'}));
 await assert.rejects(engine.call('open',{path:join(out,'missing.NEF'),sessionId:'missing'}));
 report.invalidFilesRejected=true;
 report.peakSampledRSSKiB=peakRSSKiB;
 report.offlineAndHomebrewDenied=!!process.env.CAPTRAW_SANDBOX_PROFILE;
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}finally{clearInterval(sampler);await engine.stop();}
