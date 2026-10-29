import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,mkdir,cp,rm,readdir} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';
import {enhancedFixtures,digest} from './enhanced-profile-fixtures.mjs';
import {InputProfiles} from '@captraw/desktop-core/input-profiles';
import {Documents,BatchDocumentSaver} from '@captraw/desktop-core/documents';
import {SessionDocumentSaver} from '@captraw/desktop-core/session-save';
import {XMP,CRS,CT,lookup,property,encode,readExtension} from '@captraw/desktop-core/xmp';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {ENGINE_VERSION} from '@captraw/contracts';
const root=await mkdtemp(join(tmpdir(),'captraw-enhanced-service-'));
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp);
let engine,sync,passed=false,index=0;const regressions=[];
const pass=message=>console.log('PASS',message);
function tiffPixels(path){return JSON.parse(execFileSync(process.env.CAPTRAW_QA_PYTHON||'build/qa-venv/bin/python',['-c','import sys,json,hashlib,tifffile;f=tifffile.TiffFile(sys.argv[1]);a=f.asarray();assert str(a.dtype)=="uint16";assert f.pages[0].tags.get(34675);print(json.dumps({"sha256":hashlib.sha256(a.tobytes()).hexdigest(),"shape":list(a.shape),"dtype":str(a.dtype)}))',path],{encoding:'utf8'}));}
try{
 assert((await readFile(binary)).includes(Buffer.from('CaptRAWEnhancedProfile')),'Parent must complete the enhanced native build before this test.');
 engine=new EngineClient({cache:join(root,'engine')});engine.on('error',()=>{});await engine.ready;
 const fixtures=await enhancedFixtures(root,xmp),library=new InputProfiles(join(root,'library'),engine,xmp);
 sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});
 const camera='CaptRAW Synthetic Bayer';
 const render=async(path,adjustments,artProfile='')=>{
  const image=await engine.call('open',{path,sessionId:'render-'+index});
  const controls=adjustments??image.adjustments;
  const result=await engine.call('compose',{path,width:image.width,height:image.height,adjustments:controls,artProfile:artProfile||image.artProfile});
  const output=join(root,'render-'+index+++'.tiff');await engine.call('export',{path,artProfile:result.artProfile,output,format:'tiff',colorSpace:'srgb'});
  return {...result,image,output,pixels:tiffPixels(output),adjustments:controls};
 };
 const baseline=await render(fixtures.png),unchanged={...baseline.image.adjustments,colorProfile:{...baseline.image.adjustments.colorProfile,look:undefined}};
 assert.equal(baseline.image.inputKind,'rendered');assert(!baseline.image.inputProfiles.some(p=>p.id==='matrix'));assert.equal(baseline.image.inputProfiles.find(p=>p.id==='auto').kind,'icc');
 assert.deepEqual((await render(fixtures.png,unchanged,baseline.artProfile)).pixels,baseline.pixels);
 assert(!baseline.artProfile.includes('CaptRAWEnhancedProfile=')||baseline.artProfile.includes('CaptRAWEnhancedProfile=\n'));
 const beforeNames=await readdir(join(root,'library')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));
 await assert.rejects(library.importFile(fixtures.missing,'',false),/缺少 RGBTable 资产/);
 await assert.rejects(library.importFile(fixtures.unsupported,'',false),/不支持的必要 Look 参数/);
 assert.deepEqual(await readdir(join(root,'library')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e)),beforeNames);
 pass('missing tables and unknown required features reject without mutating the library; ordinary input settings retain exact TIFF16 pixels');
 const rgb=await library.importFile(fixtures.files.rgb,'',false),again=await library.importFile(fixtures.files.rgb,'',false);assert.equal(rgb.reference,again.reference);assert.equal(rgb.kind,'look');
 const outputs=new Map();
 for(const amount of [0,.5,1,1.5,2]){
  const settings={...rgb.settings,look:{...rgb.settings.look,amount}},adjustments={...baseline.image.adjustments,colorProfile:settings};
  const result=await render(fixtures.png,adjustments,baseline.artProfile);outputs.set(amount,result);assert.match(result.artProfile,/CaptRAWEnhancedProfile=/);
  assert.deepEqual((await engine.call('validate',{artProfile:result.artProfile,adjustments})).colorProfile.look.profile,rgb.enhanced);
 }
 if(outputs.get(0).pixels.sha256!==baseline.pixels.sha256){regressions.push('zero-amount RGB Look changed TIFF16 pixels');console.error('FAIL',regressions.at(-1));}for(const amount of [.5,1,1.5,2])assert.notEqual(outputs.get(amount).pixels.sha256,baseline.pixels.sha256);
 assert.equal(new Set([...outputs.values()].map(r=>r.pixels.sha256)).size,outputs.size);
 assert.equal(outputs.get(1.5).adjustments.exposure,baseline.image.adjustments.exposure);
 pass('native RGB Look renders distinct actual TIFF16 pixels at 0/50/100/150/200% and user controls stay unchanged; zero bypass is checked separately');
 for(const key of ['hsv','both']){
  const info=await library.importFile(fixtures.files[key],'',false),adjustments={...baseline.image.adjustments,colorProfile:info.settings},result=await render(fixtures.png,adjustments,baseline.artProfile);
  assert.notEqual(result.pixels.sha256,baseline.pixels.sha256);assert.deepEqual((await render(fixtures.png,adjustments,result.artProfile)).pixels,result.pixels);
 }
 pass('HSV and combined HSV/RGB/natural-curve Looks render through the real ART pipeline and persist exactly');
 const chosen=outputs.get(1.5),saved=join(root,'保存 中文.xmp'),source=await readFile(fixtures.png);
 const recipe={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:fixtures.png,size:source.length,sha256:digest(source)},artProfile:chosen.artProfile,adjustments:chosen.adjustments};
 await saveRecipeWithMasks(engine,saved,recipe,r=>documents.serialize(r));
 const document=await documents.read(saved),standard=await xmp.read(saved),look=lookup(standard.properties,CRS,'Look');
 assert.equal(look.fields.find(p=>p.name==='Amount').node.value,'1.5');assert.equal(document.adjustments.colorProfile.look.profile.tables.length,1);
 assert.equal((await render(fixtures.png,document.adjustments,document.artProfile)).pixels.sha256,chosen.pixels.sha256);
 const moved=join(root,'移动 后');await mkdir(moved);const relocated=join(moved,'重命名.xmp');await copyFile(saved,relocated);await rm(rgb.reference.slice(5));
 const restored=await restoreRecipeMasks(engine,relocated,await documents.read(relocated),join(root,'fresh-assets'));
 assert.deepEqual((await render(fixtures.png,restored.adjustments,restored.artProfile)).pixels,chosen.pixels);
 pass('standard crs:Look Amount and inline real table assets round-trip; relocated XMP survives deletion of imported Look files');
 const curveOnly=await library.importFile(fixtures.files.curveOnly,'',false),session=new SessionDocumentSaver(binary,resources,join(root,'session'),documents,async()=>true,()=>{});
 const snapshot={path:fixtures.png,width:baseline.image.width,height:baseline.image.height,artProfile:chosen.artProfile,adjustments:chosen.adjustments};
 const initial=await session.run({sessionId:'replace-look',documents:[{...snapshot,adjustments:{...snapshot.adjustments,colorProfile:curveOnly.settings}}]});assert.equal(initial.results[0].error,undefined);
 const sessionPath=initial.results[0].output,old=(await xmp.read(sessionPath)),oldLook=lookup(old.properties,CRS,'Look'),oldPrivate=lookup(old.properties,CT,'ARTAdjustments');
 const opaque=property('urn:enhanced-save-opaque','Nested',{fields:[property('urn:enhanced-save-opaque','Text',{value:'保留 未知',qualifiers:[property('urn:enhanced-save-opaque','Note',{value:'限定符'})]})]});
 oldLook.fields.find(p=>p.name==='Parameters').node.fields.push(opaque);oldLook.qualifiers=[property('urn:enhanced-save-opaque','LookNote',{value:'保留 Look 限定符'})];
 oldPrivate.fields.find(p=>p.name==='colorProfile').node.fields.find(p=>p.name==='look').node.fields.find(p=>p.name==='profile').node.fields.push(property(CT,'FutureMetadata',encode({nested:'保留 快照'})));
 const previous=(await xmp.call('write',old.packet,[property(CRS,'Look',oldLook),property(CT,'ARTAdjustments',oldPrivate)])).packet;await writeFile(sessionPath,previous);
 const wantedLook=lookup((await xmp.call('read',previous)).properties,CRS,'Look'),wantedOpaque=wantedLook.fields.find(p=>p.name==='Parameters').node.fields.find(p=>p.name==='Nested');
 const verifyReplaced=async path=>{
  const packet=await xmp.read(path),look=lookup(packet.properties,CRS,'Look');
  assert(!look.fields.find(p=>p.name==='Parameters').node.fields.some(p=>p.name==='ToneCurvePV2012'));
  assert.deepEqual(look.fields.find(p=>p.name==='Parameters').node.fields.find(p=>p.name==='Nested'),wantedOpaque);
  assert.deepEqual(look.qualifiers,wantedLook.qualifiers);const privateProfile=readExtension(packet.properties,'ARTAdjustments').colorProfile.look.profile;
  assert.equal(privateProfile.curve,undefined);assert.deepEqual(privateProfile.FutureMetadata,{nested:'保留 快照'});
  const restored=await documents.read(path);assert.equal((await render(fixtures.png,restored.adjustments,restored.artProfile)).pixels.sha256,chosen.pixels.sha256);
 };
 const replaced=await session.run({sessionId:'replace-look',documents:[snapshot]});assert.equal(replaced.results[0].error,undefined);await verifyReplaced(sessionPath);
 const batchFolder=join(root,'batch-look');await mkdir(batchFolder);const batch=new BatchDocumentSaver(binary,resources,join(root,'batch'),documents,()=>{});
 const batchResult=await batch.run({documents:[{...snapshot,xmpPacket:previous}]},batchFolder);assert.equal(batchResult.results[0].error,undefined);await verifyReplaced(batchResult.results[0].output);
 const explicit=join(root,'explicit-look.xmp');await saveRecipeWithMasks(engine,explicit,{...recipe,xmpPacket:previous},value=>documents.serialize(value));await verifyReplaced(explicit);
 pass('Session, Batch and explicit save remove a replaced Look curve, preserve unknown nested RDF/private fields and qualifiers, and reopen with exact TIFF16 pixels');
 await assert.rejects(library.importFile(fixtures.files.rawLook,camera,true),/缺少基础 DCP/);
 const dcp=await library.importFile(fixtures.dcp,camera,true);assert.equal(dcp.name,'Enhanced Test Base');
 const rawLook=await library.importFile(fixtures.files.rawLook,camera,true);assert.equal(rawLook.settings.reference,dcp.reference);assert(rawLook.settings.toneCurve);
 const rawBase=await render(fixtures.raw);assert.equal(rawBase.image.inputKind,'mosaic-raw');assert(rawBase.image.inputProfiles.some(p=>p.id==='matrix'));
 const alias=join(root,'实际 DNG 内容.nef');await copyFile(fixtures.raw,alias);const aliasImage=await engine.call('open',{path:alias,sessionId:'raw-alias'});assert.equal(aliasImage.inputKind,'mosaic-raw');assert(aliasImage.inputProfiles.some(p=>p.id==='matrix'));assert.equal(aliasImage.inputProfiles.find(p=>p.id==='auto').kind,rawBase.image.inputProfiles.find(p=>p.id==='auto').kind);
 pass('profile auto/matrix choices agree with actual rendered/RAW inputKind, including DNG content with a camera-extension alias');
 const rawAdjustments={...rawBase.image.adjustments,colorProfile:rawLook.settings},rawResult=await render(fixtures.raw,rawAdjustments,rawBase.artProfile);
 const rawPacket=join(root,'原片 编辑.xmp'),rawBytes=await readFile(fixtures.raw);
 await saveRecipeWithMasks(engine,rawPacket,{...recipe,source:{path:fixtures.raw,size:rawBytes.length,sha256:digest(rawBytes)},artProfile:rawResult.artProfile,adjustments:rawAdjustments},r=>documents.serialize(r));
 const rawDoc=await documents.read(rawPacket);assert(rawDoc.inputProfileAsset);assert.match(rawDoc.adjustments.colorProfile.reference,/^captraw-profile:/);
 const rawMoved=join(moved,'RAW.xmp');await copyFile(rawPacket,rawMoved);await cp(rawPacket+'.assets',join(moved,basename(rawPacket)+'.assets'),{recursive:true});
 await rm(dcp.reference.slice(5));await rm(rawLook.reference.slice(5));
 const rawRestored=await restoreRecipeMasks(engine,rawMoved,await documents.read(rawMoved),join(root,'raw-fresh-assets'));
 assert.deepEqual((await render(fixtures.raw,rawRestored.adjustments,rawRestored.artProfile)).pixels,rawResult.pixels);
 pass('RAW Look requires a compatible real base DCP, and portable DCP+Look assets reproduce exact TIFF16 after relocation/library removal');
 const targetImage=await engine.call('open',{path:fixtures.other,sessionId:'sync-target'}),target={image:targetImage,adjustments:targetImage.adjustments,profile:targetImage.artProfile};
 const sourceImage=await engine.call('open',{path:fixtures.png,sessionId:'sync-source'}),sourceDocument={image:sourceImage,adjustments:chosen.adjustments,profile:chosen.artProfile};
 const synced=await sync.run({source:sourceDocument,targets:[target],groups:['profile']});assert.equal(synced.length,1);assert.equal(synced[0].adjustments.colorProfile.look.amount,1.5);assert.equal(synced[0].adjustments.exposure,target.adjustments.exposure);
 const presetStore=new Presets(join(root,'presets'),engine,join(root,'preset-assets'),xmp),preset=await presetStore.create({name:'配置 Look',group:'用户测试',groups:['profile'],adjustments:chosen.adjustments,artProfile:chosen.artProfile});
 const applied=await presetStore.applyMany({id:preset.id,targets:[target],operationId:'look-preset'},sync);assert.equal(applied.results[0].adjustments.colorProfile.look.amount,1.5);
 await assert.rejects(presetStore.importFile(fixtures.missing),/增强 Look 配置文件/);
 pass('profile-only synchronization and captured presets carry real Look assets and amount without changing unrelated controls; Look files cannot masquerade as ordinary presets');
 const icc=await library.importFile(fixtures.icc,'',false),iccAdjustments={...chosen.adjustments,colorProfile:{...chosen.adjustments.colorProfile,mode:'inherited',reference:icc.reference}},iccExpected=await render(fixtures.png,iccAdjustments,chosen.artProfile);
 const portablePreset=await presetStore.create({name:'带 ICC Look',group:'资产测试',groups:['profile'],adjustments:iccAdjustments,artProfile:chosen.artProfile});
 const presetPath=join(root,'presets',portablePreset.id,'preset.xmp'),presetPacket=await readFile(presetPath),presetManifest=readExtension((await xmp.read(presetPath)).properties,'InputProfileAsset');assert(presetManifest);assert.deepEqual(await readFile(join(dirname(presetPath),presetManifest.path)),await readFile(fixtures.icc));
 const exportedPreset=join(moved,'带 ICC Look.xmp');await presetStore.exportFile(portablePreset.id,exportedPreset);const exportedManifest=readExtension((await xmp.read(exportedPreset)).properties,'InputProfileAsset');assert(exportedManifest);assert.equal(exportedManifest.path.split('/')[0],basename(exportedPreset)+'.assets');
 await rm(icc.reference.slice(5));await rm(join(root,'presets',portablePreset.id),{recursive:true});await rm(join(root,'preset-assets'),{recursive:true,force:true});
 const freshStore=new Presets(join(root,'fresh-presets'),engine,join(root,'fresh-preset-assets'),xmp),importedPreset=await freshStore.importFile(exportedPreset);await rm(exportedPreset);await rm(exportedPreset+'.assets',{recursive:true});
 const importedPath=join(root,'fresh-presets',importedPreset.id,'preset.xmp');const duplicate=await freshStore.duplicate(importedPreset.id,'资产副本','资产测试');await freshStore.rename(duplicate.id,'改名资产副本','资产测试');
 const portableApplied=await freshStore.applyMany({id:duplicate.id,targets:[target],operationId:'portable-icc-look'},sync);assert.equal(portableApplied.results[0].adjustments.colorProfile.look.amount,1.5);
 assert.equal((await render(fixtures.other,portableApplied.results[0].adjustments,portableApplied.results[0].profile)).pixels.sha256,iccExpected.pixels.sha256);
 const duplicatePath=join(root,'fresh-presets',duplicate.id,'preset.xmp'),oldPacket=await readFile(duplicatePath),manifest=readExtension((await xmp.read(duplicatePath)).properties,'InputProfileAsset'),oldAsset=join(dirname(duplicatePath),manifest.path),oldBytes=await readFile(oldAsset);
 if(process.platform==='darwin'){
  execFileSync('/usr/bin/chflags',['uchg',duplicatePath]);
  try{await assert.rejects(freshStore.update(duplicate.id,{name:'失败替换',group:'资产测试',groups:['profile'],adjustments:portableApplied.results[0].adjustments}),/permitted|permission|权限/i);assert.deepEqual(await readFile(duplicatePath),oldPacket);assert.deepEqual(await readFile(oldAsset),oldBytes);}
  finally{execFileSync('/usr/bin/chflags',['nouchg',duplicatePath]);}
  assert(!(await readdir(dirname(duplicatePath))).some(file=>file.endsWith('.tmp')),'failed preset publication cleans its temporary XMP');
 }
 await freshStore.update(duplicate.id,{name:'清除输入资产',group:'资产测试',groups:['profile'],adjustments:baseline.image.adjustments});assert.equal(readExtension((await xmp.read(duplicatePath)).properties,'InputProfileAsset'),undefined);assert.deepEqual(await readFile(oldAsset),oldBytes);
 assert(presetPacket.length);assert((await readFile(importedPath)).length);
 pass('ICC Look preset manifests migrate through export/import/duplicate/rename without the library; failed atomic replacement preserves old XMP/assets and clearing removes the manifest');
 for(const [path,hash] of fixtures.before)assert.equal(digest(await readFile(path)),hash);
 assert.deepEqual(regressions,[],'Known pipeline regressions must be fixed before acceptance');
 passed=true;
}finally{
 sync?.cancel();if(engine){await engine.stop();if(engine.child.exitCode===null&&engine.child.signalCode===null)await new Promise(done=>engine.child.once('exit',done));}
 if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained enhanced service failure:',root);
}
