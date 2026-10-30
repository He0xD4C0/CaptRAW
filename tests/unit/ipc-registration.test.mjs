import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({
  entryPoints:['apps/desktop/electron/ipc/index.ts'],
  bundle:true,
  write:false,
  format:'esm',
  platform:'node',
  external:['electron'],
});
const {registerIpc}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

function createIpc(){
  const channels=[];
  return {channels,handle(channel,handler){if(channels.some(item=>item.channel===channel))throw new Error('duplicate channel '+channel);channels.push({channel,handler});}};
}
function registrar(runtime,ipc=createIpc()){
  const once=[];
  const dialog={},app={once(event,handler){once.push({event,handler});}};
  registerIpc(ipc,dialog,app,runtime);
  return {channels:ipc.channels,once,ipc};
}

test('main IPC registrars expose the complete unique channel set',()=>{
  const {channels,once}=registrar({});
  assert.equal(channels.length,63);
  assert.equal(new Set(channels.map(item=>item.channel)).size,channels.length);
  assert(channels.every(item=>/^[a-z]+:[a-z-]+$/.test(item.channel)));
  assert.deepEqual(once.map(item=>item.event),['will-quit']);
});

test('registration keeps session and save/export guard semantics',async()=>{
  const {channels}=registrar({
    requireSession(){throw new Error('missing session');},
    exportPending:true,
    savePending:true,
    session:{},
  });
  const handler=name=>channels.find(item=>item.channel===name).handler;
  await assert.rejects(handler('image:viewport')({}, {sessionId:'missing'}),/missing session/);
  await assert.rejects(handler('images:export')({}, {documents:[]}),/已有导出任务/);
  await assert.rejects(handler('session:save')({}, {documents:[]}),/已有保存任务/);
});

test('IPC registration rejects duplicate channels and orders image cleanup',async()=>{
  const first=registrar({});
  assert.throws(()=>registrar({},first.ipc),/duplicate channel/);

  const calls=[];
  const runtime={
    autoPerspective:{cancel(){calls.push('perspective');}},
    stopComparison(){calls.push('comparison');},
    objects:{async cancel(){calls.push('objects');}},
    brushSnapshot:{sessionId:'old'},
    curveSampling:{async cancel(){calls.push('curve');}},
    brushes:{async invalidate(){calls.push('brushes');}},
    engine:{alive:true,async call(){calls.push('engine-close');},terminate(){calls.push('engine-terminate');}},
    session:{id:'old'},
  };
  const {channels}=registrar(runtime);
  await channels.find(item=>item.channel==='image:close').handler();
  assert.deepEqual(calls,['perspective','comparison','objects','curve','brushes','engine-close','engine-terminate']);
  assert.equal(runtime.brushSnapshot,undefined);
  assert.equal(runtime.engine,undefined);
  assert.equal(runtime.session,undefined);
});
