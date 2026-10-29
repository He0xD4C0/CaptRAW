import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,cp,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {PresetPacks,builtinPresetPack} from '../packages/desktop-core/dist/preset-pack.js';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {presetValidationBase,presetAtISO,presetAmount,isoAnchors} from '@captraw/contracts/presets';
import {Presets,PresetPreview} from '@captraw/desktop-core/presets';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {XMP,CRS,CT,lookup,property,text,encode} from '@captraw/desktop-core/xmp';
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'));
async function scenario(run){const root=await mkdtemp(join(tmpdir(),'captraw-presets-'));let success=false;const core=new NativeEngine(binary,resources,join(root,'engine')),sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});core.on('error',()=>{});
 try{const store=new Presets(join(root,'user'),core,join(root,'cache'),xmp),path=join(root,'原片 甲.dng'),other=join(root,'原片 乙.dng');await cp(resolve('build/samples/synthetic.dng'),path);await cp(path,other);
  const image=await core.call('open',{path,sessionId:'test'});const profile=(await core.call('save',{})).artProfile;
  const first={image:{...image,iso:400},adjustments:structuredClone(image.adjustments),profile},second={...structuredClone(first),image:{...image,path:other,name:'乙',id:'second',iso:1600}};
  await run({root,store,core,sync,first,second});assert.deepEqual(await readFile(path),await readFile(resolve('build/samples/synthetic.dng')));success=true;
 }finally{sync.cancel();core.terminate();if(success)await rm(root,{recursive:true,force:true});else console.error('Retained preset failure:',root);}
}
test('ISO interpolation is logarithmic, clamps endpoints, rejects ambiguous or unsupported anchors',()=>{
 const anchors=[{iso:400,adjustments:{luminanceNoise:0}},{iso:1600,adjustments:{luminanceNoise:10}}];assert.equal(presetAtISO(anchors,800).luminanceNoise,5);assert.equal(presetAtISO(anchors,50).luminanceNoise,0);assert.equal(presetAtISO(anchors,6400).luminanceNoise,10);assert.throws(()=>presetAtISO(anchors,0));
 const doc=(iso,exposure=0)=>({image:{path:'sample.nef',name:'RAW',iso,inputKind:'mosaic-raw'},adjustments:{...presetValidationBase,exposure},profile:''});
 assert.throws(()=>isoAnchors([doc(400),doc(400,1)],['light']),/冲突/);assert.throws(()=>isoAnchors([doc(400),doc(400)],['light']),/不同/);
 assert.throws(()=>isoAnchors([{...doc(400),image:{...doc(400).image,path:'pretend.nef',inputKind:'rendered'}},doc(800)],['light']),/RAW/);
 assert.throws(()=>presetAtISO([{iso:400,adjustments:{rotation:0}},{iso:1600,adjustments:{rotation:90}}],800),/不支持/);
});
test('amount scales explicitly supported neutral controls, keeps absolute controls fixed and warns',()=>{
 const p={exposure:1,contrast:20,temperature:6000,curve:[{x:0,y:0},{x:1,y:.8}]},result=presetAmount(p,50);assert.equal(result.adjustments.exposure,.5);assert.equal(result.adjustments.contrast,10);assert.equal(result.adjustments.temperature,6000);assert.deepEqual(result.adjustments.curve,p.curve);assert(result.warnings.some(w=>w.includes('固定')));assert(result.warnings.some(w=>w.includes('尚未')));assert.throws(()=>presetAmount({exposure:4},200),/超出/);assert.equal(presetAmount({exposure:.5},200).adjustments.exposure,1);assert.throws(()=>presetAmount(p,201));assert.deepEqual(presetAmount(p).adjustments,p);
});
test('native preset maintenance preserves independent amount flags, missing flags and unknown structures',()=>scenario(async({root,store,first})=>{
 const value=(name,value)=>property(CRS,name,text(value)),opaque=property('urn:preset-semantics','Opaque',{fields:[property('urn:preset-semantics','Text',{value:'未知 原文',qualifiers:[property('urn:preset-semantics','Language',{value:'中文'})]})]});
 for(const [index,flags] of [[true,false],[false,true],[undefined,false],[true,undefined],[undefined,undefined]].entries()){
  const input=join(root,`flags-${index}.xmp`),changes=[value('PresetType','Normal'),property(CRS,'Name',{localized:'独立标志'}),property(CRS,'Group',{localized:'测试'}),value('Exposure2012',1),opaque];
  for(const [i,key] of ['SupportsAmount','SupportsAmount2'].entries())if(flags[i]!==undefined)changes.push(value(key,flags[i]?'True':'False'));
  const packet=(await xmp.call('write','',changes)).packet;await writeFile(input,packet);const expected=lookup((await xmp.read(input)).properties,'urn:preset-semantics','Opaque');
  const imported=await store.importFile(input),copy=await store.duplicate(imported.id,'副本','测试');await store.rename(copy.id,'改名','测试');await store.update(copy.id,{name:'更新',group:'测试',groups:['light'],adjustments:first.adjustments});
  const output=join(root,`flags-${index}-output.xmp`);await store.exportFile(copy.id,output);const restored=(await xmp.read(output)).properties;
  for(const [i,key] of ['SupportsAmount','SupportsAmount2'].entries())assert.equal(lookup(restored,CRS,key)?.value,flags[i]===undefined?undefined:flags[i]?'True':'False',key);
  assert.deepEqual(lookup(restored,'urn:preset-semantics','Opaque'),expected);assert.equal(await readFile(input,'utf8'),packet);
 }
 for(const [key,value] of [['SupportsAmount','not-a-boolean'],['SupportsAmount2',''],['SupportsAmount2','1']]){
  const input=join(root,'invalid-flag.xmp');await writeFile(input,(await xmp.call('write','',[property(CRS,'Name',{localized:'非法标志'}),property(CRS,'Exposure2012',text(1)),property(CRS,key,text(value))])).packet);
  await assert.rejects(store.importFile(input),new RegExp(key));
 }
}));
test('native sparse ISO anchors retain root nested values, discover anchor-only groups and recompute WB from coordinates',()=>scenario(async({root,store,sync,first})=>{
 const value=(name,value)=>property(CRS,name,text(value)),opaque=property('urn:preset-semantics','Opaque',{fields:[property('urn:preset-semantics','Text',{value:'保留 锚点',qualifiers:[property('urn:preset-semantics','Note',{value:'限定符'})]})]});
 const anchor=iso=>({fields:[value('ISO',iso),value('Exposure2012',iso===400?0:1),value('Tint',iso===400?10:30),value('RedHue',11),value('HueAdjustmentBlue',8),value('ParametricShadows',4),value('ColorGradeShadowLum',5),opaque],qualifiers:[property('urn:preset-semantics','AnchorNote',{value:'保留 条目'})]});
 const input=join(root,'sparse-iso.xmp'),packet=(await xmp.call('write','',[property(CRS,'Name',{localized:'稀疏 ISO'}),property(CRS,'Group',{localized:'测试'}),value('PresetType','Normal'),value('SupportsAmount','True'),value('SupportsAmount2','False'),value('ShadowTint',9),value('HueAdjustmentRed',7),value('ParametricLights',12),value('SplitToningShadowHue',30),value('SplitToningShadowSaturation',20),value('Temperature',7500),opaque,property(CRS,'ISODependent',{options:0x600,items:[anchor(400),anchor(1600)]})])).packet;await writeFile(input,packet);
 const imported=await store.importFile(input);assert(imported.groups.includes('light'));assert(imported.groups.includes('whiteBalance'));
 const target={...first,image:{...first.image,iso:800},adjustments:{...first.adjustments,wbMultipliers:[9,8,7],calibration:{...first.adjustments.calibration,greenHue:17},parametricCurve:{shadows:0,darks:0,lights:0,highlights:0,splits:[19,53,81]}}};
 for(const amount of [50,100]){
  const result=(await store.applyMany({id:imported.id,targets:[target],amount,operationId:'sparse-'+amount},sync)).results[0].adjustments;
  assert.equal(result.exposure,.5*amount/100);assert.equal(result.calibration.shadowTint,9);assert.equal(result.calibration.redHue,11);assert.equal(result.calibration.greenHue,17);assert.equal(result.hsl.hue[0],7);assert.equal(result.hsl.hue[5],8);
  assert.equal(result.parametricCurve.lights,12);assert.equal(result.parametricCurve.shadows,4);assert.deepEqual(result.parametricCurve.splits,target.adjustments.parametricCurve.splits);
  assert.deepEqual(result.colorGrading.shadows,{hue:30,saturation:20,luminance:5});assert.equal(result.temperature,7500);assert.equal(result.tint,20);assert.equal(result.wbMultipliers,null);assert.equal(result.wbMode,'custom');
 }
 const output=join(root,'sparse-export.xmp');await store.rename(imported.id,'已改名 ISO','测试');await store.exportFile(imported.id,output);
 const before=(await xmp.read(input)).properties,after=(await xmp.read(output)).properties;assert.equal(lookup(after,CRS,'SupportsAmount2').value,'False');assert.deepEqual(lookup(after,'urn:preset-semantics','Opaque'),lookup(before,'urn:preset-semantics','Opaque'));
 for(const [i,item] of lookup(after,CRS,'ISODependent').items.entries()){
  const old=lookup(before,CRS,'ISODependent').items[i];assert.deepEqual(lookup(item.fields,'urn:preset-semantics','Opaque'),lookup(old.fields,'urn:preset-semantics','Opaque'));assert.deepEqual(item.qualifiers,old.qualifiers);
 }
 assert.equal(await readFile(input,'utf8'),packet);
}));
test('native multi-target preset is one transaction preserving unselected values, no-op and cancellation',()=>scenario(async({root,store,sync,first,second})=>{
 first.adjustments.exposure=-1;second.adjustments.saturation=17;
 const p=await store.create({name:'曝光',group:'测试',groups:['light'],adjustments:{...first.adjustments,exposure:1}});
 const before=structuredClone([first,second]),result=await store.applyMany({id:p.id,targets:[first,second],operationId:'batch'},sync);assert.equal(result.results.length,2);assert.deepEqual([first,second],before);assert.equal(result.results[1].adjustments.saturation,17);assert(result.results.every(r=>r.adjustments.exposure===1));for(const file of sync.previews.values())await access(file);
 const noops=result.results.map((r,i)=>({...before[i],adjustments:r.adjustments,profile:r.profile}));assert.deepEqual((await store.applyMany({id:p.id,targets:noops,operationId:'noop'},sync)).results,[]);
 const bad={...second,image:{...second.image,path:join(root,'missing.dng')}};await assert.rejects(store.applyMany({id:p.id,targets:[first,bad],operationId:'failure'},sync));assert.equal(sync.previews.size,0);assert.deepEqual([first,second],before);
 const pending=store.applyMany({id:p.id,targets:[first,second],operationId:'cancel'},sync);store.cancel();sync.cancel();assert.equal(await pending,null);
}));
test('native ISO XMP roundtrip and per-photo commands give ordinary editable parameters',()=>scenario(async({root,store,sync,first,second})=>{
 first.adjustments.luminanceNoise=0;second.adjustments.luminanceNoise=10;
 const p=await store.createISO({name:'ISO 降噪',group:'测试',groups:['detail'],documents:[first,second]});assert.equal(p.isoAdaptive,true);assert.equal(p.supportsAmount,true);
 const output=join(root,'ISO.xmp');await store.exportFile(p.id,output);const properties=(await xmp.read(output)).properties;const sequence=lookup(properties,CRS,'ISODependent');assert.equal(sequence.items.length,2);assert.equal(sequence.items[0].fields.find(f=>f.name==='ISO').node.value,'400');
 const imported=await store.importFile(output),result=await store.applyMany({id:imported.id,targets:[{...first,image:{...first.image,iso:800}},second],operationId:'iso'},sync);assert.equal(result.results[0].adjustments.luminanceNoise,5);assert.equal(result.results[1]?.adjustments.luminanceNoise??10,10);
 await assert.rejects(store.applyMany({id:p.id,targets:[{...first,image:{...first.image,iso:0}}],operationId:'missing'},sync),/ISO/);assert.equal((await store.applyMany({id:p.id,targets:[first],amount:50,operationId:'amount'},sync)).warnings.some(w=>w.includes('固定')),true);
}));
test('built-in and user libraries, favorites, duplicate and maintenance identities are independent',()=>scenario(async({root,store,core})=>{
 const pack=(await store.listPacks())[0],builtin=(await store.list()).items.find(p=>p.origin==='builtin');assert(pack.version);assert.equal(pack.presets[0].id,builtin.id);await assert.rejects(store.rename(builtin.id,'a','b'),/只读/);await assert.rejects(store.remove(builtin.id),/只读/);
 const favorite=await store.favorite(builtin.id,true);assert(favorite.favorite);const copy=await store.duplicate(builtin.id,'用户副本','测试');assert.notEqual(copy.id,builtin.id);assert.equal(copy.origin,'user');await store.rename(copy.id,'已改名','测试');const exported=join(root,'copy.xmp');await store.exportFile(copy.id,exported);assert.notEqual(lookup((await xmp.read(exported)).properties,CRS,'UUID').value,builtin.id.replaceAll('-','').toUpperCase());
 const restarted=new Presets(join(root,'user'),core,join(root,'cache2'),xmp);const items=(await restarted.list()).items;assert(items.find(p=>p.id===builtin.id).favorite);assert.equal(items.find(p=>p.id===copy.id).name,'已改名');assert.equal((await restarted.listPacks())[0].version,pack.version);
 const file=join(root,'unknown.xmp');await store.exportFile(copy.id,file);const packet=await readFile(file,'utf8');await writeFile(file,packet.replace('</rdf:Description>','<u:Qualified xmlns:u="urn:test" rdf:parseType="Resource"><rdf:value>preserved</rdf:value><u:meaning>qualifier</u:meaning></u:Qualified></rdf:Description>'));
 const imported=await store.importFile(file);await store.rename(imported.id,'未知保留','测试');await store.exportFile(imported.id,file);assert((await readFile(file,'utf8')).includes('qualifier'));await store.remove(imported.id);assert(!(await store.list()).items.some(p=>p.id===imported.id));
}));

const adobePreset=process.env.CAPTRAW_ADOBE_ISO_PRESET||'/Library/Application Support/Adobe/CameraRaw/Settings/Adobe/Presets/Defaults/Adobe Color + Lens + NR.xmp';
test('installed Adobe ISO preset structure imports and preserves unknown Look through export', {skip:!existsSync(adobePreset)},()=>scenario(async({root,store,sync,first})=>{
 const original=await readFile(adobePreset),sha=createHash('sha256').update(original).digest('hex');
 const local=join(root,'adobe-input.xmp');await writeFile(local,(await xmp.call('write',original.toString(),[property(CRS,'Exposure2012',text('.5'))])).packet);
 const imported=await store.importFile(local);assert(imported.isoAdaptive);assert.equal(imported.supportsAmount,false);
 const result=await store.applyMany({id:imported.id,targets:[{...first,image:{...first.image,iso:800}}],operationId:'adobe-iso'},sync);assert.equal(result.results[0].adjustments.exposure,.5);assert.equal(result.results[0].adjustments.luminanceNoise,15);assert.equal(result.results[0].adjustments.colorNoise,25);
 const output=join(root,'adobe-roundtrip.xmp');await store.exportFile(imported.id,output);const roundtrip=(await xmp.read(output)).properties;const before=(await xmp.call('read',original.toString())).properties;
 assert.deepEqual(lookup(roundtrip,CRS,'Look'),lookup(before,CRS,'Look'));assert.equal(lookup(roundtrip,CRS,'ISODependent').items.length,4);
 assert.equal(createHash('sha256').update(await readFile(adobePreset)).digest('hex'),sha);
 console.log('Adobe ISO structure evidence:',adobePreset,sha);
}));
test('package maintenance validates checksums and paths and publishes a new version without changing user data',()=>scenario(async({root,store})=>{
 const builtin=(await store.list()).items.find(p=>p.origin==='builtin'),packet=await readFile(join(root,'user','.builtin',builtin.packageId,builtin.packageVersion,'exposure.xmp'));
 const packs=new PresetPacks(join(root,'maintenance'));await packs.initialize();
 const next={...structuredClone(builtinPresetPack),version:'1.0.1'};await packs.install(next,async()=>packet);assert.equal(packs.list()[0].version,'1.0.1');assert.equal(packs.entries()[0].id,builtin.id);
 await assert.rejects(packs.install({...next,version:'1.0.2',presets:[{...next.presets[0],sha256:'0'.repeat(64)}]},async()=>packet),/校验/);
 await assert.rejects(packs.install({...next,version:'1.0.2',presets:[{...next.presets[0],path:'../escape'}]},async()=>packet),/路径/);
 assert.equal(packs.list()[0].version,'1.0.1');assert.equal((await store.list()).items.find(p=>p.id===builtin.id).packageVersion,builtin.packageVersion);
}));
test('preset mask without leaf reference binds independently to every target canvas',()=>scenario(async({root,store,core,sync,first,second})=>{
 const mask={id:'preset-mask',name:'径向',type:'radial',enabled:true,inverted:false,feather:30,points:[],start:{x:.25,y:.25},end:{x:.75,y:.75},brightness:.5,contrast:0,saturation:0};
 const p=await store.create({name:'局部',group:'测试',groups:['masks'],adjustments:{...first.adjustments,masks:[mask]}});
 const legacy=join(root,'user',p.id,'preset.xmp');await writeFile(legacy,(await xmp.call('write',await readFile(legacy,'utf8'),[property(CT,'ARTAdjustments',encode({masks:[mask]}))])).packet);
 for(const [doc,angle] of [[first,12],[second,-8]]){doc.adjustments={...doc.adjustments,fineRotation:angle,crop:null};doc.profile=(await core.call('compose',{path:doc.image.path,width:doc.image.width,height:doc.image.height,adjustments:doc.adjustments,artProfile:doc.profile})).artProfile;}
 const result=await store.applyMany({id:p.id,targets:[first,second],operationId:'masks'},sync);
 assert.equal(result.results.length,2);for(const [i,r] of result.results.entries()){const checked=await core.call('validate',{artProfile:[first,second][i].profile,adjustments:{...[first,second][i].adjustments,masks:[mask]}});assert.deepEqual(r.adjustments.masks,checked.masks);}
}));

test('hover cancels obsolete requests independently of apply, returns frame revision and serializes rapid changes',()=>scenario(async({root,store,core,sync,first,second})=>{
 const p=await store.create({name:'悬停',group:'测试',groups:['light'],adjustments:{...first.adjustments,exposure:.5}});
 let observeExit=false,started;const entered=new Promise(accept=>{started=accept;});
 const previewSync=new Synchronizer(binary,resources,join(root,'hover'),()=>{if(observeExit)started();}),hover=new PresetPreview(new Presets(join(root,'user'),core,join(root,'hover-cache'),xmp),previewSync);
 const applying=store.applyMany({id:p.id,targets:[first,second],operationId:'apply'},sync);
 const old=hover.preview({id:p.id,target:first,revision:1}),newest=hover.preview({id:p.id,target:first,amount:200,revision:2});assert.equal(await old,null);const shown=await newest;assert.equal(shown.results[0].adjustments.exposure,1);assert.equal(shown.results[0].frame.revision,2);assert.equal(shown.results[0].frame.sessionId,first.image.id);
 await hover.cancel();assert.equal(previewSync.previews.size,0);assert.equal((await applying).results.length,2);for(const path of sync.previews.values())await access(path);
 observeExit=true;const exiting=hover.preview({id:p.id,target:first,revision:3});await entered;const child=previewSync.worker.child;await hover.shutdown();assert(child.exitCode!==null||child.signalCode!==null);assert.equal(await exiting,null);assert.equal(previewSync.previews.size,0);assert.equal(previewSync.running,false);await assert.rejects(hover.preview({id:p.id,target:first,revision:4}),/关闭/);
}));
