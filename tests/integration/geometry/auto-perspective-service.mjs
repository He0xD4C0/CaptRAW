import assert from 'node:assert/strict';
import {AutoPerspective} from '@captraw/desktop-core/editing';
import {EngineClient} from '../../support/engine-client.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.env.CAPTRAW_AUTO_SERVICE_OUT||'artifacts/auto-perspective-service');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-')),cache=join(out,'cache');mkdirSync(cache);
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),source=resolve('build/samples/nikon-d850.NEF');
const core=new EngineClient({executable:binary,resources,cache:join(out,'source-cache')}),service=new AutoPerspective(binary,resources,cache),checks=[],errors=[];let failure;
const pass=s=>{checks.push(s);console.log('PASS',s);};
const exited=pid=>{assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');};
try{
 const image=await core.call('open',{path:source,sessionId:'raw'}),base={sessionId:'raw',direction:'both',adjustments:image.adjustments,artProfile:image.artProfile};
 for(const phase of ['decoding','prepared']){
  const id='cancel-'+phase,promise=service.run(source,{...base,id}),job=service.current,pid=job.worker.child.pid;assert(pid);
  await assert.rejects(service.run(source,{...base,id:'duplicate'}),/已有/);service.cancel('unrelated');assert.equal(service.current,job);
  if(phase==='prepared'){
   job.worker.on('engine-event',message=>{if(message.event==='preview'&&message.frame.kind==='fit')service.cancel(id);});
  }else{await job.worker.ready;service.cancel(id);}
  assert.equal(await promise,null);exited(pid);assert.deepEqual(readdirSync(cache),[]);assert.equal(service.current,undefined);
  pass(`real RAW ${phase}: cancellation kills only the matching worker, returns null and removes its cache`);
 }
 let completed;
 try{completed={settings:await service.run(source,{...base,id:'retry'})};}catch(error){assert.match(String(error),/未找到足够可靠|Invalid/);completed={detected:false,message:String(error)};}
 assert.equal(service.current,undefined);assert.deepEqual(readdirSync(cache),[]);writeFileSync(join(out,'raw-result.json'),JSON.stringify(completed,null,2)+'\n');pass('same real RAW can retry after cancellation and returns a solved result or explicit no-solution without leaking a worker');
}catch(e){failure=e.stack;throw e;}finally{service.cancel();await core.stop();rmSync(join(out,'source-cache'),{recursive:true,force:true});writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure,checks,errors,failure,binary,resources,source},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
