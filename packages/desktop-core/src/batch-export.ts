import {join,basename,extname,isAbsolute} from 'node:path';
import {rmSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativeEngine} from './engine.js';
import {validateExportOptions} from '@captraw/contracts/export-options';
import {OUTPUT_COLOR_SPACES,type BatchExportRequest,type ExportResult,type JobStatus} from '@captraw/contracts';

export function validateBatch(request:BatchExportRequest){
 if(!request||!['jpeg','tiff'].includes(request.format)||!Object.hasOwn(OUTPUT_COLOR_SPACES,request.colorSpace))throw new Error('不支持的导出格式或色彩空间。');
 validateExportOptions(request.options);
 if(!Array.isArray(request.documents)||!request.documents.length)throw new Error('请选择需要导出的照片。');
 const paths=new Set<string>();
 for(const d of request.documents){
  if(!d||typeof d.path!=='string'||!isAbsolute(d.path)||paths.has(d.path)||typeof d.artProfile!=='string'||!d.adjustments||!Number.isInteger(d.width)||!Number.isInteger(d.height)||d.width<1||d.height<1||d.width>200000||d.height>200000)throw new Error('导出照片快照无效或重复。');
  paths.add(d.path);
 }
}
export class BatchExporter{
 active=false;
 private cancelled=false;
 private worker?:NativeEngine;
 private publishing=false;
 private temporary?:string;
 constructor(private binary:string,private resources:string,private cache:string,private send:(job:JobStatus)=>void){}
 cancel(){this.cancelled=true;if(!this.publishing)this.worker?.terminate();}
 shutdown(){this.cancel();if(this.temporary)rmSync(this.temporary,{force:true});}
 async run(input:BatchExportRequest,directory:string){
  if(this.active)throw new Error('已有导出任务正在运行。');
  validateBatch(input);const request=structuredClone(input);
  this.active=true;this.cancelled=false;
  const id=randomUUID(),total=request.documents.length,results:ExportResult[]=[];
  const report=(state:JobStatus['state'],progress:number,message:string)=>this.send({id,state,progress,message,total,results:structuredClone(results)});
  const extension=request.format==='jpeg'?'jpg':'tiff';
  try{
   for(const [index,doc] of request.documents.entries()){
    if(this.cancelled)break;
    const name=basename(doc.path),stem=basename(doc.path,extname(doc.path))+'_CaptRAW';
    const cache=join(this.cache,`batch-${id}-${index}`),temporary=join(directory,`.captraw-${id}-${index}.tmp`);
    this.temporary=temporary;let progress=0;
    report('running',index/total,`正在导出 ${index+1}/${total} · ${name}`);
    const worker=new NativeEngine(this.binary,this.resources,cache);this.worker=worker;
    worker.on('engine-event',m=>{if(m.event==='progress'&&!this.cancelled){progress=Math.max(progress,Math.min(1,Number(m.progress)||0));report('running',(index+progress)/total,`正在导出 ${index+1}/${total} · ${name}`);}});
    try{
     const {artProfile}=await worker.call('compose',doc);
     if(this.cancelled)break;
     await worker.call('export',{path:doc.path,artProfile,output:temporary,format:request.format,colorSpace:request.colorSpace,options:request.options});
     if(this.cancelled)break;
     let suffix=0;
     while(!this.cancelled){
      const output=join(directory,`${stem}${suffix?'_'+suffix:''}.${extension}`);
      this.publishing=true;
      let published=false;try{published=await worker.call('publish',{temporary,destination:output});}finally{this.publishing=false;}
      if(published){results.push({source:doc.path,output});break;}
      ++suffix;
     }
    }catch(error){if(!this.cancelled)results.push({source:doc.path,error:error instanceof Error?error.message:String(error)});}
    finally{
     // Wait for the worker to stop before removing output/cache, including cancellation.
     const stopped=worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise<void>(resolve=>worker.child.once('exit',()=>resolve()));
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
