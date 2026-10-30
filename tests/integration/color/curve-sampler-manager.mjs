import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CurveSampling} from '@captraw/desktop-core/curve-sampler';
import {captureSourceIdentity} from '@captraw/desktop-core/source-identity';
import {EngineClient} from '../../support/engine-client.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-curve-sampler-manager-')),path=join(work,'曲线 源.tif');let success=false;
const core=new EngineClient({cache:join(work,'main')});const manager=new CurveSampling(resolve('build/native/captraw-engine'),resolve('build/native/resources'),work);
try{
 copyFileSync('artifacts/stage-0/acr-reference/tat-interaction-187/inputs/controlled-tat.tif',path);
 const image=await core.call('open',{path,sessionId:'manager',sourceFramePolicy:'active-area-v1',whiteBalanceDefaults:'current'});image.sourceIdentity=await captureSourceIdentity(path);
 const snapshot={adjustments:image.adjustments,artProfile:image.artProfile};
 const request={id:'a',sessionId:image.id,revision:1,channel:'curve',point:{x:640,y:550}};
 const a=await manager.run(image,request,snapshot,()=>true);assert(a&&a.input===166/255&&!a.reused);
 const b=await manager.run(image,{...request,id:'b'},snapshot,()=>true);assert(b?.reused);assert.equal(b.id,'b');
 assert.equal(await manager.run(image,{...request,id:'stale'},snapshot,()=>false),null);
 const late=manager.run(image,{...request,id:'cancel'},snapshot,()=>true);await manager.cancel('cancel');assert.equal(await late,null);
 // Observe the real child and protocol without replacing responses or adding a
 // production test hook. This is cold preparation, distinct from token cancel.
 let settled=false;
 const preparing=manager.run(image,{...request,id:'cold-cancel'},snapshot,()=>true).finally(()=>{settled=true;});
 void preparing.catch(()=>{}); // The awaited protocol/exit check below reports it.
 const deadline=Date.now()+20000;let cache;
 while(!(cache=Reflect.get(manager,'cache'))){assert(Date.now()<deadline,'Cold worker did not start');await new Promise(r=>setTimeout(r,1));}
 const child=cache.worker.child;let stage='open',timer;
 const call=cache.worker.call.bind(cache.worker);cache.worker.call=(method,p)=>{stage=method;return call(method,p);};
 let listener;
 const progress=await new Promise((resolve,reject)=>{
  listener=event=>{if(event.event==='progress'){clearTimeout(timer);resolve({stage,progress:event.progress});}};
  cache.worker.on('engine-event',listener);timer=setTimeout(()=>reject(new Error('No real worker progress before cancellation')),20000);
  child.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited before progress was observed'));});
 });
 cache.worker.off('engine-event',listener);assert(!settled,'Preparation already finished; not an in-flight cancellation');
 assert(child.pid&&child.exitCode===null&&child.signalCode===null);await manager.cancel('cold-cancel');assert.equal(await preparing,null);
 assert(child.exitCode!==null||child.signalCode!==null);assert(!existsSync(cache.directory),'Cancelled worker cache leaked');
 console.log('PASS actual cold worker progress -> cancel -> process exit/cache release',progress);
 await manager.run(image,{...request,id:'warm-before-identity-error'},snapshot,()=>true);
 const stale=Reflect.get(manager,'cache');assert(stale?.worker.child.pid);
 writeFileSync(path,'replaced');await assert.rejects(manager.run(image,{...request,id:'identity'},snapshot,()=>true),/原片已变化/);
 assert(stale.worker.child.exitCode!==null||stale.worker.child.signalCode!==null,'source failure must await the warmed sampler exit');
 assert(!existsSync(stale.directory),'source failure must remove the warmed sampler cache');
 console.log('PASS changed source retires the actual warmed sampler before rejecting');
 // The foreground processor is a different child and remains usable.
 const result=await core.call('save',{});assert(result.artProfile);success=true;
 console.log('PASS manager cache / stale token / cancellation / source identity / foreground process isolation');
}finally{await manager.cancel();await core.stop();if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
