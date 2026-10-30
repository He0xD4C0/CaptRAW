import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {NativeEngine} from '../engine/engine.js';
import {publishBrushCoverage} from '../documents/mask-assets.js';
import {sourceFrameOpenSnapshot} from '@captraw/contracts';
import type {Adjustments,BrushPrepareRequest,BrushStrokeV1,ImageSession,MaskGeometry} from '@captraw/contracts';
type Job={id:string;cancelled:boolean;worker?:NativeEngine;directory?:string;path?:string;created?:boolean;delivered?:boolean};
const aborted=()=>new Error('画笔准备已取消。');
// One prepare RPC plus cancellation; successful document updates adopt leases.
// Adopted immutable bytes remain available to history/export snapshots until
// App exit. Session completion does not collect them; only staging is immediate.
export class BrushPreparation {
 private jobs=new Map<string,Job>();private adopted=new Set<string>();private published=new Set<string>();
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private binary:string,private resources:string,private cache:string,private publisher:()=>{call(method:string,params:unknown):Promise<any>}){}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const next=this.queue.then(run,run);this.queue=next.catch(()=>{});return next;}
 adopt(adjustments:Adjustments){
  const visit=(m:MaskGeometry&{components?:MaskGeometry[]})=>{for(const s of m.brush?.strokes||[])if(s.coverage)this.adopted.add(s.coverage.path);for(const c of m.components||[])visit(c);};
  for(const m of adjustments.masks)visit(m);
  for(const [id,job] of this.jobs)if(job.path&&this.adopted.has(job.path)&&job.delivered)this.jobs.delete(id);
 }
 async invalidate(){
  // Delivered leases can already belong to history even if the first render
  // was superseded by Undo. Only their canvas transaction may discard them.
  await Promise.all([...this.jobs.values()].filter(j=>!j.delivered).map(j=>this.cancel(j.id)));
 }
 async cancel(id?:string){
  const jobs=[...this.jobs.values()].filter(j=>!id||j.id===id);
  for(const job of jobs){job.cancelled=true;job.worker?.terminate();if(job.delivered)this.jobs.delete(job.id);}
  await this.serial(async()=>{
   for(const job of jobs)if(job.path&&this.published.has(job.path)&&!this.adopted.has(job.path)&&![...this.jobs.values()].some(j=>!j.cancelled&&j.path===job.path)){
    await rm(job.path,{force:true});this.published.delete(job.path);
   }
  });
 }
 async prepare(image:ImageSession,request:BrushPrepareRequest,adjustments:Adjustments,artProfile:string,checkSource:()=>Promise<void>,beforePublish=checkSource):Promise<BrushStrokeV1|null>{
  if(!request||typeof request.id!=='string'||!request.id||request.id.length>128||this.jobs.has(request.id))throw new Error('无效或重复的画笔任务。');
  const job:Job={id:request.id,cancelled:false};this.jobs.set(job.id,job);
  const check=async()=>{if(job.cancelled)throw aborted();await checkSource();if(job.cancelled)throw aborted();};
  let stopped:Promise<void>|undefined;
  try{
   await check();await mkdir(join(this.cache,'brush'),{recursive:true});job.directory=await mkdtemp(join(this.cache,'brush','prepare-'));await check();
   const worker=new NativeEngine(this.binary,this.resources,join(job.directory,'render'));job.worker=worker;
   stopped=new Promise<void>(done=>worker.child.once('close',()=>done()));
   await worker.call('open',{path:image.path,sessionId:image.id,...sourceFrameOpenSnapshot(adjustments,artProfile,image.sourceFrame)});await check();
   await worker.call('update',{revision:1,artProfile,adjustments:{...structuredClone(adjustments),crop:null,masks:[]},colorSampling:true});await check();
   const output=join(job.directory,'coverage.png');const info=await worker.call('prepareBrush',{sessionId:image.id,revision:1,stroke:request.stroke,output});await check();
   if(!Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||info.width!==request.stroke.canvas.width||info.height!==request.stroke.canvas.height)throw new Error('画笔覆盖率尺寸无效。');
   const coverage=await this.serial(async()=>{
    // Publication uses the surviving core, so cancelling the sampling worker
    // cannot interrupt an atomic publish before its ownership result returns.
    await check();const asset=await publishBrushCoverage(this.publisher(),this.cache,output,async()=>{await beforePublish();await check();});job.path=asset.path;job.created=asset.created;if(asset.created)this.published.add(asset.path);
    return {path:asset.path,sha256:asset.sha256,width:info.width as number,height:info.height as number};
   });
   await check();const stroke=structuredClone(request.stroke);
   if(stroke.autoMask===false)throw new Error('自动蒙版任务缺少颜色选择。');stroke.autoMask.seed=info.seed;stroke.coverage=coverage;
   job.delivered=true;return stroke;
  }catch(error){
   const cancelled=job.cancelled;await this.cancel(job.id);if(cancelled)return null;throw error;
  }finally{
   job.worker?.terminate();await stopped;if(job.directory)await rm(job.directory,{recursive:true,force:true});
   job.worker=undefined;job.directory=undefined;
   if(!job.delivered)this.jobs.delete(job.id);
  }
 }
}
