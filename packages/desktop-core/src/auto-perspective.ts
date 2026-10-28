import {join} from 'node:path';
import {rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativeEngine} from './engine.js';
import type {AutoPerspectiveRequest,PerspectiveSettings} from '@captraw/contracts';

export class AutoPerspective {
 private current?:{id:string;worker:NativeEngine;cancelled:boolean};
 constructor(private binary:string,private resources:string,private cache:string){}
 cancel(id?:string){const job=this.current;if(job&&(!id||job.id===id)){job.cancelled=true;job.worker.terminate();this.current=undefined;}}
 async run(path:string,request:AutoPerspectiveRequest):Promise<PerspectiveSettings|null>{
  if(this.current)throw new Error('已有自动透视计算正在进行。');
  if(!request||typeof request.id!=='string'||!request.id||!['horizontal','vertical','both'].includes(request.direction))throw new Error('无效的自动透视请求。');
  const directory=join(this.cache,'perspective-'+randomUUID()),worker=new NativeEngine(this.binary,this.resources,directory);
  const job={id:request.id,worker,cancelled:false};this.current=job;
  let timer:ReturnType<typeof setTimeout>|undefined,listener:(message:any)=>void=()=>{};
  try{
   await worker.call('open',{path,sessionId:request.sessionId});
   const preview=new Promise<void>((accept,reject)=>{
    listener=message=>{if(message.event==='preview'&&message.frame.revision===1&&message.frame.kind==='fit')accept();else if(message.event==='error')reject(new Error(message.message));};
    worker.on('engine-event',listener);timer=setTimeout(()=>reject(new Error('自动透视准备超时，请重试。')),120000);
   });
   await Promise.all([worker.call('update',{revision:1,artProfile:request.artProfile,adjustments:request.adjustments}),preview]);
   clearTimeout(timer);worker.off('engine-event',listener);
   const result=await worker.call('autoPerspective',{sessionId:request.sessionId,revision:1,direction:request.direction,lines:request.lines});
   return job.cancelled?null:result;
  }catch(error){if(job.cancelled)return null;throw error;}
  finally{
   clearTimeout(timer);worker.off('engine-event',listener);
   const stopped=worker.child.exitCode!==null||worker.child.signalCode!==null||!worker.child.pid?Promise.resolve():new Promise<void>(resolve=>worker.child.once('exit',()=>resolve()));
   worker.terminate();await stopped;await rm(directory,{recursive:true,force:true});if(this.current===job)this.current=undefined;
  }
 }
}
