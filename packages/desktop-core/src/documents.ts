import {ENGINE_VERSION,READABLE_ENGINE_VERSIONS,validRating,type EditDocument,type BatchSaveRequest,type BatchSaveResult,type AdjustmentPatch} from '@captraw/contracts';
import {randomUUID} from 'node:crypto';
import {stat,lstat,rm} from 'node:fs/promises';
import {basename,extname,join,isAbsolute} from 'node:path';
import {NativeEngine} from './engine.js';
import {saveRecipeWithMasks} from './mask-assets.js';
import {validateSourceIdentity,prepareSourceIdentities,verifySourceIdentity} from './source-identity.js';
import {documentRelativePath} from './runtime.js';
import {XMP,CRS,CT,TIFF,XMP_BASIC,lookup,property,text,encode,readExtension,encodeAdjustments,decodeAdjustments,standardKeys,mergeXMPNode,type XMPProperty,type XMPResult} from './xmp.js';
import {preserveEnhancedLookField} from './enhanced-profiles.js';
import {prepareImageXMP,prepareActiveSave} from './baked-crs.js';
export class Documents {
 constructor(readonly xmp:XMP){}
 async read(path:string){
  const result=await this.xmp.read(path);
  return this.decode(result);
 }
 async readForImage(path:string){
  const extension=extname(path).toLowerCase(),format=/^\.jpe?g$/.test(extension)?'jpeg':/^\.tiff?$/.test(extension)?'tiff':undefined;
  const result=format?await this.xmp.call('file-read','',[],{path,format}):await this.xmp.read(path),prepared=prepareImageXMP(result.properties);
  const packet=prepared.changes.length?(await this.xmp.call('write',result.packet!,prepared.changes)).packet!:result.packet;
  // A rendered document's metadata (including TIFF orientation) is not a new
  // adjustment request. Native open reads the actual source's interpretation.
  const metadataOnly=prepared.kind==='baked'||!!format&&!result.properties.some(p=>p.ns===CRS||p.ns===CT&&['ARTProfile','ARTAdjustments'].includes(p.name));
  const decodeProperties=format?prepared.decodeProperties.filter(p=>!(p.ns===TIFF&&p.name==='Orientation')):prepared.decodeProperties;
  const document=this.decode({packet,properties:decodeProperties},metadataOnly);
  if(prepared.kind==='legacy-active')document.warnings.push('旧编辑配方带有 AlreadyApplied=True。原有显影外观已保留，原 CRS 数据已归档；再次保存将明确标记为活动编辑。');
  return {...document,openingKind:prepared.kind,metadataOnly};
 }
 private decode(result:XMPResult,metadataOnly=false){
  const engineVersion=readExtension(result.properties,'EngineVersion')||'';
  if(engineVersion&&!READABLE_ENGINE_VERSIONS.has(engineVersion))throw new Error('XMP 使用了不支持的 ART 显影版本。');
  const {adjustments,warnings}=metadataOnly?{adjustments:{} as AdjustmentPatch,warnings:[] as string[]}:decodeAdjustments(result.properties);
  const ratingNode=lookup(result.properties,XMP_BASIC,'Rating'),rating=ratingNode===undefined?undefined:Number(ratingNode.value);
  if(ratingNode&&(!ratingNode.value?.trim()||!validRating(rating)))throw new Error('XMP 评分须为 -1（拒绝）或 0–5。');
  const labelNode=lookup(result.properties,XMP_BASIC,'Label'),label=labelNode?.value;
  if(labelNode&&(typeof label!=='string'||labelNode.fields||labelNode.items))throw new Error('XMP 颜色标签必须为标准文本。');
  const source=readExtension(result.properties,'Source');
  if(source&&(!source.path||!Number.isSafeInteger(source.size)||!/^[a-f0-9]{64}$/.test(source.sha256)))throw new Error('XMP 原片关联无效。');
  const baselineVersion=readExtension(result.properties,'BaselineVersion');if(baselineVersion!==undefined&&baselineVersion!==4)throw new Error('XMP 初始显影版本不受支持。');
  const artProfile=readExtension(result.properties,'ARTProfile')||'';if(typeof artProfile!=='string')throw new Error('无效的 ART 配置。');
  return {xmpPacket:result.packet,engineVersion,source,artProfile,adjustments,rating,label,warnings,baselineVersion:4 as const,maskAssets:readExtension(result.properties,'MaskAssets'),inputProfileAsset:readExtension(result.properties,'InputProfileAsset')};
 }
 async serialize(doc:EditDocument,carriedPackets:readonly (string|undefined)[]=[]){
  const original=doc.xmpPacket?(await this.xmp.call('read',doc.xmpPacket)).properties:[];
  const carried=await Promise.all([...new Set(carriedPackets.filter((p):p is string=>!!p&&p!==doc.xmpPacket))].map(async packet=>(await this.xmp.call('read',packet)).properties));
  const prepared=prepareActiveSave(original,carried),previous=prepared.properties;
  if(doc.rating!==undefined&&!validRating(doc.rating))throw new Error('XMP 评分须为 -1（拒绝）或 0–5。');
  if(doc.label!==undefined&&typeof doc.label!=='string')throw new Error('颜色标签必须为文本。');
  const changes:XMPProperty[]=[...encodeAdjustments(doc.adjustments,previous),property(CT,'EngineVersion',encode(ENGINE_VERSION)),property(CT,'Source',encode(doc.source)),property(CT,'ARTProfile',encode(doc.artProfile)),property(CT,'BaselineVersion',encode(4)),property(CT,'MaskAssets',doc.maskAssets?encode(doc.maskAssets):null),property(CT,'InputProfileAsset',doc.inputProfileAsset?encode(doc.inputProfileAsset):null),property(CRS,'HasSettings',text('True')),property(CRS,'AlreadyApplied',text('False'))];
  // Do not claim the Adobe renderer version for an ART-produced image.
  changes.push(property(XMP_BASIC,'Rating',doc.rating===undefined?null:text(doc.rating)));
  // An explicit empty text overrides an embedded source label on reopening.
  // Omitted labels retain the imported property and its unknown qualifiers.
  if(doc.label!==undefined)changes.push(property(XMP_BASIC,'Label',text(doc.label)));
  if(!lookup(previous,CRS,'ProcessVersion'))changes.push(property(CRS,'ProcessVersion',text('15.4')));
  // All document save paths share field ownership. Preserve external RDF without
  // reviving optional controls deliberately removed from the current snapshot.
  const ownedAdjustments=new Set<string>([...standardKeys,'curveRefineModel','sourceFrame','hdrHeadroom','perspective','perspectiveGuides','lensProfile','fineRotation','cropAspect','masks','wbMode','wbMultipliers','wbApproximate','colorProfile','blackWhite','spots','lensCorrections']);
  const optionalFields=new Set(['linearGradientModel','referenceAngle','geometryReference','brush','coverage','seed','raster','colorSamples','colorRefine','luminanceRange','initialized','components','tone','whiteBalance','details','radius','erase','end','sourcePoint','retainTexture','reference','base','path','sourceMode','searchSeed']);
  const ownedContainer=(path:string)=>/^ARTAdjustments\/(?:colorProfile|blackWhite|spots\[[^\]]+\](?:\/path\[[^\]]+\])?|masks\[[^\]]+\](?:\/components\[[^\]]+\])?(?:\/(?:points|colorSamples)\[[^\]]+\]|\/(?:start|end)|\/brush\/strokes\[[^\]]+\](?:\/autoMask)?)?)$/.test(path);
  // Black-and-white is split across CRS (enabled/mixer) and ART (base).
  // Owning the parent alone does not remove migrated children while base survives.
  const preserve=(path:string,field:XMPProperty)=>preserveEnhancedLookField(path,field)&&!(field.ns===CT&&((path==='ARTAdjustments'&&ownedAdjustments.has(field.name))||(path==='ARTAdjustments/perspective'&&['manualModel','aspect','scale','offsetX','offsetY','constrainCrop'].includes(field.name))||(path==='ARTAdjustments/blackWhite'&&['enabled','mixer'].includes(field.name))||(ownedContainer(path)&&optionalFields.has(field.name))));
  for(const change of changes){
   const old=lookup(previous,change.ns,change.name);
   if(old&&change.node)change.node=mergeXMPNode(old,change.node,preserve,change.name);
  }
  const result=await this.xmp.call('write',doc.xmpPacket||'',[...prepared.changes,...changes]);return result.packet!;
 }
}

export function validateBatchSave(request:BatchSaveRequest){
 if(!request||!Array.isArray(request.documents)||!request.documents.length||request.documents.length>500)throw new Error('请选择 1–500 张照片保存。');
 const paths=new Set<string>();
 for(const d of request.documents){
  if(!d||typeof d.path!=='string'||!isAbsolute(d.path)||paths.has(d.path)||typeof d.artProfile!=='string'||!d.adjustments||typeof d.adjustments!=='object'||Array.isArray(d.adjustments)||!Number.isInteger(d.width)||!Number.isInteger(d.height)||d.width<1||d.height<1||d.width>200000||d.height>200000||(d.xmpPacket!==undefined&&typeof d.xmpPacket!=='string'))throw new Error('保存照片快照无效或重复。');
  paths.add(d.path);
  if(d.rating!==undefined&&!validRating(d.rating))throw new Error('评分须为 -1（拒绝）或 0–5。');
  if(d.label!==undefined&&typeof d.label!=='string')throw new Error('颜色标签必须为文本。');
  if(d.sourceIdentity!==undefined)validateSourceIdentity(d.sourceIdentity);
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
   const identities=await prepareSourceIdentities(request.documents,()=>this.cancelled);
   if(!(await stat(directory)).isDirectory())throw new Error('请选择保存文件夹。');
   for(const [index,doc] of request.documents.entries()){
    if(this.cancelled)break;
    this.progress(`正在保存 ${index+1}/${request.documents.length} · ${basename(doc.path)}`);
    const cache=join(this.cache,'save-'+randomUUID());let worker:NativeEngine|undefined;
    try{
     const identity=identities.get(doc.path)!;if(identity instanceof Error)throw identity;
     await verifySourceIdentity(doc.path,identity);
     worker=new NativeEngine(this.binary,this.resources,cache);
     await worker.ready;
     const {artProfile}=await worker.call('compose',doc);
     const recipe:EditDocument={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:documentRelativePath(directory,doc.path),size:identity.size,sha256:identity.sha256},adjustments:doc.adjustments,artProfile,xmpPacket:doc.xmpPacket,rating:doc.rating,label:doc.label};
     const stem=basename(doc.path,extname(doc.path));let suffix=0;
     for(;;){
      const output=join(directory,`${stem}${suffix?'_'+suffix:''}.xmp`);++suffix;
      const exists=async(path:string)=>{try{await lstat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
      if(await exists(output)||await exists(output+'.assets'))continue;
      if(await saveRecipeWithMasks(worker,output,recipe,value=>this.documents.serialize(value,[doc.xmpPacket]),false,()=>verifySourceIdentity(doc.path,identity))){results.push({source:doc.path,output});break;}
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
