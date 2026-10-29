import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['apps/desktop/src/repairGeometry.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {automaticRepairSource}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const request=()=>({sessionId:'frozen',revision:19,path:[{x:.6,y:.4},{x:.7,y:.5}],radius:12,feather:50,seed:3,exclude:{x:.2,y:.4}});
const result=r=>({sessionId:r.sessionId,revision:r.revision,source:{x:.2,y:.3},offset:{x:-.4,y:-.1}});

test('automatic source search only sends frozen geometry over RPC; no renderer pixel APIs',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'document'),image=Object.getOwnPropertyDescriptor(globalThis,'Image');
 Object.defineProperty(globalThis,'document',{configurable:true,get(){throw new Error('renderer document forbidden');}});
 Object.defineProperty(globalThis,'Image',{configurable:true,get(){throw new Error('renderer Image forbidden');}});
 try{
  let sent,finish;
  globalThis.window={captraw:{repairSource:r=>{sent=r;return new Promise(done=>{finish=done;});}}};
  const input=request(),pending=automaticRepairSource(input,()=>true);
  input.path[0].x=.99;input.exclude.x=.99;
  assert.equal(sent.path[0].x,.6);assert.equal(sent.exclude.x,.2);
  assert.deepEqual(Object.keys(sent).sort(),['exclude','feather','path','radius','revision','seed','sessionId']);
  finish(result(sent));assert.deepEqual(await pending,{x:.2,y:.3});
 }finally{
  if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;
  if(image)Object.defineProperty(globalThis,'Image',image);else delete globalThis.Image;
  delete globalThis.window;
 }
});

test('cancelled requests and stale native responses never return a source for saving',async()=>{
 let calls=0,finish,alive=true;
 globalThis.window={captraw:{repairSource:r=>{++calls;return new Promise(done=>{finish=()=>done(result(r));});}}};
 try{
  await assert.rejects(automaticRepairSource(request(),()=>false),/cancelled/i);assert.equal(calls,0);
  const pending=automaticRepairSource(request(),()=>alive);alive=false;finish();await assert.rejects(pending,/cancelled/i);
  for(const edit of [{sessionId:'another'},{revision:18}]){
   globalThis.window.captraw.repairSource=async r=>({...result(r),...edit});
   await assert.rejects(automaticRepairSource(request(),()=>true),/cancelled/i);
  }
  globalThis.window.captraw.repairSource=async()=>{throw new Error('native source unavailable');};
  await assert.rejects(automaticRepairSource(request(),()=>true),/native source unavailable/);
 }finally{delete globalThis.window;}
});
