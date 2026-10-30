// Verify the public signed model against independently composed mature ART
// parameters. This proves lowering and persistence, not Adobe formula parity.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
const work=await mkdtemp(join(tmpdir(),'captraw-signed-native-'));
const binary=resolve('build/native/captraw-engine'),source=resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif');
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const engineSHA=await hash(binary),sourceSHA=await hash(source),core=new EngineClient({executable:binary,cache:join(work,'cache')});
let passed=false,revision=0;const checks=[];
const base={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:0,scale:1,offsetX:0,offsetY:0,constrainCrop:false,manualModel:'signed-framing-v1'};
const lower=p=>{const ratio=1+Math.abs(p.aspect)/500;return {...p,manualModel:'art-perspective-v1',aspect:p.aspect>=0?1/ratio:ratio,scale:p.scale*Math.sqrt(ratio),offsetX:p.offsetX*.0072,offsetY:p.offsetY*-.0072};};
const exact=(first,second)=>execFileSync(resolve('build/qa-venv/bin/python'),['-c','import numpy as np,tifffile,sys\na,b=[tifffile.imread(p) for p in sys.argv[1:]];assert a.dtype==b.dtype==np.uint16;assert np.array_equal(a,b),int(np.abs(a.astype(np.int32)-b).max())',first,second],{stdio:'pipe'});
try{
 const image=await core.call('open',{path:source,sessionId:'signed',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
 const settings={...image.adjustments,crop:null,rotation:0,fineRotation:0,flipHorizontal:false,flipVertical:false,lensCorrections:false,lensManualDistortion:0,masks:[],spots:[]};
 const inherited={...settings};delete inherited.perspective;
 const render=async perspective=>{const wait=core.preview(++revision);const result=await core.call('update',{revision,adjustments:{...settings,perspective},artProfile:image.artProfile});const frame=await wait;return {...result,frame};};
 const samples=[{x:100,y:120},{x:500,y:400},{x:880,y:680}];
 for(const [name,change] of [
  ['neutral',{}],['aspect25',{aspect:25}],['aspect-minus50',{aspect:-50}],
  ['scale90',{scale:.9}],['xy10',{offsetX:10,offsetY:10}],
  ['combined',{aspect:25,scale:1.1,offsetX:10,offsetY:10}],
  ['manual-projective',{aspect:-25,scale:1.2,offsetX:-10,offsetY:10,horizontal:7,vertical:-5,angle:2,shear:3}],
 ]){
  const p={...base,...change},signed=await render(p);
  assert.deepEqual((await core.call('validate',{artProfile:signed.artProfile,adjustments:inherited})).perspective,p,name+' raw public units persist in ARP');
  const signedMap=await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'source',points:samples});
  const first=join(work,name+'-signed.tif');await core.call('export',{path:source,artProfile:signed.artProfile,output:first,format:'tiff',colorSpace:'srgb'});
  const lowered=await render(lower(p)),second=join(work,name+'-lowered.tif');
  const legacyMap=await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'source',points:samples});
  for(let i=0;i<samples.length;i++){
   const a=signedMap.points[i],b=legacyMap.points[i];assert.equal(a===null,b===null,name+' map validity');
   if(a)assert(Math.hypot(a.x-b.x,a.y-b.y)<1e-7,name+' coordinate lowering');
  }
  await core.call('export',{path:source,artProfile:lowered.artProfile,output:second,format:'tiff',colorSpace:'srgb'});exact(first,second);
  await rm(first);await rm(second);checks.push(name);
 }
 for(const sign of [-1,1]){
  const p={...base,aspect:sign*100,scale:sign<0?.5:1.5,offsetX:sign*100,offsetY:sign*100};
  const result=await render(p);assert.deepEqual((await core.call('validate',{artProfile:result.artProfile,adjustments:inherited})).perspective,p);
  const file=join(work,'extreme-'+sign+'.tif');await core.call('export',{path:source,artProfile:result.artProfile,output:file,format:'tiff',colorSpace:'srgb'});
  execFileSync(resolve('build/qa-venv/bin/python'),['-c','import tifffile,sys\na=tifffile.imread(sys.argv[1]);assert a.dtype.name=="uint16" and a.shape==(800,1000,3)',file],{stdio:'pipe'});await rm(file);
 }
 for(const patch of [{aspect:101},{offsetX:-101},{offsetY:101},{scale:.49},{scale:1.51}])await assert.rejects(core.call('validate',{artProfile:image.artProfile,adjustments:{...settings,perspective:{...base,...patch}}}));
 assert.equal(await hash(source),sourceSHA);assert.equal(await hash(binary),engineSHA);passed=true;
 console.log(JSON.stringify({engineSHA,exactLoweringCases:checks,validExtremeExports:2,invalidBoundsRejected:true,sourceUnchanged:true}));
}finally{await core.stop();if(passed)await rm(work,{recursive:true,force:true});else console.error('Retained signed native failure:',work);}
