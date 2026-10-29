import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePreset,isoAnchors,presetAtISO,presetAmount,validatePreset} from '@captraw/contracts/presets';

const photo=(iso,adjustments)=>({image:{iso,inputKind:'mosaic-raw',name:'RAW'},adjustments,profile:''});
test('ISO equality ignores object key order but preserves ordered arrays and real fixed-field conflicts',()=>{
 const a={shadowTint:2,redHue:3},b={redHue:3,shadowTint:2};
 assert.equal(isoAnchors([photo(400,{calibration:a}),photo(400,{calibration:b}),photo(1600,{calibration:b})],['calibration']).length,2);
 assert.throws(()=>isoAnchors([photo(400,{calibration:a}),photo(400,{calibration:{...b,redHue:4}}),photo(1600,{calibration:b})],['calibration']),/冲突/);
 const curve=[{x:0,y:0},{x:1,y:1}];
 assert.throws(()=>isoAnchors([photo(400,{curve}),photo(400,{curve:[...curve].reverse()}),photo(1600,{curve})],['curves']),/冲突/);
 assert.throws(()=>presetAtISO([{iso:400,adjustments:{calibration:a}},{iso:1600,adjustments:{calibration:{...a,redHue:4}}}],800),/不支持 ISO 插值/);
});
test('ISO sparse anchors retain root nested controls without adding absent defaults',()=>{
 const root={exposure:1,calibration:{shadowTint:9},parametricCurve:{lights:12,splits:[19,53,81]},hsl:{hue:[1,2,3,4,5,6,7,8]},colorGrading:{shadows:{hue:30,saturation:20},global:{luminance:10}}};
 const fixed={calibration:{redHue:11},parametricCurve:{shadows:4},hsl:{hue:{0:20}},colorGrading:{shadows:{luminance:5}}};
 const anchors=[{iso:400,adjustments:{...fixed,luminanceNoise:0}},{iso:1600,adjustments:{...fixed,luminanceNoise:10}}],original=structuredClone({root,anchors});
 for(const iso of [100,800,3200]){
  const result=presetAtISO(anchors,iso,root);
  assert.deepEqual(result.calibration,{shadowTint:9,redHue:11});assert.deepEqual(result.parametricCurve,{lights:12,splits:[19,53,81],shadows:4});
  assert.deepEqual(Object.values(result.hsl.hue),[20,2,3,4,5,6,7,8]);assert.equal(result.hsl.saturation,undefined);
  assert.deepEqual(result.colorGrading,{shadows:{hue:30,saturation:20,luminance:5},global:{luminance:10}});assert.equal(result.colorGrading.blending,undefined);
  assert.equal(result.exposure,1);assert.equal(result.luminanceNoise,iso===100?0:iso===800?5:10);
 }
 assert.deepEqual({root,anchors},original);
});
test('WB preset coordinates do not capture or compare source-specific WB multipliers',()=>{
 const wb={temperature:5000,tint:10},a=photo(400,{...wb,wbMode:'camera',wbMultipliers:[1,2,3]}),b=photo(400,{...wb,wbMode:'custom',wbMultipliers:[3,2,1]}),c=photo(1600,{temperature:7000,tint:20,wbMultipliers:[4,1,2]});
 assert.deepEqual(capturePreset({name:'WB',group:'测试',groups:['whiteBalance'],adjustments:a.adjustments}).adjustments,wb);
 const anchors=isoAnchors([a,b,c],['whiteBalance']);assert.deepEqual(presetAtISO(anchors,800),{temperature:6000,tint:15});
 assert.throws(()=>isoAnchors([a,photo(400,{temperature:5001,tint:10}),c],['whiteBalance']),/冲突/);
});
test('existing amount policy preserves unverified nested/WB/noise values and discloses the limit',()=>{
 const patch={exposure:1,temperature:7500,tint:20,curve:[{x:0,y:0},{x:.5,y:.6},{x:1,y:1}],hsl:{hue:{0:20}},luminanceNoise:30},original=structuredClone(patch);
 // ACR 18.7 evidence independently measured exposure at 50/100/150 only.
 // Zero and the fixed fields below test the existing local contract, not Adobe parity.
 for(const amount of [0,50,100,150]){
  const result=presetAmount(patch,amount);assert.equal(result.adjustments.exposure,amount/100);
  for(const key of ['temperature','tint','curve','hsl','luminanceNoise'])assert.deepEqual(result.adjustments[key],patch[key]);
  if(amount!==100){assert(result.warnings.some(w=>w.includes('固定')));assert(result.warnings.some(w=>w.includes('尚未完成对照')));}
 }
 assert.deepEqual(patch,original);assert.throws(()=>presetAmount({exposure:4},150),/超出/);
});
test('independent amount support metadata is boolean typed',()=>{
 const preset={engineVersion:'',name:'test',group:'test',groups:['light'],artProfile:'',adjustments:{exposure:1},supportsAmount:true,supportsAmount2:false};
 assert.doesNotThrow(()=>validatePreset(preset));
 for(const key of ['supportsAmount','supportsAmount2'])assert.throws(()=>validatePreset({...preset,[key]:'False'}),/布尔值/);
});
