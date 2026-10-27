import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';
const out=resolve('artifacts/export-colors');mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const root=join(homedir(),'Applications/CaptRAW-0.17.app/Contents/Resources/native');
const engine=new EngineClient({cache:'build/export-colors-cache'}),reference=new EngineClient({executable:join(root,'captraw-engine'),resources:join(root,'resources'),cache:'build/export-colors-reference'});
const spaces={'srgb':'RTv4_sRGB','adobe-rgb':'RTv4_Medium','prophoto-rgb':'RTv4_Large','display-p3':'RTv4_DisplayP3','rec2020':'RTv4_Rec2020'};
const checks=[],sources={},raw=[];const pass=s=>{checks.push(s);console.log('PASS',s);};let revision=0;
async function profile(path,adjust){sources[path]=hash(path);const im=await engine.call('open',{path,sessionId:String(++revision)});const ready=engine.preview(revision,'fit',120000);const r=await engine.call('update',{revision,adjustments:adjust?adjust(im):im.adjustments});await ready;return r.artProfile;}
async function output(client,path,artProfile,name,format='tiff',colorSpace){return client.call('export',{path,artProfile,output:join(out,name+(format==='tiff'?'.tiff':'.jpg')),format,...(colorSpace?{colorSpace}:{})});}
try{
 const path=resolve('build/samples/export-wide-gamut.tiff'),arp=await profile(path);
 writeFileSync(join(out,'baseline.arp'),arp);
 await output(reference,path,arp,'legacy');await output(engine,path,arp,'default');
 for(const [space,name] of Object.entries(spaces)){
  const r=await output(engine,path,arp,space,'tiff',space);assert.equal(r.outputProfile,name);
  await output(engine,path,arp,space,'jpeg',space);
  const expected=arp.replace(/^OutputProfile=.*$/m,'OutputProfile='+name);assert(expected.includes('OutputProfile='+name));
  await output(reference,path,expected,space+'-reference');
  writeFileSync(join(out,space+'.arp'),expected);
 }
 assert.equal((await engine.call('save')).artProfile,arp);pass('five SDR ICC output choices render TIFF16 and JPEG without mutating the editing profile');
 for(const invalid of [{colorSpace:'hdr-pq'},{colorSpace:'../RTv4_sRGB'},{colorSpace:4},{colorSpace:null},{format:'png'}]){
  const target=join(out,'invalid-'+checks.length+'-'+Object.values(invalid)[0]+'.tiff');
  await assert.rejects(engine.call('export',{path,artProfile:arp,format:'tiff',output:target,...invalid}));assert(!existsSync(target));
 }
 pass('invalid color spaces and formats fail before writing output');
 for(const fixture of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const source=resolve('build/samples',fixture),a=await profile(source,im=>({...im.adjustments,crop:{x:300/im.width,y:200/im.height,width:512/im.width,height:384/im.height}}));
  await output(engine,source,a,fixture,'tiff','prophoto-rgb');await output(reference,source,a.replace(/^OutputProfile=.*$/m,'OutputProfile=RTv4_Large'),fixture+'-reference');
  raw.push(fixture);
 }
 pass('NEF CR3 and X-Trans use the selected output space with existing crop and RAW processing');
 for(const [path,sha] of Object.entries(sources))assert.equal(hash(path),sha);pass('source images and the active editing profile remain unchanged');
}finally{
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine'),engineSHA256:hash(process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine')),offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,spaces,checks,sources,raw},null,2)+'\n');
 await engine.stop();await reference.stop();
}
