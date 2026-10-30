// Real XMP SDK, native TIFF pixels, preset files and synchronization workers.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CRS,CT,property,text,encode,lookup,readExtension,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/presets';
assert.equal(decodeAdjustments([property(CRS,'PerspectiveScale',text(110))]).adjustments.perspective?.scale,1.1,'new desktop-core build required');
const root=await mkdtemp(join(tmpdir(),'captraw-perspective-scale-')),python=resolve('build/qa-venv/bin/python'),binary=resolve('build/native/captraw-engine'),resources=resolve('build/native/resources');
const sha=b=>createHash('sha256').update(b).digest('hex'),engineSHA=sha(await readFile(binary)),xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),checks=[];
let core,sync,passed=false;
const pixelHash=file=>execFileSync(python,['-c',"import tifffile,hashlib,sys;a=tifffile.imread(sys.argv[1]);assert a.dtype.name=='uint16';print(hashlib.sha256(a.tobytes()).hexdigest())",file],{encoding:'utf8'}).trim();
try{
 const path=join(root,'grid.tif');await copyFile(resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif'),path);const bytes=await readFile(path),sourceSHA=sha(bytes);
 core=new EngineClient({cache:join(root,'core'),executable:binary});const image=await core.call('open',{path,sessionId:'scale-sdk',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
 const importedPacket=(await xmp.call('write','',[property(CRS,'PerspectiveScale',text(110)),property(CRS,'PerspectiveVertical',text(10))])).packet;
 const imported=decodeAdjustments((await xmp.call('read',importedPacket)).properties);assert.equal(imported.adjustments.perspective.scale,1.1);assert(imported.warnings.some(w=>w.includes('PerspectiveVertical')));
 const neutralPacket=(await xmp.call('write','',[property(CRS,'PerspectiveScale',text(100))])).packet;assert.equal(decodeAdjustments((await xmp.call('read',neutralPacket)).properties).adjustments.perspective,undefined);
 const oldP={...image.adjustments.perspective,enabled:true,manualModel:'art-perspective-v1',scale:1.25},oldSettings={...image.adjustments,perspective:oldP};
 const before=await core.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:oldSettings});
 const properties=encodeAdjustments(image.adjustments).filter(p=>!(p.ns===CRS&&p.name==='PerspectiveScale')&&!(p.ns===CT&&p.name==='ARTAdjustments'));
 const privateState={...readExtension(encodeAdjustments(image.adjustments),'ARTAdjustments'),perspective:oldP};
 const oldPacket=(await xmp.call('write','',[...properties,property(CRS,'PerspectiveScale',text(100)),property(CT,'EngineVersion',encode('CaptRAW-31_ART-1.26.10_LibRaw-3b20539')),property(CT,'ARTAdjustments',encode(privateState)),property(CT,'ARTProfile',encode(before.artProfile))])).packet;
 const oldFile=join(root,'old.xmp');await writeFile(oldFile,oldPacket);const old=await documents.read(oldFile);assert.equal(old.adjustments.perspective.scale,1.25);assert(old.warnings.some(w=>w.includes('旧私有缩放')));
 const recipe={...old,source:{path:'grid.tif',size:bytes.length,sha256:sourceSHA}};
 const newPacket=await documents.serialize(recipe);const newFile=join(root,'new.xmp');await writeFile(newFile,newPacket);
 const encoded=(await xmp.read(newFile)).properties,restored=await documents.read(newFile);assert.equal(lookup(encoded,CRS,'PerspectiveScale').value,'125');assert.equal(readExtension(encoded,'ARTAdjustments').perspective.scale,undefined);assert.equal(restored.adjustments.perspective.scale,1.25);
 const after=await core.call('compose',{path,width:image.width,height:image.height,artProfile:restored.artProfile,adjustments:restored.adjustments});
 const oldTIFF=join(root,'old.tiff'),newTIFF=join(root,'new.tiff');
 await core.call('export',{path,artProfile:before.artProfile,output:oldTIFF,format:'tiff',colorSpace:'srgb'});await core.call('export',{path,artProfile:after.artProfile,output:newTIFF,format:'tiff',colorSpace:'srgb'});assert.equal(pixelHash(newTIFF),pixelHash(oldTIFF));
 const arpPacket=(await xmp.call('write','',[...properties,property(CRS,'PerspectiveScale',text(100)),property(CT,'ARTProfile',encode(before.artProfile))])).packet;
 const arp=decodeAdjustments((await xmp.call('read',arpPacket)).properties);assert.equal(arp.adjustments.perspective,undefined);assert(arp.warnings.some(w=>w.includes('ART 几何配置保留')));
 const inherited={...image.adjustments,...arp.adjustments};delete inherited.perspective;const inheritedProfile=await core.call('compose',{path,width:image.width,height:image.height,artProfile:before.artProfile,adjustments:inherited});
 const arpTIFF=join(root,'arp-only.tiff');await core.call('export',{path,artProfile:inheritedProfile.artProfile,output:arpTIFF,format:'tiff',colorSpace:'srgb'});assert.equal(pixelHash(arpTIFF),pixelHash(oldTIFF),'standard100 cannot clear an inherited ARP scale');
 checks.push('SDK read/write migrates private 1.25 + standard100 to standard125 without a second active authority; all TIFF16 pixels unchanged');
 const implicitP={...oldP,aspect:1.001};delete implicitP.scale;
 const implicitBefore=await core.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:{...image.adjustments,perspective:implicitP}});
 const implicitPacket=(await xmp.call('write','',[...properties,property(CRS,'PerspectiveScale',text(110)),property(CT,'EngineVersion',encode('CaptRAW-31_ART-1.26.10_LibRaw-3b20539')),property(CT,'ARTAdjustments',encode({...privateState,perspective:implicitP})),property(CT,'ARTProfile',encode(implicitBefore.artProfile))])).packet;
 const implicitFile=join(root,'old-implicit.xmp');await writeFile(implicitFile,implicitPacket);const implicitDoc=await documents.read(implicitFile);assert.equal(implicitDoc.adjustments.perspective.scale,undefined);assert(implicitDoc.warnings.some(w=>w.includes('ART 几何配置保留')));
 const implicitSaved=await documents.serialize({...implicitDoc,source:recipe.source}),implicitRestored=decodeAdjustments((await xmp.call('read',implicitSaved)).properties);assert.equal(implicitRestored.adjustments.perspective.scale,1);
 const implicitAfter=await core.call('compose',{path,width:image.width,height:image.height,artProfile:implicitDoc.artProfile,adjustments:implicitRestored.adjustments});
 const implicitOldTIFF=join(root,'implicit-old.tiff'),implicitNewTIFF=join(root,'implicit-new.tiff');await core.call('export',{path,artProfile:implicitBefore.artProfile,output:implicitOldTIFF,format:'tiff',colorSpace:'srgb'});await core.call('export',{path,artProfile:implicitAfter.artProfile,output:implicitNewTIFF,format:'tiff',colorSpace:'srgb'});assert.equal(pixelHash(implicitNewTIFF),pixelHash(implicitOldTIFF),'v31 absent scale retains native default1 despite preserved standard110');
 checks.push('v31 manual model with absent private scale preserves native default1 against standard110; SDK migration keeps every TIFF16 pixel');
 recipe.xmpPacket=newPacket;
 for(const enabled of [false,true]){
  recipe.adjustments.perspective={...oldP,enabled};
  const packet=await documents.serialize(recipe),decoded=(await xmp.call('read',packet)).properties;
  assert.equal(lookup(decoded,CRS,'PerspectiveScale').value,enabled?'125':'100');assert.equal(readExtension(decoded,'ARTAdjustments').perspective.scale,enabled?undefined:1.25);
  assert.equal(decodeAdjustments(decoded).adjustments.perspective.scale,1.25);
  recipe.xmpPacket=packet;
 }
 checks.push('SDK saves bypass as neutral100 with an inactive remembered value; re-enable removes the private value through Documents ownership');
 const scaleSettings={...image.adjustments,...imported.adjustments},scaleProfile=await core.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:scaleSettings});
 const foreignSaved=await documents.serialize({...recipe,xmpPacket:importedPacket,artProfile:scaleProfile.artProfile,adjustments:scaleSettings}),foreignProperties=(await xmp.call('read',foreignSaved)).properties;assert.equal(lookup(foreignProperties,CRS,'PerspectiveVertical').value,'10');assert(decodeAdjustments(foreignProperties).warnings.some(w=>w.includes('PerspectiveVertical')));
 const expected=join(root,'scale110.tiff');await core.call('export',{path,artProfile:scaleProfile.artProfile,output:expected,format:'tiff',colorSpace:'srgb'});
 const targetPath=join(root,'target.tif');await copyFile(path,targetPath);const targetImage=await core.call('open',{path:targetPath,sessionId:'target-scale',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'}),target={image:targetImage,adjustments:targetImage.adjustments,profile:targetImage.artProfile};
 sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});const source={image,adjustments:scaleSettings,profile:scaleProfile.artProfile};
 const copied=await sync.run({source,targets:[target],groups:['perspective']});assert.equal(copied[0].adjustments.perspective.scale,1.1);
 const store=new Presets(join(root,'presets'),core,join(root,'preset-cache'),xmp),preset=await store.create({name:'Standard Scale',group:'Geometry',groups:['perspective'],adjustments:scaleSettings,artProfile:scaleProfile.artProfile});
 const file=join(root,'preset.xmp');await store.exportFile(preset.id,file);const presetProperties=(await xmp.read(file)).properties;assert.equal(lookup(presetProperties,CRS,'PerspectiveScale').value,'110');assert.equal(readExtension(presetProperties,'ARTAdjustments').perspective.scale,undefined);
 const importedPreset=await store.importFile(file),applied=await store.apply(importedPreset.id,target,sync);assert.equal(applied[0].adjustments.perspective.scale,1.1);
 for(const [name,row] of [['sync',copied[0]],['preset',applied[0]]]){const output=join(root,name+'.tiff');await core.call('export',{path:targetPath,artProfile:row.profile,output,format:'tiff',colorSpace:'srgb'});assert.equal(pixelHash(output),pixelHash(expected));}
 checks.push('real standard110 import, portable SDK preset export/import/apply and synchronization retain center scale and match independently composed TIFF16 pixels');
 assert.equal(sha(await readFile(path)),sourceSHA);assert.equal(sha(await readFile(binary)),engineSHA);passed=true;console.log(JSON.stringify({engineSHA,checks},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,diagnostics:core?.diagnostics},null,2));throw error;}
finally{sync?.cancel();await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained scale failure:',root);}
