import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {patchColorGrading} from '../../../native/patches/patch-art.mjs';

// Compile into an isolated test directory; never overwrite a concurrent UI build.
test('shadow calibration: source contract, sparse XMP, commands and preset selection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'captraw-shadow-source-'));let passed=false;
 try{
  const alias=Object.fromEntries(['','/synchronize','/presets','/export-options'].map(s=>['@captraw/contracts'+s,resolve('packages/contracts/'+(s?s.slice(1):'index')+'.ts')]));
  const file=join(root,'source.mjs');await build({stdin:{resolveDir:process.cwd(),contents:`export * from '../../../packages/contracts/index.ts';export * from '../../../packages/contracts/synchronize.ts';export * from '../../../packages/contracts/presets.ts';export * from '../../../packages/desktop-core/src/documents/xmp.ts';`},bundle:true,platform:'node',format:'esm',outfile:file,alias});
  const m=await import(pathToFileURL(file));
  for(const value of [-100,-1,0,1,100]){
   const patch={calibration:{shadowTint:value}},properties=m.encodeAdjustments(patch);
   assert.equal(m.lookup(properties,m.CRS,'ShadowTint').value,String(value));
   assert.deepEqual(m.decodeAdjustments(properties).adjustments,patch);
   assert(!properties.some(p=>p.ns===m.CRS&&/^(Red|Green|Blue)/.test(p.name)));
  }
  for(const value of [-101,101,.5,NaN,Infinity])assert.throws(()=>m.encodeAdjustments({calibration:{shadowTint:value}}),/ShadowTint/);
  for(const value of ['', '0.5','101'])assert.throws(()=>m.decodeAdjustments([m.property(m.CRS,'ShadowTint',m.text(value))]),/ShadowTint/);
  const base={...structuredClone(m.presetValidationBase),calibration:{shadowTint:-12,redHue:9,blueSaturation:8}},next={...base,calibration:{...base.calibration,shadowTint:25}};
  const command=m.adjustmentCommand(base,next,'shadow');assert.deepEqual(command.set,{calibration:{shadowTint:25}});assert.deepEqual(m.applyEditCommand(base,command),next);assert.equal(base.calibration.shadowTint,-12);
  assert.deepEqual(m.applyEditCommand(next,m.adjustmentCommand(next,base,'undo')),base);
  assert.deepEqual(m.mergeAdjustmentPatch(base,{calibration:{redHue:17}}).calibration,{...base.calibration,redHue:17});
  assert.deepEqual(m.partialAdjustmentGroups({calibration:{shadowTint:25}}),['calibration']);
  const preset=m.capturePreset({name:'阴影',group:'验证',groups:['calibration'],adjustments:next});assert.deepEqual(preset.adjustments,{calibration:next.calibration});
  assert(m.presetAmount(preset.adjustments,50).warnings.some(w=>w.includes('calibration')));
  // Actual locally retained 18.7 output, not a manufactured Adobe fixture.
  const reference=await readFile('artifacts/stage-0/acr-reference/cases/canon-r5-neutral.xmp','utf8');assert.match(reference,/crs:ShadowTint="0"/);
  const xmp=new m.XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'));
  const input=(await xmp.call('read',reference)).properties,changed=await xmp.call('write',reference,m.encodeAdjustments({calibration:{shadowTint:31}},input));
  assert.equal(m.decodeAdjustments(changed.properties).adjustments.calibration.shadowTint,31);
  const unknown=m.property('urn:calibration-test','Opaque',{fields:[m.property('urn:calibration-test','Nested',m.text('keep'))]});
  const packet=await xmp.call('write',changed.packet,[unknown]),again=await xmp.call('write',packet.packet,m.encodeAdjustments({calibration:{shadowTint:-31}},packet.properties));
  assert.deepEqual(m.lookup(again.properties,unknown.ns,unknown.name),m.lookup(packet.properties,unknown.ns,unknown.name));
  assert.equal(m.lookup(again.properties,m.CRS,'ShadowTint').value,'-31');
  const removed=await xmp.call('write',again.packet,m.encodeAdjustments({},again.properties));assert.equal(m.lookup(removed.properties,m.CRS,'ShadowTint'),undefined);
  assert.deepEqual(m.lookup(removed.properties,unknown.ns,unknown.name),m.lookup(packet.properties,unknown.ns,unknown.name));
  passed=true;
 }finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained shadow source test:',root);}
});

test('ART shadow calibration patch is complete, idempotent and neutral-bypassed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'captraw-shadow-patch-'));let passed=false;
 try{
  const upstream=resolve('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b');
  const files=['engine/procparams.h','engine/procparams.cc','engine/improcfun.h','engine/improcfun.cc','gui/paramsedited.h','gui/paramsedited.cc'];
  for(const name of files){await mkdir(join(root,'src',name.split('/')[0]),{recursive:true});await copyFile(join(upstream,'src',name),join(root,'src',name));}
  patchColorGrading(root);const before=await Promise.all(files.map(f=>readFile(join(root,'src',f),'utf8')));patchColorGrading(root);assert.deepEqual(await Promise.all(files.map(f=>readFile(join(root,'src',f),'utf8'))),before);
  assert.match(before[0],/int captrawShadowTint = 0;/);assert.match(before[1],/captrawShadowTint != other.captrawShadowTint/);
  assert.match(before[1],/if \(chmixer.captrawShadowTint != 0\)\s+saveToKeyfile/);assert.match(before[1],/Invalid stored shadow tint/);
  assert.match(before[3],/STEP_\(captrawCalibration, params->chmixer.captrawShadowTint == 0\)/);
  const native=await readFile('native/src/grading.cc','utf8'),body=native.slice(native.indexOf('void ImProcFunctions::captrawCalibration'),native.indexOf('void ImProcFunctions::captrawColorGrading'));
  assert(body.indexOf('if(!amount)return;')<body.indexOf('setMode'));assert.match(body,/Color::yuv2rgb\(0.f,-chroma,chroma/);assert.match(native,/958935312489710b17dc4792d0677bdacf43a95c/);
  passed=true;
 }finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained shadow patch test:',root);}
});
