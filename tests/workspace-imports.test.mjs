import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {ENGINE_VERSION,OUTPUT_COLOR_SPACES,autoTone,mergeAdjustmentPatch,partialAdjustmentGroups,validRating} from '@captraw/contracts';
import {DEFAULT_EXPORT_OPTIONS,validateExportOptions,outputDimensions} from '@captraw/contracts/export-options';
import {capturePreset,validatePreset,presetValidationBase} from '@captraw/contracts/presets';
import {SYNC_GROUPS,cameraExposureValue,matchExposureByCameraSettings,synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {BatchExporter,validateBatch} from '@captraw/desktop-core/batch-export';
import {Documents,validateBatchSave} from '@captraw/desktop-core/documents';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ObjectSelection} from '@captraw/desktop-core/object-selection';
import {Presets} from '@captraw/desktop-core/presets';
import {Segmenter} from '@captraw/desktop-core/segmentation';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {XMP,CRS,CT,property,text,encode,decode,encodeAdjustments,decodeAdjustments,readExtension} from '@captraw/desktop-core/xmp';

test('all 13 public entries resolve to compiled JavaScript in plain Node',()=>{
 const entries=['@captraw/contracts',...['export-options','presets','synchronize'].map(name=>'@captraw/contracts/'+name),...['engine','batch-export','documents','mask-assets','object-selection','presets','segmentation','synchronize','xmp'].map(name=>'@captraw/desktop-core/'+name)];
 for(const entry of entries)assert.match(import.meta.resolve(entry),/\/dist\/[^/]+\.js$/);
 for(const entry of ['@captraw/contracts/src/index.js','@captraw/desktop-core/src/engine.js'])assert.throws(()=>import.meta.resolve(entry),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 assert.equal(process.versions.electron,undefined);
 assert(!Object.keys(createRequire(import.meta.url).cache).some(path=>/\/node_modules\/electron\//.test(path)));
 assert.equal(typeof ENGINE_VERSION,'string');assert.equal(OUTPUT_COLOR_SPACES.srgb,'sRGB');
});

test('XMP rating keeps rejection distinct from unrated and accepts the standard real-number range',()=>{
 for(const value of [-1,0,1,2.5,5])assert(validRating(value));
 for(const value of [-2,-.5,5.1,NaN,Infinity,'3',null,undefined])assert(!validRating(value));
 const document={path:'/photo.nef',width:100,height:100,artProfile:'',adjustments:structuredClone(presetValidationBase),rating:3};
 assert.doesNotThrow(()=>validateBatchSave({documents:[document]}));
 assert.throws(()=>validateBatchSave({documents:[{...document,rating:6}]}),/评分/);
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
 const source=structuredClone(presetValidationBase);source.exposure=1.25;source.saturation=22;source.fineRotation=23;
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
 const cropPreset=capturePreset({name:'角度',group:'测试',groups:['crop'],adjustments:source});
 validatePreset(cropPreset);assert.equal(cropPreset.adjustments.fineRotation,23);
 assert.equal(synchronizedAdjustments(from,target,['crop']).fineRotation,23);
 target.adjustments.fineRotation=-17;
 assert.equal(synchronizedAdjustments(from,target,['light']).fineRotation,-17);
 const partial={...from,adjustments:{...target.adjustments,crop:{x:0,y:0,width:.5,height:.5}}};
 assert.equal(synchronizedAdjustments(partial,target,['crop']).fineRotation,-17);
 assert.throws(()=>synchronizedAdjustments(from,target,['unknown']));
});

test('camera exposure matching uses ISO, aperture, shutter and exposure compensation atomically',()=>{
 const document=(path,iso,aperture,shutter,exposureCompensation,exposure)=>({
  image:{path,name:path.split('/').at(-1),iso,aperture,shutter,exposureCompensation},
  adjustments:{...structuredClone(presetValidationBase),exposure},
  profile:'',
 });
 const source=document('/source.nef',100,2,1/100,0,.7);
 assert.equal(cameraExposureValue(source.image),Math.log2(400));
 const darker=document('/darker.nef',100,4,1/100,0,.5);
 const biased=document('/biased.nef',100,2,1/100,1,-1.5);
 const matches=matchExposureByCameraSettings(source,[darker,biased]);
 assert.deepEqual(matches.map(match=>match.exposure),[-1.5,-.5]);
 assert.deepEqual(matches.map(match=>match.delta),[-2,1]);
 assert.throws(()=>matchExposureByCameraSettings(source,[{...darker,image:{...darker.image,shutter:0}}]),/缺少可用/);
 assert.throws(()=>matchExposureByCameraSettings(source,[{...darker,adjustments:{...darker.adjustments,exposure:-4.5}}]),/超出当前显影范围/);
 assert.throws(()=>matchExposureByCameraSettings(source,[source]),/来源照片不能/);
 assert.throws(()=>matchExposureByCameraSettings(source,[darker,darker]),/重复照片/);
});

test('auto tone derives bounded base tone edits from a real RGB histogram without mutating the recipe',()=>{
 const source=structuredClone(presetValidationBase),snapshot=structuredClone(source);
 const histogram=Array.from({length:3},()=>Array(256).fill(0));
 for(let index=10;index<80;index++)for(const channel of histogram)channel[index]=100;
 const adjusted=autoTone(source,histogram);
 assert.deepEqual(source,snapshot);assert(adjusted.exposure>0);assert(adjusted.exposure<=5);assert(adjusted.shadows>0);assert(adjusted.contrast>=source.contrast);assert.deepEqual(adjusted.masks,source.masks);assert.notEqual(adjusted,source);
 const clipped=Array.from({length:3},()=>Array(256).fill(0));for(const channel of clipped){channel[0]=200;channel[255]=800;}
 const recovered=autoTone(source,clipped);assert(recovered.highlights<0);assert(recovered.whites<0);
 assert.deepEqual(autoTone(source,[]),source);assert.deepEqual(autoTone(source,null),source);
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
 const core={call:async method=>{if(method==='inputProfileAsset')return {path:''};assert.equal(method,'maskAssets');return {paths:[]};}};
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

test('synchronization cancellation during source-reference validation returns null',{timeout:10000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'captraw-sync-reference-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const marker=join(directory,'validating'),script=join(directory,'protocol.mjs');
 await writeFile(script,`import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
console.log(JSON.stringify({event:'ready'}));
createInterface({input:process.stdin}).on('line',line=>{const {method}=JSON.parse(line);if(method==='validate')writeFileSync(${JSON.stringify(marker)},'started');});
`);
 const sync=new Synchronizer(process.execPath,script,join(directory,'cache'),()=>{});t.after(()=>sync.cancel());
 const adjustments=structuredClone(presetValidationBase),source={image:{path:'/source.nef'},profile:'',adjustments:{...adjustments,masks:[{id:'leaf',type:'radial'}]}},target={image:{path:'/target.nef'},profile:'',adjustments};
 const pending=sync.run({source,targets:[target],groups:['masks']});pending.catch(()=>{});
 const deadline=Date.now()+5000;let started=false;
 while(Date.now()<deadline){if(await readFile(marker,'utf8').catch(()=>null)==='started'){started=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
 assert(started,'Worker must have entered source-reference validation before cancellation');
 sync.cancel();assert.equal(await pending,null);assert.equal(sync.running,false);
});


test('sparse adjustment merging preserves every unselected channel, wheel, split and calibration value',()=>{
 const base={...structuredClone(presetValidationBase),hsl:{hue:[1,2,3,4,5,6,7,8],saturation:[9,10,11,12,13,14,15,16],luminance:[-1,-2,-3,-4,-5,-6,-7,-8]},parametricCurve:{highlights:5,lights:6,darks:7,shadows:8,splits:[21,58,83]},colorGrading:{shadows:{hue:210,saturation:20,luminance:-4},midtones:{hue:40,saturation:21,luminance:3},highlights:{hue:50,saturation:22,luminance:5},global:{hue:190,saturation:9,luminance:-2},blending:72,balance:-8},calibration:{redHue:10,greenSaturation:9}};
 const original=structuredClone(base),patch={hsl:{hue:{4:0},saturation:{7:-35}},parametricCurve:{highlights:-18,splits:{2:88}},colorGrading:{midtones:{saturation:0},balance:7},calibration:{redHue:-5}};
 const result=mergeAdjustmentPatch(base,patch),expected=structuredClone(base);
 expected.hsl.hue[4]=0;expected.hsl.saturation[7]=-35;expected.parametricCurve.highlights=-18;expected.parametricCurve.splits[2]=88;expected.colorGrading.midtones.saturation=0;expected.colorGrading.balance=7;expected.calibration.redHue=-5;
 assert.deepEqual(result,expected);assert.deepEqual(base,original);result.hsl.hue[0]=99;assert.equal(base.hsl.hue[0],1);
 assert.deepEqual(partialAdjustmentGroups(patch),['hsl','parametricCurve','colorGrading','calibration']);assert.deepEqual(partialAdjustmentGroups(base),['calibration']);assert.deepEqual(partialAdjustmentGroups({...base,calibration:{redHue:10,redSaturation:0,greenHue:0,greenSaturation:9,blueHue:0,blueSaturation:0}}),[]);
});

test('sparse XMP serialization retains only supplied standard fields across JSON transport',()=>{
 const fields={HueAdjustmentBlue:0,SaturationAdjustmentRed:-9,ParametricHighlightSplit:80,ColorGradeMidtoneSat:0,SplitToningBalance:7};
 const decoded=decodeAdjustments(Object.entries(fields).map(([name,value])=>property(CRS,name,text(value)))).adjustments;
 assert.deepEqual(decoded,{hsl:{hue:{5:0},saturation:{0:-9}},parametricCurve:{splits:{2:80}},colorGrading:{midtones:{saturation:0},balance:7}});
 const transported=JSON.parse(JSON.stringify(decoded)),encoded=encodeAdjustments(transported);
 assert.deepEqual(Object.fromEntries(encoded.filter(p=>p.ns===CRS&&p.node!==null).map(p=>[p.name,Number(p.node.value)])),fields);
 assert.deepEqual(decodeAdjustments(encoded).adjustments,decoded);
});

test('legacy complete Split Toning resets modern controls while modern sparse grading preserves them',()=>{
 const fields={SplitToningShadowHue:220,SplitToningShadowSaturation:20,SplitToningHighlightHue:40,SplitToningHighlightSaturation:10,SplitToningBalance:-5};
 const properties=Object.entries(fields).map(([name,value])=>property(CRS,name,text(value))),classic=decodeAdjustments(properties);
 assert.deepEqual(classic.adjustments.colorGrading,{shadows:{hue:220,saturation:20,luminance:0},highlights:{hue:40,saturation:10,luminance:0},balance:-5,midtones:{hue:0,saturation:0,luminance:0},global:{hue:0,saturation:0,luminance:0},blending:100});
 assert(classic.warnings.some(message=>message.includes('旧式分离色调')));
 const modern=decodeAdjustments([...properties,property(CRS,'ColorGradeMidtoneSat',text(0))]);
 assert.equal(modern.adjustments.colorGrading.blending,undefined);assert.equal(modern.adjustments.colorGrading.global,undefined);assert(!modern.warnings.some(message=>message.includes('旧式分离色调')));
});
