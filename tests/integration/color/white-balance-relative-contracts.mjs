// Explicit component checks after the WB implementation window opens.
// No private assets, SDK process, native engine or generated fixture is required.
// Run against the rebuilt workspace: node --test tests/integration/color/white-balance-relative-contracts.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {hasRelativeWhiteBalance,validateWhiteBalanceTarget,mergeAdjustmentPatch} from '@captraw/contracts';
import {adjustmentCommand,applyEditCommand,synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {capturePreset,presetAmount,presetValidationBase,isoAnchors,canCreateISO} from '@captraw/contracts/presets';
import {CRS,property,text,lookup,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/xmp';

const relative=(temperature=0,tint=0)=>({incrementalTemperature:temperature,incrementalTint:tint,relativeWBModel:'art-ctl-v1'});
const baseline=()=>({...structuredClone(presetValidationBase),wbMode:'custom',wbMultipliers:null,wbApproximate:false});
const doc=(inputKind,adjustments,path='/controlled')=>({image:{inputKind,path,name:'controlled',width:192,height:128},adjustments,profile:''});

test('rendered offsets serialize using standard Incremental properties without camera Kelvin',()=>{
 // Independently authored values matching the four observed ACR JPEG controls.
 for(const [temperature,tint] of [[0,0],[25,0],[0,-15],[25,-15]]){
  const adjustments={...baseline(),...relative(temperature,tint)},properties=encodeAdjustments(adjustments);
  assert.equal(lookup(properties,CRS,'IncrementalTemperature').value,String(temperature));
  assert.equal(lookup(properties,CRS,'IncrementalTint').value,String(tint));
  assert.equal(lookup(properties,CRS,'Temperature'),undefined);
  assert.equal(lookup(properties,CRS,'Tint'),undefined);
  const decoded=decodeAdjustments(properties).adjustments;
  for(const [key,value] of Object.entries(relative(temperature,tint)))assert.equal(decoded[key],value,key);
 }
});

test('an external sparse relative edit preserves the other target offset',()=>{
 const fields=[property(CRS,'WhiteBalance',text('Custom')),property(CRS,'IncrementalTemperature',text('+25'))];
 const before=structuredClone(fields),decoded=decodeAdjustments(fields).adjustments;
 assert.equal(decoded.incrementalTemperature,25);assert.equal(decoded.incrementalTint,undefined);
 const merged=mergeAdjustmentPatch({...baseline(),...relative(-12,-17)},decoded);
 assert.equal(merged.incrementalTemperature,25);assert.equal(merged.incrementalTint,-17);
 assert.deepEqual(fields,before);
});

test('relative units reject invalid bounds and ambiguous absolute-plus-relative input',()=>{
 for(const key of ['incrementalTemperature','incrementalTint'])for(const value of [-101,101,.5,NaN,Infinity]){
  assert.throws(()=>encodeAdjustments({...relative(),[key]:value}));
 }
 for(const name of ['IncrementalTemperature','IncrementalTint'])for(const value of ['','0.5','101','NaN','Infinity']){
  assert.throws(()=>decodeAdjustments([property(CRS,name,text(value))]));
 }
 assert.throws(()=>decodeAdjustments([property(CRS,'Temperature',text(6500)),property(CRS,'IncrementalTemperature',text(25))]));
});

test('manual relative changes retain one reversible command and unchanged absolute fields',()=>{
 const before={...baseline(),...relative(7,-19)},after={...before,incrementalTemperature:25};
 const command=adjustmentCommand(before,after,'relative-temperature');
 assert.deepEqual(command.set,{incrementalTemperature:25});
 assert.deepEqual(applyEditCommand(before,command),after);
 assert.deepEqual(applyEditCommand(after,adjustmentCommand(after,before,'undo-relative')),before);
 assert.equal(after.temperature,before.temperature);assert.equal(after.tint,before.tint);
});

test('fixed Kelvin and rendered offsets cannot cross input spaces through synchronization',()=>{
 for(const inputKind of ['mosaic-raw','linear-raw']){
  assert.doesNotThrow(()=>validateWhiteBalanceTarget({temperature:6500,tint:20},inputKind));
  assert.throws(()=>validateWhiteBalanceTarget(relative(25,-15),inputKind),/相对|RAW/);
 }
 assert.doesNotThrow(()=>validateWhiteBalanceTarget(relative(25,-15),'rendered'));
 assert.throws(()=>validateWhiteBalanceTarget({temperature:6500,tint:20},'rendered'),/绝对|相对/);
 const source=doc('rendered',{...baseline(),...relative(25,-15)},'/source'),target=doc('rendered',{...baseline(),...relative(-5,12)},'/target');
 const frozen=structuredClone([source,target]),result=synchronizedAdjustments(source,target,['whiteBalance']);
 assert.equal(result.incrementalTemperature,25);assert.equal(result.incrementalTint,-15);
 assert.deepEqual([source,target],frozen);
 assert.throws(()=>synchronizedAdjustments(source,doc('mosaic-raw',baseline()),['whiteBalance']),/相对|RAW/);
});

test('relative preset capture excludes Kelvin and holds unverified amount scaling fixed',()=>{
 const input={...baseline(),...relative(25,-15)},preset=capturePreset({name:'相对白平衡',group:'验证',groups:['whiteBalance'],adjustments:input});
 assert(hasRelativeWhiteBalance(preset.adjustments));
 assert.equal(preset.adjustments.temperature,undefined);assert.equal(preset.adjustments.tint,undefined);
 assert.equal(preset.adjustments.incrementalTemperature,25);assert.equal(preset.adjustments.incrementalTint,-15);
 const scaled=presetAmount(preset.adjustments,50);
 assert.deepEqual(scaled.adjustments,preset.adjustments);assert(scaled.warnings.some(w=>w.includes('固定')));
 assert.equal(input.temperature,6500);assert.equal(input.tint,0);
});

test('ISO eligibility uses decoded input kinds with no extension or missing-kind fallback',()=>{
 const image=(inputKind,iso,path)=>({inputKind,iso,path,name:'controlled'});
 const first=image('mosaic-raw',400,'camera.supported-other-extension'),second=image('linear-raw',1600,'linear.jpg');
 assert(canCreateISO([first,second]));
 const docs=[first,second].map(image=>({image,adjustments:baseline(),profile:''}));
 assert.equal(isoAnchors(docs,['light']).length,2);
 for(const bad of [image('rendered',800,'pretend.nef'),image(undefined,800,'unknown.nef'),image('mosaic-raw',0,'real.raw'),image('linear-raw',NaN,'linear.dng')]){
  assert.equal(canCreateISO([first,bad]),false);
  assert.throws(()=>isoAnchors([docs[0],{image:bad,adjustments:baseline(),profile:''}],['light']),/RAW|ISO/);
 }
 assert.equal(canCreateISO([first,{...second,iso:400}]),false);
 assert.throws(()=>isoAnchors([docs[0],{...docs[1],image:{...second,iso:400},adjustments:{...baseline(),exposure:1}}],['light']),/冲突/);
});
