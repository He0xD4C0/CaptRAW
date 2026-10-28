import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP,CRS,lookup,decodeAdobeMaskGroups} from '@captraw/desktop-core/xmp';
import {EngineClient} from './engine-client.mjs';
import {adobeMaskFixture as fixture} from './xmp-test.mjs';

const out=resolve(process.env.CAPTRAW_XMP_MASK_IMPORT_OUT||'artifacts/xmp-mask-import');
const source=resolve('build/samples/synthetic.dng');
const xmpBinary=resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp');
mkdirSync(out,{recursive:true});
assert(existsSync(source),'Build the synthetic RAW fixture first');
assert(existsSync(xmpBinary),'Build captraw-xmp first');
const work=mkdtempSync(join(out,'run-'));
let success=false,adobeReference;

const input=join(work,'adobe-masks.xmp');
writeFileSync(input,fixture);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceSHA256=hash(input),documents=new Documents(new XMP(xmpBinary)),checks=[];
const pass=message=>{checks.push(message);console.log('PASS',message);};
const engine=new EngineClient({cache:join(work,'cache')});
try{
  const imported=await documents.read(input);
  assert.equal(imported.adjustments.masks.length,4);
  const [linear,radial,luminance,brush]=imported.adjustments.masks;
  assert.deepEqual({type:linear.type,brightness:linear.brightness,contrast:linear.contrast,saturation:linear.saturation,start:linear.start,end:linear.end},
    {type:'linear',brightness:2,contrast:20,saturation:-25,start:{x:.5,y:1},end:{x:.5,y:0}});
  assert.equal(radial.type,'radial');
  assert.deepEqual(radial.tone,{highlights:-20,shadows:0,whites:0,blacks:0});
  assert.deepEqual(radial.whiteBalance,{temperature:10,tint:0});
  assert.equal(radial.components?.[0].inverted,false);
  assert.deepEqual({start:radial.start,end:radial.end,feather:radial.feather},{start:{x:.2,y:.1},end:{x:.9,y:.8},feather:40});
  assert.equal(luminance.type,'luminance');
  assert.deepEqual(luminance.components?.[0].luminanceRange,[60,85,100,100]);
  assert.deepEqual(luminance.details,{hue:0,texture:0,clarity:-30,noise:40,noiseDetail:50});
  assert.equal(brush.type,'brush');
  assert.equal(brush.brightness,.6);
  assert.deepEqual(brush.components?.[0].points,[{x:.3,y:.4,radius:.08,erase:false},{x:.6,y:.7,radius:.12,erase:false}]);
  assert.deepEqual(brush.components?.map(component=>component.operation),['add','subtract']);
  assert(imported.warnings.some(message=>message.includes('AI 蒙版')&&message.includes('MaskSubType=2')));
  pass('ACR linear, radial, luminance and RDF-array brush masks import with per-dab radii and local adjustments');
  assert(!imported.adjustments.masks.some(mask=>mask.id==='adobe-INCOMPLETE'));
  assert(imported.warnings.some(message=>message.includes('Person minus gradient')&&message.includes('整组未应用')));
  pass('an unreadable AI base plus a subtracting gradient never becomes an unrelated additive mask');

  const image=await engine.call('open',{path:source,sessionId:'mask-import'});
  const neutralPreview=engine.preview(1);await engine.call('update',{revision:1,adjustments:image.adjustments,artProfile:image.artProfile});const neutral=await neutralPreview;
  const adjustments={...image.adjustments,...imported.adjustments,masks:imported.adjustments.masks};
  const changedPreview=engine.preview(2);const applied=await engine.call('update',{revision:2,adjustments,artProfile:image.artProfile});const changed=await changedPreview;
  assert.notEqual(hash(neutral.file),hash(changed.file));
  assert(applied.artProfile);
  pass('imported ACR masks drive the ART core and change real preview pixels');
  const linearPreview=engine.preview(3);await engine.call('update',{revision:3,adjustments:{...image.adjustments,masks:[linear]},artProfile:image.artProfile});const linearFrame=await linearPreview;
  const radialPreview=engine.preview(4);await engine.call('update',{revision:4,adjustments:{...image.adjustments,masks:[radial]},artProfile:image.artProfile,maskId:radial.id});const radialFrame=await radialPreview;
  const radialCoverage=join(work,'radial-coverage.png');copyFileSync(radialFrame.mask.file,radialCoverage);
  execFileSync(resolve('build/qa-venv/bin/python'),['-c',`from PIL import Image
import numpy as np
neutral=np.asarray(Image.open(${JSON.stringify(neutral.file)}).convert('RGB'),dtype=np.float32)
linear=np.asarray(Image.open(${JSON.stringify(linearFrame.file)}).convert('RGB'),dtype=np.float32)
delta=np.abs(linear-neutral).mean(axis=2);h=delta.shape[0]
assert delta[-max(1,h//5):].mean()>delta[:max(1,h//5)].mean()+1
coverage=np.asarray(Image.open(${JSON.stringify(radialCoverage)}))[...,3]
height,width=coverage.shape
center=float(coverage[int(height*.45),int(width*.55)]);corner=float(coverage[int(height*.95),int(width*.95)])
assert center>corner+100,(center,corner)
`]);
  pass('linear full/zero direction and inside-flipped radial coverage match Adobe mask semantics');

  const document={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:statSync(source).size,sha256:createHash('sha256').update(readFileSync(source)).digest('hex')},adjustments,artProfile:applied.artProfile,xmpPacket:imported.xmpPacket};
  const saved=join(work,'captraw-roundtrip.xmp');writeFileSync(saved,await documents.serialize(document));
  const restored=await documents.read(saved);
  assert.deepEqual(restored.adjustments.masks,imported.adjustments.masks);
  assert(readFileSync(saved,'utf8').includes('MaskGroupBasedCorrections'));
  assert(restored.warnings.some(message=>message.includes('私有蒙版')&&message.includes('Adobe MaskGroupBasedCorrections')));
  pass('supported Adobe masks persist as editable CaptRAW masks while the original ACR structure remains preserved');

  const emptyAdjustments={...adjustments,masks:[]};
  const emptyProfile=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments:emptyAdjustments,artProfile:applied.artProfile});
  const emptyPath=join(work,'deleted-masks.xmp');writeFileSync(emptyPath,await documents.serialize({...document,adjustments:emptyAdjustments,artProfile:emptyProfile.artProfile}));
  const empty=await documents.read(emptyPath);assert.deepEqual(empty.adjustments.masks,[]);
  assert(readFileSync(emptyPath,'utf8').includes('MaskGroupBasedCorrections'));
  const emptyPreview=engine.preview(5);await engine.call('update',{revision:5,adjustments:empty.adjustments,artProfile:empty.artProfile});const emptyFrame=await emptyPreview;
  assert.equal(hash(emptyFrame.file),hash(neutral.file));
  pass('deleting every mask survives XMP reopening and restores neutral pixels while preserving the Adobe structure');

  const inactivePath=join(work,'inactive.xmp');writeFileSync(inactivePath,fixture.replace('<crs:CorrectionActive>true','<crs:CorrectionActive>false').replace('<crs:MaskActive>true','<crs:MaskActive>false'));
  const inactive=await documents.read(inactivePath);assert.equal(inactive.adjustments.masks.length,4);
  assert.equal(inactive.adjustments.masks[0].enabled,false);assert.equal(inactive.adjustments.masks[0].components[0].enabled,false);
  pass('inactive Adobe groups and supported components remain editable with their original disabled state');

  const invalidMode=join(work,'invalid-mode.xmp');writeFileSync(invalidMode,fixture.replace('<crs:MaskBlendMode>0','<crs:MaskBlendMode>9'));
  await assert.rejects(documents.read(invalidMode),/MaskBlendMode=9/);
  pass('unknown component blend modes fail explicitly instead of silently changing the selection');

  const unknownDab=join(work,'unknown-dab.xmp');writeFileSync(unknownDab,fixture.replace('d 0.6 0.7','p 0.6 0.7'));
  const partialBrush=await documents.read(unknownDab);assert.equal(partialBrush.adjustments.masks.length,3);
  assert(!partialBrush.adjustments.masks.some(mask=>mask.name==='Brush'));
  assert(partialBrush.warnings.some(message=>message.includes('Dabs 指令')));
  pass('unknown brush commands reject the complete group rather than dropping stroke data');

  if(process.env.CAPTRAW_ADOBE_MASK_REFERENCE){
    const path=resolve(process.env.CAPTRAW_ADOBE_MASK_REFERENCE),before=hash(path),result=await documents.xmp.read(path),node=lookup(result.properties,CRS,'MaskGroupBasedCorrections'),warnings=[];
    const importedReference=decodeAdobeMaskGroups(node,warnings),field=(node,name)=>node.fields?.find(p=>p.ns===CRS&&p.name===name)?.node;
    const blocked=node.items.filter(group=>field(group,'CorrectionMasks')?.items?.some(mask=>field(mask,'What')?.value==='Mask/Image'));
    assert(blocked.length>0,'The real reference must contain an AI mask group');
    for(const group of blocked)assert(!importedReference.some(mask=>mask.name===field(group,'CorrectionName')?.value));
    assert(importedReference.length>0,'The reference must also retain a fully supported group');
    assert.equal(hash(path),before);
    adobeReference={sha256:before,version:lookup(result.properties,CRS,'Version')?.value,groups:node.items.length,imported:importedReference.length,blockedAIGroups:blocked.length};
    pass('a real local ACR settings XMP preserves supported groups and excludes every unreadable AI composition without altering the source');
  }

  const invalid=join(work,'invalid-range.xmp');writeFileSync(invalid,fixture.replace('0.6 0.85 1 1','0.9 0.4 1 1'));
  await assert.rejects(documents.read(invalid),/亮度范围蒙版无效/);
  pass('invalid Adobe luminance ranges fail explicitly');

  assert.equal(hash(input),sourceSHA256);
  pass('the imported Adobe XMP packet remains byte-for-byte unchanged');
  writeFileSync(join(out,'report.json'),JSON.stringify({checks,sourceSHA256,adobeReference,masks:imported.adjustments.masks,warnings:imported.warnings,previewSHA256:{neutral:hash(neutral.file),combined:hash(changed.file),linear:hash(linearFrame.file),radialMask:hash(radialFrame.mask.file)}},null,2)+'\n');
  success=true;
}catch(error){
  writeFileSync(join(out,'report.json'),JSON.stringify({checks,success:false,error:String(error),work},null,2)+'\n');
  throw error;
}finally{
  await engine.stop();
  if(success)rmSync(work,{recursive:true,force:true});
  else console.error('Failure workspace:',work);
}
