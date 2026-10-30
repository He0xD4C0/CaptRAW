import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {POINT_CURVE_PRESETS,pointCurveName} from '@captraw/contracts';
import {adjustmentCommand,applyEditCommand,synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {capturePreset} from '@captraw/contracts/presets';
import {XMP,CRS,property,text,lookup,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
const work=mkdtempSync(join(tmpdir(),'captraw-point-curve-presets-')),xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),checks=[];
const reference=resolve('artifacts/stage-0/acr-reference/curves-refine-tiff-187'),pass=s=>{checks.push(s);console.log('PASS',s);};let passed=false;
const base={exposure:0,temperature:6500,tint:0,contrast:0,saturation:0,vibrance:0,curve:structuredClone(POINT_CURVE_PRESETS.Linear),redCurve:[{x:0,y:0},{x:.375,y:.5625},{x:1,y:1}],greenCurve:structuredClone(POINT_CURVE_PRESETS.Linear),blueCurve:structuredClone(POINT_CURVE_PRESETS.Linear),rotation:0,crop:null,masks:[]};
try{
 for(const [name,stem] of [['Medium Contrast','medium-default'],['Strong Contrast','strong-refine50']]){
  const packet=readFileSync(join(reference,stem+'.xmp'),'utf8'),properties=(await xmp.call('read',packet)).properties,decoded=decodeAdjustments(properties);
  assert.deepEqual(decoded.adjustments.curve,POINT_CURVE_PRESETS[name]);assert.equal(decoded.adjustments.curveName,name);assert(!decoded.warnings.some(s=>s.includes('对应关系尚未验证')));
  const state={...base,...decoded.adjustments,redCurve:base.redCurve},fields=encodeAdjustments(state);assert.equal(lookup(fields,CRS,'ToneCurveName2012').value,name);assert(!lookup(fields,CRS,'ToneCurvePV2012Red').items.every((p,i)=>p.value===['0, 0','255, 255'][i]));
  const serialized=await documents.serialize({source:{path:'source.tif',size:1,sha256:'0'.repeat(64)},artProfile:'',adjustments:state,xmpPacket:packet});
  const saved=(await xmp.call('read',serialized)).properties;assert.deepEqual(lookup(saved,CRS,'CurveRefineSaturation'),lookup(properties,CRS,'CurveRefineSaturation'));
  assert.equal(decodeAdjustments(saved).adjustments.curveName,name);
 }
 pass('real ACR Medium/Strong points, names, fractional channel and existing refine survive SDK roundtrip');
 const named={...base,curve:structuredClone(POINT_CURVE_PRESETS['Medium Contrast']),curveName:'Medium Contrast'},edited=structuredClone(named);edited.curve[1].y+=1/255;delete edited.curveName;
 assert.equal(pointCurveName(edited),'Custom');assert.equal(lookup(encodeAdjustments(edited),CRS,'ToneCurveName2012').value,'Custom');
 const command=adjustmentCommand(named,edited,'curve-edit'),restored=applyEditCommand(named,command);assert.equal(restored.curveName,undefined);assert.deepEqual(restored.redCurve,base.redCurve);
 const sync=synchronizedAdjustments({image:{inputKind:'rendered'},adjustments:named,profile:''},{image:{inputKind:'rendered'},adjustments:base,profile:''},['curves']);assert.equal(sync.curveName,'Medium Contrast');assert.deepEqual(sync.curve,named.curve);
 const preset=capturePreset({name:'curve',group:'test',groups:['curves'],adjustments:named});assert.equal(preset.adjustments.curveName,'Medium Contrast');
 pass('point edits become Custom; atomic commands, curves synchronization and preset capture carry known names');
 for(const [name,points] of [['Old Unverified',POINT_CURVE_PRESETS.Linear],['Strong Contrast',POINT_CURVE_PRESETS['Medium Contrast']],['Medium Contrast',null]]){
  const fields=[property(CRS,'ToneCurveName2012',text(name)),...(points?[property(CRS,'ToneCurvePV2012',{options:0x600,items:points.map(p=>text(`${p.x*255}, ${p.y*255}`))})]:[])];
  const read=decodeAdjustments(fields);assert.equal(read.adjustments.curveName,undefined);assert(read.warnings.some(s=>s.includes('ToneCurveName2012=')));
 }
 pass('unknown names, mismatched named points and name-only records remain warnings without inventing points');
 assert.equal(lookup(encodeAdjustments({...base,redCurve:base.greenCurve}),CRS,'ToneCurveName2012').value,'Linear');assert.equal(lookup(encodeAdjustments(base),CRS,'ToneCurveName2012').value,'Custom');
 pass('existing Linear/Custom all-channel behavior remains intact');passed=true;console.log(JSON.stringify({checks}));
}finally{if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
