import {readdir,writeFile,rm,mkdtemp,lstat} from 'node:fs/promises';
import {join,extname,basename,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import type {InputProfileOption} from '@captraw/contracts';
import {assetBytes,assetDirectory,publishAsset} from './mask-assets.js';
type Core={call(method:string,params:unknown):Promise<any>};
export class InputProfiles {
 constructor(private root:string,private core:Core){}
 async inspect(reference:string):Promise<InputProfileOption>{
  const path=reference.startsWith('file:')?reference.slice(5):reference;
  if(!isAbsolute(path))throw new Error('配置文件缺少本地绝对路径。');
  const data=await assetBytes(path,'配置文件'),sha256=createHash('sha256').update(data).digest('hex'),expected=basename(path).match(/^([a-f0-9]{64})\.(dcp|icc|icm)$/i)?.[1];if(expected&&sha256!==expected.toLowerCase())throw new Error('配置文件资产内容校验失败。');return {...await this.core.call('inspectInputProfile',{path}),sha256};
 }
 async list(){
  await assetDirectory(this.root,'配置文件');const items:InputProfileOption[]=[],errors:string[]=[];
  for(const name of await readdir(this.root)){
   if(!/^[a-f0-9]{64}\.(dcp|icc|icm)$/.test(name))continue;
   try{const path=join(this.root,name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('配置文件库包含链接或无效文件');const data=await assetBytes(path,'配置文件');if(createHash('sha256').update(data).digest('hex')!==name.slice(0,64))throw new Error('内容校验失败');items.push(await this.inspect(path));}
   catch(e){errors.push(`${name}：${String(e)}`);}
  }
  return {items:items.sort((a,b)=>a.name.localeCompare(b.name)||a.reference!.localeCompare(b.reference!)),errors};
 }
 assertCompatible(info:InputProfileOption,camera:string,raw:boolean){
  if(info.kind==='dcp'&&!raw)throw new Error('DCP 仅适用于 RAW 照片，请为此照片选择 RGB ICC。');
  if(info.cameraModel&&info.cameraModel.trim().toUpperCase()!==camera.trim().toUpperCase())throw new Error(`配置文件适用于 ${info.cameraModel}，与当前相机 ${camera} 不匹配。`);
 }
 async importFile(path:string,camera:string,raw:boolean){
  path=resolve(path);const extension=extname(path).toLowerCase();
  if(!['.dcp','.icc','.icm'].includes(extension))throw new Error('请选择 DCP / ICC 配置文件。');
  const data=await assetBytes(path,'配置文件'),id=createHash('sha256').update(data).digest('hex');
  // Inspect the exact immutable bytes before adding anything to the library.
  const temporary=await mkdtemp(join(tmpdir(),'captraw-profile-'));
  try{
   const check=join(temporary,basename(path));await writeFile(check,data,{flag:'wx',mode:0o600});
   const info:InputProfileOption=await this.core.call('inspectInputProfile',{path:check});
   this.assertCompatible(info,camera,raw);
   await assetDirectory(this.root,'配置文件');const destination=join(this.root,id+(info.kind==='icc'?'.icc':'.dcp'));await publishAsset(this.core,destination,data,id,'配置文件');
   return {...info,reference:'file:'+destination,sha256:id};
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
}
