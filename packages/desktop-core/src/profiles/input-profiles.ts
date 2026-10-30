import {readdir,writeFile,rm,mkdtemp,lstat} from 'node:fs/promises';
import {join,extname,basename,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import type {InputProfileOption,ColorProfileSettings} from '@captraw/contracts';
import {assetBytes,assetDirectory,publishAsset} from '../documents/mask-assets.js';
import {parseEnhancedProfile} from './enhanced-profiles.js';
import type {XMP} from '../documents/xmp.js';
type Core={call(method:string,params:unknown):Promise<any>};
export class InputProfiles {
 constructor(private root:string,private core:Core,private xmp?:XMP){}
 async inspect(reference:string):Promise<InputProfileOption>{
  const path=reference.startsWith('file:')?reference.slice(5):reference;
  if(!isAbsolute(path))throw new Error('配置文件缺少本地绝对路径。');
  const data=await assetBytes(path,'配置文件'),sha256=createHash('sha256').update(data).digest('hex'),expected=basename(path).match(/^([a-f0-9]{64})\.(dcp|icc|icm|look)$/i)?.[1];if(expected&&sha256!==expected.toLowerCase())throw new Error('配置文件资产内容校验失败。');return {...await this.core.call('inspectInputProfile',{path}),sha256};
 }
 async list(){
  await assetDirectory(this.root,'配置文件');const items:InputProfileOption[]=[],errors:string[]=[];
  for(const name of await readdir(this.root)){
   if(!/^[a-f0-9]{64}\.(dcp|icc|icm|look)$/.test(name))continue;
   try{const path=join(this.root,name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('配置文件库包含链接或无效文件');const data=await assetBytes(path,'配置文件');if(createHash('sha256').update(data).digest('hex')!==name.slice(0,64))throw new Error('内容校验失败');items.push(await this.inspect(path));}
   catch(e){errors.push(`${name}：${String(e)}`);}
  }
  return {items:items.sort((a,b)=>a.name.localeCompare(b.name)||a.reference!.localeCompare(b.reference!)),errors};
 }
 assertCompatible(info:InputProfileOption,camera:string,raw:boolean){
  if(info.kind==='dcp'&&!raw)throw new Error('DCP 仅适用于 RAW 照片，请为此照片选择 RGB ICC。');
  if(info.cameraModel&&info.cameraModel.trim().toUpperCase()!==camera.trim().toUpperCase())throw new Error(`配置文件适用于 ${info.cameraModel}，与当前相机 ${camera} 不匹配。`);
  if(info.enhanced){const p=info.enhanced;if(raw&&!p.supportsSceneReferred||!raw&&!p.supportsOutputReferred)throw new Error('此 Look 不支持当前输入类型，未应用。');if(p.cameraModelRestriction&&p.cameraModelRestriction.trim().toUpperCase()!==camera.trim().toUpperCase())throw new Error(`Look 仅适用于 ${p.cameraModelRestriction}，与当前相机不匹配。`);}
 }
 async resolveLook(info:InputProfileOption,camera:string,raw:boolean):Promise<InputProfileOption>{
  if(!info.enhanced)return info;this.assertCompatible(info,camera,raw);
  const p=info.enhanced,base=p.baseProfile;
  let settings:ColorProfileSettings={mode:'auto',toneCurve:false,lookTable:false,hueSatMap:true,baselineExposure:true,illuminant:0};
  if(base||raw){
   if(!raw)throw new Error(`Look 需要基础 DCP“${base}”，不能应用于已渲染照片。`);
   // RAWmakase library.rs, pinned by native/config/enhanced-profile-sources.json (MIT),
   // LookBase::Any prefers an available Adobe Standard, then falls
   // back to the image/open-source base. An absent name is not a missing asset.
   const {items}=await this.list();const candidates=items.filter(v=>v.kind==='dcp'&&v.name===(base||'Adobe Standard')&&(!v.cameraModel||v.cameraModel.trim().toUpperCase()===camera.trim().toUpperCase()));
   if(base&&candidates.length!==1)throw new Error(candidates.length?`基础 DCP“${base}”有多个匹配，请移除歧义后重试。`:`Look 缺少基础 DCP“${base}”，请先导入适用于当前相机的原始 DCP。`);
   if(candidates.length===1){const dcp=candidates[0];this.assertCompatible(dcp,camera,raw);
    settings={...settings,mode:'inherited',reference:dcp.reference,toneCurve:!!dcp.dcp?.toneCurve,lookTable:!p.parameters.LookTable&&!!dcp.dcp?.lookTable};}
  }
  return {...info,cameraModel:p.cameraModelRestriction||undefined,settings:{...settings,look:{profile:structuredClone(p),amount:1}}};
 }
 async listFor(camera:string,raw:boolean){const result=await this.list(),items:InputProfileOption[]=[];for(const info of result.items){try{items.push(info.enhanced?await this.resolveLook(info,camera,raw):info);}catch(e){result.errors.push(`${info.name}：${String(e)}`);}}return {...result,items};}
 async resolveSettings(settings:ColorProfileSettings,camera:string,raw:boolean):Promise<ColorProfileSettings>{
  const p=settings.look?.profile;if(!p)return settings;
  this.assertCompatible({id:'inherited',kind:'look',name:p.name,enhanced:p},camera,raw);
  const base=p.baseProfile;
  if(!base){if(settings.mode==='inherited'&&settings.reference)this.assertCompatible(await this.inspect(settings.reference),camera,raw);return structuredClone(settings);}
  if(base&&settings.mode==='inherited'&&settings.reference){
   const info=await this.inspect(settings.reference);this.assertCompatible(info,camera,raw);
   if(info.kind!=='dcp'||info.name!==base)throw new Error(`Look 的基础配置必须为匹配的 DCP“${base}”。`);
   return structuredClone(settings);
  }
  const resolved=await this.resolveLook({id:'inherited',kind:'look',name:p.name,enhanced:p},camera,raw);
  return {...resolved.settings!,look:structuredClone(settings.look)};
 }
 async importFile(path:string,camera:string,raw:boolean){
  path=resolve(path);const extension=extname(path).toLowerCase();
  if(!['.dcp','.icc','.icm','.xmp'].includes(extension))throw new Error('请选择 DCP / ICC 或增强 Look XMP 配置文件。');
  let data=await assetBytes(path,'配置文件');
  if(extension==='.xmp'){
   if(!this.xmp)throw new Error('Look XMP 读取器不可用。');const packet=new TextDecoder('utf-8',{fatal:true}).decode(data),properties=(await this.xmp.call('read',packet)).properties;
   const {profile}=parseEnhancedProfile(properties,packet);data=Buffer.from(JSON.stringify(profile));
  }
  const id=createHash('sha256').update(data).digest('hex');
  // Inspect the exact immutable bytes before adding anything to the library.
  const temporary=await mkdtemp(join(tmpdir(),'captraw-profile-'));
  try{
   const check=join(temporary,extension==='.xmp'?'profile.look':basename(path));await writeFile(check,data,{flag:'wx',mode:0o600});
   const info:InputProfileOption=await this.core.call('inspectInputProfile',{path:check});
   this.assertCompatible(info,camera,raw);
   const resolved=await this.resolveLook(info,camera,raw);
   await assetDirectory(this.root,'配置文件');const destination=join(this.root,id+(info.kind==='look'?'.look':info.kind==='icc'?'.icc':'.dcp'));await publishAsset(this.core,destination,data,id,'配置文件');
   return {...resolved,reference:'file:'+destination,sha256:id};
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
}
