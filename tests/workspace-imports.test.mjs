import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {ENGINE_VERSION,OUTPUT_COLOR_SPACES} from '@captraw/contracts';
import {DEFAULT_EXPORT_OPTIONS,validateExportOptions,outputDimensions} from '@captraw/contracts/export-options';
import {capturePreset,validatePreset,presetValidationBase} from '@captraw/contracts/presets';
import {SYNC_GROUPS,synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {BatchExporter,validateBatch} from '@captraw/desktop-core/batch-export';
import {Documents} from '@captraw/desktop-core/documents';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ObjectSelection} from '@captraw/desktop-core/object-selection';
import {Presets} from '@captraw/desktop-core/presets';
import {Segmenter} from '@captraw/desktop-core/segmentation';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {XMP,CT,encode,decode,encodeAdjustments,decodeAdjustments,readExtension} from '@captraw/desktop-core/xmp';

test('all 13 public entries resolve to compiled JavaScript in plain Node',()=>{
 const entries=['@captraw/contracts',...['export-options','presets','synchronize'].map(name=>'@captraw/contracts/'+name),...['engine','batch-export','documents','mask-assets','object-selection','presets','segmentation','synchronize','xmp'].map(name=>'@captraw/desktop-core/'+name)];
 for(const entry of entries)assert.match(import.meta.resolve(entry),/\/dist\/[^/]+\.js$/);
 for(const entry of ['@captraw/contracts/src/index.js','@captraw/desktop-core/src/engine.js'])assert.throws(()=>import.meta.resolve(entry),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 assert.equal(process.versions.electron,undefined);
 assert(!Object.keys(createRequire(import.meta.url).cache).some(path=>/\/node_modules\/electron\//.test(path)));
 assert.equal(typeof ENGINE_VERSION,'string');assert.equal(OUTPUT_COLOR_SPACES.srgb,'sRGB');
});

test('export options validate input types and compute output dimensions',()=>{
 const options=structuredClone(DEFAULT_EXPORT_OPTIONS);
 options.size={mode:'long-edge',width:600,height:600,dontEnlarge:true};
 assert.deepEqual(outputDimensions(1200,800,options),{width:600,height:400});
 assert.deepEqual(outputDimensions(300,200,options),{width:300,height:200});
 for(const size of [{...options.size,width:'600'},{...options.size,dontEnlarge:1}])assert.throws(()=>validateExportOptions({...options,size}));
 assert.throws(()=>validateExportOptions({...options,sharpen:{...options.sharpen,radius:NaN}}));
});

test('preset and synchronization contracts select fields and isolate snapshots',()=>{
 const source=structuredClone(presetValidationBase);source.exposure=1.25;source.saturation=22;
 const preset=capturePreset({name:' 光线 ',group:' 测试 ',groups:['light'],adjustments:source});
 validatePreset(preset);assert.equal(preset.name,'光线');assert.equal(preset.engineVersion,ENGINE_VERSION);
 assert.equal(preset.adjustments.exposure,1.25);assert(!Object.hasOwn(preset.adjustments,'saturation'));
 source.exposure=4;assert.equal(preset.adjustments.exposure,1.25);
 assert.throws(()=>validatePreset({...preset,adjustments:{...preset.adjustments,saturation:1}}));
 assert.throws(()=>capturePreset({name:'x',group:'x',groups:['unknown'],adjustments:source}));
 const target={image:{path:'/target.nef',width:1200,height:800},adjustments:{...structuredClone(presetValidationBase),saturation:-11},profile:''};
 const original=structuredClone(target),from={image:{path:'/source.nef'},adjustments:source,profile:''};
 const synced=synchronizedAdjustments(from,target,['light']);
 assert.equal(synced.exposure,4);assert.equal(synced.saturation,-11);assert.deepEqual(target,original);
 synced.curve[0].y=.2;assert.equal(target.adjustments.curve[0].y,0);
 assert(SYNC_GROUPS.some(group=>group.id==='masks'));
 assert.throws(()=>synchronizedAdjustments(from,target,['unknown']));
});

test('batch export validates snapshots before starting a native worker',async()=>{
 const request={documents:[{path:join(tmpdir(),'source.nef'),width:1200,height:800,artProfile:'',adjustments:structuredClone(presetValidationBase)}],format:'tiff',colorSpace:'srgb'};
 validateBatch(request);
 for(const invalid of [{...request,format:'png'},{...request,documents:[request.documents[0],request.documents[0]]},{...request,documents:[{...request.documents[0],width:'1200'}]}])assert.throws(()=>validateBatch(invalid));
 const exporter=new BatchExporter('unused','unused','unused',()=>{});
 await assert.rejects(exporter.run({...request,format:'png'},'unused'));
 assert.equal(exporter.active,false);exporter.shutdown();
});

test('XMP typed state and Documents serialize through their public interfaces',async()=>{
 const adjustments={...structuredClone(presetValidationBase),exposure:1.25};
 assert.deepEqual(decodeAdjustments(encodeAdjustments(adjustments)).adjustments,adjustments);
 const state={enabled:true,value:1,items:['中文',null]};assert.deepEqual(decode(encode(state)),state);
 assert.throws(()=>encode({value:Infinity}));
 assert.throws(()=>decode({fields:[{ns:CT,name:'__proto__',node:{value:'x'}}]}));
 let changes;
 const adapter={call:async(method,packet,properties)=>{assert.equal(method,'write');assert.equal(packet,'');changes=properties;return {packet:'<xmp/>',properties};}};
 const documents=new Documents(adapter);
 const source={path:'/source.nef',size:42,sha256:'a'.repeat(64)};
 assert.equal(await documents.serialize({source,artProfile:'[ART]',adjustments}),'<xmp/>');
 assert.equal(readExtension(changes,'EngineVersion'),ENGINE_VERSION);
 assert.deepEqual(readExtension(changes,'Source'),source);
 const xmp=new XMP('unused');assert.equal(typeof xmp.read,'function');
});

test('mask asset save and restore keep an ordinary recipe independent',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'captraw-import-masks-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const recipe={artProfile:'[ART]',adjustments:structuredClone(presetValidationBase)};
 const core={call:async method=>{assert.equal(method,'maskAssets');return {paths:[]};}};
 const path=join(directory,'recipe.xmp');
 await saveRecipeWithMasks(core,path,recipe,async copy=>{assert.notEqual(copy,recipe);return '<xmp/>';});
 assert.equal(await readFile(path,'utf8'),'<xmp/>');
 const restored=await restoreRecipeMasks(core,path,recipe,directory);assert.deepEqual(restored,recipe);assert.notEqual(restored,recipe);
 await assert.rejects(restoreRecipeMasks(core,path,{...recipe,maskAssets:{schemaVersion:2,files:[]}},directory));
});

test('Node-only service lifecycle and validation need no native binary or Electron',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'captraw-import-services-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const segmenter=new Segmenter('unused','unused',directory);
 await assert.rejects(segmenter.request({revision:0}),/递增/);
 await segmenter.dispose();await assert.rejects(segmenter.request({revision:1}),/已关闭/);
 const selection=new ObjectSelection('unused','unused','unused','unused',directory,()=>{});
 await assert.rejects(selection.predict('unknown',[]));await selection.cancel();assert.equal(selection.previews.size,0);selection.shutdown();
 const presets=new Presets(join(directory,'presets'),{call:async()=>{throw new Error('unexpected native call');}},directory,new XMP('unused'));
 assert.deepEqual(await presets.list(),{items:[],errors:[]});
 const sync=new Synchronizer('unused','unused',directory,()=>{});
 const adjustments=structuredClone(presetValidationBase),source={image:{path:'/source.nef'},adjustments,profile:''},target={image:{path:'/target.nef'},adjustments:structuredClone(adjustments),profile:''};
 assert.deepEqual(await sync.run({source,targets:[target],groups:['light']}),[]);
 await assert.rejects(sync.run({source,targets:[source],groups:['light']}));assert.equal(sync.running,false);sync.cancel();
});

test('NativeEngine public entry performs real JSON-line RPC with a Node fixture',{timeout:10000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'captraw-import-engine-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const script=join(directory,'protocol.mjs');
 await writeFile(script,"import {createInterface} from 'node:readline';\nconsole.log(JSON.stringify({event:'ready'}));\ncreateInterface({input:process.stdin}).on('line',line=>{const {id,method,params}=JSON.parse(line);console.log(JSON.stringify({id,result:{method,params}}));});\n");
 const engine=new NativeEngine(process.execPath,script,join(directory,'cache'));
 const closed=new Promise(done=>engine.child.once('close',done));
 try{await engine.ready;assert(engine.alive);assert.deepEqual(await engine.call('echo',{value:42}),{method:'echo',params:{value:42}});}
 finally{engine.terminate();await closed;}
 assert.equal(engine.alive,false);await assert.rejects(engine.call('echo'),/未运行/);
});
