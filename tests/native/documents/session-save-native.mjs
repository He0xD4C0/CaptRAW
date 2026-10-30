import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,mkdir,rm,readdir,symlink,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {SessionDocumentSaver,validateSessionSave} from '@captraw/desktop-core/documents';
import {restoreRecipeMasks} from '@captraw/desktop-core/documents';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {Documents} from '@captraw/desktop-core/documents';
import {encodeNativeEdit,decodeNativeEdit} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {XMP,CRS,CT,lookup,encode,property} from '@captraw/desktop-core/documents';
import {presetValidationBase} from '@captraw/contracts/presets';
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'));
const sourceXML=(label='original')=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:u="urn:session-save-test" xmlns:c="${CRS}" c:Exposure2012="0"><u:Struct rdf:parseType="Resource"><u:Nested>${label}</u:Nested></u:Struct><u:Qualified rdf:parseType="Resource"><rdf:value>keep</rdf:value><u:Qualifier>custom</u:Qualifier></u:Qualified><u:List><rdf:Seq><rdf:li xml:lang="zh-CN">未知字段</rdf:li></rdf:Seq></u:List></rdf:Description></rdf:RDF></x:xmpmeta>`;
async function fixture(doc,label='original'){
 const bytes=await readFile(doc.path);
 return encodeNativeEdit({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:basename(doc.path),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},artProfile:doc.artProfile,adjustments:doc.adjustments,rating:doc.rating,xmpPacket:label.startsWith('<')?label:sourceXML(label)});
}

async function scenario(run){
 const root=await mkdtemp(join(tmpdir(),'captraw-session-save-'));let passed=false;
 try{
  const source=join(root,'photo.dng');await cp(resolve('build/samples/synthetic.dng'),source);
  const doc={path:source,width:1024,height:768,artProfile:'',adjustments:structuredClone(presetValidationBase),rating:3};
  const prompts=[],documents=new Documents(xmp),cache=join(root,'cache');
  const saver=new SessionDocumentSaver(binary,resources,cache,documents,async targets=>{prompts.push(targets);return true;},()=>{});
  await run({root,source,doc,prompts,documents,saver,output:source+'.captraw'});
  assert.deepEqual(await readdir(cache).catch(()=>[]),[],'workers leave no cache');
  assert(!(await readdir(root)).some(name=>name.startsWith('.session-save-')),'staging is cleaned');
  assert.deepEqual(await readFile(source),await readFile(resolve('build/samples/synthetic.dng')),'RAW stays unchanged');
  passed=true;
 }finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained failure:',root);}
}
const request=(doc,sessionId='session-a')=>({sessionId,documents:[doc]});
const success=result=>{assert.equal(result?.cancelled,false);assert(result.results.length);for(const row of result.results){assert.equal(row.error,undefined);assert(row.output);assert.equal(typeof row.nativePacket,'string');decodeNativeEdit(row.nativePacket);}};

test('native session save keeps unknown RDF, qualifiers and RAW, remembers confirmation per session',()=>scenario(async({saver,doc,output,prompts})=>{
 await writeFile(output,await fixture(doc));success(await saver.run(request(doc)));
 assert.equal(prompts.length,1);assert.equal(prompts[0][0].exists,true);
 const packet=await readFile(output,'utf8');for(const value of ['Nested','original','Qualifier','custom','未知字段','zh-CN'])assert(packet.includes(value),value);
 assert.equal((await new Documents(xmp).read(output)).adjustments.exposure,doc.adjustments.exposure);
 success(await saver.run(request({...doc,rating:5})));assert.equal(prompts.length,1);
 success(await saver.run(request(doc,'session-b')));assert.equal(prompts.length,2);
}));

test('native save re-confirms edits after the initial dialog and during serialization, merging latest RDF',()=>scenario(async({root,doc,documents,output})=>{
 const prompts=[];let changed=false;
 const saver=new SessionDocumentSaver(binary,resources,join(root,'cache'),documents,async targets=>{
  prompts.push(targets);if(prompts.length===1)await writeFile(output,await fixture(doc,'during-dialog'));return true;
 },()=>{});
 const serialize=documents.serialize.bind(documents);
 documents.serialize=async value=>{const packet=await serialize(value);if(!changed){changed=true;await writeFile(output,await fixture(doc,'during-serialize'));}return packet;};
 success(await saver.run(request(doc)));assert.equal(prompts.length,3);assert(prompts[1][0].changed);assert(prompts[2][0].changed);
 assert((await readFile(output,'utf8')).includes('during-serialize'));
 await writeFile(output,await fixture(doc,'external-later'));const saved=await saver.run(request(doc));success(saved);assert.equal(prompts.length,4);
 assert(saved.results[0].xmpPacket.includes('external-later'));assert(saved.results[0].xmpPacket.includes('custom'));
 assert.equal(saved.results[0].nativePacket,await readFile(output,'utf8'));
 const alternate=join(root,'alternate.captraw');
 const copied=await saver.run(request({...doc,xmpPacket:saved.results[0].xmpPacket}),alternate);success(copied);
 assert(copied.results[0].xmpPacket.includes('external-later'));assert.equal(copied.results[0].nativePacket,await readFile(alternate,'utf8'));
}));

test('native save declines safely, including external-change confirmation',()=>scenario(async({root,doc,documents,output})=>{
 let prompts=0;const saver=new SessionDocumentSaver(binary,resources,join(root,'cache'),documents,async()=>++prompts===1,()=>{});
 await writeFile(output,await fixture(doc));success(await saver.run(request(doc)));
 const external=await fixture(doc,'external');await writeFile(output,external);
 assert.equal(await saver.run(request(doc)),null);assert.equal(await readFile(output,'utf8'),external);
}));

test('native per-image failures preserve old native document and assets; explicit retry remembers new target',()=>scenario(async({root,doc,saver,output,prompts})=>{
 await writeFile(output,'broken XML');await mkdir(output+'.assets');await writeFile(join(output+'.assets','keep.bin'),'old asset');
 const other=join(root,'other.dng');await cp(doc.path,other);
 const result=await saver.run({sessionId:'session-a',documents:[doc,{...doc,path:other}]});
 assert(result.results[0].error);assert.equal(result.results[1].output,join(root,'other.dng.captraw'));
 assert.equal(await readFile(output,'utf8'),'broken XML');assert.equal(await readFile(join(output+'.assets','keep.bin'),'utf8'),'old asset');
 const target=join(root,'retry.captraw');success(await saver.run(request(doc),target));
 const count=prompts.length;success(await saver.run(request(doc)));assert.equal(prompts.length,count);
 assert.equal(await readFile(output,'utf8'),'broken XML');
}));

test('native cancellation during atomic serialization completes current file and skips remaining files',()=>scenario(async({root,doc,documents,saver,output})=>{
 const other=join(root,'other.dng');await cp(doc.path,other);
 const serialize=documents.serialize.bind(documents);documents.serialize=async value=>{saver.cancel();return serialize(value);};
 const result=await saver.run({sessionId:'session-a',documents:[doc,{...doc,path:other}]});
 assert.equal(result.cancelled,true);assert.equal(result.results.length,1);assert.equal(result.results[0].source,doc.path);assert.equal(result.results[0].output,output);assert.equal(result.results[0].nativePacket,await readFile(output,'utf8'));
 await assert.rejects(readFile(join(root,'other.dng.captraw')),{code:'ENOENT'});
}));

test('native read-only target failure can be retried separately; symlinks are rejected and same-stem inputs remain distinct',()=>scenario(async({root,doc,saver,output})=>{
 await symlink(doc.path,output);let result=await saver.run(request(doc));assert(result.results[0].error);await rm(output);
 const other=join(root,'photo.nef');await cp(doc.path,other);
 result=await saver.run({sessionId:'session-a',documents:[doc,{...doc,path:other}]});assert.equal(result.results.length,2);assert(result.results.every(row=>!row.error));assert.notEqual(result.results[0].output,result.results[1].output);
 const locked=join(root,'locked');await mkdir(locked);await chmod(locked,0o555);
 try{result=await saver.run(request(doc),join(locked,'photo.captraw'));assert.match(result.results[0].error,/权限|只读/);}finally{await chmod(locked,0o755);}
 success(await saver.run(request(doc),join(root,'writable.captraw')));
}));

test('native failed serialization retains old native document and rejects concurrent sessions',()=>scenario(async({doc,documents,saver,output})=>{
 await writeFile(output,await fixture(doc));const before=await readFile(output);
 const serialize=documents.serialize.bind(documents);
 documents.serialize=async value=>{
  await assert.rejects(saver.run(request(doc,'other')),/正在运行/);
  await serialize(value);throw new Error('injected serialization failure');
 };
 const result=await saver.run(request(doc));assert.match(result.results[0].error,/injected/);assert.deepEqual(await readFile(output),before);assert.equal(saver.active,false);
}));

test('session save rejects malformed contracts before creating a worker',async()=>{
 assert.throws(()=>validateSessionSave({sessionId:'',documents:[]}),/会话/);
 const saver=new SessionDocumentSaver('unused','unused','unused',new Documents(xmp),async()=>{throw new Error('unexpected dialog');},()=>{});
 await assert.rejects(saver.run({sessionId:'x',documents:[]}),/1–500/);
 await assert.rejects(saver.run({sessionId:'x',documents:[{path:'/photo.dng',width:1,height:1,artProfile:'',adjustments:{}}]},'/photo.dng'),/另存/);
 assert.equal(saver.active,false);
});


async function rasterDocument(root,doc){
 const chunk=(name,data)=>{
  const body=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([header,body,tail]);
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,180]))),chunk('IEND',Buffer.alloc(0))]);
 const raster=join(root,'mask.png');await writeFile(raster,png);
 const id=createHash('sha256').update(png).digest('hex');
 const masks=[{id:'raster',name:'raster',type:'raster',enabled:true,inverted:false,feather:0,points:[],start:{x:0,y:0},end:{x:1,y:1},brightness:.5,contrast:0,saturation:0,raster:{path:raster,sha256:id,width:1,height:1}}];
 return {masked:{...doc,adjustments:{...doc.adjustments,masks}},raster,id,png};
}

test('native raster assets are portable and old assets survive a later asset validation failure',()=>scenario(async({root,doc,saver,output,documents})=>{
 const {masked,raster,id,png}=await rasterDocument(root,doc);success(await saver.run(request(masked)));
 const before=await readFile(output),asset=join(output+'.assets',id+'.png');assert.deepEqual(await readFile(asset),png);
 await rm(raster);
 const core=new NativeEngine(binary,resources,join(root,'restore-cache'));const closed=new Promise(done=>core.child.once('exit',done));
 try{
  await core.ready;
  const restored=await restoreRecipeMasks(core,output,await documents.read(output),join(root,'restored-assets'));
  assert.deepEqual(await readFile(restored.adjustments.masks[0].raster.path),png);
 }finally{core.terminate();await closed;}
 const failed=await saver.run(request(masked));assert(failed.results[0].error);assert.deepEqual(await readFile(output),before);assert.deepEqual(await readFile(asset),png);
}));

test('cancellation at the first confirmation starts no files',()=>scenario(async({root,doc,documents,output})=>{
 let saver;saver=new SessionDocumentSaver(binary,resources,join(root,'cache'),documents,async()=>{saver.cancel();return true;},()=>{});
 const result=await saver.run(request(doc));assert.deepEqual(result,{results:[],cancelled:true});await assert.rejects(readFile(output),{code:'ENOENT'});
}));


test('cancel during a pending initial confirmation does not cache consent',()=>scenario(async({root,doc,documents,output})=>{
 let release,entered;const pending=new Promise(done=>release=done),shown=new Promise(done=>entered=done);let count=0;
 const saver=new SessionDocumentSaver(binary,resources,join(root,'cache'),documents,async()=>{if(++count===1){entered();await pending;}return true;},()=>{});
 const saving=saver.run(request(doc));await shown;assert.throws(()=>saver.forgetSession('session-a'),/尚未结束/);saver.cancel();release();
 assert.deepEqual(await saving,{results:[],cancelled:true});await assert.rejects(readFile(output),{code:'ENOENT'});
 success(await saver.run(request(doc)));assert.equal(count,2);
}));

test('cancel while external-change confirmation is pending leaves external native document intact',()=>scenario(async({root,doc,documents,output})=>{
 let release,entered,count=0;const pending=new Promise(done=>release=done),shown=new Promise(done=>entered=done);
 const external=await fixture(doc,'after-first-confirmation');
 const saver=new SessionDocumentSaver(binary,resources,join(root,'cache'),documents,async()=>{
  if(++count===1)await writeFile(output,external);else{entered();await pending;}return true;
 },()=>{});
 const saving=saver.run(request(doc));await shown;saver.cancel();release();
 const result=await saving;assert.equal(result.cancelled,true);assert(result.results[0].error);assert.equal(await readFile(output,'utf8'),external);
}));

test('session transitions release location consent; explicit release forgets a completed session',()=>scenario(async({root,doc,saver,prompts,output})=>{
 const target=join(root,'alternate.captraw');success(await saver.run(request(doc),target));
 const count=prompts.length;success(await saver.run(request(doc)));assert.equal(prompts.length,count);
 saver.forgetSession('unrelated');success(await saver.run(request(doc)));assert.equal(prompts.length,count);
 success(await saver.run(request(doc,'session-b')));assert.equal(prompts.length,count+1);
 success(await saver.run(request(doc)));assert.equal(prompts.length,count+2);
 assert.equal(prompts.at(-1)[0].output,output,'old alternate location does not leak across sessions');
 saver.forgetSession('session-a');success(await saver.run(request(doc)));assert.equal(prompts.length,count+3);
}));

test('native save preserves unknown document payload and source RDF while updating editable values',()=>scenario(async({doc,saver,output})=>{
 success(await saver.run(request(doc)));
 const external=JSON.parse(await readFile(output,'utf8'));external.payload.FutureSetting={nested:'keep'};external.sourceXMP=sourceXML();await writeFile(output,JSON.stringify(external));
 success(await saver.run(request({...doc,rating:4,adjustments:{...doc.adjustments,exposure:1,curve:[{x:0,y:0},{x:1,y:.8}]}})));
 const saved=decodeNativeEdit(await readFile(output,'utf8'));assert.deepEqual(saved.FutureSetting,{nested:'keep'});assert.equal(saved.xmpPacket,external.sourceXMP);assert.equal(saved.rating,4);assert.equal(saved.adjustments.exposure,1);assert.deepEqual(saved.adjustments.curve,[{x:0,y:0},{x:1,y:.8}]);
}));

test('native edits preserve source qualified curves and scalars without rewriting Adobe instructions',()=>scenario(async({doc,saver,output})=>{
 const xml=sourceXML().replace(' c:Exposure2012="0"','').replace('</rdf:Description>','<c:Exposure2012 rdf:parseType="Resource"><rdf:value>0</rdf:value><u:ExposureQualifier>keep-scalar</u:ExposureQualifier></c:Exposure2012><c:ToneCurvePV2012 rdf:parseType="Resource"><rdf:value><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></rdf:value><u:CurveQualifier>keep-qualified-array</u:CurveQualifier></c:ToneCurvePV2012></rdf:Description>');
 await writeFile(output,await fixture(doc,xml));
 success(await saver.run(request({...doc,adjustments:{...doc.adjustments,exposure:1,curve:[{x:0,y:0},{x:1,y:.8}]}})));
 const saved=await new Documents(xmp).read(output);assert.equal(saved.xmpPacket,xml);assert.equal(saved.adjustments.exposure,1);assert.deepEqual(saved.adjustments.curve,[{x:0,y:0},{x:1,y:.8}]);
}));

test('native asset publication followed by real rename failure keeps assets and old native document, cleans staging and continues',{skip:process.platform!=='darwin'},()=>scenario(async({root,doc,saver,output})=>{
 const {masked,id,png}=await rasterDocument(root,doc),external=await fixture(doc);await writeFile(output,external);
 const other=join(root,'next.dng');await cp(doc.path,other);
 execFileSync('/usr/bin/chflags',['uchg',output]);
 try{
  const result=await saver.run({sessionId:'session-a',documents:[masked,{...doc,path:other}]});
  assert.match(result.results[0].error,/权限|permitted/);assert.equal(result.results[1].output,join(root,'next.dng.captraw'));
  assert.equal(await readFile(output,'utf8'),external);
  assert.deepEqual(await readFile(join(output+'.assets',id+'.png')),png,'published immutable asset must not be rolled back');
  assert(!(await readdir(root)).some(name=>name.startsWith('.session-save-')));
 }finally{execFileSync('/usr/bin/chflags',['nouchg',output]);}
}));


test('native node merge permits normal crop ownership and optional editing-state removal',()=>scenario(async({doc,saver})=>{
 const first={...doc,adjustments:{...doc.adjustments,fineRotation:3,crop:null,wbMode:'camera'}};
 success(await saver.run(request(first)));
 const {wbMode,...adjustments}=first.adjustments;
 success(await saver.run(request({...doc,adjustments:{...adjustments,crop:{x:.1,y:.1,width:.8,height:.8}}})));
}));

test('native bridge captures and rewrites qualifier namespaces, URI values and language on array items',()=>scenario(async()=>{
 const ns='urn:arbitrary-qualifiers';
 const q=(name,value)=>property(ns,name,{value});
 const value={items:[{value:'old',lang:'zh-CN',qualifiers:[q('ItemNote','保留 条目'),property(ns,'Link',{value:'https://example.invalid/metadata',options:2})]}],options:0x600,qualifiers:[q('ArrayNote','保留 数组'),property(ns,'Complex',{fields:[property(ns,'Nested',encode({value:'opaque nested qualifier'}))]})]};
 const initial=await xmp.call('write','',[property(ns,'Array',value),property(ns,'Struct',{fields:[property(ns,'Field',{value:'old',qualifiers:[q('FieldNote','保留 字段')]})],qualifiers:[q('StructNote','保留 结构')]})]);
 const updated=await xmp.call('write',initial.packet,[property(ns,'Array',{items:[{value:'new'}],options:0x600}),property(ns,'Struct',{fields:[property(ns,'Field',{value:'new'})]})]);
 const array=lookup(updated.properties,ns,'Array'),structure=lookup(updated.properties,ns,'Struct');
 assert.equal(array.qualifiers.find(p=>p.name==='ArrayNote').node.value,'保留 数组');
 assert.deepEqual(array.qualifiers.find(p=>p.name==='Complex'),lookup(initial.properties,ns,'Array').qualifiers.find(p=>p.name==='Complex'));
 assert.equal(array.items[0].value,'new');assert.equal(array.items[0].lang,'zh-CN');
 assert.equal(array.items[0].qualifiers.find(p=>p.name==='ItemNote').node.value,'保留 条目');
 assert.equal(array.items[0].qualifiers.find(p=>p.name==='Link').node.options&2,2);
 assert.equal(structure.qualifiers.find(p=>p.name==='StructNote').node.value,'保留 结构');
 assert.equal(structure.fields[0].node.value,'new');assert.equal(structure.fields[0].node.qualifiers.find(p=>p.name==='FieldNote').node.value,'保留 字段');
 const rebuilt=await xmp.call('write','',updated.properties);assert.deepEqual(rebuilt.properties,updated.properties,'all exposed qualifiers survive writing into an empty packet');
}));

test('session edits reorder native masks without changing opaque source structures',()=>scenario(async({doc,saver,output})=>{
 const mask=id=>({id,name:id,type:'radial',enabled:true,inverted:false,feather:10,points:[],start:{x:.2,y:.2},end:{x:.8,y:.8},brightness:.25,contrast:0,saturation:0});
 const a=mask('mask-a'),b=mask('mask-b'),snapshot={...doc,xmpPacket:sourceXML('opaque mask provenance'),adjustments:{...doc.adjustments,masks:[a,b]}};
 success(await saver.run(request(snapshot)));
 success(await saver.run(request({...snapshot,adjustments:{...snapshot.adjustments,masks:[b,{...a,brightness:.6}]}})));
 const saved=decodeNativeEdit(await readFile(output,'utf8'));assert.equal(saved.xmpPacket,snapshot.xmpPacket);assert.deepEqual(saved.adjustments.masks.map(m=>m.id),['mask-b','mask-a']);assert.equal(saved.adjustments.masks[1].brightness,.6);
}));
