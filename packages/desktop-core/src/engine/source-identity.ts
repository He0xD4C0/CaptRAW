import {open,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import type {SourceIdentity} from '@captraw/contracts';

// A session-local filesystem signature, not a persistent document field or a lock.
const version=(info:BigIntStats)=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
const changed=(path:string)=>new Error('原片已变化或无法读取。当前编辑已保留，请恢复原片后重试：'+path);
export function validateSourceIdentity(value:unknown):asserts value is SourceIdentity {
 if(!value||typeof value!=='object')throw new Error('原片身份快照无效。');
 const identity=value as SourceIdentity;
 if(!Number.isSafeInteger(identity.size)||identity.size<0||typeof identity.sha256!=='string'||!/^[a-f0-9]{64}$/.test(identity.sha256)||typeof identity.version!=='string'||!identity.version.length)throw new Error('原片身份快照无效。');
}
export async function captureSourceIdentity(path:string):Promise<SourceIdentity>{
 const file=await open(path,'r').catch(()=>{throw changed(path);});
 try{
  const before=await file.stat({bigint:true});
  if(!before.isFile()||before.size>BigInt(Number.MAX_SAFE_INTEGER)||version(before)!==version(await stat(path,{bigint:true})))throw changed(path);
  const hash=createHash('sha256');
  for await(const bytes of file.createReadStream({autoClose:false,highWaterMark:1024*1024}))hash.update(bytes);
  if(version(before)!==version(await file.stat({bigint:true}))||version(before)!==version(await stat(path,{bigint:true})))throw changed(path);
  return {size:Number(before.size),sha256:hash.digest('hex'),version:version(before)};
 }catch(error){if(error instanceof Error&&error.message.startsWith('原片已变化'))throw error;throw changed(path);}
 finally{await file.close();}
}
export async function verifySourceIdentity(path:string,expected:SourceIdentity){
 validateSourceIdentity(expected);
 const actual=await captureSourceIdentity(path);
 // Restoring or moving the same bytes must recover an interrupted workflow.
 // The filesystem signature guards each read; content identifies the photo.
 if(actual.size!==expected.size||actual.sha256!==expected.sha256)throw changed(path);
}
// Legacy headless snapshots establish their baseline here, before any dialog or
// worker. They cannot detect replacement before this run began. Never recapture
// that baseline later to attach old edits to a different source.
export async function prepareSourceIdentities(documents:readonly {path:string;sourceIdentity?:SourceIdentity}[],cancelled:()=>boolean=()=>false){
 const identities=new Map<string,SourceIdentity|Error>();
 for(const doc of documents){
  if(cancelled())break;
  try{
   if(doc.sourceIdentity){await verifySourceIdentity(doc.path,doc.sourceIdentity);identities.set(doc.path,doc.sourceIdentity);}
   else identities.set(doc.path,await captureSourceIdentity(doc.path));
  }catch(error){identities.set(doc.path,error instanceof Error?error:new Error(String(error)));}
 }
 return identities;
}
