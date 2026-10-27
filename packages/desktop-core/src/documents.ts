import {ENGINE_VERSION,READABLE_ENGINE_VERSIONS,type EditDocument,type BatchSaveRequest,type BatchSaveResult} from '@captraw/contracts';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat,lstat,rm} from 'node:fs/promises';
import {basename,extname,join,isAbsolute} from 'node:path';
import {NativeEngine} from './engine.js';
import {saveRecipeWithMasks} from './mask-assets.js';
import {XMP,CRS,CT,property,text,encode,readExtension,encodeAdjustments,decodeAdjustments,type XMPProperty} from './xmp.js';
export class Documents {
 constructor(readonly xmp:XMP){}
 async read(path:string){
  const result=await this.xmp.read(path);
  const engineVersion=readExtension(result.properties,'EngineVersion')||'';
  if(engineVersion&&!READABLE_ENGINE_VERSIONS.has(engineVersion))throw new Error('XMP 使用了不支持的 ART 显影版本。');
  const {adjustments,warnings}=decodeAdjustments(result.properties);
  const source=readExtension(result.properties,'Source');
  if(source&&(!source.path||!Number.isSafeInteger(source.size)||!/^[a-f0-9]{64}$/.test(source.sha256)))throw new Error('XMP 原片关联无效。');
  const baselineVersion=readExtension(result.properties,'BaselineVersion');if(baselineVersion!==undefined&&baselineVersion!==4)throw new Error('XMP 初始显影版本不受支持。');
  const artProfile=readExtension(result.properties,'ARTProfile')||'';if(typeof artProfile!=='string')throw new Error('无效的 ART 配置。');
  return {xmpPacket:result.packet,engineVersion,source,artProfile,adjustments,warnings,baselineVersion:4 as const,maskAssets:readExtension(result.properties,'MaskAssets'),inputProfileAsset:readExtension(result.properties,'InputProfileAsset')};
 }
 async serialize(doc:EditDocument){
  const changes:XMPProperty[]=[...encodeAdjustments(doc.adjustments),property(CT,'EngineVersion',encode(ENGINE_VERSION)),property(CT,'Source',encode(doc.source)),property(CT,'ARTProfile',encode(doc.artProfile)),property(CT,'BaselineVersion',encode(4)),property(CT,'MaskAssets',doc.maskAssets?encode(doc.maskAssets):null),property(CT,'InputProfileAsset',doc.inputProfileAsset?encode(doc.inputProfileAsset):null),property(CRS,'HasSettings',text('True'))];
  // Do not claim the Adobe renderer version for an ART-produced image.
  if(!doc.xmpPacket)changes.push(property(CRS,'ProcessVersion',text('15.4')));
  const result=await this.xmp.call('write',doc.xmpPacket||'',changes);return result.packet!;
 }
}

export function validateBatchSave(request:BatchSaveRequest){
 if(!request||!Array.isArray(request.documents)||!request.documents.length||request.documents.length>500)throw new Error('请选择 1–500 张照片保存。');
 const paths=new Set<string>();
 for(const d of request.documents){
  if(!d||typeof d.path!=='string'||!isAbsolute(d.path)||paths.has(d.path)||typeof d.artProfile!=='string'||!d.adjustments||typeof d.adjustments!=='object'||Array.isArray(d.adjustments)||!Number.isInteger(d.width)||!Number.isInteger(d.height)||d.width<1||d.height<1||d.width>200000||d.height>200000||(d.xmpPacket!==undefined&&typeof d.xmpPacket!=='string'))throw new Error('保存照片快照无效或重复。');
  paths.add(d.path);
 }
}

export class BatchDocumentSaver {
 active=false;
 private cancelled=false;
 constructor(private binary:string,private resources:string,private cache:string,private documents:Documents,private progress:(message:string)=>void){}
 // Finish the current atomic document before stopping; published files stay usable.
 cancel(){this.cancelled=true;}
 async run(input:BatchSaveRequest,directory:string):Promise<BatchSaveResult>{
  if(this.active)throw new Error('已有批量保存任务正在运行。');
  validateBatchSave(input);const request=structuredClone(input),results:BatchSaveResult['results']=[];
  this.active=true;this.cancelled=false;
  try{
   if(!(await stat(directory)).isDirectory())throw new Error('请选择保存文件夹。');
   for(const [index,doc] of request.documents.entries()){
    if(this.cancelled)break;
    this.progress(`正在保存 ${index+1}/${request.documents.length} · ${basename(doc.path)}`);
    const cache=join(this.cache,'save-'+randomUUID());let worker:NativeEngine|undefined;
    try{
     worker=new NativeEngine(this.binary,this.resources,cache);
     await worker.ready;
     const info=await stat(doc.path);if(!info.isFile())throw new Error('原片不是可读取的文件。');
     const hash=createHash('sha256');for await(const chunk of createReadStream(doc.path))hash.update(chunk);
     const {artProfile}=await worker.call('compose',doc);
     const recipe:EditDocument={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:doc.path,size:info.size,sha256:hash.digest('hex')},adjustments:doc.adjustments,artProfile,xmpPacket:doc.xmpPacket};
     const stem=basename(doc.path,extname(doc.path));let suffix=0;
     for(;;){
      const output=join(directory,`${stem}${suffix?'_'+suffix:''}.xmp`);++suffix;
      const exists=async(path:string)=>{try{await lstat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
      if(await exists(output)||await exists(output+'.assets'))continue;
      if(await saveRecipeWithMasks(worker,output,recipe,value=>this.documents.serialize(value),false)){results.push({source:doc.path,output});break;}
     }
    }catch(error){
     const messages:Record<string,string>={ENOENT:'文件已移动或删除，请恢复原片及所需资产后重试。',EACCES:'无法读取原片或写入目标文件夹，请检查访问权限。',EPERM:'无法读取原片或写入目标文件夹，请检查访问权限。',ENOSPC:'目标磁盘空间不足，请释放空间后重试。',EROFS:'目标文件夹位于只读磁盘，请选择可写入的位置。'};
     results.push({source:doc.path,error:messages[(error as NodeJS.ErrnoException).code||'']||(error instanceof Error?error.message:String(error))});
    }
    finally{
     if(worker){
      const stopped=!worker.child.pid||worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise<void>(accept=>worker!.child.once('exit',()=>accept()));
      worker.terminate();await stopped;await rm(cache,{recursive:true,force:true});
     }
    }
   }
   return {results,cancelled:this.cancelled};
  }finally{this.active=false;}
 }
}
