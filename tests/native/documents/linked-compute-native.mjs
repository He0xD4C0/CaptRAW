import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {Synchronizer} from '@captraw/desktop-core/presets';
import {EngineClient} from '../../support/engine-client.mjs';
const scratch=await mkdtemp(join(tmpdir(),'captraw-linked-compute-'));
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const sync=new Synchronizer(binary,resources,scratch,()=>{}),checks=[];
let passed=false;
try{
 const targets=[],sources=[];
 for(const name of ['nikon-d850.NEF','canon-r5.CR3']){
  const path=resolve('build/samples',name);sources.push(await readFile(path));
  const engine=new EngineClient({cache:join(scratch,name),executable:binary,resources});
  try{
   const image=await engine.call('open',{path,sessionId:name}),preview=engine.preview(1);
   const result=await engine.call('update',{revision:1,adjustments:image.adjustments});await preview;
   targets.push({image,adjustments:image.adjustments,profile:result.artProfile});
  }finally{await engine.stop();}
 }
 const source={...targets[0],image:{...targets[0].image,path:'captraw-compute:test'}};
 const original=structuredClone(targets);
 const results=await sync.run({source,targets,groups:[],recompute:{type:'whiteBalance',request:{mode:'auto'}}});
 assert(results.length===2);assert.deepEqual(targets,original,'prepared edits never mutate request snapshots');
 for(const [i,target] of targets.entries()){
  const engine=new EngineClient({cache:join(scratch,'reference-'+i),executable:binary,resources});
  try{
   await engine.call('open',{path:target.image.path,sessionId:'reference'});let preview=engine.preview(1);
   const base=await engine.call('update',{revision:1,adjustments:target.adjustments,artProfile:target.profile});await preview;
   const wb=await engine.call('whiteBalance',{mode:'auto'}),result=results.find(r=>r.path===target.image.path);
   const {wbMultipliers,...computed}=result.adjustments,expected={...target.adjustments,...wb};
   for(const [index,value] of wbMultipliers.entries())assert(Math.abs(value-expected.wbMultipliers[index])<1e-14,'auto WB reductions agree within floating point rounding');
   delete expected.wbMultipliers;assert.deepEqual(computed,expected);
   preview=engine.preview(2);await engine.call('update',{revision:2,adjustments:result.adjustments,artProfile:base.artProfile});const frame=await preview;
   assert.deepEqual(await readFile(sync.previews.get(result.preview.replace('captraw://preview/',''))),await readFile(frame.file),'batch WB matches a fresh per-photo calculation and native render');
   checks.push(target.image.name+' per-photo auto WB and preview pixels');
  }finally{await engine.stop();}
 }
 assert.notDeepEqual(results[0].adjustments.wbMultipliers,results[1].adjustments.wbMultipliers,'cross-camera auto WB is not copied from the active photo');
 const changed=await sync.run({source,targets,groups:[],commands:targets.map((target,i)=>({operationId:'values',path:target.image.path,set:{exposure:i===0?-.3:.4},unset:[]}))});
 assert.equal(changed[0].adjustments.exposure,-.3);assert.equal(changed[1].adjustments.exposure,.4);checks.push('one atomic request supports distinct numerical values per target');
 for(const [i,target] of targets.entries())assert.deepEqual(await readFile(target.image.path),sources[i]);
 passed=true;console.log(JSON.stringify({checks,passed,scope:'Same-core consistency; not Adobe quality equivalence.'}));
}finally{sync.cancel();if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained failure:',scratch);}
