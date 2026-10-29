import test from 'node:test';
import assert from 'node:assert/strict';
import {CRS,CT,property,text,encode,lookup,readExtension,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/xmp';
const legacy={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1};
const manual=scale=>({...legacy,manualModel:'art-perspective-v1',scale});
const standard=value=>property(CRS,'PerspectiveScale',text(value));
test('standard Scale is percent; neutral 100 does not materialize or activate a model',()=>{
 assert.equal(decodeAdjustments([standard(100)]).adjustments.perspective,undefined);
 const result=decodeAdjustments([standard(110),property(CRS,'PerspectiveVertical',text(10))]);
 assert.deepEqual(result.adjustments.perspective,{...legacy,aspect:0,manualModel:'signed-framing-v1',scale:1.1,offsetX:0,offsetY:0});assert(result.warnings.some(s=>s.includes('PerspectiveVertical')));
 for(const value of ['',0,-1,'NaN','Infinity',9,401])assert.throws(()=>decodeAdjustments([standard(value)]));
});
test('active Scale has one standard authority and exact private-ratio migration',()=>{
 for(const scale of [.1,.12345678901234567,1,1.001,1.1,1.2345678901234567,4]){
  const properties=encodeAdjustments({perspective:manual(scale)}),stored=readExtension(properties,'ARTAdjustments').perspective;
  assert.equal(stored.scale,undefined);assert.equal(stored.manualModel,'art-perspective-v1');
  assert.equal(decodeAdjustments(properties).adjustments.perspective.scale,scale,'decimal conversion must preserve the exact double');
 }
 assert.equal(lookup(encodeAdjustments({perspective:manual(1.1)}),CRS,'PerspectiveScale').value,'110');
});
test('old private values and ARP outrank preserved standard 100, with explicit migration warning',()=>{
 const p=manual(1.25),old=[standard(100),property(CT,'EngineVersion',encode('CaptRAW-31_ART-1.26.10_LibRaw-3b20539')),property(CT,'ARTAdjustments',encode({perspective:p}))],decoded=decodeAdjustments(old);
 assert.deepEqual(decoded.adjustments.perspective,p);assert(decoded.warnings.some(s=>s.includes('旧私有缩放')&&s.includes('125')));
 const saved=encodeAdjustments(decoded.adjustments,old);assert.equal(lookup(saved,CRS,'PerspectiveScale').value,'125');assert.equal(readExtension(saved,'ARTAdjustments').perspective.scale,undefined);
 const arp=decodeAdjustments([standard(100),property(CT,'ARTProfile',encode('[Perspective]\nCaptRAWManualV1=true\nCaptRAWScale=1.25\n'))]);
 assert.equal(arp.adjustments.perspective,undefined);assert(arp.warnings.some(s=>s.includes('ART 几何配置保留')));
 const oldGeometry=decodeAdjustments([standard(110),property(CT,'ARTAdjustments',encode({perspective:legacy}))]);assert.deepEqual(oldGeometry.adjustments.perspective,legacy);
 const oldPreset=decodeAdjustments([standard(110),property(CT,'EngineVersion',encode('CaptRAW-31_ART-1.26.10_LibRaw-3b20539'))]);assert.equal(oldPreset.adjustments.perspective,undefined);assert(oldPreset.warnings.some(w=>w.includes('ART 几何配置保留')));
 const implicit={...manual(1),aspect:1.001};delete implicit.scale;
 const oldImplicit=decodeAdjustments([standard(110),property(CT,'EngineVersion',encode('CaptRAW-31_ART-1.26.10_LibRaw-3b20539')),property(CT,'ARTAdjustments',encode({perspective:implicit}))]);assert.deepEqual(oldImplicit.adjustments.perspective,implicit);assert(oldImplicit.warnings.some(w=>w.includes('ART 几何配置保留')),'old model with absent scale keeps its native default1');
});
test('bypass writes neutral standard Scale and remembers only the inactive private value',()=>{
 const p={...manual(1.25),enabled:false},properties=encodeAdjustments({perspective:p});
 assert.equal(lookup(properties,CRS,'PerspectiveScale').value,'100');assert.equal(readExtension(properties,'ARTAdjustments').perspective.scale,1.25);
 assert.deepEqual(decodeAdjustments(properties).adjustments.perspective,p);
 const active=encodeAdjustments({perspective:{...p,enabled:true}},properties);assert.equal(readExtension(active,'ARTAdjustments').perspective.scale,undefined);assert.equal(lookup(active,CRS,'PerspectiveScale').value,'125');
 const reset=encodeAdjustments({perspective:{...legacy,enabled:false}},active);assert.equal(lookup(reset,CRS,'PerspectiveScale').value,'100');assert.equal(decodeAdjustments(reset).adjustments.perspective.manualModel,undefined);
});
