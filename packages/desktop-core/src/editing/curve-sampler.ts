import {join} from 'node:path';
import {rm} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {sourceFrameOpenSnapshot} from '@captraw/contracts';
import type {ImageSession,Adjustments,CurveSampleRequest,CurveSampleResult} from '@captraw/contracts';
import {NativeEngine} from '../engine/engine.js';
import {verifySourceIdentity} from '../engine/source-identity.js';
type Cache={key:string;worker:NativeEngine;directory:string;closed?:Promise<void>;lastId:string};
export class CurveSampling {
 private cache?:Cache;private active?:{id:string;cancelled:boolean};private stopping:Promise<void>=Promise.resolve();
 constructor(private binary:string,private resources:string,private directory:string){}
 private retire(cache:Cache){
  if(cache.closed)return cache.closed;
  cache.closed=(async()=>{
   const child=cache.worker.child;
   const stopped=child.exitCode!==null||child.signalCode!==null||!child.pid?Promise.resolve():new Promise<void>(resolve=>child.once('exit',()=>resolve()));
   cache.worker.terminate();await stopped;await rm(cache.directory,{recursive:true,force:true});
  })();return cache.closed;
 }
 async cancel(id?:string){
  if(id&&this.active?.id!==id&&this.cache?.lastId!==id)return;
  if(this.active){this.active.cancelled=true;this.active=undefined;}
  const previous=this.cache;this.cache=undefined;
  if(previous)this.stopping=Promise.all([this.stopping,this.retire(previous)]).then(()=>{});
  await this.stopping;
 }
 async run(image:ImageSession,request:CurveSampleRequest,snapshot:{adjustments:Adjustments;artProfile:string},valid:()=>boolean):Promise<CurveSampleResult|null>{
  if(this.active)throw new Error('曲线取样正在进行，请稍候。');
  if(!request||typeof request.id!=='string'||!request.id||request.sessionId!==image.id||!Number.isSafeInteger(request.revision)||request.revision<1||
   !['curve','redCurve','greenCurve','blueCurve'].includes(request.channel)||!request.point||![request.point.x,request.point.y].every(Number.isFinite))throw new Error('曲线取样请求无效。');
  if(!image.sourceIdentity)throw new Error('照片缺少原片身份，请重新打开。');
  const job={id:request.id,cancelled:false};this.active=job;let cache:Cache|undefined=this.cache;
  try{
   await this.stopping;await verifySourceIdentity(image.path,image.sourceIdentity);
   if(job.cancelled||!valid())return null;
   const key=createHash('sha256').update(JSON.stringify([image.path,image.sourceIdentity.sha256,image.id,request.revision,snapshot])).digest('hex');
   if(this.cache?.key!==key){
    if(this.cache){await this.retire(this.cache);this.cache=undefined;}
    if(job.cancelled||!valid())return null;
    const directory=join(this.directory,'curve-sample-'+randomUUID());
    cache={key,directory,worker:new NativeEngine(this.binary,this.resources,directory),lastId:request.id};this.cache=cache;
    await cache.worker.call('open',{path:image.path,sessionId:image.id,...sourceFrameOpenSnapshot(snapshot.adjustments,snapshot.artProfile,image.sourceFrame)});
    let timer:ReturnType<typeof setTimeout>|undefined;let listener:(message:any)=>void=()=>{};
    try{
     const preview=new Promise<void>((resolve,reject)=>{
      listener=message=>{if(message.event==='preview'&&message.frame.revision===request.revision&&message.frame.kind==='fit')resolve();else if(message.event==='error')reject(new Error(message.message));};
      cache!.worker.on('engine-event',listener);timer=setTimeout(()=>reject(new Error('曲线取样准备超时，请重试。')),120000);
     });
     await Promise.all([cache.worker.call('update',{revision:request.revision,...snapshot}),preview]);
    }finally{clearTimeout(timer);cache.worker.off('engine-event',listener);}
   }
   cache=this.cache;if(!cache||job.cancelled||!valid())return null;cache.lastId=request.id;
   const result=await cache.worker.call('sampleCurve',request);
   await verifySourceIdentity(image.path,image.sourceIdentity);
   if(job.cancelled||!valid()||result.revision!==request.revision||result.sessionId!==image.id||result.channel!==request.channel)return null;
   return {...result,id:request.id};
  }catch(error){
   if(cache){await this.retire(cache);if(this.cache===cache)this.cache=undefined;}
   if(job.cancelled)return null;throw error;
  }finally{if(this.active===job)this.active=undefined;}
 }
}
