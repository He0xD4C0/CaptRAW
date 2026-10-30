import {ENGINE_VERSION,type SessionSaveRequest,type BatchSaveResult,type EditDocument} from '@captraw/contracts';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readFile,realpath,mkdtemp,readdir,rename,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve,isAbsolute} from 'node:path';
import {Documents,validateBatchSave} from './documents.js';
import {prepareSourceIdentities,verifySourceIdentity} from '../engine/source-identity.js';
import {NativeEngine} from '../engine/engine.js';
import {documentRelativePath} from '../engine/runtime.js';
import {nativeSidecar,decodeNativeEdit} from './native-codec.js';
import {assetDirectory,publishAsset,saveRecipeWithMasks} from './mask-assets.js';

export interface SessionSaveTarget {source:string;output:string;exists:boolean;changed:boolean}
type TargetState={stamp:string;nativePacket?:string};
export function validateSessionSave(request:SessionSaveRequest){
 if(!request||typeof request.sessionId!=='string'||!request.sessionId.trim())throw new Error('保存会话标识无效。');
 validateBatchSave(request);
}
export async function saveTargetState(path:string):Promise<TargetState>{
 let before;
 try{before=await lstat(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {stamp:'absent'};throw error;}
 if(!before.isFile()||before.isSymbolicLink()||before.size>64n*1024n*1024n)throw new Error('原生编辑文档 目标必须是普通文件，不能是链接或超过 64 MiB。');
 const bytes=await readFile(path),after=await lstat(path,{bigint:true});
 const identity=(s:typeof before)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
 if(identity(before)!==identity(after))throw new Error('原生编辑文档 在读取期间被外部修改，请重试并重新确认。');
 const nativePacket=new TextDecoder('utf-8',{fatal:true}).decode(bytes);decodeNativeEdit(nativePacket);
 return {stamp:identity(after)+':'+createHash('sha256').update(bytes).digest('hex'),nativePacket};
}
const errorMessage=(error:unknown)=>{
 const messages:Record<string,string>={EACCES:'无法读取原片或写入目标，请检查权限，或对失败项另存。',EPERM:'无法读取原片或写入目标，请检查权限，或对失败项另存。',EROFS:'目标位于只读磁盘，请对失败项另存。',ENOSPC:'目标磁盘空间不足，请释放空间或另存。',ENOENT:'原片、资产或目标文件夹已移动或删除。'};
 return messages[(error as NodeJS.ErrnoException).code||'']||(error instanceof Error?error.message:String(error));
};

export class SessionDocumentSaver {
 active=false;
 private cancelled=false;
 private sessionId?:string;
 private confirmations=new Map<string,Map<string,string>>();
 private locations=new Map<string,Map<string,string>>();
 constructor(private binary:string,private resources:string,private cache:string,private documents:Documents,
  private confirm:(targets:SessionSaveTarget[])=>Promise<boolean>,private progress:(message:string)=>void){}
 cancel(){this.cancelled=true;}
 // Completion/discard may release the current session once its save has settled.
 forgetSession(sessionId:string){
  if(this.sessionId!==sessionId)return;
  if(this.active)throw new Error('保存尚未结束，不能清除会话保存位置。');
  this.confirmations.clear();this.locations.clear();this.sessionId=undefined;
 }
 async run(input:SessionSaveRequest,retryTarget?:string):Promise<BatchSaveResult|null>{
  if(this.active)throw new Error('已有会话保存任务正在运行。');
  validateSessionSave(input);
  if(retryTarget!==undefined&&(!isAbsolute(retryTarget)||!/\.captraw$/i.test(retryTarget)||input.documents.length!==1))throw new Error('另存须选择单张照片和绝对路径的 .captraw 目标。');
  const request=structuredClone(input),results:BatchSaveResult['results']=[];
  // Only the current editing session owns location consent. A new ID ends the old one.
  if(this.sessionId!==request.sessionId){this.confirmations.clear();this.locations.clear();this.sessionId=request.sessionId;}
  const confirmed=this.confirmations.get(request.sessionId)||new Map<string,string>();this.confirmations.set(request.sessionId,confirmed);
  const locations=this.locations.get(request.sessionId)||new Map<string,string>();this.locations.set(request.sessionId,locations);
  this.active=true;this.cancelled=false;
  try{
   const identities=await prepareSourceIdentities(request.documents,()=>this.cancelled);
   if(this.cancelled)return {results,cancelled:true};
   const targets=request.documents.map(doc=>resolve(retryTarget||locations.get(doc.path)||nativeSidecar(doc.path)));
   const sources=await Promise.all(request.documents.map(doc=>realpath(doc.path).catch(()=>resolve(doc.path))));
   const states=new Map<string,TargetState>(),errors=new Map<string,string>(),pending:SessionSaveTarget[]=[];
   for(const [index,doc] of request.documents.entries()){
    const output=targets[index];
    try{
     const identity=identities.get(doc.path)!;if(identity instanceof Error)throw identity;
     if(sources.includes(output)||sources.includes(await realpath(output).catch(()=>output)))throw new Error('不能覆盖原始照片。');
     if(targets.indexOf(output)!==targets.lastIndexOf(output))throw new Error('多张原片对应同一个原生编辑文档，请单独另存。');
     const state=await saveTargetState(output);states.set(output,state);
     if(confirmed.get(output)!==state.stamp)pending.push({source:doc.path,output,exists:state.nativePacket!==undefined,changed:confirmed.has(output)});
    }catch(error){errors.set(output,errorMessage(error));}
   }
   if(pending.length){
    if(this.cancelled)return {results,cancelled:true};
    const accepted=await this.confirm(pending);
    if(this.cancelled)return {results,cancelled:true};
    if(!accepted)return null;
    for(const target of pending)confirmed.set(target.output,states.get(target.output)!.stamp);
   }
   for(const [index,doc] of request.documents.entries()){
    if(this.cancelled)break;
    const output=targets[index];
    if(errors.has(output)){results.push({source:doc.path,error:errors.get(output)});continue;}
    this.progress(`正在保存 ${index+1}/${request.documents.length} · ${basename(doc.path)}`);
    const cache=join(this.cache,'session-save-'+randomUUID());let worker:NativeEngine|undefined,staging:string|undefined;
    try{
     const identity=identities.get(doc.path)!;if(identity instanceof Error)throw identity;
     await verifySourceIdentity(doc.path,identity);
     worker=new NativeEngine(this.binary,this.resources,cache);await worker.ready;
     const {artProfile}=await worker.call('compose',doc);
     const recipe:EditDocument={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:documentRelativePath(dirname(output),doc.path),size:identity.size,sha256:identity.sha256},adjustments:doc.adjustments,artProfile,rating:doc.rating,label:doc.label};
     staging=await mkdtemp(join(dirname(output),'.session-save-'));const staged=join(staging,basename(output));
     for(;;){
      const state=await saveTargetState(output);
      if(confirmed.get(output)!==state.stamp){
       if(this.cancelled)throw new Error('已取消保存，未替换外部更新的 原生编辑文档。');
       const accepted=await this.confirm([{source:doc.path,output,exists:state.nativePacket!==undefined,changed:true}]);
       if(this.cancelled||!accepted){this.cancelled=true;throw new Error('已取消替换外部更新的 原生编辑文档。');}
       confirmed.set(output,state.stamp);
       // Re-read after the dialog too: a confirmation authorizes only the displayed version.
       continue;
      }
      const previous=state.nativePacket?decodeNativeEdit(state.nativePacket):undefined;
      recipe.nativePacket=state.nativePacket??doc.nativePacket;
      recipe.xmpPacket=previous&&previous.source.sha256===identity.sha256&&previous.source.size===identity.size?previous.xmpPacket??doc.xmpPacket:doc.xmpPacket;
      let packet='';
      await saveRecipeWithMasks(worker,staged,recipe,async value=>{
       packet=await this.documents.serialize(value,[doc.xmpPacket]);
       return packet;
      });
      const assets=staged+'.assets';
      const files=await readdir(assets).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      if(files.length){
       await assetDirectory(output+'.assets');
       for(const file of files){const bytes=await readFile(join(assets,file));await publishAsset(worker,join(output+'.assets',file),bytes,createHash('sha256').update(bytes).digest('hex'));}
      }
      await verifySourceIdentity(doc.path,identity);
      if((await saveTargetState(output)).stamp!==state.stamp)continue;
      // New targets use exclusive publication. Existing files switch atomically on this volume.
      if(state.nativePacket===undefined){if(!await worker.call('publish',{temporary:staged,destination:output}))continue;}
      else await rename(staged,output);
      const saved=await saveTargetState(output).catch(()=>undefined);
      if(saved?.nativePacket===packet)confirmed.set(output,saved.stamp);else confirmed.delete(output);
      locations.set(doc.path,output);results.push({source:doc.path,output,nativePacket:packet,xmpPacket:decodeNativeEdit(packet).xmpPacket});break;
     }
    }catch(error){results.push({source:doc.path,error:errorMessage(error)});}
    finally{
     if(worker){const stopped=!worker.child.pid||worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise<void>(accept=>worker!.child.once('exit',()=>accept()));worker.terminate();await stopped;}
     // Attempt both cleanups even if one fails; never discard earlier per-image results.
     const cleanup=await Promise.allSettled([rm(cache,{recursive:true,force:true}),...(staging?[rm(staging,{recursive:true,force:true})]:[])]);
     for(const [index,result] of cleanup.entries())if(result.status==='rejected')this.progress(`保存临时文件清理失败：${index===0?cache:staging} · ${errorMessage(result.reason)}`);
    }
   }
   return {results,cancelled:this.cancelled};
  }finally{this.active=false;}
 }
}
