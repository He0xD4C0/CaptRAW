import {join,dirname} from 'node:path';
import {PresetPacks} from './preset-pack.js';
import {mkdir,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {capturePreset,validatePreset,presetName,presetValidationAdjustments,type PresetDocument,type PresetInput,type PresetSummary,type ISOPresetInput,type PresetApplyRequest,type PresetApplyResult,type PresetPreviewRequest,isoAnchors,presetAtISO,presetAmount} from '@captraw/contracts/presets';
import {mergeAdjustmentPatch,validateWhiteBalanceTarget,type AdjustmentPatch} from '@captraw/contracts';
import type {SyncDocument} from '@captraw/contracts/synchronize';
import {saveRecipeWithMasks,restoreRecipeMasks} from './mask-assets.js';
import {XMP,CRS,CT,property,text,encode,lookup,readExtension,encodeAdjustments,decodeAdjustments} from './xmp.js';
import {ENGINE_VERSION,READABLE_ENGINE_VERSIONS} from '@captraw/contracts';
import {SYNC_GROUPS,adjustmentCommand} from '@captraw/contracts/synchronize';
import type {Synchronizer} from './synchronize.js';
type Core={call(method:string,params:unknown):Promise<any>};
const validID=(id:string)=>{if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw new Error('无效的预设标识。');return id;};
export class Presets {
 private core:Core;private generation=0;private packs:PresetPacks;private ready?:Promise<void>;
 private favorites=new Set<string>();
 private async initialize(){if(!this.ready)this.ready=(async()=>{await this.packs.initialize();const f=join(this.root,'.favorites.xmp');try{const {properties}=await this.xmp.read(f);const ids=readExtension(properties,'FavoriteIDs');if(Array.isArray(ids))this.favorites=new Set(ids.filter(id=>typeof id==='string'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}})();await this.ready;}
 cancel(){++this.generation;}
 constructor(private root:string,core:Core,private cache:string,private xmp:XMP){
  this.packs=new PresetPacks(join(root,'.builtin'));
  // Presets carry selected controls only, never hidden source-image ART settings.
  this.core={call:async(method,params)=>{if(method!=='maskAssets')return core.call(method,params);const input=params as {adjustments:AdjustmentPatch};const missing=!Object.hasOwn(input.adjustments,'masks');const result=await core.call(method,{...input,adjustments:{masks:[],...input.adjustments}});if(missing)delete result.adjustments.masks;return {...result,artProfile:''};}};
 }
 private path(id:string){validID(id);return this.packs.entries().find(e=>e.id===id)?.path||join(this.root,id,'preset.xmp');}
 private writable(id:string){if(this.packs.entries().some(e=>e.id===id))throw new Error('内置预设只读，请先创建用户副本。');}
 async listPacks(){await this.initialize();return this.packs.list();}
 private summary(id:string,p:PresetDocument):PresetSummary{const pack=this.packs.entries().find(e=>e.id===id);return {id,name:p.name,group:p.group,groups:p.groups,approximateWB:!!p.approximateWB,warnings:p.warnings,favorite:this.favorites.has(id),origin:pack?'builtin':'user',packageId:pack?.packageId,packageVersion:pack?.packageVersion,isoAdaptive:!!p.isoAnchors,supportsAmount:p.supportsAmount!==false};}
 private async read(path:string){
  const {packet,properties}=await this.xmp.read(path),engineVersion=readExtension(properties,'EngineVersion')||'';
  if(lookup(properties,CRS,'PresetType')?.value==='Look')throw new Error('这是增强 Look 配置文件，请从输入配置文件面板导入并验证基础配置及表资产。');
  if(engineVersion&&!READABLE_ENGINE_VERSIONS.has(engineVersion))throw new Error('XMP 使用了不支持的 ART 显影版本。');
  const {adjustments,warnings}=decodeAdjustments(properties.filter(p=>p.ns!==CRS||!['ISODependent','SupportsAmount2'].includes(p.name)));
  const label=(key:string,fallback:string)=>{const node=lookup(properties,CRS,key);return node?.items?.find(n=>n.lang==='x-default')?.value||node?.items?.[0]?.value||node?.value||fallback;};
  const isoNode=lookup(properties,CRS,'ISODependent');
  if(isoNode&&(!isoNode.items||(isoNode.options!&0x600)!==0x600))throw new Error('ISODependent 必须为 RDF Seq。');
  const anchors=isoNode?.items?.map(node=>{if(!node.fields)throw new Error('ISO 锚点必须为 RDF 结构。');const iso=Number(node.fields.find(f=>f.ns===CRS&&f.name==='ISO')?.node?.value);const decoded=decodeAdjustments(node.fields.filter(f=>f.name!=='ISO'));warnings.push(...decoded.warnings);return {iso,adjustments:decoded.adjustments};});
  const groups=SYNC_GROUPS.filter(g=>[adjustments,...(anchors||[]).map(a=>a.adjustments)].some(values=>g.fields.some(key=>Object.hasOwn(values,key)))).map(g=>g.id);
  if(!groups.length)throw new Error('此 XMP 尚无可应用的调节。'+warnings.join(' '));
  const flag=(name:string)=>{const node=lookup(properties,CRS,name);if(!node)return undefined;const value=node.value?.trim().toLowerCase();if(node.fields||node.items||!['true','false'].includes(value||''))throw new Error(`XMP ${name} 必须为 True 或 False。`);return value==='true';};
  const p:PresetDocument={xmpPacket:packet,engineVersion:readExtension(properties,'EngineVersion')||'',name:label('Name','导入预设'),group:label('Group','用户预设'),groups,artProfile:'',adjustments,isoAnchors:anchors,supportsAmount:flag('SupportsAmount'),supportsAmount2:flag('SupportsAmount2'),maskAssets:readExtension(properties,'MaskAssets'),inputProfileAsset:readExtension(properties,'InputProfileAsset'),warnings};validatePreset(p);return p;
 }
 private async save(path:string,p:PresetDocument){
  await saveRecipeWithMasks(this.core,path,p,async value=>{
   const previous=value.xmpPacket?(await this.xmp.call('read',value.xmpPacket)).properties:[];
   const localized=(s:string)=>({localized:s});
   const isoItems=value.isoAnchors?.map(a=>{
    const old=lookup(previous,CRS,'ISODependent')?.items?.find(n=>Number(n.fields?.find(f=>f.ns===CRS&&f.name==='ISO')?.node?.value)===a.iso);
    const fields=new Map((old?.fields||[]).map(f=>[f.ns+'|'+f.name,f]));
    for(const f of [property(CRS,'ISO',text(a.iso)),...encodeAdjustments(a.adjustments,old?.fields)]){const key=f.ns+'|'+f.name;if(f.node===null)fields.delete(key);else fields.set(key,f);}
    return {...old,fields:[...fields.values()]};
   });
   const changes=[...encodeAdjustments(value.adjustments,previous),property(CRS,'Name',localized(value.name)),property(CRS,'Group',localized(value.group)),property(CRS,'PresetType',text('Normal')),property(CRS,'ISODependent',isoItems?{options:0x600,items:isoItems}:null),property(CT,'EngineVersion',encode(ENGINE_VERSION)),property(CT,'MaskAssets',value.maskAssets?encode(value.maskAssets):null),property(CT,'InputProfileAsset',value.inputProfileAsset?encode(value.inputProfileAsset):null)];
   // The independently authored flags are retained separately. Existing evidence
   // does not establish SupportsAmount2 as an alias for SupportsAmount.
   for(const [name,enabled] of [['SupportsAmount',value.supportsAmount],['SupportsAmount2',value.supportsAmount2]] as const)if(enabled!==undefined||!value.xmpPacket)changes.push(property(CRS,name,text(enabled===false?'False':'True')));
   if(!value.xmpPacket)changes.push(property(CRS,'ProcessVersion',text('15.4')),property(CRS,'UUID',text(randomUUID().replaceAll('-','').toUpperCase())));
   return (await this.xmp.call('write',value.xmpPacket||'',changes)).packet!;
  });
 }
 private async restore(path:string){const p=await restoreRecipeMasks(this.core,path,await this.read(path),this.cache);for(const adjustments of [p.adjustments,...(p.isoAnchors||[]).map(a=>a.adjustments)])await this.core.call('validate',{artProfile:'',adjustments:presetValidationAdjustments(adjustments)});return p;}
 async list(){await this.initialize();await mkdir(this.root,{recursive:true});const items:PresetSummary[]=[],errors:string[]=[];for(const id of await readdir(this.root)){if(!/^[0-9a-f-]{36}$/.test(id))continue;try{items.push(this.summary(id,await this.read(this.path(id))));}catch(e){errors.push(`${id}：${String(e)}`);}}for(const entry of this.packs.entries())try{items.push(this.summary(entry.id,await this.read(entry.path)));}catch(e){errors.push(`${entry.id}：${String(e)}`);}return {items:items.sort((a,b)=>a.group.localeCompare(b.group)||a.name.localeCompare(b.name)),errors};}
 private async add(p:PresetDocument){await this.initialize();const id=randomUUID(),path=this.path(id);await mkdir(join(this.root,id),{recursive:true});try{await this.save(path,p);}catch(e){await rm(join(this.root,id),{recursive:true,force:true});throw e;}return this.summary(id,p);}
 async create(input:PresetInput){const checked=await this.core.call('validate',{artProfile:input.artProfile||'',adjustments:input.adjustments,sourceFrame:input.sourceFrame,sourcePath:input.sourcePath,sourceIdentity:input.sourceIdentity,bindSourceFrame:true});input={...input,adjustments:{...input.adjustments,masks:checked.masks}};return this.add(capturePreset(input));}
 async rename(id:string,name:string,group:string){await this.initialize();this.writable(id);const p=await this.restore(this.path(id));p.name=presetName(name);p.group=presetName(group);await this.save(this.path(id),p);return this.summary(id,p);}
 async update(id:string,input:PresetInput){await this.initialize();this.writable(id);const checked=await this.core.call('validate',{artProfile:input.artProfile||'',adjustments:input.adjustments,sourceFrame:input.sourceFrame,sourcePath:input.sourcePath,sourceIdentity:input.sourceIdentity,bindSourceFrame:true});input={...input,adjustments:{...input.adjustments,masks:checked.masks}};const previous=await this.read(this.path(id));const p={...capturePreset(input),xmpPacket:previous.xmpPacket,supportsAmount:previous.supportsAmount,supportsAmount2:previous.supportsAmount2};await this.save(this.path(id),p);return this.summary(id,p);}
 async remove(id:string){await this.initialize();this.writable(id);await this.read(this.path(id));const trash=join(this.root,'.deleted');await mkdir(trash,{recursive:true});await rename(join(this.root,validID(id)),join(trash,id+'-'+randomUUID()));}
 async importFile(path:string){return this.add(await this.restore(path));}
 async exportFile(id:string,path:string){await this.initialize();if(!/\.xmp$/i.test(path))throw new Error('请选择 .xmp 文件名。');await this.save(path,await this.restore(this.path(id)));}
 async favorite(id:string,favorite:boolean){
  await this.initialize();if(typeof favorite!=='boolean')throw new Error('收藏值无效。');const p=await this.read(this.path(id));
  const next=new Set(this.favorites);if(favorite)next.add(id);else next.delete(id);
  const path=join(this.root,'.favorites.xmp'),temporary=path+'.'+randomUUID();
  try{await mkdir(this.root,{recursive:true});
   const packet=(await this.xmp.call('write','',[property(CT,'FavoriteIDs',encode([...next]))])).packet!;
   await writeFile(temporary,packet);await rename(temporary,path);this.favorites=next;
  }finally{await rm(temporary,{force:true});}return this.summary(id,p);
 }
 async duplicate(id:string,name:string,group:string){await this.initialize();const p=await this.restore(this.path(id));p.xmpPacket=(await this.xmp.call('write',p.xmpPacket||'',[property(CRS,'UUID',text(randomUUID().replaceAll('-','').toUpperCase()))])).packet;return this.add({...p,name:presetName(name),group:presetName(group)});}
 async createISO(input:ISOPresetInput){
  const anchors=isoAnchors(input.documents,input.groups);
  for(const doc of input.documents)await this.core.call('validate',{artProfile:doc.profile,adjustments:doc.adjustments});
  return this.add({...capturePreset({...input,adjustments:input.documents[0].adjustments}),adjustments:anchors[0].adjustments,isoAnchors:anchors,supportsAmount:true});
 }
 async applyMany(request:PresetApplyRequest,sync:Synchronizer):Promise<PresetApplyResult|null>{
  request=structuredClone(request);const token=this.generation;await this.initialize();
  if(!request?.operationId||!Array.isArray(request.targets)||!request.targets.length||new Set(request.targets.map(t=>t.image.path)).size!==request.targets.length)throw new Error('预设目标快照无效。');
  const p=await this.restore(this.path(request.id)),amount=request.amount??100,warnings=[...(p.warnings||[])];
  if(p.supportsAmount===false&&amount!==100)throw new Error('此预设不支持强度调整。');
  const commands=[];
  for(const target of request.targets){
   const combined=p.isoAnchors?presetAtISO(p.isoAnchors,target.image.iso,p.adjustments):p.adjustments;
   const scaled=presetAmount(combined,amount);warnings.push(...scaled.warnings);
   if(p.groups.includes('whiteBalance'))validateWhiteBalanceTarget(scaled.adjustments,target.image.inputKind);
   const next=mergeAdjustmentPatch(target.adjustments,scaled.adjustments);
   if(p.groups.includes('whiteBalance')){next.wbMultipliers=null;next.wbMode='custom';next.wbApproximate=false;}
   if(scaled.adjustments.masks){const checked=await this.core.call('validate',{artProfile:target.profile,adjustments:next});next.masks=checked.masks;}
   commands.push({...adjustmentCommand(target.adjustments,next,request.operationId),path:target.image.path});
   if(token!==this.generation)return null;
  }
  if(token!==this.generation)return null;
  const first=request.targets[0];const results=await sync.run({source:{...first,image:{...first.image,path:'captraw-preset:'+request.id}},targets:request.targets,groups:p.groups,commands});
  if(token!==this.generation||results===null)return null;
  return {results,warnings:[...new Set(warnings)]};
 }
 async apply(id:string,target:SyncDocument,sync:Synchronizer){return (await this.applyMany({id,targets:[target],operationId:randomUUID()},sync))?.results??null;}
}

// Hover owns a separate store generation and processor. It never mutates documents.
export class PresetPreview {
 private generation=0;private pending:Promise<PresetApplyResult|null>=Promise.resolve(null);private closed=false;
 constructor(private presets:Presets,private sync:Synchronizer){}
 async cancel(){const token=++this.generation;this.presets.cancel();this.sync.cancel();await this.pending.catch(()=>null);
  if(token!==this.generation)return;const directories=new Set([...this.sync.previews.values()].map(dirname));this.sync.previews.clear();
  await Promise.all([...directories].map(path=>rm(path,{recursive:true,force:true})));
 }
 async shutdown(){this.closed=true;await this.cancel();}
 preview(request:PresetPreviewRequest):Promise<PresetApplyResult|null>{
  if(this.closed)return Promise.reject(new Error('预设预览已关闭。'));
  if(!Number.isSafeInteger(request?.revision)||request.revision<1)return Promise.reject(new Error('预设预览 revision 无效。'));
  request=structuredClone(request);const token=++this.generation,previous=this.pending;
  this.presets.cancel();this.sync.cancel();
  this.pending=(async()=>{
   await previous.catch(()=>null);if(token!==this.generation)return null;
   try{const result=await this.presets.applyMany({id:request.id,targets:[request.target],amount:request.amount,operationId:`preview-${request.revision}`},this.sync);
    if(token!==this.generation||!result)return null;
    for(const row of result.results)if(row.frame)row.frame={...row.frame,revision:request.revision,sessionId:request.target.image.id};return result;
   }catch(error){if(token!==this.generation)return null;throw error;}
  })();return this.pending;
 }
}
