// Run the full suite after the document-opening/save/archive fix is built.
// SDK capability and unbaked controls can run independently of the native core.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {ENGINE_VERSION} from '@captraw/contracts';
import {DEFAULT_EXPORT_OPTIONS} from '@captraw/contracts/export-options';
import {XMP,CRS,CT,XMP_BASIC,lookup,property,text,decodeAdjustments} from '@captraw/desktop-core/xmp';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {saveRecipeWithMasks} from '@captraw/desktop-core/mask-assets';
import {captureSourceIdentity,verifySourceIdentity} from '@captraw/desktop-core/source-identity';
import {documentRelativePath} from '@captraw/desktop-core/runtime';

const scratch=await mkdtemp(join(tmpdir(),'captraw-already-applied-native-'));
let moduleDirectory;
if(process.env.CAPTRAW_ALREADY_APPLIED_SOURCE==='1'){
 moduleDirectory=join(scratch,'source-modules');await mkdir(moduleDirectory);
 const changed=new Set(['baked-crs','documents','session-save','output-metadata']);
 for(const name of changed){
  const file=resolve('packages/desktop-core/src',name+'.ts');
  const source=stripTypeScriptTypes(await readFile(file,'utf8'),{mode:'transform',sourceMap:false});
  const rewritten=source.replace(/from\s*(['"])([^'"]+)\1/g,(whole,quote,specifier)=>{
   if(specifier.startsWith('node:'))return whole;
   const local=/^\.\/(.+)\.js$/.exec(specifier);
   const target=local?pathToFileURL(changed.has(local[1])?join(moduleDirectory,local[1]+'.mjs'):resolve('packages/desktop-core/dist',local[1]+'.js')).href:import.meta.resolve(specifier);
   return 'from '+quote+target+quote;
  });
  await writeFile(join(moduleDirectory,name+'.mjs'),rewritten);
 }
}
const modulePath=name=>moduleDirectory?pathToFileURL(join(moduleDirectory,name+'.mjs')).href:'@captraw/desktop-core/'+name;
const {Documents,BatchDocumentSaver}=await import(modulePath('documents'));
const {SessionDocumentSaver,saveTargetState}=await import(modulePath('session-save'));
const {outputXMP}=await import(modulePath('output-metadata'));
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp);
const U='https://example.invalid/already-applied/',SECRET='baked-only-secret-旧蒙版';
let failed=false;
after(async()=>{if(failed)console.error('AlreadyApplied failure retained:',scratch);else await rm(scratch,{recursive:true,force:true});});
const scenario=run=>async()=>{try{await run();}catch(error){failed=true;throw error;}};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(packet,changes=[])=>xmp.call('write',packet,changes);
const parse=packet=>xmp.call('read',packet);
const field=(name,node)=>property(U,name,node);

function canonical(node){
 if(!node)return node;
 const result={};
 for(const key of ['value','localized','lang','type'])if(node[key]!==undefined)result[key]=node[key];
 // Container semantics matter; SDK bookkeeping flags do not alter RDF values.
 if(node.options&0x1f00)result.options=node.options&0x1f00;
 for(const key of ['fields','qualifiers'])if(node[key])result[key]=canonicalProperties(node[key]);
 if(node.items)result.items=node.items.map(canonical);
 return result;
}
function canonicalProperties(properties){
 return properties.map(p=>({ns:p.ns,name:p.name,node:canonical(p.node)})).sort((a,b)=>(a.ns+'|'+a.name).localeCompare(b.ns+'|'+b.name));
}
function archivedTrees(properties){
 const result=[];
 function visit(node,owner){
  if(!node)return;
  if(node.fields&&lookup(node.fields,CRS,'AlreadyApplied')?.value==='True'&&lookup(node.fields,CRS,'FutureMask'))result.push({owner,properties:node.fields.filter(p=>p.ns===CRS)});
  for(const p of [...(node.fields||[]),...(node.qualifiers||[])])visit(p.node,owner);
  for(const item of node.items||[])visit(item,owner);
 }
 for(const p of properties)if(p.ns===CT)visit(p.node,p.name);
 return result;
}
async function fixture(flag='True',includeLook=true){
 const nodes=[
  property(CRS,'AlreadyApplied',{value:flag,qualifiers:[field('FlagProof',text('preserve flag qualifier'))]}),
  property(CRS,'Exposure2012',{value:'1',qualifiers:[field('ManagedProof',text('old managed qualifier'))]}),
  property(CRS,'FutureMask',{options:0x600,qualifiers:[field('ArrayProof',{fields:[field('Unicode',text('限定符 中文'))]})],items:[
   {fields:[property(CRS,'Name',text('旧蒙版')),field('Secret',text(SECRET)),field('Sequence',{options:0x600,items:[text('second'),text('first')]})]},
   {fields:[field('Empty',text('')),field('Nested',{fields:[field('Leaf',{value:'opaque',qualifiers:[field('LeafProof',text('qualified leaf'))]})]})]}
  ]}),
  property(XMP_BASIC,'Rating',text(4)),property(XMP_BASIC,'Label',text('自定义 蓝标签')),
  field('Keep',text('unrelated metadata'))
 ];
 if(includeLook)nodes.push(property(CRS,'Look',{fields:[property(CRS,'Name',text('already baked Look')),property(CRS,'Parameters',{fields:[property(CRS,'CameraProfile',text('missing-profile-no-load.dcp')),property(CRS,'LookTable',text('0123456789ABCDEF0123456789ABCDEF')),field('Opaque',text('preserve nested unknown'))]})]}));
 return (await write('',nodes)).packet;
}
const document=(packet,adjustments={exposure:.25})=>({xmpPacket:packet,engineVersion:ENGINE_VERSION,source:{path:'rendered.tiff',size:1,sha256:'0'.repeat(64)},artProfile:'',adjustments,rating:4,label:'自定义 蓝标签',baselineVersion:4});
async function rendered(name,format){
 const path=join(scratch,name+'.'+format);
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import numpy as np,tifffile,sys
from PIL import Image
a=np.full((96,128,3),100,np.uint8)
if sys.argv[2]=='jpeg':Image.fromarray(a).save(sys.argv[1],quality=95)
else:tifffile.imwrite(sys.argv[1],a.astype(np.uint16)*257,photometric='rgb',metadata=None)`,path,format]);
 return path;
}

function assertArchive(original,result){
 const entries=archivedTrees(result);
 assert.equal(entries.length,1,'one original baked CRS tree must survive, without repeated-save duplication');
 assert.deepEqual(canonicalProperties(entries[0].properties),canonicalProperties(original.filter(p=>p.ns===CRS)));
 assert.equal(lookup(result,CRS,'FutureMask'),undefined,'baked unknown mask must not remain active at root');
 assert.equal(lookup(result,CRS,'Look'),undefined,'baked Look must not remain active at root');
 return entries[0];
}

test('SDK capability: a foreign-namespace RDF archive preserves structures, qualifiers and ordered arrays',scenario(async()=>{
 const packet=await fixture(),original=(await parse(packet)).properties;
 // This is a storage capability proof, not a substitute for production archiving.
 const archived=await write('',[
  property(CT,'ArchiveCapabilityProof',{options:0x600,items:[{fields:original.filter(p=>p.ns===CRS)}]}),
  property(CRS,'Exposure2012',text(.25)),property(CRS,'AlreadyApplied',text('False'))
 ]);
 assertArchive(original,archived.properties);
 const again=await write(archived.packet,[field('Later',text('metadata-only update'))]);
 assertArchive(original,again.properties);
 assert.equal(decodeAdjustments(again.properties).adjustments.exposure,.25);
}));

test('intentional decode remains available for explicit preset/transfer extraction from AlreadyApplied=True',scenario(async()=>{
 const packet=await fixture('True',false),properties=(await parse(packet)).properties;
 assert.equal(decodeAdjustments(properties).adjustments.exposure,1);
 const path=join(scratch,'pure-decode.xmp');await writeFile(path,packet);
 assert.equal((await documents.read(path)).adjustments.exposure,1,'Documents.read stays a decoder; image opening owns application context');
}));

test('image opening classifies baked CRS before Look decode and retains only metadata as activity',scenario(async()=>{
 const packet=await fixture(),original=(await parse(packet)).properties;
 const path=join(scratch,'baked-opening.xmp');
 await writeFile(path,(await write(packet,[property('http://ns.adobe.com/tiff/1.0/','Orientation',text(6)),property(CRS,'HDREditMode',text(1))])).packet);
 const opened=await documents.readForImage(path);
 assert.equal(opened.openingKind,'baked');assert.deepEqual(opened.adjustments,{});
 assert.equal(opened.rating,4);assert.equal(opened.label,'自定义 蓝标签');
 const result=await parse(opened.xmpPacket);
 assert.equal(lookup(result.properties,CRS,'Look'),undefined);
 const entries=archivedTrees(result.properties);assert.equal(entries.length,1);
 assert.deepEqual(canonical(lookup(entries[0].properties,CRS,'FutureMask')),canonical(lookup(original,CRS,'FutureMask')));
 assert.equal(lookup(entries[0].properties,CRS,'HDREditMode').value,'1');
}));

for(const format of ['jpeg','tiff'])test(`${format} embedded XMP fallback classifies True/False, saves and reopens without touching source pixels`,scenario(async()=>{
 const path=await rendered('embedded-'+format,format),packet=await fixture();
 await xmp.call('file-write',packet,[],{path,format});
 const original=await readFile(path),embedded=await xmp.call('file-read','',[],{path,format});
 const opened=await documents.readForImage(path);
 assert.equal(opened.openingKind,'baked');assert.deepEqual(opened.adjustments,{});
 assert.equal(opened.rating,4);assert.equal(opened.label,'自定义 蓝标签');
 assertArchive(embedded.properties,(await parse(opened.xmpPacket)).properties);
 const sidecar=join(scratch,'embedded-'+format+'.xmp');
 await writeFile(sidecar,await documents.serialize(document(opened.xmpPacket)));
 const saved=await documents.readForImage(sidecar);assert.equal(saved.openingKind,'active');assert.equal(saved.adjustments.exposure,.25);
 assertArchive(embedded.properties,(await parse(saved.xmpPacket)).properties);
 // Simulate an encoded export's metadata write. The SDK must remove archive
 // bytes, not only hide properties while leaving an abandoned old packet.
 const output=await rendered('embedded-output-'+format,format);
 const pixelHash=()=>execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import hashlib,sys,tifffile
from PIL import Image
pixels=tifffile.imread(sys.argv[1]).tobytes() if sys.argv[2]=='tiff' else Image.open(sys.argv[1]).tobytes()
print(hashlib.sha256(pixels).hexdigest())`,output,format],{encoding:'utf8'}).trim();
 const outputPixels=pixelHash();
 await xmp.call('file-write',saved.xmpPacket,[],{path:output,format});
 const options={...structuredClone(DEFAULT_EXPORT_OPTIONS),metadata:{include:'all',removeLocation:false}};
 const outputPacket=await outputXMP(xmp,embedded.packet,{...document(saved.xmpPacket),path,width:128,height:96},format,options,128,96,'RTv4_sRGB');
 await xmp.call('file-write',outputPacket,[],{path:output,format});
 const reopened=await documents.readForImage(output);assert.equal(reopened.openingKind,'baked');assert.deepEqual(reopened.adjustments,{});
 const result=await xmp.call('file-read','',[],{path:output,format});assert.equal(archivedTrees(result.properties).length,0);
 for(const secret of [SECRET,'missing-profile-no-load.dcp'])assert(!(await readFile(output)).includes(Buffer.from(secret)));
 assert.equal(pixelHash(),outputPixels,'removing prior archive metadata must not re-encode exported pixels');
 assert.deepEqual(await readFile(path),original,'opening, saving a sidecar and output must not write the source container');
 const activePath=await rendered('embedded-active-'+format,format);
 await xmp.call('file-write',await fixture('False',false),[],{path:activePath,format});
 const activeOriginal=await readFile(activePath),active=await documents.readForImage(activePath);
 assert.equal(active.openingKind,'active');assert.equal(active.adjustments.exposure,1);
 assert.equal(archivedTrees((await parse(active.xmpPacket)).properties).length,0);
 assert.deepEqual(await readFile(activePath),activeOriginal);
}));

test('real ACR active False embedded TIFF exposes the same full RDF and active gradient as its extracted sidecar',scenario(async()=>{
 const source=resolve('artifacts/stage-0/acr-reference/linear-gradient-active-187/inputs/controlled-linear-active.tif');
 const bytes=await readFile(source);assert.equal(hash(bytes),'f138e1c921e02e7237e020c0496572ae44f35ad46a2219fd8c0ce8d2884a1bfb');
 const path=join(scratch,'real-native-active.tif');await copyFile(source,path);
 const opened=await documents.readForImage(path),sidecar=await documents.readForImage(resolve('artifacts/stage-0/acr-reference/linear-gradient-active-187/native-active.xmp'));
 const {rotation,flipHorizontal,flipVertical,...develop}=sidecar.adjustments;
 assert.equal(rotation,0);assert.equal(flipHorizontal,false);assert.equal(flipVertical,false);
 assert.equal(opened.openingKind,'active');assert.deepEqual(opened.adjustments,develop);
 const full=(await parse(opened.xmpPacket)).properties;
 for(const p of (await parse(sidecar.xmpPacket)).properties)assert.deepEqual(canonical(lookup(full,p.ns,p.name)),canonical(p.node),p.name);
 assert.equal(opened.adjustments.masks[0].components[0].linearGradientModel,'full-zero-v1');
 assert.deepEqual(await readFile(path),bytes);assert.deepEqual(await readFile(source),bytes);
}));

for(const format of ['jpeg','tiff'])test(`${format} embedded source orientation is metadata; explicit sidecar orientation remains an adjustment`,scenario(async()=>{
 const path=await rendered('orientation-'+format,format);
 execFileSync('exiftool',['-overwrite_original','-EXIF:Orientation#=6',path],{stdio:'pipe'});
 for(const nodes of [[],[property(XMP_BASIC,'Rating',text(4)),property(XMP_BASIC,'Label',text('仅标签'))]]){
  const packet=(await write('',[...nodes,property('http://ns.adobe.com/tiff/1.0/','Orientation',text(6))])).packet;
  await xmp.call('file-write',packet,[],{path,format});const bytes=await readFile(path);
  const opened=await documents.readForImage(path);assert.deepEqual(opened.adjustments,{});assert.equal(opened.metadataOnly,true);
  assert.equal(opened.rating,nodes.length?4:undefined);assert.equal(opened.label,nodes.length?'仅标签':undefined);
  assert.deepEqual(await readFile(path),bytes);
 }
 const active=(await write(await fixture('False',false),[property('http://ns.adobe.com/tiff/1.0/','Orientation',text(6))])).packet;
 await xmp.call('file-write',active,[],{path,format});
 const embedded=await documents.readForImage(path);assert.equal(embedded.metadataOnly,false);assert.equal(embedded.adjustments.exposure,1);assert.equal(embedded.adjustments.rotation,undefined);
 const sidecar=join(scratch,'orientation-command-'+format+'.xmp');await writeFile(sidecar,active);
 const command=await documents.readForImage(sidecar);assert.equal(command.adjustments.rotation,90);
}));

test('native active False linear gradient remains an active full-zero mask',scenario(async()=>{
 const path=resolve('artifacts/stage-0/acr-reference/linear-gradient-active-187/native-active.xmp');
 assert.equal(hash(await readFile(path)),'a8ec7ad86aa9025993cfa7b114906f160fd4e163b8e2d6347f3e0319cb56abf2');
 const opened=await documents.readForImage(path);assert.equal(opened.openingKind,'active');
 assert.equal(opened.adjustments.masks.length,1);
 const leaf=opened.adjustments.masks[0].components[0];assert.equal(leaf.type,'linear');assert.equal(leaf.linearGradientModel,'full-zero-v1');
 assert.deepEqual(leaf.start,{x:.315451,y:.499285});assert.deepEqual(leaf.end,{x:.625417,y:.499285});assert.equal(leaf.enabled,true);assert.equal(leaf.feather,0);
}));

test('unbaked unknown CRS fields retain their original root, qualifiers and sequence',scenario(async()=>{
 const packet=await fixture('False'),original=(await parse(packet)).properties;
 const saved=await parse(await documents.serialize(document(packet)));
 assert.equal(lookup(saved.properties,CRS,'AlreadyApplied').value,'False');
 for(const name of ['FutureMask','Look'])assert.deepEqual(canonical(lookup(saved.properties,CRS,name)),canonical(lookup(original,CRS,name)));
 assert.equal(archivedTrees(saved.properties).length,0);
}));

test('a baked CRS document saves only new active edits and archives the complete original RDF tree',scenario(async()=>{
 const packet=await fixture(),original=(await parse(packet)).properties;
 const saved=await parse(await documents.serialize(document(packet)));
 assert.equal(lookup(saved.properties,CRS,'AlreadyApplied').value,'False');
 assert.equal(Number(lookup(saved.properties,CRS,'Exposure2012').value),.25);
 assert.equal(lookup(saved.properties,CRS,'Exposure2012').qualifiers?.some(p=>p.ns===U&&p.name==='ManagedProof')??false,false,'old baked qualifiers belong in the archive, not the new active exposure');
 assertArchive(original,saved.properties);
 assert.equal(lookup(saved.properties,XMP_BASIC,'Rating').value,'4');
 assert.equal(lookup(saved.properties,XMP_BASIC,'Label').value,'自定义 蓝标签');
 assert.equal(lookup(saved.properties,U,'Keep').value,'unrelated metadata');
}));

test('repeated active saves do not reactivate or append the baked tree',scenario(async()=>{
 const packet=await fixture(),original=(await parse(packet)).properties;
 let saved=await documents.serialize(document(packet));
 for(const exposure of [.5,.75]){
  saved=await documents.serialize(document(saved,{exposure}));
  const result=await parse(saved);assertArchive(original,result.properties);
  assert.equal(lookup(result.properties,CRS,'AlreadyApplied').value,'False');
  assert.equal(Number(lookup(result.properties,CRS,'Exposure2012').value),exposure);
 }
}));

test('legacy native activity plus True migrates its active exposure/HDR snapshot without resurrecting unknown CRS',scenario(async()=>{
 const active=await documents.serialize(document(undefined,{exposure:.75,hdrEnabled:true,hdrHeadroom:2}));
 const future=lookup((await parse(await fixture())).properties,CRS,'FutureMask');
 const legacy=await write(active,[property(CRS,'AlreadyApplied',text('True')),property(CRS,'FutureMask',future)]);
 const path=join(scratch,'legacy.xmp');await writeFile(path,legacy.packet);
 const decoded=await documents.read(path);
 assert.equal(decoded.adjustments.exposure,.75);assert.equal(decoded.adjustments.hdrEnabled,true);
 const opened=await documents.readForImage(path);assert.equal(opened.openingKind,'legacy-active');
 assert.deepEqual(opened.adjustments,decoded.adjustments);
 assert(opened.warnings.some(message=>message.includes('AlreadyApplied=True')&&message.includes('原有显影外观已保留')));
 const migrated=await parse(await documents.serialize(document(legacy.packet,decoded.adjustments)));
 assert.equal(lookup(migrated.properties,CRS,'AlreadyApplied').value,'False');
 assert.equal(Number(lookup(migrated.properties,CRS,'Exposure2012').value),.75);
 assert.equal(lookup(migrated.properties,CRS,'HDREditMode').value,'1');
 assertArchive(legacy.properties,migrated.properties);
}));

test('latest active metadata carries snapshot provenance and deduplicates repeated saves',scenario(async()=>{
 const original=await fixture(),originalProperties=(await parse(original)).properties;
 const saved=await documents.serialize(document(original));
 const latest=(await write('',[property(CRS,'AlreadyApplied',text('False')),property(CRS,'FutureActive',text('external active metadata'))])).packet;
 let next=await documents.serialize(document(latest),[saved,original]);
 for(let i=0;i<2;i++){
  const result=await parse(next);assertArchive(originalProperties,result.properties);
  assert.equal(lookup(result.properties,CRS,'FutureActive').value,'external active metadata');
  next=await documents.serialize(document(next,{exposure:.5}),[saved]);
 }
}));

test('an external baked target and the older snapshot keep both original RDF trees inactive',scenario(async()=>{
 const original=await fixture(),latest=await write(original,[property(CRS,'Exposure2012',text('2')),field('Keep',text('latest external metadata'))]);
 const saved=await documents.serialize(document(latest.packet),[original]);
 const properties=(await parse(saved)).properties,trees=archivedTrees(properties);
 assert.equal(trees.length,2);assert.deepEqual(trees.map(t=>Number(lookup(t.properties,CRS,'Exposure2012').value)).sort(),[1,2]);
 assert.equal(lookup(properties,CRS,'FutureMask'),undefined);assert.equal(lookup(properties,CRS,'Look'),undefined);
 assert.equal(lookup(properties,U,'Keep').value,'latest external metadata');
 assert.equal(Number(lookup(properties,CRS,'Exposure2012').value),.25);
}));

test('archive extension qualifiers merge losslessly; ambiguous extensions or versions fail before a save',scenario(async()=>{
 const packet=await documents.serialize(document(await fixture()));
 async function qualified(name,value='opaque'){
  const properties=(await parse(packet)).properties,root=lookup(properties,CT,'BakedCRS');
  for(const key of ['Version','Entries'])lookup(root.fields,CT,key).qualifiers=[field(name,text(value))];
  return (await write(packet,[property(CT,'BakedCRS',root)])).packet;
 }
 const a=await qualified('ProofA'),b=await qualified('ProofB');
 const saved=await parse(await documents.serialize(document(a),[b]));
 const root=lookup(saved.properties,CT,'BakedCRS');
 for(const key of ['Version','Entries'])for(const name of ['ProofA','ProofB'])assert.equal(lookup(lookup(root.fields,CT,key).qualifiers||[],U,name)?.value,'opaque');
 assert.equal(archivedTrees(saved.properties).length,1);
 await assert.rejects(documents.serialize(document(a),[await qualified('ProofA','conflict')]),/归档.*冲突/);
 const invalid=structuredClone(root);lookup(invalid.fields,CT,'Version').value='999';
 const broken=(await write(packet,[property(CT,'BakedCRS',invalid)])).packet;
 await assert.rejects(documents.serialize(document(broken)),/归档结构或版本无效/);
}));

test('output policies exclude the private archive and cannot refill baked CRS from the embedded source packet',scenario(async()=>{
 const packet=await fixture(),saved=await documents.serialize(document(packet));
 assertArchive((await parse(packet)).properties,(await parse(saved)).properties);
 for(const include of ['all','all-except-develop','copyright','none']){
  const options={...structuredClone(DEFAULT_EXPORT_OPTIONS),metadata:{include,removeLocation:false}};
  const output=await outputXMP(xmp,packet,{path:join(scratch,'source.tiff'),width:128,height:96,artProfile:'',adjustments:{exposure:.25},xmpPacket:saved},'tiff',options,128,96,'RTv4_sRGB');
  const properties=output?(await parse(output)).properties:[];
  assert.equal(archivedTrees(properties).length,0);
  for(const secret of [SECRET,'missing-profile-no-load.dcp','preserve nested unknown'])assert(!output.includes(secret),`${include} leaked archive content`);
  assert.equal(lookup(properties,CRS,'FutureMask'),undefined);
  assert.equal(lookup(properties,CRS,'Look'),undefined);
  if(include==='all'){
   assert.equal(lookup(properties,CRS,'AlreadyApplied').value,'True');
   assert.equal(Number(lookup(properties,CRS,'Exposure2012').value),.25);
  }else assert(!properties.some(p=>p.ns===CRS));
  if(include==='all'||include==='all-except-develop')assert.equal(lookup(properties,U,'Keep').value,'unrelated metadata');
 }
}));

test('unbaked output metadata retains ordinary unknown CRS instead of treating every unknown field as private',scenario(async()=>{
 const packet=await fixture('False',false),options={...structuredClone(DEFAULT_EXPORT_OPTIONS),metadata:{include:'all',removeLocation:false}};
 const output=await outputXMP(xmp,packet,{path:join(scratch,'active.tiff'),width:128,height:96,artProfile:'',adjustments:{exposure:.25}},'tiff',options,128,96,'RTv4_sRGB');
 assert.deepEqual(canonical(lookup((await parse(output)).properties,CRS,'FutureMask')),canonical(lookup((await parse(packet)).properties,CRS,'FutureMask')));
}));

test('actual recipe:save handler carries provenance and rejects a target changed before atomic publication (source-only asset adapter)',scenario(async()=>{
 // Execute the exact owned IPC body without importing Electron or launching a
 // worker. Only native validation/empty-asset inventory are adapted here.
 const source=join(scratch,'explicit-source.tiff');await writeFile(source,'unchanged source identity');
 const target=join(scratch,'explicit-target.xmp'),packet=await fixture(),saved=await documents.serialize(document(packet));
 const current={id:'explicit',path:source,adjustments:{exposure:.25},sourceIdentity:await captureSourceIdentity(source),recipe:{xmpPacket:saved}};
 const latest=(await write('',[property(CRS,'AlreadyApplied',text('False')),field('Keep',text('external latest'))])).packet;
 const external=(await write(await fixture(),[property(CRS,'Exposure2012',text('2'))])).packet;
 const main=await readFile(resolve('apps/desktop/electron/main.ts'),'utf8');
 const block=main.slice(main.indexOf("  ipcMain.handle('recipe:save'"),main.indexOf("  ipcMain.handle('image:export'"));
 assert(block.startsWith("  ipcMain.handle('recipe:save'"));let handler;
 const adapter={async call(method){if(method==='validate')return {};if(method==='maskAssets')return {paths:[]};if(method==='inputProfileAsset')return {};throw new Error('Unexpected native asset call '+method);}};
 const dependencies={ipcMain:{handle(channel,value){assert.equal(channel,'recipe:save');handler=value;}},requireSession:()=>current,verifySourceIdentity,
  dialog:{showSaveDialog:async()=>({canceled:false,filePath:target})},win:undefined,join,dirname,basename,extname,resolve,native:()=>adapter,documents,saveRecipeWithMasks,ENGINE_VERSION,documentRelativePath,saveTargetState};
 new Function('dependencies','const {'+Object.keys(dependencies).join(',')+'}=dependencies;'+stripTypeScriptTypes(block,{mode:'transform'}))(dependencies);
 await writeFile(target,latest);await handler(null,{session:structuredClone(current),artProfile:''});
 assertArchive((await parse(packet)).properties,(await xmp.read(target)).properties);
 assert.equal(lookup((await xmp.read(target)).properties,U,'Keep').value,'external latest');
 assert.equal((await parse(current.recipe.xmpPacket)).properties.length,(await xmp.read(target)).properties.length);
 const serialize=documents.serialize.bind(documents),before=structuredClone(current.recipe);
 documents.serialize=async(...args)=>{const result=await serialize(...args);await writeFile(target,external);return result;};
 try{await assert.rejects(handler(null,{session:structuredClone(current),artProfile:''}),/XMP.*外部修改.*未覆盖原数据/);}finally{documents.serialize=serialize;}
 assert.equal(await readFile(target,'utf8'),external);assert.deepEqual(current.recipe,before);
 assert(!(await readdir(scratch)).some(name=>name.startsWith('explicit-target.xmp.')&&name.endsWith('.tmp')));
}));

test('session latest-target merge and batch save retain the snapshot archive without activating old CRS',{skip:process.env.CAPTRAW_ALREADY_APPLIED_SOURCE==='1'?'source-only SDK run; native workers are reserved for the joint build':false},scenario(async()=>{
 const directory=join(scratch,'services');await mkdir(directory);
 const source=join(directory,'rendered.tiff'),python=resolve('build/qa-venv/bin/python');
 execFileSync(python,['-c','import numpy as np,tifffile,sys;tifffile.imwrite(sys.argv[1],np.full((96,128,3),26000,np.uint16),photometric="rgb",metadata=None)',source]);
 const sourceBytes=await readFile(source),sourceHash=hash(sourceBytes),packet=await fixture();
 const snapshotPacket=await documents.serialize(document(packet));
 assertArchive((await parse(packet)).properties,(await parse(snapshotPacket)).properties);
 const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
 const worker=new NativeEngine(binary,resources,join(directory,'open-cache'));let image;
 try{await worker.ready;image=await worker.call('open',{path:source,sessionId:'archive-save',effectsDefaults:'current',whiteBalanceDefaults:'current',sourceFramePolicy:'active-area-v1'});}finally{const exit=worker.child.exitCode===null?new Promise(done=>worker.child.once('exit',done)):Promise.resolve();worker.terminate();await exit;}
 const snapshot={path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:{...image.adjustments,exposure:.25},xmpPacket:snapshotPacket,rating:4,label:'自定义 蓝标签'};
 const latest=await write('',[property(CRS,'AlreadyApplied',text('False')),property(CRS,'FutureActive',text('new external active metadata'))]);
 const target=join(directory,'rendered.xmp');await writeFile(target,latest.packet);
 const saver=new SessionDocumentSaver(binary,resources,join(directory,'save-cache'),documents,async()=>true,()=>{});
 const result=await saver.run({sessionId:'archive-save',documents:[snapshot]});
 assert.equal(result.results.length,1);assert.equal(result.results[0].error,undefined,JSON.stringify(result));
 const session=await xmp.read(target);assertArchive((await parse(packet)).properties,session.properties);
 assert.equal(lookup(session.properties,CRS,'FutureActive').value,'new external active metadata');
 assert.equal(lookup(session.properties,CRS,'AlreadyApplied').value,'False');
 const batchDirectory=join(directory,'batch');await mkdir(batchDirectory);
 const batch=new BatchDocumentSaver(binary,resources,join(directory,'batch-cache'),documents,()=>{});
 const saved=await batch.run({documents:[snapshot]},batchDirectory);
 assert.equal(saved.results[0].error,undefined,JSON.stringify(saved));
 assertArchive((await parse(packet)).properties,(await xmp.read(saved.results[0].output)).properties);
 // Force a real target update after staging, before the publication check.
 // All native compose/asset work still executes; only the external writer is
 // controlled, with no worker protocol or ready-event substitution.
 const external=(await write(packet,[property(CRS,'Exposure2012',text('2')),field('Keep',text('external baked target'))])).packet;
 for(const action of ['accept','decline','cancel']){
  await writeFile(target,latest.packet);const trace=[],isolated=new Documents(xmp),serialize=isolated.serialize.bind(isolated);let mutated=false,racing;
  isolated.serialize=async(...args)=>{const result=await serialize(...args);if(!mutated){mutated=true;await writeFile(target,external);}return result;};
  racing=new SessionDocumentSaver(binary,resources,join(directory,'race-'+action),isolated,async targets=>{
   trace.push(structuredClone(targets));if(trace.length===1)return true;
   if(action==='cancel')racing.cancel();return action!=='decline';
  },()=>{});
  const result=await racing.run({sessionId:'race-'+action,documents:[snapshot]});
  assert.equal(trace.length,2);assert.equal(trace[1][0].changed,true);
  if(action==='accept'){
   assert.equal(result.results[0].error,undefined,JSON.stringify(result));
   const properties=(await xmp.read(target)).properties;assert.equal(archivedTrees(properties).length,2);
   assert.equal(lookup(properties,CRS,'AlreadyApplied').value,'False');assert.equal(lookup(properties,CRS,'FutureMask'),undefined);
   assert.equal(Number(lookup(properties,CRS,'Exposure2012').value),.25);assert.equal(lookup(properties,U,'Keep').value,'external baked target');
  }else{assert.equal(result.cancelled,true);assert(result.results[0].error);assert.equal(await readFile(target,'utf8'),external);}
  assert(!(await readdir(directory)).some(name=>name.startsWith('.session-save-')));
 }
 assert.equal(hash(await readFile(source)),sourceHash);
}));
