import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {ENGINE_VERSION,OUTPUT_COLOR_SPACES,autoTone,mergeAdjustmentPatch,partialAdjustmentGroups,validRating} from '@captraw/contracts';
import {DEFAULT_EXPORT_OPTIONS,validateExportOptions,outputDimensions} from '@captraw/contracts/export-options';
import {capturePreset,validatePreset,presetValidationBase,presetAmount} from '@captraw/contracts/presets';
import {SYNC_GROUPS,adjustmentCommand,applyEditCommand,cameraExposureValue,matchExposureByCameraSettings,synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {executableName,isContainedFile} from '@captraw/desktop-core/runtime';
import {BatchExporter,validateBatch} from '@captraw/desktop-core/batch-export';
import {Documents,validateBatchSave} from '@captraw/desktop-core/documents';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ObjectSelection} from '@captraw/desktop-core/object-selection';
import {Presets} from '@captraw/desktop-core/presets';
import {Segmenter} from '@captraw/desktop-core/segmentation';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {XMP,CRS,CT,TIFF,property,text,encode,decode,encodeAdjustments,decodeAdjustments,readExtension} from '@captraw/desktop-core/xmp';

test('all public entries load compiled JavaScript in plain Node',async()=>{
 const entries=[];
 for(const name of ['contracts','desktop-core']){
  const manifest=JSON.parse(await readFile(new URL(`../packages/${name}/package.json`,import.meta.url),'utf8'));
  for(const key of Object.keys(manifest.exports))entries.push('@captraw/'+name+(key==='.'?'':key.slice(1)));
 }
 for(const entry of entries){assert.match(import.meta.resolve(entry),/\/dist\/[^/]+\.js$/);await import(entry);}
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
 assert.throws(()=>validateBatch({format:'tiff',colorSpace:'srgb',documents:[{...document,rating:6}]}),/评分/);
});

test('shadow calibration preserves sparse edits, bounds, history commands and preset grouping without native dependencies',()=>{
 for(const shadowTint of [-100,-1,0,1,100]){
  const value={calibration:{shadowTint}},properties=encodeAdjustments(value);
  assert.equal(properties.find(p=>p.ns===CRS&&p.name==='ShadowTint').node.value,String(shadowTint));
  assert.deepEqual(decodeAdjustments(properties).adjustments,value);
  assert(!properties.some(p=>p.ns===CRS&&/^(Red|Green|Blue)/.test(p.name)));
 }
 for(const shadowTint of [-101,101,.5,NaN,Infinity])assert.throws(()=>encodeAdjustments({calibration:{shadowTint}}),/ShadowTint/);
 for(const value of ['','0.5','101'])assert.throws(()=>decodeAdjustments([property(CRS,'ShadowTint',text(value))]),/ShadowTint/);
 const base={...structuredClone(presetValidationBase),calibration:{shadowTint:-12,redHue:9,blueSaturation:8}},next={...base,calibration:{...base.calibration,shadowTint:25}};
 const command=adjustmentCommand(base,next,'shadow');assert.deepEqual(command.set,{calibration:{shadowTint:25}});assert.deepEqual(applyEditCommand(base,command),next);
 assert.deepEqual(applyEditCommand(next,adjustmentCommand(next,base,'undo')),base);
 assert.deepEqual(mergeAdjustmentPatch(base,{calibration:{redHue:17}}).calibration,{...base.calibration,redHue:17});
 assert.deepEqual(partialAdjustmentGroups({calibration:{shadowTint:25}}),['calibration']);
 const preset=capturePreset({name:'阴影',group:'验证',groups:['calibration'],adjustments:next});assert.deepEqual(preset.adjustments,{calibration:next.calibration});
 assert(presetAmount(preset.adjustments,50).warnings.some(w=>w.includes('calibration')));
});

test('export options validate input types and compute output dimensions',()=>{
 const options=structuredClone(DEFAULT_EXPORT_OPTIONS);
 options.size={mode:'long-edge',width:600,height:600,dontEnlarge:true};
 assert.deepEqual(outputDimensions(1200,800,options),{width:600,height:400});
 assert.deepEqual(outputDimensions(300,200,options),{width:300,height:200});
 for(const size of [{...options.size,width:'600'},{...options.size,dontEnlarge:1}])assert.throws(()=>validateExportOptions({...options,size}));
 assert.throws(()=>validateExportOptions({...options,sharpen:{...options.sharpen,radius:NaN}}));
 for(const resolution of [0,NaN,72.5,'300',1000])assert.throws(()=>validateExportOptions({...options,resolution}));
 for(const jpegQuality of [-1,13,5.5,'12'])assert.throws(()=>validateExportOptions({...options,jpegQuality}));
 assert.throws(()=>validateExportOptions({...options,tiffCompression:'lossy'}));
 assert.throws(()=>validateExportOptions({...options,tiffCompression:'lzw'}));
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

test('linked edits copy changed controls and sparse color bands without replacing target settings',()=>{
 const before=structuredClone(presetValidationBase),after={...structuredClone(before),exposure:1.25,hsl:{hue:[0,30,0,0,0,0,0,0],saturation:Array(8).fill(0),luminance:Array(8).fill(0)}};
 const target={...structuredClone(before),contrast:27,temperature:4200,hsl:{hue:[17,5,0,0,0,0,0,0],saturation:[10,0,0,0,0,0,0,0],luminance:Array(8).fill(0)}};
 const saved=structuredClone(target),command=adjustmentCommand(before,after,'gesture-1'),result=applyEditCommand(target,command);
 assert.deepEqual(command.set,{exposure:1.25,hsl:{hue:{1:30}}});assert.equal(command.operationId,'gesture-1');
 assert.equal(result.exposure,1.25);assert.equal(result.contrast,27);assert.equal(result.temperature,4200);
 assert.deepEqual(result.hsl.hue,[17,30,0,0,0,0,0,0]);assert.equal(result.hsl.saturation[0],10);assert.deepEqual(target,saved);
 const clear=adjustmentCommand({...before,grain:30},before,'clear');assert.deepEqual(clear.unset,['grain']);assert.equal(applyEditCommand({...target,grain:70},clear).grain,undefined);
 const curve={...before,parametricCurve:{shadows:12,darks:0,lights:0,highlights:0,splits:[25,50,75]}};
 assert.deepEqual(adjustmentCommand(before,curve,'curve').set,{parametricCurve:{shadows:12}});
 assert.deepEqual(adjustmentCommand(before,{...before,calibration:{redHue:10,redSaturation:0,greenHue:0,greenSaturation:0,blueHue:0,blueSaturation:0}},'calibration').set,{calibration:{redHue:10}});
 const points={...before,curve:[{x:0,y:0},{x:.5,y:.7},{x:1,y:1}]};assert.deepEqual(applyEditCommand(target,adjustmentCommand(before,points,'curve-points')).curve,points.curve);
 assert.deepEqual(adjustmentCommand(before,before,'noop').set,{});assert.throws(()=>applyEditCommand(target,{set:{},unset:[]}),/无效/);
 const geometry={enabled:false,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1};
 const lensTarget={...target,perspective:{...geometry,horizontal:27},blackWhite:{enabled:false,mixer:[17,0,0,0,0,0,0,0]}};
 const linked=applyEditCommand(lensTarget,adjustmentCommand(before,{...before,perspective:{...geometry,enabled:true,vertical:12},blackWhite:{enabled:true,mixer:Array(8).fill(0)}},'nested'));
 assert.equal(linked.perspective.vertical,12);assert.equal(linked.perspective.horizontal,27);assert.equal(linked.blackWhite.enabled,true);assert.equal(linked.blackWhite.mixer[0],17);
});

test('linked edits carry tool activation from an already active source while preserving unrelated target controls',()=>{
 const perspective={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1,manualModel:'art-perspective-v1',scale:1};
 const before={...structuredClone(presetValidationBase),perspective,blackWhite:{enabled:true,mixer:Array(8).fill(0)}};
 const after={...structuredClone(before),perspective:{...perspective,scale:1.3},blackWhite:{enabled:true,mixer:[0,25,0,0,0,0,0,0]}};
 const target={...structuredClone(presetValidationBase),perspective:{...perspective,enabled:false,horizontal:17,aspect:1.2},blackWhite:{enabled:false,mixer:[12,0,0,0,0,0,0,0]}};
 const result=applyEditCommand(target,adjustmentCommand(before,after,'active-tools'));
 assert.equal(result.perspective.enabled,true);assert.equal(result.perspective.scale,1.3);
 assert.equal(result.perspective.horizontal,17);assert.equal(result.perspective.aspect,1.2);
 assert.equal(result.blackWhite.enabled,true);assert.deepEqual(result.blackWhite.mixer,[12,25,0,0,0,0,0,0]);
 const disabled={...before,blackWhite:{...before.blackWhite,enabled:false}};
 assert.equal(applyEditCommand(result,adjustmentCommand(before,disabled,'disable')).blackWhite.enabled,false);
 assert.deepEqual(adjustmentCommand(before,before,'unchanged').merge,undefined);
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

test('legacy typed XMP missing flip controls inherits ARP flips while standalone standard Orientation clears them',async()=>{
 const inherited={...structuredClone(presetValidationBase),flipHorizontal:true,flipVertical:true};
 const artProfile='[Coarse Transformation]\nRotate=0\nHorizontalFlip=true\nVerticalFlip=true\n';
 for(const [orientation,rotation] of [[1,0],[3,180],[6,90],[8,270]]){
  const properties=[property(CT,'EngineVersion',encode(ENGINE_VERSION)),property(CT,'ARTAdjustments',encode({})),property(CT,'ARTProfile',encode(artProfile)),property(TIFF,'Orientation',text(orientation))];
  const documents=new Documents({read:async()=>({packet:'<legacy/>',properties})});
  const read=await documents.read('/legacy.xmp');
  assert.equal(read.artProfile,artProfile);
  assert.equal(read.adjustments.rotation,rotation);
  assert(!Object.hasOwn(read.adjustments,'flipHorizontal'),'missing legacy horizontal control must stay absent');
  assert(!Object.hasOwn(read.adjustments,'flipVertical'),'missing legacy vertical control must stay absent');
  const merged=mergeAdjustmentPatch(inherited,read.adjustments);
  assert.equal(merged.flipHorizontal,true);assert.equal(merged.flipVertical,true);
 }
 const external=decodeAdjustments([property(TIFF,'Orientation',text(1))]).adjustments;
 assert.deepEqual(external,{rotation:0,flipHorizontal:false,flipVertical:false});
 const cleared=mergeAdjustmentPatch(inherited,external);
 assert.equal(cleared.flipHorizontal,false);assert.equal(cleared.flipVertical,false);
 const explicit=decodeAdjustments(encodeAdjustments({rotation:0,flipHorizontal:false,flipVertical:false})).adjustments;
 assert.equal(explicit.flipHorizontal,false);assert.equal(explicit.flipVertical,false);
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
 const packs=await presets.listPacks();assert.equal(packs.length,1);assert.equal(packs[0].id,'org.captraw.validation');assert(packs[0].engineVersions.includes(ENGINE_VERSION));
 const sync=new Synchronizer('unused','unused',directory,()=>{});
 const adjustments=structuredClone(presetValidationBase),source={image:{path:'/source.nef'},adjustments,profile:''},target={image:{path:'/target.nef'},adjustments:structuredClone(adjustments),profile:''};
 assert.deepEqual(await sync.run({source,targets:[target],groups:['light']}),[]);
 await assert.rejects(sync.run({source,targets:[source],groups:['light']}));assert.equal(sync.running,false);sync.cancel();
});

test('runtime containment rejects sibling prefixes and parent traversal without rejecting dotted filenames',()=>{
 const directory=join(tmpdir(),'照片 缓存');
 for(const file of [join(directory,'frame.png'),join(directory,'..frame.png'),join(directory,'mask','像素.png')])assert(isContainedFile(directory,file));
 for(const file of [directory,join(directory+'-other','frame.png'),join(directory,'..','frame.png')])assert(!isContainedFile(directory,file));
 assert.equal(executableName('captraw-engine','win32'),'captraw-engine.exe');
 for(const platform of ['darwin','linux'])assert.equal(executableName('captraw-engine',platform),'captraw-engine');
});

test('NativeEngine public entry performs real JSON-line RPC with a Node fixture',{timeout:10000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'captraw-import-engine-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const script=join(directory,'protocol.mjs');
 await writeFile(script,"import {createInterface} from 'node:readline';\nconsole.log(JSON.stringify({event:'ready',engineVersion:'"+ENGINE_VERSION+"'}));\ncreateInterface({input:process.stdin}).on('line',line=>{const {id,method,params}=JSON.parse(line);console.log(JSON.stringify({id,result:{method,params}}));});\n");
 const engine=new NativeEngine(process.execPath,script,join(directory,'cache'));
 const closed=new Promise(done=>engine.child.once('close',done));
 try{await engine.ready;assert(engine.alive);assert.deepEqual(await engine.call('echo',{value:42}),{method:'echo',params:{value:42}});}
 finally{engine.terminate();await closed;}
 assert.equal(engine.alive,false);engine.terminate();await assert.rejects(engine.call('echo'),/未运行/);
});

test('NativeEngine refuses mismatched and missing processing versions before sending edits',{timeout:10000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'captraw-engine-version-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const [index,version] of [ENGINE_VERSION+'-other',undefined].entries()){
  const script=join(directory,`wrong-${index}.mjs`),marker=join(directory,`called-${index}`);
  await writeFile(script,`import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
console.log(JSON.stringify(${JSON.stringify({event:'ready',engineVersion:version})}));
createInterface({input:process.stdin}).on('line',()=>writeFileSync(${JSON.stringify(marker)},'unexpected edit'));
`);
  const engine=new NativeEngine(process.execPath,script,join(directory,'cache-'+index));
  const closed=new Promise(done=>engine.child.once('close',done));
  try{
   await assert.rejects(engine.ready,/版本不一致/);
   await assert.rejects(engine.call('update',{revision:1}),/版本不一致/);
   assert.equal(engine.alive,false);
   assert.equal(await readFile(marker,'utf8').catch(error=>{assert.equal(error.code,'ENOENT');return null;}),null);
  }finally{engine.terminate();await closed;}
 }
});

test('synchronization cancellation during source-reference validation returns null',{timeout:10000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'captraw-sync-reference-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const marker=join(directory,'validating'),script=join(directory,'protocol.mjs');
 const sourcePath=join(directory,'source.nef'),targetPath=join(directory,'target.nef');
 await Promise.all([sourcePath,targetPath].map(path=>writeFile(path,'source-reference cancellation fixture')));
 await writeFile(script,`import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
console.log(JSON.stringify({event:'ready',engineVersion:${JSON.stringify(ENGINE_VERSION)}}));
createInterface({input:process.stdin}).on('line',line=>{const {method}=JSON.parse(line);if(method==='validate')writeFileSync(${JSON.stringify(marker)},'started');});
`);
 const sync=new Synchronizer(process.execPath,script,join(directory,'cache'),()=>{});t.after(()=>sync.cancel());
 const adjustments=structuredClone(presetValidationBase),source={image:{path:sourcePath},profile:'',adjustments:{...adjustments,masks:[{id:'leaf',type:'radial'}]}},target={image:{path:targetPath},profile:'',adjustments};
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
 assert.deepEqual(partialAdjustmentGroups(patch),['hsl','parametricCurve','colorGrading','calibration']);assert.deepEqual(partialAdjustmentGroups(base),['calibration']);assert.deepEqual(partialAdjustmentGroups({...base,calibration:{shadowTint:0,redHue:10,redSaturation:0,greenHue:0,greenSaturation:9,blueHue:0,blueSaturation:0}}),[]);
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

test('HDR uses the standard mode with ART-only headroom and rejects ambiguous state',()=>{
 for(const enabled of [false,true]){
  const value={hdrEnabled:enabled,hdrHeadroom:2.25},properties=encodeAdjustments(value);
  assert.equal(properties.find(p=>p.ns===CRS&&p.name==='HDREditMode').node.value,enabled?'1':'0');
  assert.deepEqual(readExtension(properties,'ARTAdjustments'),{hdrHeadroom:2.25});
  assert.deepEqual(decodeAdjustments(properties).adjustments,value);
  assert.equal(properties.some(p=>p.ns===CRS&&p.name==='HDRMaxValue'),false);
 }
 const external=decodeAdjustments([property(CRS,'HDREditMode',text(1)),property(CRS,'HDRMaxValue',text(2))]);
 assert.deepEqual(external.adjustments,{hdrEnabled:true});
 assert(external.warnings.some(message=>message.includes('HDRMaxValue')));
 assert(external.warnings.some(message=>message.includes('尚未等效')));
 assert.equal(decodeAdjustments([property(CRS,'HDREditMode',text(0))]).warnings.some(message=>message.includes('HDREditMode')),false);
 for(const value of ['',2,'True'])assert.throws(()=>decodeAdjustments([property(CRS,'HDREditMode',text(value))]));
 for(const value of [NaN,Infinity,0,4.1,'3'])assert.throws(()=>encodeAdjustments({hdrEnabled:true,hdrHeadroom:value}));
 assert.throws(()=>encodeAdjustments({hdrEnabled:1}));
 assert.throws(()=>decodeAdjustments([property(CT,'ARTAdjustments',encode({hdrEnabled:true})),property(CRS,'HDREditMode',text(0))]));
 assert.throws(()=>decodeAdjustments([property(CT,'ARTAdjustments',encode({hdrEnabled:true}))]));
});

test('HDR presets and synchronization preserve independently selected light controls',()=>{
 const base=structuredClone(presetValidationBase),adjustments={...base,hdrEnabled:true,hdrHeadroom:4,exposure:2};
 const preset=capturePreset({name:'HDR',group:'Test',groups:['hdr'],adjustments});validatePreset(preset);
 assert.deepEqual(preset.adjustments,{hdrEnabled:true,hdrHeadroom:4});
 const source={image:{path:'/a.nef',width:100,height:80},adjustments},target={image:{path:'/b.nef',width:100,height:80},adjustments:{...base,exposure:-1}};
 assert.deepEqual(synchronizedAdjustments(source,target,['hdr']),{...target.adjustments,hdrEnabled:true,hdrHeadroom:4});
 assert.equal(synchronizedAdjustments(source,target,['light']).hdrEnabled,undefined);
});


test('HDR AVIF export accepts only matching Rec.2020 and validates before worker startup',async()=>{
 const request={documents:[{path:join(tmpdir(),'source.nef'),width:1200,height:800,artProfile:'',adjustments:structuredClone(presetValidationBase)}],format:'avif',colorSpace:'rec2020'};
 validateBatch(request);assert.throws(()=>validateBatch({...request,colorSpace:'srgb'}));
 const exporter=new BatchExporter('unused','unused','unused',()=>{});await assert.rejects(exporter.run({...request,colorSpace:'srgb'},'unused'));assert.equal(exporter.active,false);exporter.shutdown();
});
