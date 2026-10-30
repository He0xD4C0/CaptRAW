import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAdjustments,decodeAdjustments,lookup,property,text,TIFF,CRS} from '@captraw/desktop-core/xmp';
import {synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {capturePreset,presetValidationBase} from '@captraw/contracts/presets';

test('all 16 ART toggle combinations use the eight standard TIFF orientations and retain exact crop/toggles',()=>{
 const expected={0:[1,2,4,3],90:[6,5,7,8],180:[3,4,2,1],270:[8,7,5,6]},seen=new Set();
 for(const rotation of [0,90,180,270])for(const flipHorizontal of [false,true])for(const flipVertical of [false,true]){
  const input={rotation,flipHorizontal,flipVertical,crop:{x:.125,y:.25,width:.5,height:.375},fineRotation:3.5};
  const properties=encodeAdjustments(input),orientation=Number(lookup(properties,TIFF,'Orientation').value);seen.add(orientation);
  assert.equal(orientation,expected[rotation][Number(flipHorizontal)+2*Number(flipVertical)]);
  const result=decodeAdjustments(properties).adjustments;
  for(const key of ['rotation','flipHorizontal','flipVertical','crop','fineRotation'])assert.deepEqual(result[key],input[key],key);
 }
 assert.deepEqual([...seen].sort(),[1,2,3,4,5,6,7,8]);
});
test('external standard TIFF Orientation 1-8 imports both mirrored and rotated crops',()=>{
 const expected={1:[0,false,false],2:[0,true,false],3:[180,false,false],4:[0,false,true],5:[90,true,false],6:[90,false,false],7:[90,false,true],8:[270,false,false]};
 for(let orientation=1;orientation<=8;++orientation){
  const fields=[property(TIFF,'Orientation',text(orientation)),...Object.entries({HasCrop:'True',CropTop:.125,CropLeft:.25,CropBottom:.625,CropRight:.75,CropAngle:0}).map(([k,v])=>property(CRS,k,text(v)))];
  const {adjustments,warnings}=decodeAdjustments(fields);
  assert.deepEqual([adjustments.rotation,adjustments.flipHorizontal,adjustments.flipVertical],expected[orientation]);
  assert(!warnings.some(w=>w.includes('镜像方向')));
  const saved=encodeAdjustments(adjustments);assert.equal(Number(lookup(saved,TIFF,'Orientation').value),orientation);
  for(const name of ['CropTop','CropLeft','CropBottom','CropRight'])assert.equal(Number(lookup(saved,CRS,name).value),Number(lookup(fields,CRS,name).value));
 }
});
test('invalid flip values fail at the XMP boundary',()=>{
 assert.throws(()=>encodeAdjustments({rotation:0,flipHorizontal:1}),/布尔/);
 assert.throws(()=>encodeAdjustments({rotation:10,flipVertical:true}),/旋转/);
});
test('crop synchronization clears flips missing from an old source instead of inheriting target flips',()=>{
 const doc=adjustments=>({image:{path:'image.png',width:1024,height:768},profile:'',adjustments:{...structuredClone(presetValidationBase),...adjustments}});
 const result=synchronizedAdjustments(doc({}),doc({flipHorizontal:true,flipVertical:true}),['crop']);
 assert.equal(result.flipHorizontal,false);assert.equal(result.flipVertical,false);
 const selected=synchronizedAdjustments(doc({flipHorizontal:true,flipVertical:false}),doc({}),['crop']);
 assert.equal(selected.flipHorizontal,true);assert.equal(selected.flipVertical,false);
});
test('geometry preset captures both flip controls without leaking them into light-only presets',()=>{
 const adjustments={...structuredClone(presetValidationBase),flipHorizontal:true,flipVertical:false};
 const input={name:'geometry',group:'tests',adjustments};
 const geometry=capturePreset({...input,groups:['crop']}).adjustments;
 assert.equal(geometry.flipHorizontal,true);assert.equal(geometry.flipVertical,false);
 const light=capturePreset({...input,groups:['light']}).adjustments;
 assert.equal(light.flipHorizontal,undefined);assert.equal(light.flipVertical,undefined);
});
