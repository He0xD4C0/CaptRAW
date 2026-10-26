import {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {EngineClient} from './engine-client.mjs';
const upstream=resolve('build/upstream/redlamp-libraw-3b20539d3faa766a370e93a529a3b87edffbf0f6');
const bench=join(upstream,'redlamp/bench'),out=resolve('artifacts/nikon-he'),cache=resolve('build/samples/nikon-he');
mkdirSync(out,{recursive:true});mkdirSync(cache,{recursive:true});
const manifest=JSON.parse(readFileSync(join(bench,'samples.json'))),goldens=JSON.parse(readFileSync(join(bench,'goldens.json')));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const staticMirrors={'be91bac25573adf7ec6320a542105d87b4fb9c956d7b620ec90d57ac2ae6c3f0':'https://raw.pixls.us/data/Nikon/Z%209/Nikon_-_NIKON_Z_9_-_14bit_compressed_(Lossy_High_Efficiency).NEF'};
const available=manifest.samples.filter(s=>s.mode==='HE'||s.mode==='HE*').map(s=>({...s,mirrorURL:staticMirrors[s.sha256]}));
const fixtures=available.filter(s=>(!process.env.CAPTRAW_NIKON_FILTER||s.name.includes(process.env.CAPTRAW_NIKON_FILTER))&&(!process.env.CAPTRAW_NIKON_CACHED_ONLY||(existsSync(join(cache,s.name+'.NEF'))&&hash(join(cache,s.name+'.NEF'))===s.sha256)));
assert(fixtures.length,'No HE fixtures match the selected filter');
writeFileSync(join(out,'samples.json'),JSON.stringify({source:manifest.source,samples:fixtures},null,2)+'\n');
async function download(url,file,sha){
 if(existsSync(file)&&hash(file)===sha)return;
 const fetch=resume=>new Promise((resolve,reject)=>{const p=spawn('curl',['-fsSL','--connect-timeout','15','--max-time',process.env.CAPTRAW_NIKON_TIMEOUT||'600',...(resume?['--continue-at','-']:[]),...(process.env.CAPTRAW_CURL_RESOLVE?['--resolve',process.env.CAPTRAW_CURL_RESOLVE]:[]),url,'-o',file]);let diagnostic='';p.stderr.on('data',x=>diagnostic+=x);p.once('error',reject);p.once('exit',code=>resolve({code,diagnostic}));});
 let response=await fetch(true);if(response.code===33)response=await fetch(false);
 if(response.code)throw new Error(`Download ${response.code}: ${url}: ${response.diagnostic}`);
 assert.equal(hash(file),sha);
}
let cursor=0;
const downloaded=await Promise.allSettled(Array.from({length:3},async()=>{while(cursor<fixtures.length){const s=fixtures[cursor++];await download(s.mirrorURL||s.url,join(cache,s.name+'.NEF'),s.sha256);console.log('Fetched',s.name);if(s.adobe)await download(s.adobe.url,join(cache,s.name+'.dng'),s.adobe.sha256);}}));
for(const r of downloaded)if(r.status==='rejected')throw r.reason;
const dump=resolve('build/nikon-dump');
execFileSync('clang++',['-std=c++17','-O2',join(bench,'tools/dump_raw.cpp'),'-I'+resolve('build/vendor/libraw/include'),'-L'+resolve('build/vendor/libraw/lib'),'-lraw_r','-Wl,-rpath,'+resolve('build/vendor/libraw/lib'),'-o',dump]);
const engine=new EngineClient({cache:'build/nikon-he-cache'});engine.on('error',()=>{});const results=[];
try{
 await engine.ready;
 for(const s of fixtures){
  const path=join(cache,s.name+'.NEF'),mosaic=join(out,'mosaic.u16');
  const meta=JSON.parse(execFileSync(dump,[path,mosaic],{encoding:'utf8'}));
  assert.equal(meta.unpack,0);assert.equal(meta.unsupported_flag,false);assert.equal(meta.nef_compression,s.mode==='HE'?13:14);
  const mosaicSHA256=hash(mosaic);assert.equal(mosaicSHA256,goldens[s.name].sha256,'Sensor mosaic differs from pinned upstream golden');
  let adobeIdentical;
  if(s.adobe){const ref=join(out,'adobe.u16');execFileSync(dump,[join(cache,s.name+'.dng'),ref]);adobeIdentical=hash(ref)===mosaicSHA256;assert(adobeIdentical,'Adobe reference mosaic differs');rmSync(ref);}
  const image=await engine.call('open',{path,sessionId:s.name});const pending=engine.preview(1);
  await engine.call('update',{revision:1,adjustments:image.adjustments});const frame=await pending;
  assert(frame.histogram?.every(channel=>channel.filter(n=>n>0).length>64),'Decoded preview is not a full tonal image');
  results.push({name:s.name,camera:s.camera,mode:s.mode,meta,mosaicSHA256,goldenIdentical:true,adobeIdentical,frame,sourceUnchanged:hash(path)===s.sha256});rmSync(mosaic);
  writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,availableSamples:available.length,selectedSamples:fixtures.length,cachedOnly:!!process.env.CAPTRAW_NIKON_CACHED_ONLY,commit:'3b20539d3faa766a370e93a529a3b87edffbf0f6',decoder:'fully local LGPL-2.1 LibRaw fork',results},null,2)+'\n');
  console.log('PASS',s.name,meta.unpack_ms,frame.elapsedMs,adobeIdentical??'golden');
 }
}finally{await engine.stop();}
