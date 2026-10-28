import {join} from 'node:path';
import {mkdir,readdir,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {capturePreset,validatePreset,presetName,presetValidationAdjustments,type PresetDocument,type PresetInput,type PresetSummary} from '@captraw/contracts/presets';
import {mergeAdjustmentPatch,type AdjustmentPatch} from '@captraw/contracts';
import type {SyncDocument} from '@captraw/contracts/synchronize';
import {saveRecipeWithMasks,restoreRecipeMasks} from './mask-assets.js';
import {XMP,CRS,CT,property,text,encode,lookup,readExtension,encodeAdjustments,decodeAdjustments} from './xmp.js';
import {ENGINE_VERSION,READABLE_ENGINE_VERSIONS} from '@captraw/contracts';
import {SYNC_GROUPS} from '@captraw/contracts/synchronize';
import type {Synchronizer} from './synchronize.js';
type Core={call(method:string,params:unknown):Promise<any>};
const validID=(id:string)=>{if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw new Error('无效的预设标识。');return id;};
export class Presets {
 private core:Core;private generation=0;
 cancel(){++this.generation;}
 constructor(private root:string,core:Core,private cache:string,private xmp:XMP){
  // Presets carry selected controls only, never hidden source-image ART settings.
  this.core={call:async(method,params)=>{if(method!=='maskAssets')return core.call(method,params);const input=params as {adjustments:AdjustmentPatch};const missing=!Object.hasOwn(input.adjustments,'masks');const result=await core.call(method,{...input,adjustments:{masks:[],...input.adjustments}});if(missing)delete result.adjustments.masks;return {...result,artProfile:''};}};
 }
 private path(id:string){return join(this.root,validID(id),'preset.xmp');}
 private summary(id:string,p:PresetDocument):PresetSummary{return {id,name:p.name,group:p.group,groups:p.groups,approximateWB:!!p.approximateWB,warnings:p.warnings};}
 private async read(path:string){
  const {packet,properties}=await this.xmp.read(path),engineVersion=readExtension(properties,'EngineVersion')||'';
  if(engineVersion&&!READABLE_ENGINE_VERSIONS.has(engineVersion))throw new Error('XMP 使用了不支持的 ART 显影版本。');
  const {adjustments,warnings}=decodeAdjustments(properties);
  const label=(key:string,fallback:string)=>{const node=lookup(properties,CRS,key);return node?.items?.find(n=>n.lang==='x-default')?.value||node?.items?.[0]?.value||node?.value||fallback;};
  const groups=SYNC_GROUPS.filter(g=>g.fields.some(key=>Object.hasOwn(adjustments,key))).map(g=>g.id);
  if(!groups.length)throw new Error('此 XMP 尚无可应用的调节。'+warnings.join(' '));
  const p:PresetDocument={xmpPacket:packet,engineVersion:readExtension(properties,'EngineVersion')||'',name:label('Name','导入预设'),group:label('Group','用户预设'),groups,artProfile:'',adjustments,maskAssets:readExtension(properties,'MaskAssets'),warnings};validatePreset(p);return p;
 }
 private async save(path:string,p:PresetDocument){
  await saveRecipeWithMasks(this.core,path,p,async value=>{
   const previous=value.xmpPacket?(await this.xmp.call('read',value.xmpPacket)).properties:[];
   const localized=(s:string)=>({localized:s});
   const changes=[...encodeAdjustments(value.adjustments,previous),property(CRS,'Name',localized(value.name)),property(CRS,'Group',localized(value.group)),property(CRS,'PresetType',text('Normal')),property(CT,'EngineVersion',encode(ENGINE_VERSION)),property(CT,'MaskAssets',value.maskAssets?encode(value.maskAssets):null)];
   if(!value.xmpPacket)changes.push(property(CRS,'ProcessVersion',text('15.4')),property(CRS,'UUID',text(randomUUID().replaceAll('-','').toUpperCase())));
   return (await this.xmp.call('write',value.xmpPacket||'',changes)).packet!;
  });
 }
 private async restore(path:string){const p=await restoreRecipeMasks(this.core,path,await this.read(path),this.cache);await this.core.call('validate',{artProfile:'',adjustments:presetValidationAdjustments(p.adjustments)});return p;}
 async list(){await mkdir(this.root,{recursive:true});const items:PresetSummary[]=[],errors:string[]=[];for(const id of await readdir(this.root)){if(!/^[0-9a-f-]{36}$/.test(id))continue;try{items.push(this.summary(id,await this.read(this.path(id))));}catch(e){errors.push(`${id}：${String(e)}`);}}return {items:items.sort((a,b)=>a.group.localeCompare(b.group)||a.name.localeCompare(b.name)),errors};}
 private async add(p:PresetDocument){const id=randomUUID(),path=this.path(id);await mkdir(join(this.root,id),{recursive:true});try{await this.save(path,p);}catch(e){await rm(join(this.root,id),{recursive:true,force:true});throw e;}return this.summary(id,p);}
 async create(input:PresetInput){const checked=await this.core.call('validate',{artProfile:input.artProfile||'',adjustments:input.adjustments});input={...input,adjustments:{...input.adjustments,masks:checked.masks}};return this.add(capturePreset(input));}
 async rename(id:string,name:string,group:string){const p=await this.restore(this.path(id));p.name=presetName(name);p.group=presetName(group);await this.save(this.path(id),p);return this.summary(id,p);}
 async update(id:string,input:PresetInput){const checked=await this.core.call('validate',{artProfile:input.artProfile||'',adjustments:input.adjustments});input={...input,adjustments:{...input.adjustments,masks:checked.masks}};const previous=await this.read(this.path(id));const p={...capturePreset(input),xmpPacket:previous.xmpPacket};await this.save(this.path(id),p);return this.summary(id,p);}
 async remove(id:string){await this.read(this.path(id));const trash=join(this.root,'.deleted');await mkdir(trash,{recursive:true});await rename(join(this.root,validID(id)),join(trash,id+'-'+randomUUID()));}
 async importFile(path:string){return this.add(await this.restore(path));}
 async exportFile(id:string,path:string){if(!/\.xmp$/i.test(path))throw new Error('请选择 .xmp 文件名。');await this.save(path,await this.restore(this.path(id)));}
 async apply(id:string,target:SyncDocument,sync:Synchronizer){const token=this.generation,p=await this.restore(this.path(id));if(token!==this.generation)return null;
  // Synchronizer never opens its source; this identity prevents collision with the target photo.
  // A preset without a leaf reference retains its historical target-canvas
  // semantics. This profile supplies binding context only; it is never stored.
  return sync.run({source:{image:{...target.image,path:'captraw-preset:'+id},profile:target.profile,adjustments:mergeAdjustmentPatch(target.adjustments,p.adjustments)},targets:[target],groups:p.groups});
 }
}
