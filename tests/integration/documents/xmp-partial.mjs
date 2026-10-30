import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {ENGINE_VERSION,mergeAdjustmentPatch,partialAdjustmentGroups} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {XMP,CRS,lookup,property,text} from '@captraw/desktop-core/xmp';
import {EngineClient} from '../../support/engine-client.mjs';
import {adobePartialFields,adobePartialFixture,partialTargetSettings} from '../../support/xmp-test.mjs';

const out=resolve(process.env.CAPTRAW_XMP_PARTIAL_OUT||'artifacts/xmp-partial');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),source=resolve('build/samples/synthetic.dng'),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),sourceHash=hash(source);
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),engine=new EngineClient({cache:join(work,'core')});
const sync=new Synchronizer(resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),join(work,'sync'),()=>{}),store=new Presets(join(work,'library'),engine,join(work,'assets'),xmp);
const checks=[],references=[],pass=message=>{checks.push(message);console.log('PASS',message);};let success=false,tiffPixels;
const packet=fields=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="${CRS}" ${Object.entries(fields).map(([key,value])=>`crs:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
try{
  assert.equal((await engine.ready).engineVersion,ENGINE_VERSION);
  const input=join(work,'partial.xmp');writeFileSync(input,adobePartialFixture);const imported=await documents.read(input);
  assert.deepEqual(imported.adjustments,{parametricCurve:{highlights:18,splits:{0:40}},hsl:{hue:{3:27},luminance:{5:-16}},colorGrading:{midtones:{saturation:37},global:{luminance:-9}},calibration:{redHue:-14}});
  const preset=await store.importFile(input),exported=join(work,'exported.xmp');await store.exportFile(preset.id,exported);
  const exportedProperties=(await xmp.read(exported)).properties;
  for(const [name,value] of Object.entries(adobePartialFields))assert.equal(Number(lookup(exportedProperties,CRS,name).value),value);
  for(const name of ['HueAdjustmentRed','ParametricDarks','ParametricMidtoneSplit','ColorGradeBlending','SplitToningBalance','GreenHue'])assert.equal(lookup(exportedProperties,CRS,name),undefined);
  assert.equal(lookup(exportedProperties,'https://example.invalid/partial/','Opaque').value,'keep');
  pass('sparse HSL, parametric, modern grading and calibration preset import/export never manufactures unspecified fields');

  const image=await engine.call('open',{path:source,sessionId:'partial'}),base={...image.adjustments,...structuredClone(partialTargetSettings),exposure:1.1};
  const profile=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments:base,artProfile:image.artProfile}),target={image,adjustments:base,profile:profile.artProfile},before=JSON.stringify(target);
  const expected=structuredClone(base);expected.hsl.hue[3]=27;expected.hsl.luminance[5]=-16;expected.parametricCurve.highlights=18;expected.parametricCurve.splits[0]=40;expected.colorGrading.midtones.saturation=37;expected.colorGrading.global.luminance=-9;expected.calibration.redHue=-14;
  const applied=(await store.apply(preset.id,target,sync))[0];assert.deepEqual(applied.adjustments,expected);assert.equal(JSON.stringify(target),before);
  pass('applying a sparse preset changes exactly seven controls and retains every other edited value');

  const projected=await engine.call('adjustmentBase',{artProfile:target.profile,groups:['hsl','parametricCurve','colorGrading','calibration']});
  for(const key of ['hsl','parametricCurve','colorGrading','calibration'])assert.deepEqual(projected[key],base[key]);
  const sourceInfo={path:source,size:statSync(source).size,sha256:sourceHash},doc={engineVersion:ENGINE_VERSION,source:sourceInfo,baselineVersion:4,artProfile:target.profile,adjustments:base};
  const wholePacket=await documents.serialize(doc),properties=(await xmp.call('read',wholePacket)).properties;
  const grouped=properties.filter(p=>p.ns===CRS&&(/^(?:Hue|Saturation|Luminance)Adjustment/.test(p.name)||/^(?:Parametric|ColorGrade|SplitToning)/.test(p.name)||/^(?:Red|Green|Blue)(?:Hue|Saturation)$/.test(p.name)));
  const sparseDoc=join(work,'sparse-document.xmp');writeFileSync(sparseDoc,(await xmp.call('write',wholePacket,[...grouped.map(p=>property(CRS,p.name,null)),...Object.entries(adobePartialFields).map(([name,value])=>property(CRS,name,text(value)))])).packet);
  const loaded=await documents.read(sparseDoc),groups=partialAdjustmentGroups(loaded.adjustments),inherited=await engine.call('adjustmentBase',{artProfile:loaded.artProfile,groups});
  const hydrated=mergeAdjustmentPatch({...image.adjustments,...inherited},loaded.adjustments);
  for(const key of ['hsl','parametricCurve','colorGrading','calibration','exposure'])assert.deepEqual(hydrated[key],expected[key]);
  pass('native parameter projection supplies the real stored base for sparse documents instead of fresh defaults');

  const noncanonical=target.profile.replace(/(\[HSL Equalizer\][^\[]*\nHCurve=)[^\n]*/,(_match,prefix)=>prefix+'1;0;0.5;0;0;0.5;0.7;0;0;');
  assert.notEqual(noncanonical,target.profile);await assert.rejects(engine.call('adjustmentBase',{artProfile:noncanonical,groups:['hsl']}),/无法无损投影/);
  const otherMixer=target.profile.replace(/(\[Channel Mixer\][^\[]*\nMode=)\d+/,(_match,prefix)=>prefix+'0');
  assert.notEqual(otherMixer,target.profile);await assert.rejects(engine.call('adjustmentBase',{artProfile:otherMixer,groups:['calibration']}),/无法无损投影/);
  pass('noncanonical HSL and a different enabled channel-mixer mode reject sparse hydration instead of changing the stored look');

  const saved=join(work,'resolved-document.xmp');writeFileSync(saved,await documents.serialize({...doc,artProfile:applied.profile,adjustments:applied.adjustments}));
  const restored=await documents.read(saved);for(const key of ['hsl','parametricCurve','colorGrading','calibration','exposure'])assert.deepEqual(restored.adjustments[key],expected[key]);
  pass('resolved edits save as complete standard fields and restore every untouched value');

  const split=join(work,'split-only.xmp');writeFileSync(split,packet({ParametricShadowSplit:60}));const splitPreset=await store.importFile(split),splitExport=join(work,'split-export.xmp');await store.exportFile(splitPreset.id,splitExport);
  assert.equal(lookup((await xmp.read(splitExport)).properties,CRS,'ParametricMidtoneSplit'),undefined);
  await assert.rejects(store.apply(splitPreset.id,target,sync),/splits|分界/);assert.equal(JSON.stringify(target),before);
  const compatible=structuredClone(target);compatible.adjustments.parametricCurve.splits=[21,74,90];compatible.profile=(await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments:compatible.adjustments,artProfile:profile.artProfile})).artProfile;
  const compatibleResult=(await store.apply(splitPreset.id,compatible,sync))[0];assert.deepEqual(compatibleResult.adjustments.parametricCurve,{...compatible.adjustments.parametricCurve,splits:[60,74,90]});
  pass('split-only presets import independently, reject conflicting targets atomically and apply to compatible targets');

  const classic=join(work,'classic.xmp');writeFileSync(classic,packet({SplitToningShadowHue:225,SplitToningShadowSaturation:17,SplitToningHighlightHue:45,SplitToningHighlightSaturation:25,SplitToningBalance:12}));
  const classicPreset=await store.importFile(classic),classicResult=(await store.apply(classicPreset.id,target,sync))[0];
  assert.deepEqual(classicResult.adjustments.colorGrading,{shadows:{hue:225,saturation:17,luminance:0},midtones:{hue:0,saturation:0,luminance:0},highlights:{hue:45,saturation:25,luminance:0},global:{hue:0,saturation:0,luminance:0},blending:100,balance:12});
  assert.deepEqual(classicResult.adjustments.hsl,base.hsl);assert.deepEqual(classicResult.adjustments.parametricCurve,base.parametricCurve);assert.equal(classicResult.adjustments.exposure,1.1);
  pass('complete legacy Split Toning applies the documented blend-100/reset rule without resetting unrelated groups');

  for(const [variable,label] of [['CAPTRAW_ADOBE_PARTIAL_HSL','partial HSL'],['CAPTRAW_ADOBE_PARTIAL_CURVE','partial curve'],['CAPTRAW_ADOBE_CLASSIC_TONING','legacy toning']])if(process.env[variable]){
    const path=resolve(process.env[variable]),before=hash(path),read=await documents.read(path),properties=(await xmp.read(path)).properties;
    if(label==='partial HSL'){assert(read.adjustments.hsl);assert(partialAdjustmentGroups(read.adjustments).includes('hsl'));}
    if(label==='partial curve'){assert.deepEqual(read.adjustments.parametricCurve,{splits:{2:Number(lookup(properties,CRS,'ParametricHighlightSplit').value)}});}
    if(label==='legacy toning'){assert.equal(read.adjustments.colorGrading.blending,100);assert.equal(read.adjustments.colorGrading.midtones.saturation,0);assert(read.warnings.some(message=>message.includes('旧式分离色调')));}
    assert.equal(hash(path),before);references.push({label,sha256:before,version:lookup(properties,CRS,'Version')?.value});
  }
  if(references.length)pass('real local Adobe sparse HSL, one-split and legacy toning presets are recognized without modifying their files');

  const authored=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments:expected,artProfile:target.profile}),hydratedProfile=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments:hydrated,artProfile:loaded.artProfile});
  const paths=[join(work,'preset.tiff'),join(work,'authored.tiff'),join(work,'hydrated.tiff')];
  for(const [i,artProfile] of [applied.profile,authored.artProfile,hydratedProfile.artProfile].entries())await engine.call('export',{path:source,artProfile,format:'tiff',output:paths[i]});
  if(process.env.CAPTRAW_PARTIAL_REFERENCE_ENGINE){const old=new EngineClient({executable:process.env.CAPTRAW_PARTIAL_REFERENCE_ENGINE,resources:process.env.CAPTRAW_PARTIAL_REFERENCE_RESOURCES,cache:join(work,'reference-cache')});const file=join(work,'previous.tiff');try{await old.call('export',{path:source,artProfile:authored.artProfile,format:'tiff',output:file});paths.push(file);}finally{await old.stop();}}
  tiffPixels=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np,sys,json
images=[tifffile.imread(p) for p in sys.argv[1:]]
assert all(image.dtype==np.uint16 and np.array_equal(images[0],image) for image in images)
with tifffile.TiffFile(sys.argv[1]) as t:icc=t.pages[0].tags[34675].value
assert len(icc)>0
print(json.dumps(dict(shape=list(images[0].shape),maximumDifference=0,bitsPerSample=16,iccBytes=len(icc),comparedFiles=len(images))))`,...paths],{encoding:'utf8'}));
  pass('sparse preset, explicitly authored, profile-hydrated and previous-core TIFF16 outputs are pixel-identical');
  assert.equal(hash(source),sourceHash);assert.equal(readFileSync(input,'utf8'),adobePartialFixture);success=true;
}finally{
  await engine.stop();writeFileSync(join(out,'report.json'),JSON.stringify({checks,success,references,sourceHash,tiffPixels,...(!success?{work}:{})},null,2)+'\n');
  if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure workspace:',work);
}
