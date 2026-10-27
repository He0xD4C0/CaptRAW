import {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {EngineClient} from './engine-client.mjs';
const upstream=resolve('build/upstream/redlamp-libraw-3b20539d3faa766a370e93a529a3b87edffbf0f6');
const bench=join(upstream,'redlamp/bench'),out=resolve(process.env.CAPTRAW_NIKON_OUT||'artifacts/nikon-he'),cache=resolve('build/samples/nikon-he');
mkdirSync(out,{recursive:true});mkdirSync(cache,{recursive:true});
const manifest=JSON.parse(readFileSync(join(bench,'samples.json'))),goldens=JSON.parse(readFileSync(join(bench,'goldens.json')));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const staticMirrors={
 'be91bac25573adf7ec6320a542105d87b4fb9c956d7b620ec90d57ac2ae6c3f0':'https://raw.pixls.us/download/data/Nikon/Z%209/Nikon_-_NIKON_Z_9_-_14bit_compressed_(Lossy_High_Efficiency).NEF',
 'e113deb305d84153b26251ce259d1f839be1f36b048cbe83a4548cbda806c0f5':'https://raw.pixls.us/download/data/Nikon/Z%209/Nikon_-_NIKON_Z_9_-_14bit_compressed_(Lossy_High_Efficiency_Star).NEF',
 '82df041542b8d328738443bb5ff3373b396e406ecc8cbe7dc3b35252790c53e7':'https://raw.pixls.us/download/data/Nikon/Z%208/Nikon_Z8_high_efficiency_low.NEF',
 'ea8b093cd11c946c5eeb501b775859e8e617ce1d79577abc41b233c339e4004c':'https://raw.pixls.us/download/data/Nikon/Z%208/Nikon_Z8_raw_high_efficiency_hight.NEF',
 '98d6ca8e6c98048ca7ffed68ccaeda7b2b9f03807f0d320d97d5678db21748c2':'https://raw.pixls.us/download/data/Nikon/Z%20f/DSC_0043.NEF',
 'c888f109dc420e359853a2ce768d8a6274b8ba0109b2f5cb6e0c982981d5a624':'https://raw.pixls.us/download/data/Nikon/Z%20f/DSC_0042.NEF'
};
const available=manifest.samples.filter(s=>s.mode==='HE'||s.mode==='HE*').map(s=>({...s,mirrorURL:staticMirrors[s.sha256]}));
const fixtures=available.filter(s=>(!process.env.CAPTRAW_NIKON_FILTER||s.name.includes(process.env.CAPTRAW_NIKON_FILTER))&&(!process.env.CAPTRAW_NIKON_CACHED_ONLY||(existsSync(join(cache,s.name+'.NEF'))&&hash(join(cache,s.name+'.NEF'))===s.sha256)));
assert(fixtures.length,'No HE fixtures match the selected filter');
writeFileSync(join(out,'samples.json'),JSON.stringify({source:manifest.source,samples:fixtures},null,2)+'\n');
const downloads=new Map(),failures=[];
const base={engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,availableSamples:available.length,selectedSamples:fixtures.length,cachedOnly:!!process.env.CAPTRAW_NIKON_CACHED_ONLY,commit:'3b20539d3faa766a370e93a529a3b87edffbf0f6',decoder:'fully local LGPL-2.1 LibRaw fork'};
const results=[];let complete=false;
function report(){writeFileSync(join(out,'report.json'),JSON.stringify({...base,complete,downloads:[...downloads.values()],failures,results},null,2)+'\n');}
async function download(url,file,sha){
 if(existsSync(file)&&hash(file)===sha)return;
 const partial=file+'.part';if(existsSync(file)&&!existsSync(partial))renameSync(file,partial);
 const fetch=resume=>new Promise((resolve,reject)=>{const p=spawn('curl',['-fsSL','--connect-timeout','15','--max-time',process.env.CAPTRAW_NIKON_TIMEOUT||'1200','--speed-limit','1024','--speed-time','45',...(resume?['--continue-at','-']:[]),...(process.env.CAPTRAW_CURL_RESOLVE?['--resolve',process.env.CAPTRAW_CURL_RESOLVE]:[]),url,'-o',partial]);let diagnostic='';p.stderr.on('data',x=>diagnostic=(diagnostic+x).slice(-4000));p.once('error',reject);p.once('exit',code=>resolve({code,diagnostic}));});
 let response=await fetch(true);if(response.code===33)response=await fetch(false);
 if(response.code)throw new Error(`Download ${response.code}: ${url}: ${response.diagnostic}`);
 assert.equal(hash(partial),sha,'Downloaded sample checksum mismatch');renameSync(partial,file);
}
const dump=resolve('build/nikon-dump');
const bundled=process.env.CAPTRAW_RESOURCES?resolve(process.env.CAPTRAW_RESOURCES,'../lib/libraw_r.26.dylib'):undefined;
execFileSync('clang++',['-std=c++17','-O2','-Wl,-headerpad_max_install_names',join(bench,'tools/dump_raw.cpp'),'-I'+resolve('build/vendor/libraw/include'),...(bundled?[bundled]:['-L'+resolve('build/vendor/libraw/lib'),'-lraw_r','-Wl,-rpath,'+resolve('build/vendor/libraw/lib')]),'-o',dump]);
if(bundled){execFileSync('install_name_tool',['-change','@loader_path/libraw_r.26.dylib',bundled,dump]);execFileSync('codesign',['--force','--sign','-',dump]);base.decoderLibrary={path:bundled,sha256:hash(bundled)};}
const runDump=args=>execFileSync(process.env.CAPTRAW_SANDBOX_PROFILE?'/usr/bin/sandbox-exec':dump,process.env.CAPTRAW_SANDBOX_PROFILE?['-f',process.env.CAPTRAW_SANDBOX_PROFILE,dump,...args]:args,{encoding:'utf8'});
const engine=new EngineClient({cache:'build/nikon-he-cache'});engine.on('error',()=>{});
try{
 await engine.ready;
 async function verify(s){
  const path=join(cache,s.name+'.NEF'),mosaic=join(out,'mosaic.u16');
  const meta=JSON.parse(runDump([path,mosaic]));
  assert.equal(meta.unpack,0);assert.equal(meta.unsupported_flag,false);assert.equal(meta.nef_compression,s.mode==='HE'?13:14);
  const mosaicSHA256=hash(mosaic);assert.equal(mosaicSHA256,goldens[s.name].sha256,'Sensor mosaic differs from pinned upstream golden');
  let adobeIdentical;
  if(s.adobe){const ref=join(out,'adobe.u16');runDump([join(cache,s.name+'.dng'),ref]);adobeIdentical=hash(ref)===mosaicSHA256;assert(adobeIdentical,'Adobe reference mosaic differs');rmSync(ref);}
  const image=await engine.call('open',{path,sessionId:s.name});const pending=engine.preview(1);
  await engine.call('update',{revision:1,adjustments:image.adjustments});const frame=await pending;
  assert(frame.histogram?.every(channel=>channel.filter(n=>n>0).length>64),'Decoded preview is not a full tonal image');
  results.push({name:s.name,camera:s.camera,mode:s.mode,crop:s.crop,source:s.source||manifest.source,licence:s.licence||'CC0',sourceSHA256:s.sha256,meta,mosaicSHA256,goldenIdentical:true,adobeIdentical,frame,sourceUnchanged:hash(path)===s.sha256});rmSync(mosaic);
  report();
  console.log('PASS',s.name,meta.unpack_ms,frame.elapsedMs,adobeIdentical??'golden');
 }
 let cursor=0;let draining=Promise.resolve();
 // One native session verifies queued files; downloads continue independently.
 const schedule=s=>{draining=draining.then(async()=>{try{await verify(s);}catch(error){failures.push({name:s.name,stage:'validation',error:String(error)});report();console.error('FAIL',s.name,String(error));}});};
 report();await Promise.all(Array.from({length:4},async()=>{while(cursor<fixtures.length){const s=fixtures[cursor++];try{await download(s.mirrorURL||s.url,join(cache,s.name+'.NEF'),s.sha256);if(s.adobe)await download(s.adobe.url,join(cache,s.name+'.dng'),s.adobe.sha256);downloads.set(s.name,{name:s.name,status:'verified',url:s.mirrorURL||s.url});report();console.log('Fetched',s.name);schedule(s);}catch(error){failures.push({name:s.name,stage:'download',error:String(error)});downloads.set(s.name,{name:s.name,status:'failed'});report();console.error('FAIL download',s.name,String(error));}}}));
 await draining;complete=true;report();if(failures.length)throw new Error(`${failures.length} Nikon samples failed; see ${join(out,'report.json')}`);
}finally{await engine.stop();}
