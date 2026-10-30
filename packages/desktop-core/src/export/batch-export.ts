import {join,basename,extname,isAbsolute} from 'node:path';
import {rmSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativeEngine} from '../engine/engine.js';
import type {XMP} from '../documents/xmp.js';
import {finishOutputMetadata} from './output-metadata.js';
import {validateSourceIdentity,prepareSourceIdentities,verifySourceIdentity} from '../engine/source-identity.js';
import {validateExportOptions} from '@captraw/contracts/export-options';
import {OUTPUT_COLOR_SPACES,validRating,type BatchExportRequest,type ExportResult,type JobStatus} from '@captraw/contracts';

export function validateBatch(request:BatchExportRequest){
 if(!request||!['jpeg','tiff','avif'].includes(request.format)||!Object.hasOwn(OUTPUT_COLOR_SPACES,request.colorSpace))throw new Error('不支持的导出格式或色彩空间。');
 if(request.format==='avif'&&request.colorSpace!=='rec2020')throw new Error('HDR AVIF 使用 Rec.2020 / PQ。');
 validateExportOptions(request.options);
 if(!Array.isArray(request.documents)||!request.documents.length)throw new Error('请选择需要导出的照片。');
 const paths=new Set<string>();
 for(const d of request.documents){
  if(!d||typeof d.path!=='string'||!isAbsolute(d.path)||paths.has(d.path)||typeof d.artProfile!=='string'||!d.adjustments||!Number.isInteger(d.width)||!Number.isInteger(d.height)||d.width<1||d.height<1||d.width>200000||d.height>200000)throw new Error('导出照片快照无效或重复。');
  paths.add(d.path);
  if(d.xmpPacket!==undefined&&(typeof d.xmpPacket!=='string'||Buffer.byteLength(d.xmpPacket)>64*1024*1024))throw new Error('导出 XMP 快照无效或超过 64 MiB。');
  if(d.rating!==undefined&&!validRating(d.rating))throw new Error('评分须为 -1（拒绝）或 0–5。');
  if(d.label!==undefined&&typeof d.label!=='string')throw new Error('颜色标签必须为文本。');
  if(d.sourceIdentity!==undefined)validateSourceIdentity(d.sourceIdentity);
 }
}
export class BatchExporter{
 active=false;
 private cancelled=false;
 private worker?:NativeEngine;
 private publishing=false;
 private temporary?:string;
 constructor(private binary:string,private resources:string,private cache:string,private send:(job:JobStatus)=>void,private xmp?:XMP){}
 cancel(){this.cancelled=true;if(!this.publishing)this.worker?.terminate();}
 shutdown(){this.cancel();if(this.temporary)rmSync(this.temporary,{force:true});}
 async run(input:BatchExportRequest,directory:string){
  if(this.active)throw new Error('已有导出任务正在运行。');
  validateBatch(input);const request=structuredClone(input);
  if(request.options?.metadata&&!this.xmp)throw new Error('输出元数据需要配置 XMP 后端。');
  this.active=true;this.cancelled=false;
  const id=randomUUID(),total=request.documents.length,results:ExportResult[]=[];
  const report=(state:JobStatus['state'],progress:number,message:string)=>this.send({id,state,progress,message,total,results:structuredClone(results)});
  const extension=request.format==='jpeg'?'jpg':request.format==='avif'?'avif':'tiff';
  try{
   const identities=await prepareSourceIdentities(request.documents,()=>this.cancelled);
   for(const [index,doc] of request.documents.entries()){
    if(this.cancelled)break;
    const name=basename(doc.path),stem=basename(doc.path,extname(doc.path))+'_CaptRAW';
    const cache=join(this.cache,`batch-${id}-${index}`),temporary=join(directory,`.captraw-${id}-${index}.tmp`);
    this.temporary=temporary;let progress=0;
    report('running',index/total,`正在导出 ${index+1}/${total} · ${name}`);
    const worker=new NativeEngine(this.binary,this.resources,cache);this.worker=worker;
    worker.on('engine-event',m=>{if(m.event==='progress'&&!this.cancelled){progress=Math.max(progress,Math.min(1,Number(m.progress)||0));report('running',(index+progress)/total,`正在导出 ${index+1}/${total} · ${name}`);}});
    try{
     await worker.ready;
     const identity=identities.get(doc.path)!;if(identity instanceof Error)throw identity;
     await verifySourceIdentity(doc.path,identity);
     const {artProfile}=await worker.call('compose',doc);
     if(this.cancelled)break;
     const output=await worker.call('export',{path:doc.path,artProfile,output:temporary,format:request.format,colorSpace:request.colorSpace,options:request.options,rating:doc.rating});
     if(this.xmp&&!this.cancelled)await finishOutputMetadata(worker,this.xmp,doc,request.format,request.options,output);
     else if(request.options?.metadata&&!this.cancelled)throw new Error('输出元数据需要配置 XMP 后端。');
     if(this.cancelled)break;
     let suffix=0;
     while(!this.cancelled){
      const output=join(directory,`${stem}${suffix?'_'+suffix:''}.${extension}`);
      await verifySourceIdentity(doc.path,identity);
      if(this.cancelled)break;
      this.publishing=true;
      let published=false;try{published=await worker.call('publish',{temporary,destination:output});}finally{this.publishing=false;}
      if(published){results.push({source:doc.path,output});break;}
      ++suffix;
     }
    }catch(error){if(!this.cancelled)results.push({source:doc.path,error:error instanceof Error?error.message:String(error)});}
    finally{
     // Wait for the worker to stop before removing output/cache, including cancellation.
     const stopped=!worker.child.pid||worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise<void>(resolve=>worker.child.once('exit',()=>resolve()));
     worker.terminate();await stopped;this.worker=undefined;
     await rm(temporary,{force:true});this.temporary=undefined;await rm(cache,{recursive:true,force:true});
    }
   }
   const completed=results.filter(r=>r.output).length,failed=results.filter(r=>r.error).length;
   report(this.cancelled?'cancelled':failed?'error':'done',this.cancelled?results.length/total:1,`${this.cancelled?'已取消，保留已导出文件':failed?'批量导出结束':'批量导出完成'} · 已导出 ${completed}/${total}${failed?` · 失败 ${failed}`:''}`);
   return results;
  }catch(error){
   report('error',results.length/total,`批量导出停止 · 已导出 ${results.filter(r=>r.output).length}/${total} · ${error instanceof Error?error.message:String(error)}`);
   throw error;
  }finally{this.active=false;}
 }
}
