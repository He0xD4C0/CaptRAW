import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {patchEffects} from '../native/patch-effects.mjs';
import {encodeAdjustments,decodeAdjustments,XMP,CRS,CT,property,text} from '@captraw/desktop-core/xmp';
import {capturePreset,presetValidationBase} from '@captraw/contracts/presets';
import {synchronizedAdjustments} from '@captraw/contracts/synchronize';
const work=mkdtempSync(join(tmpdir(),'captraw-effects-'));let success=false;
try{
 const upstream=resolve('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b');
 for(const name of ['engine/procparams.h','engine/procparams.cc','engine/improcfun.h','engine/improcfun.cc','gui/paramsedited.h','gui/paramsedited.cc']){mkdirSync(join(work,'src',name,'..'),{recursive:true});copyFileSync(join(upstream,'src',name),join(work,'src',name));}
 patchEffects(work);const once=readFileSync(join(work,'src/engine/procparams.cc'),'utf8');patchEffects(work);assert.equal(readFileSync(join(work,'src/engine/procparams.cc'),'utf8'),once);
 execFileSync('clang++',['-std=c++17','-O2','-I',resolve('native'),resolve('tests/effects-kernel.cc'),'-o',join(work,'kernel')]);console.log(execFileSync(join(work,'kernel'),{encoding:'utf8'}).trim());
 const effects={grain:37,grainModel:'procedural-v1',grainSize:42,grainRoughness:63,vignette:-48,postCropVignetteStyle:'color-priority',postCropVignetteMidpoint:35,postCropVignetteRoundness:12,postCropVignetteFeather:67,postCropVignetteHighlights:19};
 const xmp=new XMP(resolve(process.env.CAPTRAW_XMP||'build/xmp/captraw-xmp'));
 for(const style of ['highlight-priority','color-priority','paint-overlay']){
  const a={...effects,postCropVignetteStyle:style},encoded=encodeAdjustments(a),packet=await xmp.call('write','',encoded),decoded=decodeAdjustments((await xmp.call('read',packet.packet)).properties);
  for(const [key,value] of Object.entries(a))assert.equal(decoded.adjustments[key],value,key);
 }
 const legacy={grain:25,vignette:-25,postCropVignetteFeather:50,postCropVignetteRoundness:0};
 const decoded=decodeAdjustments([...encodeAdjustments(legacy),property(CT,'EngineVersion',text('27'))]).adjustments;assert.equal(decoded.grainModel,undefined);assert.equal(decoded.postCropVignetteStyle,undefined);
 const external=decodeAdjustments([property(CRS,'GrainSize',text(27)),property(CRS,'GrainFrequency',text(62)),property(CRS,'PostCropVignetteStyle',text(2))]).adjustments;
 assert.equal(external.grainModel,'procedural-v1');assert.equal(external.postCropVignetteStyle,'color-priority');
 for(const key of ['grainSize','grainRoughness','postCropVignetteMidpoint','postCropVignetteHighlights'])assert.throws(()=>encodeAdjustments({...effects,[key]:101}));
 assert.throws(()=>decodeAdjustments([property(CRS,'PostCropVignetteStyle',text(9))]));
 const source={...structuredClone(presetValidationBase),...effects},preset=capturePreset({name:'effects',group:'test',groups:['effects'],adjustments:source});
 for(const [key,value] of Object.entries(effects))assert.equal(preset.adjustments[key],value,key);
 const synced=synchronizedAdjustments({image:{width:100,height:80},adjustments:source,profile:''},{image:{width:100,height:80},adjustments:structuredClone(presetValidationBase),profile:''},['effects']);
 for(const [key,value] of Object.entries(effects))assert.equal(synced[key],value,key);
 console.log('effects XMP SDK roundtrip / legacy selection / bounds / preset / sync / patch replay: passed');success=true;
}finally{if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
