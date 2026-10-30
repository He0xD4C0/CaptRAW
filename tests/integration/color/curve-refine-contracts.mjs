// Run only after the parent rebuilds desktop-core/contracts dist and the SDK.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {POINT_CURVE_PRESETS,validateCurveRefine,ENGINE_VERSION} from '@captraw/contracts';
import {adjustmentCommand,applyEditCommand,synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {capturePreset,presetAmount} from '@captraw/contracts/presets';
import {XMP,CRS,CT,property,text,lookup,readExtension,encode,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
const work=mkdtempSync(join(tmpdir(),'captraw-curve-refine-contracts-')),xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),checks=[];
const ns='https://example.com/refine-fixture/1.0/',base={exposure:0,temperature:6500,tint:0,contrast:25,saturation:0,vibrance:0,curve:structuredClone(POINT_CURVE_PRESETS['Medium Contrast']),curveName:'Medium Contrast',redCurve:[{x:0,y:0},{x:.375,y:.5625},{x:1,y:1}],greenCurve:structuredClone(POINT_CURVE_PRESETS.Linear),blueCurve:structuredClone(POINT_CURVE_PRESETS.Linear),rotation:0,crop:null,masks:[]};
const current={...base,curveRefineModel:'weighted-std-v1',curveRefineSaturation:50},record=(a,packet)=>({source:{path:'fixture.tif',size:1,sha256:'0'.repeat(64)},artProfile:'',adjustments:a,xmpPacket:packet}),pass=s=>{checks.push(s);console.log('PASS',s);};let passed=false;
try{
 const external=(await xmp.call('write','',[
  property(CRS,'CurveRefineSaturation',{...text('100'),qualifiers:[property(ns,'note',text('keep while updating'))]}),
  property(CT,'FutureCurve',text('unknown owned-namespace sibling')),
 ])).packet;
 const original=(await xmp.call('read',external)).properties,unknown=decodeAdjustments(original);
 assert.equal(unknown.adjustments.curveRefineModel,undefined);assert.equal(unknown.adjustments.curveRefineSaturation,undefined);
 const unchanged=await documents.serialize(record(base,external)),kept=(await xmp.call('read',unchanged)).properties;
 assert.deepEqual(lookup(kept,CRS,'CurveRefineSaturation'),lookup(original,CRS,'CurveRefineSaturation'));
 pass('unmarked qualified Adobe Refine is retained without activating processing');
 for(const version of [ENGINE_VERSION,'CaptRAW-27_ART-1.26.10_LibRaw-3b20539']){
  const properties=[...encodeAdjustments(base),...original,property(CT,'EngineVersion',encode(version))];
  const path=join(work,version.startsWith('CaptRAW-27')?'old27.xmp':'unmarked32.xmp');writeFileSync(path,(await xmp.call('write','',properties)).packet);
  const opened=await documents.readForImage(path);assert.equal(opened.engineVersion,version);assert.equal(opened.adjustments.curveRefineModel,undefined);assert.equal(opened.adjustments.curveRefineSaturation,undefined);
  const packet=await documents.serialize({...record({...base,...opened.adjustments},opened.xmpPacket),engineVersion:version});
  const saved=(await xmp.call('read',packet)).properties,restored=decodeAdjustments(saved).adjustments;
  assert.equal(restored.curveRefineModel,undefined);assert.equal(restored.curveRefineSaturation,undefined);assert.deepEqual(lookup(saved,CRS,'CurveRefineSaturation'),lookup(original,CRS,'CurveRefineSaturation'));
 }
 pass('existing32 unmarked and old27 documents stay inactive through read/save/reopen with opaque qualified Refine intact');
 const activated=await documents.serialize(record(current,external)),properties=(await xmp.call('read',activated)).properties,decoded=decodeAdjustments(properties);
 assert.equal(decoded.adjustments.curveRefineModel,'weighted-std-v1');assert.equal(decoded.adjustments.curveRefineSaturation,50);
 assert.equal(readExtension(properties,'ARTAdjustments').curveRefineModel,'weighted-std-v1');assert.equal(readExtension(properties,'ARTAdjustments').curveRefineSaturation,undefined);
 assert.deepEqual(lookup(properties,CRS,'CurveRefineSaturation').qualifiers,lookup(original,CRS,'CurveRefineSaturation').qualifiers);
 assert.deepEqual(decoded.adjustments.redCurve,base.redCurve);assert.equal(decoded.adjustments.curveName,base.curveName);
 pass('explicit model and standard amount roundtrip with qualifiers and other curve state intact');
 const removed=await documents.serialize(record(base,activated)),without=(await xmp.call('read',removed)).properties;
 assert.equal(lookup(without,CRS,'CurveRefineSaturation'),undefined);assert.equal(readExtension(without,'ARTAdjustments').curveRefineModel,undefined);
 assert.deepEqual(lookup(without,CT,'FutureCurve'),lookup(original,CT,'FutureCurve'));
 const redone=decodeAdjustments((await xmp.call('read',await documents.serialize(record(current,removed)))).properties);
 assert.equal(redone.adjustments.curveRefineSaturation,50);assert.equal(redone.adjustments.curveRefineModel,'weighted-std-v1');
 pass('Documents ownership removes model and qualified amount without resurrection; redo restores owned values');
 for(const patch of [{curveRefineModel:'future-v2',curveRefineSaturation:50},{curveRefineModel:'weighted-std-v1'},{curveRefineSaturation:50},{curveRefineModel:'weighted-std-v1',curveRefineSaturation:-1},{curveRefineModel:'weighted-std-v1',curveRefineSaturation:100.5}])assert.throws(()=>validateCurveRefine(patch));
 for(const [model,amount] of [['future-v2','50'],['weighted-std-v1','101'],['weighted-std-v1','NaN'],['weighted-std-v1','1.5'],['weighted-std-v1',null]]){
  const fields=[property(CT,'ARTAdjustments',encode({curveRefineModel:model})),...(amount===null?[]:[property(CRS,'CurveRefineSaturation',text(amount))])];assert.throws(()=>decodeAdjustments(fields));
 }
 const opaque=decodeAdjustments([property(CRS,'CurveRefineSaturation',text('future Adobe representation'))]);assert.equal(opaque.adjustments.curveRefineSaturation,undefined);
 pass('unknown owned models and invalid marked amounts reject; unknown external values stay opaque');
 const after={...current,curveRefineSaturation:75},command=adjustmentCommand(current,after,'amount-only');
 assert.equal(command.set.curveRefineModel,'weighted-std-v1');assert.equal(command.set.curveRefineSaturation,75);
 const target={...base,exposure:1,curve:structuredClone(POINT_CURVE_PRESETS['Strong Contrast'])},applied=applyEditCommand(target,command);
 assert.deepEqual(applied.curve,target.curve);assert.equal(applied.exposure,1);assert.equal(applied.curveRefineModel,'weighted-std-v1');
 const unset=adjustmentCommand(current,base,'remove');assert.equal(applyEditCommand(current,unset).curveRefineModel,undefined);
 const sync=synchronizedAdjustments({image:{},profile:'',adjustments:current},{image:{},profile:'',adjustments:target},['curves']);assert.equal(sync.curveRefineModel,'weighted-std-v1');assert.equal(sync.curveRefineSaturation,50);assert.equal(sync.exposure,1);
 pass('amount-only edit commands carry the marker atomically and curves synchronization preserves unrelated settings');
 const preset=capturePreset({name:'refine',group:'test',groups:['curves'],adjustments:current}),scaled=presetAmount(preset.adjustments,50).adjustments;
 assert.equal(preset.adjustments.curveRefineModel,'weighted-std-v1');assert.equal(scaled.curveRefineModel,'weighted-std-v1');assert.equal(scaled.curveRefineSaturation,50);
 pass('curves presets carry model plus amount without treating the model as a scalable scalar');
 passed=true;console.log(JSON.stringify({checks}));
}finally{if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
