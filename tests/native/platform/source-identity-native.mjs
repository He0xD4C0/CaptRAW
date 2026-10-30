import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,writeFile,mkdir,rm,rename,readdir,open,utimes,stat,link,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {captureSourceIdentity,verifySourceIdentity,validateSourceIdentity,prepareSourceIdentities} from '@captraw/desktop-core/engine';
import {Documents,BatchDocumentSaver,validateBatchSave} from '@captraw/desktop-core/documents';
import {SessionDocumentSaver} from '@captraw/desktop-core/documents';
import {BatchExporter,validateBatch} from '@captraw/desktop-core/export';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {Synchronizer} from '@captraw/desktop-core/presets';
import {XMP} from '@captraw/desktop-core/documents';
import {presetValidationBase} from '@captraw/contracts/presets';
const binary=resolve('build/native/captraw-engine'),resources=resolve('build/native/resources');
const documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp'))),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function scenario(run){
 const root=await mkdtemp(join(tmpdir(),'captraw-source-identity-'));let passed=false;
 try{
  const paths=[join(root,'第一张 空格.dng'),join(root,'second.dng')];for(const path of paths)await copyFile('build/samples/synthetic.dng',path);
  const snapshots=paths.map(path=>({path,width:1024,height:768,artProfile:'',adjustments:structuredClone(presetValidationBase)}));
  await run({root,paths,snapshots});passed=true;
 }finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained source identity failure:',root);}
}
async function mutate(path){const bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);}
async function replace(path,different=false){const temporary=path+'.replacement';await copyFile(path,temporary);if(different)await mutate(temporary);await rename(temporary,path);}

test('content identity allows identical restoration and rejects same-size edits with restored mtime; capture never writes sources',()=>scenario(async({paths})=>{
 const path=paths[0],bytes=await readFile(path),identity=await captureSourceIdentity(path);
 assert.equal(identity.sha256,sha(bytes));assert.equal(identity.size,bytes.length);assert.equal(typeof identity.version,'string');
 await verifySourceIdentity(path,identity);assert.deepEqual(await readFile(path),bytes);
 await rename(path,path+'.moved');await assert.rejects(verifySourceIdentity(path,identity),/原片已变化/);
 await rename(path+'.moved',path);await verifySourceIdentity(path,identity);
 await replace(path);await verifySourceIdentity(path,identity);assert.deepEqual(await readFile(path),bytes);
 const next=await captureSourceIdentity(path),before=await stat(path);await mutate(path);await utimes(path,before.atime,before.mtime);
 await assert.rejects(verifySourceIdentity(path,next),/原片已变化/);
 await rm(path);await assert.rejects(verifySourceIdentity(path,next),/原片已变化/);
}));

test('hashing rejects fd/path replacement and in-place mutation during the actual read',()=>scenario(async({paths})=>{
 const sample=await open(paths[0],'r'),prototype=Object.getPrototypeOf(sample),original=prototype.createReadStream;await sample.close();
 for(const change of [replace,mutate]){
  let reached=false;
  prototype.createReadStream=function(options){
   const stream=original.call(this,options),iterator=stream[Symbol.asyncIterator].bind(stream);
   stream[Symbol.asyncIterator]=async function*(){for await(const bytes of iterator()){if(!reached){reached=true;await change(paths[0]);}yield bytes;}};
   return stream;
  };
  try{await assert.rejects(captureSourceIdentity(paths[0]),/原片已变化/);assert(reached,'must mutate while the real file descriptor is being hashed');}
  finally{prototype.createReadStream=original;}
 }
}));

test('save/export reject malformed identities at the request boundary',()=>scenario(async({snapshots})=>{
 for(const sourceIdentity of [null,{}, {size:1,sha256:'bad',version:'opaque'}, {size:1,sha256:'0'.repeat(64),version:''}]){
  assert.throws(()=>validateSourceIdentity(sourceIdentity),/身份/);
  assert.throws(()=>validateBatchSave({documents:[{...snapshots[0],sourceIdentity}]}),/身份/);
  assert.throws(()=>validateBatch({documents:[{...snapshots[0],sourceIdentity}],format:'jpeg',colorSpace:'srgb'}),/身份/);
 }
}));

test('preflight checks cancellation between files and all three services stop after the current hash',()=>scenario(async({root,paths,snapshots})=>{
 let checks=0;const prepared=await prepareSourceIdentities([snapshots[0],...Array.from({length:499},(_,i)=>({...snapshots[0],path:join(root,`missing-${i}.dng`)}))],()=>++checks>1);
 assert.equal(prepared.size,1);assert.equal(checks,2);assert(!(prepared.get(paths[0]) instanceof Error));
 const sample=await open(paths[0],'r'),prototype=Object.getPrototypeOf(sample),original=prototype.createReadStream;await sample.close();
 for(const kind of ['session','batch','export']){
  const directory=join(root,kind);await mkdir(directory);let hashed=0,confirmed=0;
  const saver=kind==='session'?new SessionDocumentSaver(binary,resources,join(root,'cache-'+kind),documents,async()=>{++confirmed;return true;},()=>{}):kind==='batch'?new BatchDocumentSaver(binary,resources,join(root,'cache-'+kind),documents,()=>{}):new BatchExporter(binary,resources,join(root,'cache-'+kind),()=>{});
  prototype.createReadStream=function(options){const stream=original.call(this,options);++hashed;saver.cancel();return stream;};
  try{
   const result=kind==='session'?await saver.run({sessionId:'cancel',documents:snapshots}):kind==='batch'?await saver.run({documents:snapshots},directory):await saver.run({documents:snapshots,format:'jpeg',colorSpace:'srgb'},directory);
   assert.equal(hashed,1);assert.equal(confirmed,0);assert.deepEqual(kind==='export'?result:result.results,[]);assert.deepEqual(await readdir(directory),[]);
   if(kind!=='export')assert.equal(result.cancelled,true);
  }finally{prototype.createReadStream=original;}
 }
}));

test('session save, legacy batch save and batch export report stale sources per image and retain successful peers',()=>scenario(async({root,paths,snapshots})=>{
 for(const doc of snapshots)doc.sourceIdentity=await captureSourceIdentity(doc.path);
 await replace(paths[0],true);
 const session=new SessionDocumentSaver(binary,resources,join(root,'session-cache'),documents,async()=>true,()=>{});
 const batchDirectory=join(root,'batch'),exportDirectory=join(root,'exports');await mkdir(batchDirectory);await mkdir(exportDirectory);
 const batch=new BatchDocumentSaver(binary,resources,join(root,'batch-cache'),documents,()=>{}),exporter=new BatchExporter(binary,resources,join(root,'export-cache'),()=>{});
 const results=[(await session.run({sessionId:'stale',documents:snapshots})).results,(await batch.run({documents:snapshots},batchDirectory)).results,await exporter.run({documents:snapshots,format:'jpeg',colorSpace:'srgb'},exportDirectory)];
 for(const rows of results){assert.equal(rows.length,2);assert.match(rows[0].error,/原片已变化/);assert(rows[1].output);assert.equal(rows[1].error,undefined);}
 for(const output of [results[0][1].output,results[1][1].output]){
  const saved=await documents.read(output);assert.equal(saved.source.sha256,snapshots[1].sourceIdentity.sha256);assert.deepEqual(Object.keys(saved.source).sort(),['path','sha256','size']);assert.equal(saved.sourceIdentity,undefined);
 }
 assert.deepEqual(await readdir(exportDirectory),['second_CaptRAW.jpg']);
}));

test('legacy snapshots are captured before dialogs and before the first batch item, never rebound for later files',()=>scenario(async({root,paths,snapshots})=>{
 const previous=join(root,'second.xmp');await writeFile(previous,'previous output must survive');
 const session=new SessionDocumentSaver(binary,resources,join(root,'session-cache'),documents,async()=>{await mutate(paths[1]);return true;},()=>{});
 const saved=await session.run({sessionId:'legacy',documents:snapshots});assert(saved.results[0].output);assert.match(saved.results[1].error,/原片已变化/);assert.equal(await readFile(previous,'utf8'),'previous output must survive');
 const output=join(root,'batch');await mkdir(output);
 const batch=new BatchDocumentSaver(binary,resources,join(root,'batch-cache'),documents,()=>{});
 // Mutating item two after the first real compose proves all fallback identities
 // were captured at run start, not lazily when each worker reaches that item.
 const original=NativeEngine.prototype.call;let reached=false;
 NativeEngine.prototype.call=async function(method,args){const result=await original.call(this,method,args);if(method==='compose'&&!reached){reached=true;await mutate(paths[1]);}return result;};
 try{const result=await batch.run({documents:snapshots},output);assert(reached);assert(result.results[0].output);assert.match(result.results[1].error,/原片已变化/);}
 finally{NativeEngine.prototype.call=original;}
 const exportDirectory=join(root,'exports');await mkdir(exportDirectory);reached=false;
 NativeEngine.prototype.call=async function(method,args){const result=await original.call(this,method,args);if(method==='export'&&!reached){reached=true;await mutate(paths[1]);}return result;};
 try{const rows=await new BatchExporter(binary,resources,join(root,'export-cache'),()=>{}).run({documents:snapshots,format:'jpeg',colorSpace:'srgb'},exportDirectory);assert(reached);assert(rows[0].output);assert.match(rows[1].error,/原片已变化/);}
 finally{NativeEngine.prototype.call=original;}
}));

test('source changes after real compose/export cannot publish XMP or rendered files',()=>scenario(async({root,paths,snapshots})=>{
 const original=NativeEngine.prototype.call;
 for(const kind of ['session','batch','export']){
  const doc={...snapshots[0],sourceIdentity:await captureSourceIdentity(paths[0])},output=join(root,kind);await mkdir(output);
  const sidecar=paths[0].replace(/\.dng$/,'.xmp'),oldSidecar=await documents.serialize({engineVersion:'',source:{path:doc.path,size:doc.sourceIdentity.size,sha256:doc.sourceIdentity.sha256},artProfile:'',adjustments:doc.adjustments});await writeFile(sidecar,oldSidecar);let reached=false;
  NativeEngine.prototype.call=async function(method,args){const result=await original.call(this,method,args);if(!reached&&method===(kind==='export'?'export':'compose')){reached=true;await mutate(paths[0]);}return result;};
  try{
   let rows;
   if(kind==='session')rows=(await new SessionDocumentSaver(binary,resources,join(root,'cache-'+kind),documents,async()=>true,()=>{}).run({sessionId:kind,documents:[doc]})).results;
   else if(kind==='batch')rows=(await new BatchDocumentSaver(binary,resources,join(root,'cache-'+kind),documents,()=>{}).run({documents:[doc]},output)).results;
   else rows=await new BatchExporter(binary,resources,join(root,'cache-'+kind),()=>{}).run({documents:[doc],format:'jpeg',colorSpace:'srgb'},output);
   assert(reached,'must complete real native work before source mutation');assert.match(rows[0].error,/原片已变化/);assert.equal(rows[0].output,undefined);
   assert.deepEqual(await readdir(output),[]);assert.equal(await readFile(sidecar,'utf8'),oldSidecar);assert.deepEqual(await readdir(join(root,'cache-'+kind)),[]);
   assert(!(await readdir(root)).some(name=>name.startsWith('.session-save-')));
  }finally{NativeEngine.prototype.call=original;}
 }
}));

test('replacing an already-previewed real Sync target rejects the whole group and removes all transaction previews',()=>scenario(async({root,paths})=>{
 const setup=new NativeEngine(binary,resources,join(root,'setup')),targets=[];
 try{for(const path of paths){const image=await setup.call('open',{path,sessionId:path});image.sourceIdentity=await captureSourceIdentity(path);targets.push({image,adjustments:image.adjustments,profile:image.artProfile||''});}}
 finally{const stopped=new Promise(resolve=>setup.child.once('exit',resolve));setup.terminate();await stopped;}
 const before=structuredClone(targets),cache=join(root,'sync'),sync=new Synchronizer(binary,resources,cache,()=>{}),original=NativeEngine.prototype.call;
 let replaced=false,returned=false,firstPreview;
 NativeEngine.prototype.call=async function(method,args){
  const result=await original.call(this,method,args);
  if(method==='open'&&args.path===paths[1]){
   assert.equal(sync.previews.size,1,'the first real target must already have a staged preview');firstPreview=[...sync.previews.values()][0];assert((await stat(firstPreview)).isFile());
   await replace(paths[0],true);replaced=true;
  }
  return result;
 };
 try{
  const source={...targets[0],image:{...targets[0].image,path:'captraw-edit:fixed-values'}},request={source,targets,groups:[],command:{operationId:'identity-replacement',set:{exposure:1},unset:[]}};
  await assert.rejects(sync.run(request).then(result=>{returned=true;return result;}),/原片已变化/);
  assert(replaced);assert.equal(returned,false,'no partial result may escape');assert.deepEqual(targets,before,'target edit snapshots must remain unchanged');
  assert.equal(sync.running,false);assert.equal(sync.previews.size,0);assert.deepEqual(await readdir(cache),[]);await assert.rejects(stat(firstPreview),{code:'ENOENT'});
 }finally{NativeEngine.prototype.call=original;sync.cancel();}
}));


test('raw pixel encoder rejects source, hard-link and symlink output aliases before writing',()=>scenario(async({root,paths})=>{
 const source=paths[0],original=await readFile(source),aliases=[source,join(root,'hard-link.dng'),join(root,'symbolic-link.dng')];
 await link(source,aliases[1]);await symlink(source,aliases[2]);
 const worker=new NativeEngine(binary,resources,join(root,'native-export'));
 try{
  const image=await worker.call('open',{path:source,sessionId:'export-source-alias'});
  for(const output of aliases)for(const format of ['tiff','jpeg']){
   await assert.rejects(worker.call('export',{path:source,artProfile:image.artProfile,output,format,colorSpace:'srgb'}),/原始照片/);
   assert.deepEqual(await readFile(source),original);
  }
  const output=join(root,'separate.tif');await worker.call('export',{path:source,artProfile:image.artProfile,output,format:'tiff',colorSpace:'srgb'});
  assert((await stat(output)).size>1000);assert.deepEqual(await readFile(source),original);
 }finally{const stopped=worker.child.exitCode===null?new Promise(resolve=>worker.child.once('exit',resolve)):Promise.resolve();worker.terminate();await stopped;}
}));
