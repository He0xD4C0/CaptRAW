import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {XMP,CRS,CT,lookup,property,text,encode,readExtension} from '@captraw/desktop-core/xmp';
import {EngineClient} from './engine-client.mjs';
import {adobeGradingFields,adobeGradingSettings,adobeGradingFixture} from './xmp-test.mjs';

const out=resolve(process.env.CAPTRAW_XMP_GRADING_OUT||'artifacts/xmp-color-grading');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),source=resolve('build/samples/synthetic.dng');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),sourceHash=hash(source);
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),engine=new EngineClient({cache:join(work,'core')});
const aliases={SplitToningShadowHue:'ColorGradeShadowHue',SplitToningShadowSaturation:'ColorGradeShadowSat',SplitToningHighlightHue:'ColorGradeHighlightHue',SplitToningHighlightSaturation:'ColorGradeHighlightSat',SplitToningBalance:'ColorGradeBalance'};
const checks=[],references=[],pass=message=>{checks.push(message);console.log('PASS',message);};let success=false,tiffPixels;
try{
  assert.equal((await engine.ready).engineVersion,ENGINE_VERSION);
  const input=join(work,'adobe.xmp');writeFileSync(input,adobeGradingFixture);
  const imported=await documents.read(input);assert.deepEqual(imported.adjustments,{colorGrading:adobeGradingSettings});
  assert(!imported.warnings.some(message=>message.includes('不完整')));
  pass('fourteen actual Adobe SplitToning/ColorGrade fields import as four wheels, blending and balance');

  const image=await engine.call('open',{path:source,sessionId:'grading'});
  const pending=engine.preview(1);await engine.call('update',{revision:1,adjustments:image.adjustments,artProfile:image.artProfile});const neutral=await pending;
  const adjustments={...image.adjustments,...imported.adjustments},changedPending=engine.preview(2);
  const applied=await engine.call('update',{revision:2,adjustments,artProfile:image.artProfile}),changed=await changedPending;
  assert.notEqual(hash(neutral.file),hash(changed.file));
  const directPending=engine.preview(3);await engine.call('update',{revision:3,adjustments:{...image.adjustments,colorGrading:adobeGradingSettings},artProfile:image.artProfile});const direct=await directPending;
  assert.equal(hash(changed.file),hash(direct.file));
  pass('standard Adobe grading drives real pixels and exactly matches directly authored native grading');

  const document={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:statSync(source).size,sha256:sourceHash},adjustments,artProfile:applied.artProfile,xmpPacket:imported.xmpPacket};
  const saved=join(work,'saved.xmp');writeFileSync(saved,await documents.serialize(document));
  const properties=(await xmp.read(saved)).properties;
  for(const [name,value] of Object.entries(adobeGradingFields))assert.equal(Number(lookup(properties,CRS,name).value),value);
  for(const name of Object.values(aliases))assert.equal(lookup(properties,CRS,name),undefined);
  assert.equal(readExtension(properties,'EngineVersion'),ENGINE_VERSION);
  assert.equal(lookup(properties,'https://example.invalid/grading/','Opaque').value,'keep');
  assert.deepEqual((await documents.read(saved)).adjustments.colorGrading,adobeGradingSettings);
  pass('saving writes canonical Adobe names and the current processing version while preserving unrelated metadata');

  const legacyChanges=[property(CT,'EngineVersion',encode('CaptRAW-24_ART-1.26.10_LibRaw-3b20539'))];
  for(const [canonical,alias] of Object.entries(aliases))legacyChanges.push(property(CRS,canonical,text(0)),property(CRS,alias,text(adobeGradingFields[canonical])));
  const legacy=join(work,'legacy.xmp');writeFileSync(legacy,(await xmp.call('write',readFileSync(saved,'utf8'),legacyChanges)).packet);
  const legacyHash=hash(legacy),old=await documents.read(legacy);assert.deepEqual(old.adjustments.colorGrading,adobeGradingSettings);
  assert(old.warnings.some(message=>message.includes('误写的颜色分级字段')));
  const migrated=join(work,'migrated.xmp');writeFileSync(migrated,await documents.serialize(old));
  const migratedProperties=(await xmp.read(migrated)).properties,restored=await documents.read(migrated);
  for(const name of Object.values(aliases))assert.equal(lookup(migratedProperties,CRS,name),undefined);
  for(const [canonical,value] of Object.entries(adobeGradingFields))assert.equal(Number(lookup(migratedProperties,CRS,canonical).value),value);
  assert.deepEqual(restored.adjustments.colorGrading,old.adjustments.colorGrading);assert.equal(restored.artProfile,old.artProfile);assert.equal(hash(legacy),legacyHash);
  pass('old CaptRAW names override stale inherited Adobe values once and migrate without changing edits or the native profile');

  const foreign=join(work,'foreign.xmp');writeFileSync(foreign,(await xmp.call('write',adobeGradingFixture,[property(CRS,'ColorGradeShadowHue',text(9))])).packet);
  const foreignRead=await documents.read(foreign);assert.equal(foreignRead.adjustments.colorGrading.shadows.hue,218);
  const foreignSaved=join(work,'foreign-saved.xmp');writeFileSync(foreignSaved,await documents.serialize({...document,xmpPacket:foreignRead.xmpPacket}));
  assert.equal(lookup((await xmp.read(foreignSaved)).properties,CRS,'ColorGradeShadowHue').value,'9');
  assert.equal((await documents.read(foreignSaved)).adjustments.colorGrading.shadows.hue,218);
  pass('foreign unknown names survive saving and never acquire legacy CaptRAW semantics after reopening');

  const partial=join(work,'partial.xmp');writeFileSync(partial,adobeGradingFixture.replace(' crs:SplitToningBalance="-14"',''));
  const partialRead=await documents.read(partial);assert.equal(partialRead.adjustments.colorGrading.balance,undefined);assert.deepEqual(partialRead.adjustments.colorGrading.shadows,adobeGradingSettings.shadows);
  const invalid=join(work,'invalid.xmp');writeFileSync(invalid,adobeGradingFixture.replace('crs:SplitToningShadowHue="218"','crs:SplitToningShadowHue="361"'));
  await assert.rejects(documents.read(invalid),/SplitToningShadowHue/);
  pass('incomplete grading never manufactures missing values and invalid canonical ranges fail explicitly');

  const sync=new Synchronizer(resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),join(work,'sync'),()=>{});
  const store=new Presets(join(work,'library'),engine,join(work,'preset-cache'),xmp),preset=await store.importFile(input);
  const targetAdjustments={...image.adjustments,exposure:1.25},targetProfile=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments:targetAdjustments,artProfile:image.artProfile});
  const result=await store.apply(preset.id,{image,adjustments:targetAdjustments,profile:targetProfile.artProfile},sync);
  assert.equal(result[0].adjustments.exposure,1.25);assert.deepEqual(result[0].adjustments.colorGrading,adobeGradingSettings);
  const oldPreset=join(work,'old-preset.xmp');writeFileSync(oldPreset,(await xmp.call('write',adobeGradingFixture,legacyChanges)).packet);
  const oldImported=await store.importFile(oldPreset),exported=join(work,'preset-export.xmp');await store.exportFile(oldImported.id,exported);
  const exportedProperties=(await xmp.read(exported)).properties;
  for(const name of Object.values(aliases))assert.equal(lookup(exportedProperties,CRS,name),undefined);
  assert.equal(lookup(exportedProperties,CRS,'SplitToningShadowHue').value,'218');
  pass('Adobe grading-only presets retain unrelated exposure and old CaptRAW presets export canonical fields');

  for(const [env,label] of [['CAPTRAW_ADOBE_MASK_REFERENCE','ACR settings'],['CAPTRAW_ADOBE_GRADING_PRESET','Adobe preset']])if(process.env[env]){
    const path=resolve(process.env[env]),before=hash(path),read=await documents.read(path),properties=(await xmp.read(path)).properties;
    const expected={shadows:{hue:Number(lookup(properties,CRS,'SplitToningShadowHue').value),saturation:Number(lookup(properties,CRS,'SplitToningShadowSaturation').value),luminance:Number(lookup(properties,CRS,'ColorGradeShadowLum').value)},midtones:{hue:Number(lookup(properties,CRS,'ColorGradeMidtoneHue').value),saturation:Number(lookup(properties,CRS,'ColorGradeMidtoneSat').value),luminance:Number(lookup(properties,CRS,'ColorGradeMidtoneLum').value)},highlights:{hue:Number(lookup(properties,CRS,'SplitToningHighlightHue').value),saturation:Number(lookup(properties,CRS,'SplitToningHighlightSaturation').value),luminance:Number(lookup(properties,CRS,'ColorGradeHighlightLum').value)},global:{hue:Number(lookup(properties,CRS,'ColorGradeGlobalHue').value),saturation:Number(lookup(properties,CRS,'ColorGradeGlobalSat').value),luminance:Number(lookup(properties,CRS,'ColorGradeGlobalLum').value)},blending:Number(lookup(properties,CRS,'ColorGradeBlending').value),balance:Number(lookup(properties,CRS,'SplitToningBalance').value)};
    assert.deepEqual(read.adjustments.colorGrading,expected);assert(!read.warnings.some(message=>message.includes('ColorGrade*')&&message.includes('不完整')));assert.equal(hash(path),before);
    references.push({label,sha256:before,version:lookup(properties,CRS,'Version')?.value,colorGrading:expected});
  }
  if(references.length)pass('real local Adobe settings and preset grading match their fourteen stored fields without altering the originals');

  const current=join(work,'current.tiff'),after=join(work,'migrated.tiff');
  await engine.call('export',{path:source,artProfile:applied.artProfile,format:'tiff',output:current});await engine.call('export',{path:source,artProfile:restored.artProfile,format:'tiff',output:after});
  let reference;
  if(process.env.CAPTRAW_GRADING_REFERENCE_ENGINE){
    reference=join(work,'reference.tiff');const oldEngine=new EngineClient({executable:process.env.CAPTRAW_GRADING_REFERENCE_ENGINE,resources:process.env.CAPTRAW_GRADING_REFERENCE_RESOURCES,cache:join(work,'reference-cache')});
    try{await oldEngine.call('export',{path:source,artProfile:old.artProfile,format:'tiff',output:reference});}finally{await oldEngine.stop();}
  }
  tiffPixels=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np,json,sys
images=[tifffile.imread(p) for p in sys.argv[1:]]
assert all(a.dtype==np.uint16 and np.array_equal(images[0],a) for a in images)
with tifffile.TiffFile(sys.argv[1]) as t:
 icc=t.pages[0].tags[34675].value
 assert len(icc)>0
print(json.dumps(dict(shape=list(images[0].shape),bitsPerSample=16,maximumDifference=0,iccBytes=len(icc),comparedFiles=len(images))))`,current,after,...(reference?[reference]:[])],{encoding:'utf8'}));
  pass('canonical, migrated and optional previous-installed-core TIFF16 pixels remain identical with ICC');
  assert.equal(hash(source),sourceHash);assert.equal(readFileSync(input,'utf8'),adobeGradingFixture);success=true;
}catch(error){console.error(error);throw error;}
finally{
  await engine.stop();writeFileSync(join(out,'report.json'),JSON.stringify({checks,success,sourceHash,references,tiffPixels,...(!success?{work}:{})},null,2)+'\n');
  if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure workspace:',work);
}
