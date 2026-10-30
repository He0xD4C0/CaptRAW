import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,mkdir,readdir,rm,rename,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {ENGINE_VERSION} from '@captraw/contracts';
import {presetValidationBase,presetAtISO} from '@captraw/contracts/presets';
import {Documents,BatchDocumentSaver,validateBatchSave} from '@captraw/desktop-core/documents';
import {SessionDocumentSaver,saveTargetState} from '@captraw/desktop-core/documents';
import {nativeSidecar,encodeNativeEdit,decodeNativeEdit,encodeNativePreset,decodeNativePreset,encodeNativeFavorites,decodeNativeFavorites} from '@captraw/desktop-core/documents';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {PresetPacks,builtinPresetPack} from '@captraw/desktop-core/presets';
import {XMP,CRS,CT,property,text,encode,encodeAdjustments,lookup} from '@captraw/desktop-core/documents';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {captureSourceIdentity} from '@captraw/desktop-core/engine';

const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const python=resolve(process.env.CAPTRAW_PYTHON||'build/qa-venv/bin/python');
const fixture=resolve('tests/fixtures/native-documents-legacy32');
const golden=JSON.parse(await readFile(join(fixture,'expected.json'),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'));
const documents=new Documents(xmp);
const unknown=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:u="urn:native-document-test"><u:Qualified rdf:parseType="Resource"><rdf:value>原文 p:literal</rdf:value><u:Qualifier>限定符</u:Qualifier></u:Qualified><u:List><rdf:Seq><rdf:li xml:lang="zh-CN">未知结构</rdf:li></rdf:Seq></u:List></rdf:Description></rdf:RDF></x:xmpmeta>`;
const edit=(extra={})=>({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:'原片.dng',size:golden.sourceBytes,sha256:golden.sourceSHA256},artProfile:'',adjustments:structuredClone(presetValidationBase),...extra});
const preset=(extra={})=>({engineVersion:ENGINE_VERSION,name:'原生预设',group:'测试',groups:['light'],artProfile:'',adjustments:{exposure:.5},...extra});
const request=(doc,sessionId='native-session')=>({sessionId,documents:[doc]});
function saved(result,count=1){assert(result);assert.equal(result.cancelled,false);assert.equal(result.results.length,count);for(const row of result.results){assert.equal(row.error,undefined);assert(row.output.endsWith('.captraw'));assert.equal(typeof row.nativePacket,'string');decodeNativeEdit(row.nativePacket);if(row.xmpPacket!==undefined)assert(row.xmpPacket.trimStart().startsWith('<'));}return result.results[0];}
async function scenario(run){
 const root=await mkdtemp(join(tmpdir(),'captraw-native-documents-'));let passed=false;const workers=[];
 const core=()=>{const worker=new NativeEngine(binary,resources,join(root,'engine-'+workers.length));workers.push(worker);return worker;};
 try{
  const source=join(root,'中文 空格.dng');await copyFile(join(fixture,'synthetic.dng'),source);
  const doc={path:source,width:golden.width,height:golden.height,artProfile:await readFile(join(fixture,'legacy.arp'),'utf8'),adjustments:structuredClone(golden.adjustments),rating:golden.rating,label:golden.label,xmpPacket:unknown,sourceIdentity:await captureSourceIdentity(source)};
  await run({root,source,doc,core});assert.equal(sha(await readFile(source)),golden.sourceSHA256);passed=true;
 }finally{
  for(const worker of workers){const stopped=worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise(done=>worker.child.once('exit',done));worker.terminate();await stopped;}
  if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained native-document failure:',root);
 }
}
const makeSaver=(root,confirm=async()=>true,progress=()=>{})=>new SessionDocumentSaver(binary,resources,join(root,'save-cache'),documents,confirm,progress);
const value=(name,v)=>property(CRS,name,text(v));
async function legacyPreset(path,{id,adjustments={exposure:.75},anchors,source=unknown,engineVersion=ENGINE_VERSION,assets}={}){
 const changes=[property(CRS,'Name',{localized:'旧自有预设'}),property(CRS,'Group',{localized:'迁移测试'}),value('SupportsAmount','True'),value('SupportsAmount2','False'),...encodeAdjustments(adjustments)];
 if(id)changes.push(value('UUID',id.replaceAll('-','').toUpperCase()));
 if(engineVersion)changes.push(property(CT,'EngineVersion',text(engineVersion)));
 if(anchors)changes.push(property(CRS,'ISODependent',{options:0x600,items:anchors.map(a=>({fields:[value('ISO',a.iso),...encodeAdjustments(a.adjustments).filter(p=>p.node!==null)]}))}));
 if(assets)changes.push(property(CT,'MaskAssets',encode(assets)));
 const packet=(await xmp.call('write',source,changes)).packet;await writeFile(path,packet);return packet;
}
async function raster(root,doc){
 const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,body,tail]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;
 const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,180]))),chunk('IEND',Buffer.alloc(0))]);
 const path=join(root,'临时蒙版.png');await writeFile(path,bytes);const id=sha(bytes);
 return {bytes,path,id,doc:{...doc,adjustments:{...doc.adjustments,masks:[{id:'raster',name:'原生资产',type:'raster',enabled:true,inverted:false,feather:0,points:[],start:{x:0,y:0},end:{x:1,y:1},brightness:.5,contrast:0,saturation:0,raster:{path,sha256:id,width:1,height:1}}]}}};
}

test('native markers separate edit/preset/favorites and reject historical JSON or unsupported versions',()=>{
 const packet=encodeNativeEdit(edit());assert.equal(JSON.parse(packet).version,1);assert.deepEqual(decodeNativeEdit(packet).adjustments,presetValidationBase);
 for(const invalid of ['{}',JSON.stringify(edit()),JSON.stringify({...JSON.parse(packet),format:'Other'}),JSON.stringify({...JSON.parse(packet),version:2}),JSON.stringify({...JSON.parse(packet),kind:'preset'})])assert.throws(()=>decodeNativeEdit(invalid));
 assert.throws(()=>decodeNativePreset(packet));assert.throws(()=>decodeNativeFavorites(packet));assert.throws(()=>encodeNativeEdit(edit({xmpPacket:packet})),/XML/);
 assert.throws(()=>encodeNativeEdit(edit({engineVersion:'future'})),/版本/);assert.throws(()=>encodeNativeEdit(edit({label:1})),/标签/);assert.throws(()=>encodeNativeEdit(edit({adjustments:{...presetValidationBase,exposure:NaN}})),/保存/);
 const nested=JSON.parse(packet);nested.payload.nativePacket=packet;assert.throws(()=>decodeNativeEdit(JSON.stringify(nested)),/嵌套/);
 const id=randomUUID();assert.deepEqual(decodeNativeFavorites(encodeNativeFavorites([id,id])),[id]);assert.throws(()=>encodeNativeFavorites(['bad']));
});
test('native snapshots remove undone owned fields and preserve source XML plus unknown envelope/payload',async()=>{
 const first=JSON.parse(encodeNativeEdit(edit({xmpPacket:unknown,label:'任意 中文',adjustments:{...presetValidationBase,glow:20}})));first.opaque={sequence:[{note:'未知'}]};first.payload.future={enabled:true};
 const next=decodeNativeEdit(encodeNativeEdit(edit({nativePacket:JSON.stringify(first),label:'',xmpPacket:unknown.replace('未知结构','外部更新')}),[unknown]));
 assert.equal(next.label,'');assert.equal(next.adjustments.glow,undefined);assert.equal(next.future.enabled,true);assert.equal(next.xmpPacket,unknown.replace('未知结构','外部更新'));
 const container=JSON.parse(next.nativePacket);assert.deepEqual(container.opaque,first.opaque);assert.deepEqual(container.sourceXMPHistory,[unknown]);assert.equal(container.payload.xmpPacket,undefined);
 const packet=await documents.serialize(edit({xmpPacket:unknown}));assert.equal(decodeNativeEdit(packet).xmpPacket,unknown);assert.deepEqual((await xmp.call('read',decodeNativeEdit(packet).xmpPacket)).properties,(await xmp.call('read',unknown)).properties);
});
test('native readForImage is active and source XML baked flags never override its snapshot',()=>scenario(async({root})=>{
 const packet=(await xmp.call('write',unknown,[value('AlreadyApplied','True'),value('Exposure2012',3)])).packet;
 const path=join(root,'原生.captraw');await writeFile(path,await documents.serialize(edit({xmpPacket:packet,adjustments:{...presetValidationBase,exposure:.5},label:''})));
 const opened=await documents.readForImage(path);assert.equal(opened.storageKind,'native');assert.equal(opened.openingKind,'active');assert.equal(opened.metadataOnly,false);assert.equal(opened.hasDevelopSettings,true);assert.equal(opened.adjustments.exposure,.5);assert.equal(opened.label,'');assert.equal(opened.xmpPacket,packet);assert.equal(opened.nativePacket,await readFile(path,'utf8'));
}));
test('fixed stage-A legacy XML migrates without changing full ART profile, controls or RGB16 pixels',()=>scenario(async({root,source,doc,core})=>{
 for(const [file,expected] of [[golden.sourceFile,golden.sourceSHA256],[golden.xmpFile,golden.xmpSHA256],[golden.artProfileFile,golden.artProfileSHA256]])assert.equal(sha(await readFile(join(fixture,file))),expected,'immutable golden '+file);
 const legacy=join(root,'synthetic.xmp');await copyFile(join(fixture,'synthetic.xmp'),legacy);const bytes=await readFile(legacy);
 const imported=await documents.readForImage(legacy);assert.equal(imported.storageKind,'legacy-xmp');assert.deepEqual(imported.adjustments,golden.adjustments);assert.equal(sha(Buffer.from(imported.artProfile)),golden.artProfileSHA256);
 const worker=core();await worker.ready;const native=join(root,'synthetic.dng.captraw');
 await saveRecipeWithMasks(worker,native,{...imported,source:{path:'中文 空格.dng',size:golden.sourceBytes,sha256:golden.sourceSHA256}},v=>documents.serialize(v));
 const opened=await restoreRecipeMasks(worker,native,await documents.readForImage(native),join(root,'restore'));
 assert.deepEqual(opened.adjustments,golden.adjustments);assert.equal(opened.artProfile,imported.artProfile);assert.equal(opened.xmpPacket,bytes.toString());assert.equal(opened.rating,golden.rating);assert.equal(opened.label,golden.label);
 const composed=await worker.call('compose',{...doc,path:source,artProfile:opened.artProfile,adjustments:opened.adjustments});assert.equal(sha(Buffer.from(composed.artProfile)),golden.recomposedArtProfileSHA256);
 const output=join(root,'native-reopened.tif');await worker.call('export',{path:source,artProfile:composed.artProfile,output,format:'tiff',colorSpace:'srgb'});
 const pixels=JSON.parse(execFileSync(python,['-c',"import tifffile,numpy as np,hashlib,json,sys\nwith tifffile.TiffFile(sys.argv[1]) as f:\n a=f.asarray();assert a.dtype.name=='uint16';icc=f.pages[0].tags[34675].value\n print(json.dumps({'shape':list(a.shape),'dtype':str(a.dtype),'pixelSHA256':hashlib.sha256(np.ascontiguousarray(a.astype('<u2')).tobytes()).hexdigest(),'iccSHA256':hashlib.sha256(icc).hexdigest()}))",output],{encoding:'utf8'}));
 assert.deepEqual(pixels,golden.expectedRGB16);assert.deepEqual(await readFile(legacy),bytes);
}));
test('session saves native sidecars, keeps XML separate, and remembers only the current session',()=>scenario(async({root,doc})=>{
 const prompts=[],saver=makeSaver(root,async targets=>{prompts.push(targets);return true;});const first=saved(await saver.run(request(doc)));
 assert.equal(first.output,nativeSidecar(doc.path));assert.equal(first.xmpPacket,unknown);assert.equal(await readFile(first.output,'utf8'),first.nativePacket);assert.equal(prompts.length,1);assert.equal(prompts[0][0].exists,false);
 saved(await saver.run(request({...doc,label:''})));assert.equal(prompts.length,1);assert.equal((await documents.read(first.output)).label,'');
 saver.forgetSession('native-session');saved(await saver.run(request(doc)));assert.equal(prompts.length,2);
 saved(await saver.run(request(doc,'other-session')));assert.equal(prompts.length,3);assert.deepEqual(await readdir(join(root,'save-cache')),[]);
}));
test('external native updates require fresh consent and preserve new XML and unknown JSON fields',()=>scenario(async({root,doc})=>{
 const prompts=[],saver=makeSaver(root,async targets=>{prompts.push(targets);return true;});const first=saved(await saver.run(request(doc))),external=JSON.parse(first.nativePacket);
 external.sourceXMP=unknown.replace('未知结构','外部未知 最新');external.vendor={data:['opaque']};external.payload.externalField='保留';await writeFile(first.output,JSON.stringify(external));
 const second=saved(await saver.run(request({...doc,adjustments:{...doc.adjustments,exposure:1}})));assert.equal(prompts.length,2);assert.equal(prompts[1][0].changed,true);assert.equal(second.xmpPacket,external.sourceXMP);
 const result=JSON.parse(second.nativePacket);assert.deepEqual(result.vendor,external.vendor);assert.equal(result.payload.externalField,'保留');assert.equal(result.payload.adjustments.exposure,1);
}));
test('session cancellation during consent starts no worker/file and rejected replace leaves the old document',()=>scenario(async({root,doc})=>{
 let saver;saver=makeSaver(root,async()=>{saver.cancel();return true;});assert.deepEqual(await saver.run(request(doc)),{results:[],cancelled:true});await assert.rejects(access(nativeSidecar(doc.path)));
 const normal=makeSaver(root);const first=saved(await normal.run(request(doc))),before=await readFile(first.output);const rejecting=makeSaver(root,async()=>false);assert.equal(await rejecting.run(request(doc)),null);assert.deepEqual(await readFile(first.output),before);
}));
test('cancellation after real worker composition finishes the current atomic document and stops the next',()=>scenario(async({root,doc})=>{
 const second=join(root,'next.dng');await copyFile(doc.path,second);let saver,serialized=0;
 class CancelDocuments extends Documents{async serialize(value,carried){++serialized;saver.cancel();return super.serialize(value,carried);}}
 saver=new SessionDocumentSaver(binary,resources,join(root,'save-cache'),new CancelDocuments(xmp),async()=>true,()=>{});
 const result=await saver.run({sessionId:'atomic-cancel',documents:[doc,{...doc,path:second}]});assert.equal(result.cancelled,true);assert.equal(result.results.length,1);assert.equal(result.results[0].error,undefined);assert.equal(serialized,1);assert.equal(decodeNativeEdit(await readFile(nativeSidecar(doc.path),'utf8')).adjustments.exposure,doc.adjustments.exposure);await assert.rejects(access(nativeSidecar(second)));assert.deepEqual(await readdir(join(root,'save-cache')),[]);
}));
test('native partial success is retained and a failed target can be saved once to an explicit location',()=>scenario(async({root,doc})=>{
 const secondPath=join(root,'second.dng');await copyFile(doc.path,secondPath);const second={...doc,path:secondPath};await writeFile(nativeSidecar(doc.path),'not a native document');
 const saver=makeSaver(root),result=await saver.run({sessionId:'partial',documents:[doc,second]});assert(result.results[0].error);assert.equal(result.results[1].error,undefined);assert.equal(await readFile(nativeSidecar(doc.path),'utf8'),'not a native document');
 const alternate=join(root,'另存 目标.captraw');assert.equal(saved(await saver.run(request(doc,'partial'),alternate)).output,alternate);assert.equal(saved(await saver.run(request(doc,'partial'))).output,alternate);
 await assert.rejects(saver.run(request(doc,'partial'),doc.path),/captraw/);assert.equal((await saveTargetState(alternate)).nativePacket,await readFile(alternate,'utf8'));
}));
test('batch uses source-extension native names and exclusive collisions without changing legacy XML',()=>scenario(async({root,doc})=>{
 const output=join(root,'batch');await mkdir(output);const legacy=doc.path.replace(/\.dng$/,'.xmp');await writeFile(legacy,unknown);await writeFile(join(output,'中文 空格.dng.captraw'),'existing');
 const saver=new BatchDocumentSaver(binary,resources,join(root,'batch-cache'),documents,()=>{}),row=saved(await saver.run({documents:[doc]},output));assert.equal(row.output,join(output,'中文 空格.dng_1.captraw'));assert.equal(row.xmpPacket,unknown);assert.equal(await readFile(join(output,'中文 空格.dng.captraw'),'utf8'),'existing');assert.equal(await readFile(legacy,'utf8'),unknown);assert.equal(resolve(dirname(row.output),decodeNativeEdit(row.nativePacket).source.path),doc.path);
 for(const key of ['nativePacket','xmpPacket'])assert.throws(()=>validateBatchSave({documents:[{...doc,[key]:42}]}),/快照/);
}));
test('document assets survive publication failure, reuse immutable files and reopen after moving the entire group',()=>scenario(async({root,doc,core})=>{
 const worker=core();await worker.ready;const masked=await raster(root,doc),target=join(root,'asset.captraw'),before=await documents.serialize(edit());await writeFile(target,before);
 const recipe=edit({artProfile:doc.artProfile,adjustments:masked.doc.adjustments,xmpPacket:unknown});
 await assert.rejects(saveRecipeWithMasks(worker,target,recipe,v=>documents.serialize(v),true,async()=>{throw new Error('publication denied');}),/publication denied/);
 assert.equal(await readFile(target,'utf8'),before);const asset=join(target+'.assets',masked.id+'.png');assert.deepEqual(await readFile(asset),masked.bytes);assert(!(await readdir(root)).some(n=>n.endsWith('.tmp')));
 await saveRecipeWithMasks(worker,target,recipe,v=>documents.serialize(v));const first=await readFile(target,'utf8');await saveRecipeWithMasks(worker,target,recipe,v=>documents.serialize(v));assert.equal(await readFile(target,'utf8'),first);assert.deepEqual(await readdir(target+'.assets'),[masked.id+'.png']);
 const moved=join(root,'移动组');await mkdir(moved);const relocated=join(moved,'asset.captraw');await rename(target,relocated);await rename(target+'.assets',relocated+'.assets');await rm(masked.path);
 const restored=await restoreRecipeMasks(worker,relocated,await documents.read(relocated),join(root,'restored'));assert.deepEqual(await readFile(restored.adjustments.masks[0].raster.path),masked.bytes);
 const good=await readFile(relocated);await writeFile(join(relocated+'.assets',masked.id+'.png'),'changed');await assert.rejects(restoreRecipeMasks(worker,relocated,await documents.read(relocated),join(root,'bad-restore')),/校验|改变|不符/);assert.deepEqual(await readFile(relocated),good);
}));
test('self-owned preset and favorites migrate to native once, leaving legacy XML and ISO settings intact',()=>scenario(async({root,core})=>{
 const worker=core();await worker.ready;const library=join(root,'library'),id=randomUUID(),folder=join(library,id);await mkdir(folder,{recursive:true});
 const anchors=[{iso:400,adjustments:{luminanceNoise:0}},{iso:1600,adjustments:{luminanceNoise:30}}],legacy=join(folder,'preset.xmp');const packet=await legacyPreset(legacy,{id,adjustments:{exposure:.75},anchors});
 const favorites=(await xmp.call('write','',[property(CT,'FavoriteIDs',encode([id]))])).packet;await writeFile(join(library,'.favorites.xmp'),favorites);
 const store=new Presets(library,worker,join(root,'cache'),xmp),list=await store.list();assert.deepEqual(list.errors,[]);assert(list.items.find(p=>p.id===id).favorite);assert(list.items.find(p=>p.id===id).isoAdaptive);
 const path=join(folder,'preset.captrawpreset'),native=await readFile(path,'utf8'),decoded=decodeNativePreset(native);assert.equal(decoded.xmpPacket,packet);assert.equal(decoded.adjustments.exposure,.75);assert.deepEqual(decoded.isoAnchors,anchors);assert.equal(decoded.supportsAmount2,false);assert.deepEqual(decodeNativeFavorites(await readFile(join(library,'.favorites.captraw'),'utf8')),[id]);
 const restarted=new Presets(library,worker,join(root,'cache2'),xmp);assert.deepEqual((await restarted.list()).errors,[]);assert.equal(await readFile(path,'utf8'),native);assert.equal(await readFile(legacy,'utf8'),packet);assert.equal(await readFile(join(library,'.favorites.xmp'),'utf8'),favorites);
 await restarted.favorite(id,false);assert.equal((await restarted.list()).items.find(p=>p.id===id).favorite,false);assert.equal(await readFile(join(library,'.favorites.xmp'),'utf8'),favorites);
}));
test('native preset maintenance preserves source XML, unknown JSON and independent Amount flags',()=>scenario(async({root,core})=>{
 const worker=core();await worker.ready;const store=new Presets(join(root,'library'),worker,join(root,'cache'),xmp),input=join(root,'input.captrawpreset');
 const native=JSON.parse(encodeNativePreset(preset({xmpPacket:unknown,supportsAmount:false,supportsAmount2:true})));native.unknown={qualifier:'保留'};native.payload.extra='opaque';await writeFile(input,JSON.stringify(native));
 const imported=await store.importFile(input);await store.rename(imported.id,'改名','中文分组');const copy=await store.duplicate(imported.id,'复制','中文分组');assert.notEqual(copy.id,imported.id);
 await store.update(copy.id,{name:'更新',group:'测试',groups:['light'],adjustments:{...presetValidationBase,exposure:1}});
 const output=join(root,'export.captrawpreset');await store.exportFile(copy.id,output);const decoded=decodeNativePreset(await readFile(output,'utf8'));assert.equal(decoded.xmpPacket,unknown);assert.equal(decoded.supportsAmount,false);assert.equal(decoded.supportsAmount2,true);assert.equal(decoded.adjustments.exposure,1);assert.equal(decoded.extra,'opaque');assert.deepEqual(JSON.parse(decoded.nativePacket).unknown,native.unknown);await assert.rejects(store.exportFile(copy.id,join(root,'forbidden.xmp')),/captrawpreset/);
 const after=new Presets(join(root,'library'),worker,join(root,'cache2'),xmp);assert((await after.list()).items.some(p=>p.id===copy.id));
}));
test('Adobe missing or native-unsupported Look is skipped with ISO/NR intact; self-owned imports fail faithfully',()=>scenario(async({root,core})=>{
 const worker=core();await worker.ready;const store=new Presets(join(root,'library'),worker,join(root,'cache'),xmp);
 const look=stubbed=>property(CRS,'Look',{fields:[value('Name','测试 Look'),value('UUID','0123456789ABCDEF0123456789ABCDEF'),property(CRS,'Parameters',{fields:stubbed?[value('Stubbed','True')]:[value('LookTable','0123456789ABCDEF0123456789ABCDEF')]})]});
 const anchors=[400,1600].map((iso,i)=>({fields:[value('ISO',iso),value('LuminanceSmoothing',i*30),value('ColorNoiseReduction',25)]}));
 for(const stubbed of [false,true]){
  const file=join(root,'adobe-'+stubbed+'.xmp'),packet=(await xmp.call('write',unknown,[property(CRS,'Name',{localized:'Adobe 导入'}),property(CRS,'Group',{localized:'测试'}),value('Exposure2012',.5),look(stubbed),property(CRS,'ISODependent',{options:0x600,items:anchors})])).packet;await writeFile(file,packet);
  const imported=await store.importFile(file);assert(imported.isoAdaptive);assert(imported.warnings.some(w=>/跳过/.test(w)));const output=join(root,'adobe-'+stubbed+'.captrawpreset');await store.exportFile(imported.id,output);const decoded=decodeNativePreset(await readFile(output,'utf8'));
  assert.equal(decoded.xmpPacket,packet);assert.equal(decoded.adjustments.colorProfile,undefined);assert.equal(decoded.adjustments.exposure,.5);assert.equal(presetAtISO(decoded.isoAnchors,800,decoded.adjustments).luminanceNoise,15);assert.equal(presetAtISO(decoded.isoAnchors,800,decoded.adjustments).colorNoise,25);assert(decoded.unsupportedSettings.some(w=>/跳过/.test(w)));assert.equal(await readFile(file,'utf8'),packet);
  const strict=join(root,'self-'+stubbed+'.xmp');await writeFile(strict,(await xmp.call('write',packet,[property(CT,'EngineVersion',text(ENGINE_VERSION))])).packet);await assert.rejects(store.importFile(strict),/Look|资产|Stubbed/);
 }
}));
test('legacy preset missing assets stays unmigrated with a visible library error',()=>scenario(async({root,core})=>{
 const worker=core();await worker.ready;const library=join(root,'library'),id=randomUUID(),folder=join(library,id);await mkdir(folder,{recursive:true});const masked=await raster(root,{adjustments:{}}),entry={id:masked.id,path:'preset.xmp.assets/'+masked.id+'.png',bytes:masked.bytes.length};
 const m=structuredClone(masked.doc.adjustments);m.masks[0].raster.path='captraw-mask:'+masked.id;const legacy=join(folder,'preset.xmp'),packet=await legacyPreset(legacy,{id,adjustments:m,assets:{schemaVersion:1,files:[entry]}});
 const list=await new Presets(library,worker,join(root,'cache'),xmp).list();assert(list.errors.some(error=>error.startsWith(id+'：')&&/资产|ENOENT/.test(error)));await assert.rejects(access(join(folder,'preset.captrawpreset')));assert.equal(await readFile(legacy,'utf8'),packet);
}));
test('native preset mask assets and ISO anchors remain portable through library migration/export',()=>scenario(async({root,doc,core})=>{
 const worker=core();await worker.ready;const library=join(root,'library'),id=randomUUID(),folder=join(library,id);await mkdir(folder,{recursive:true});const masked=await raster(root,doc),asset=join(folder,'preset.xmp.assets',masked.id+'.png');await mkdir(dirname(asset));await writeFile(asset,masked.bytes);
 const controls=structuredClone(masked.doc.adjustments.masks);controls[0].raster.path='captraw-mask:'+masked.id;const anchors=[400,1600].map((iso,i)=>({iso,adjustments:{masks:controls,luminanceNoise:i*20}}));
 const legacy=join(folder,'preset.xmp'),packet=await legacyPreset(legacy,{id,adjustments:{masks:controls,luminanceNoise:0},anchors,assets:{schemaVersion:1,files:[{id:masked.id,path:'preset.xmp.assets/'+masked.id+'.png',bytes:masked.bytes.length}]}});
 const store=new Presets(library,worker,join(root,'cache'),xmp);assert.deepEqual((await store.list()).errors,[]);const output=join(root,'portable.captrawpreset');await store.exportFile(id,output);const exported=decodeNativePreset(await readFile(output,'utf8'));assert.equal(exported.xmpPacket,packet);assert.equal(exported.isoAnchors[1].adjustments.luminanceNoise,20);assert.equal(exported.isoAnchors[0].adjustments.masks[0].raster.path,'captraw-mask:'+masked.id);
 await rm(folder,{recursive:true});const restoredStore=new Presets(join(root,'second-library'),worker,join(root,'second-cache'),xmp);assert((await restoredStore.importFile(output)).isoAdaptive);assert.deepEqual(await readFile(join(output+'.assets',masked.id+'.png')),masked.bytes);
}));
test('native ICC preset assets are atomic and missing native assets never degrade to another profile',()=>scenario(async({root,core})=>{
 const worker=core();await worker.ready;const profile=join(root,'输入.icc');execFileSync(python,['-c',"from PIL import ImageCms\nimport sys\nopen(sys.argv[1],'wb').write(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())",profile]);
 const input=join(root,'icc.captrawpreset'),controls={mode:'inherited',reference:profile,toneCurve:false,lookTable:false,hueSatMap:true,baselineExposure:true,illuminant:0};await writeFile(input,encodeNativePreset(preset({groups:['profile'],adjustments:{colorProfile:controls},xmpPacket:unknown})));
 const store=new Presets(join(root,'library'),worker,join(root,'cache'),xmp),imported=await store.importFile(input),output=join(root,'export.captrawpreset');await store.exportFile(imported.id,output);const bytes=await readFile(output),decoded=decodeNativePreset(bytes.toString()),asset=join(dirname(output),decoded.inputProfileAsset.path);assert.deepEqual(await readFile(asset),await readFile(profile));
 await rm(profile);const independent=new Presets(join(root,'second-library'),worker,join(root,'cache2'),xmp);assert(await independent.importFile(output));await writeFile(asset,'bad');await assert.rejects(independent.importFile(output),/配置文件|校验/);assert.deepEqual(await readFile(output),bytes);
}));
test('native built-in pack publishes immutable checked native members and rejects bad bytes/old XML',()=>scenario(async({root})=>{
 const packs=new PresetPacks(join(root,'packs'));await packs.initialize();const entry=packs.entries()[0];assert(entry.path.endsWith('.captrawpreset'));const packet=await readFile(entry.path);assert.equal(decodeNativePreset(packet.toString()).adjustments.exposure,.5);
 const next={...structuredClone(builtinPresetPack),version:'1.1.1'};await packs.install(next,async()=>packet);assert.equal(packs.list()[0].version,'1.1.1');
 await assert.rejects(packs.install({...next,version:'1.1.2'},async()=>Buffer.from('wrong')),/校验/);const legacy=Buffer.from(unknown);await assert.rejects(packs.install({...next,version:'1.1.2',presets:[{...next.presets[0],sha256:sha(legacy)}]},async()=>legacy),/JSON/);assert.equal(packs.list()[0].version,'1.1.1');
}));

console.log('native-document cohort:',JSON.stringify({engineSHA256:sha(await readFile(binary)),legacyReference:golden.referenceCohort,legacyPixelSHA256:golden.expectedRGB16.pixelSHA256}));
