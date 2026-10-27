import {join,basename,resolve} from 'node:path';
import {mkdir,rm,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativeEngine} from './engine.js';
import {synchronizedAdjustments,type SyncRequest,type SyncResult} from '@captraw/contracts/synchronize';

// One isolated processor prepares the whole transaction; the renderer commits only on success.
export class Synchronizer {
 private worker?:NativeEngine;private cancelled=false;private active=false;private directory='';
 readonly previews=new Map<string,string>();
 constructor(private binary:string,private resources:string,private cache:string,private progress:(message:string)=>void){}
 get running(){return this.active;}
 cancel(){this.cancelled=true;this.worker?.terminate();}
 async run(request:SyncRequest):Promise<SyncResult[]|null>{
  if(this.active)throw new Error('已有同步任务正在运行。');
  if(!request?.source?.image?.path||!Array.isArray(request.targets)||!request.targets.length||new Set(request.targets.map(d=>d.image.path)).size!==request.targets.length)throw new Error('请选择要同步的照片。');
  const targets=request.targets.map(doc=>{
   if(doc.image.path===request.source.image.path)throw new Error('来源照片不能同时作为同步目标。');
   return {...doc,adjustments:synchronizedAdjustments(request.source,doc,request.groups)};
  }).filter((doc,i)=>JSON.stringify(doc.adjustments)!==JSON.stringify(request.targets[i].adjustments));
  if(!targets.length)return [];
  this.active=true;this.cancelled=false;const results:SyncResult[]=[];
  try{
   this.previews.clear();if(this.directory)await rm(this.directory,{recursive:true,force:true});
   this.directory=join(this.cache,`sync-${randomUUID()}`);await mkdir(this.directory,{recursive:true});
   if(this.cancelled)return null;
   const worker=new NativeEngine(this.binary,this.resources,join(this.directory,'engine'));this.worker=worker;
   for(const [i,target] of targets.entries()){
    this.progress(`正在同步 ${i+1}/${targets.length} · ${target.image.name}`);
    try{
     const sessionId=randomUUID();await worker.call('open',{path:target.image.path,sessionId,baselineVersion:target.image.baselineVersion||4,artProfile:target.profile});
     let listener:(message:any)=>void=()=>{},timeout:ReturnType<typeof setTimeout>|undefined;
     const preview=new Promise<any>((accept,reject)=>{listener=message=>{if(message.event==='preview'&&message.frame.sessionId===sessionId&&message.frame.revision===1&&message.frame.kind==='fit')accept(message.frame);else if(message.event==='error')reject(new Error(message.message));};worker.on('engine-event',listener);timeout=setTimeout(()=>reject(new Error('照片预览超时，请重试。')),120000);});
     let result,frame;try{[result,frame]=await Promise.all([worker.call('update',{revision:1,adjustments:target.adjustments,artProfile:target.profile}),preview]);}finally{worker.off('engine-event',listener);clearTimeout(timeout);}
     if(this.cancelled)return null;
     if(!resolve(frame.file).startsWith(join(this.directory,'engine')+'/'))throw new Error('无效的同步预览。');
     const key=`sync/${randomUUID()}.png`,file=join(this.directory,basename(key));await copyFile(frame.file,file);this.previews.set(key,file);
     results.push({path:target.image.path,adjustments:target.adjustments,profile:result.artProfile,preview:`captraw://preview/${key}`});
    }catch(error){if(this.cancelled)return null;throw new Error(`${target.image.name}：${error instanceof Error?error.message:String(error)}`);}
   }
   return results;
  }finally{
   this.worker?.terminate();this.worker=undefined;
   try{await rm(join(this.directory,'engine'),{recursive:true,force:true});if(this.cancelled||results.length!==targets.length){this.previews.clear();await rm(this.directory,{recursive:true,force:true});}}finally{this.active=false;}
  }
 }
}
