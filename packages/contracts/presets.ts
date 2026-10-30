import type {Adjustments,AdjustmentPatch,EditDocument,ImageSession,SourceFrame,SourceIdentity} from './index.js';
import {ENGINE_VERSION,READABLE_ENGINE_VERSIONS,mergeAdjustmentPatch,hasRelativeWhiteBalance} from './index.js';
import {SYNC_GROUPS,type SyncGroup} from './synchronize.js';
export interface PresetDocument {isoAnchors?:ISOAnchor[];supportsAmount?:boolean;supportsAmount2?:boolean;xmpPacket?:string;nativePacket?:string;warnings?:string[];unsupportedSettings?:string[];engineVersion:string;name:string;group:string;groups:SyncGroup[];artProfile:string;adjustments:AdjustmentPatch;maskAssets?:EditDocument['maskAssets'];inputProfileAsset?:EditDocument['inputProfileAsset'];approximateWB?:boolean}
export interface PresetSummary {origin?:'user'|'builtin';favorite?:boolean;isoAdaptive?:boolean;supportsAmount?:boolean;packageId?:string;packageVersion?:string;id:string;name:string;group:string;groups:SyncGroup[];approximateWB:boolean;warnings?:string[]}
export interface PresetInput {name:string;group:string;groups:SyncGroup[];adjustments:Adjustments;artProfile?:string;sourceFrame?:SourceFrame;sourcePath?:string;sourceIdentity?:SourceIdentity}
export function presetName(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>100||/[\x00-\x1f]/.test(value))throw new Error('名称须为 1–100 个字符。');return value.trim();}
export function presetFields(groups:SyncGroup[]){if(!Array.isArray(groups)||!groups.length||new Set(groups).size!==groups.length||groups.some(id=>!SYNC_GROUPS.some(g=>g.id===id)))throw new Error('请选择有效的预设调整项。');return SYNC_GROUPS.filter(g=>groups.includes(g.id)).flatMap(g=>[...g.fields]);}
export function capturePreset(input:PresetInput):PresetDocument{
 const adjustments:Record<string,unknown>={};for(const key of presetFields(input.groups))if(input.adjustments[key]!==undefined)adjustments[key]=structuredClone(input.adjustments[key]);
 if(hasRelativeWhiteBalance(input.adjustments)&&input.groups.includes('whiteBalance')){delete adjustments.temperature;delete adjustments.tint;}
 return {engineVersion:ENGINE_VERSION,name:presetName(input.name),group:presetName(input.group),groups:[...input.groups],artProfile:'',adjustments,approximateWB:input.groups.includes('whiteBalance')&&!!input.adjustments.wbApproximate};
}
export function validatePreset(value:PresetDocument){
 if(!value||(value.engineVersion!==''&&!READABLE_ENGINE_VERSIONS.has(value.engineVersion))||value.artProfile!=='')throw new Error('不支持的 XMP 预设处理版本。');
 for(const key of ['supportsAmount','supportsAmount2'] as const)if(value[key]!==undefined&&typeof value[key]!=='boolean')throw new Error('预设强度支持标志必须为布尔值。');
 presetName(value.name);presetName(value.group);const fields=presetFields(value.groups);
 if(!value.adjustments||typeof value.adjustments!=='object'||Array.isArray(value.adjustments)||Object.keys(value.adjustments).some(key=>!fields.includes(key as typeof fields[number])))throw new Error('预设包含未选择的调整项。');
 if(value.isoAnchors){validateISOAnchors(value.isoAnchors);for(const a of value.isoAnchors)if(Object.keys(a.adjustments).some(key=>!fields.includes(key as typeof fields[number])))throw new Error('ISO 锚点包含未选择字段。');}
}
// Required neutral fields only provide context for native validation; they are never saved or applied as selected values.
export const presetValidationBase:Adjustments={exposure:0,contrast:0,temperature:6500,tint:0,saturation:0,vibrance:0,curve:[{x:0,y:0},{x:1,y:1}],crop:null,rotation:0,masks:[]};
export function presetValidationAdjustments(adjustments:AdjustmentPatch){
 const patch=structuredClone(adjustments),splits=patch.parametricCurve?.splits;
 // Partial split positions can only be checked against the eventual target.
 if(patch.parametricCurve&&(!splits||splits[0]===undefined||splits[1]===undefined||splits[2]===undefined))delete patch.parametricCurve;
 return mergeAdjustmentPatch(presetValidationBase,patch);
}

export interface ISOAnchor {iso:number;adjustments:AdjustmentPatch}
export interface ISOPresetInput {name:string;group:string;groups:SyncGroup[];documents:import('./synchronize.js').SyncDocument[]}
export function isISOAnchor(image:Pick<ImageSession,'inputKind'|'iso'>){return (image.inputKind==='mosaic-raw'||image.inputKind==='linear-raw')&&Number.isFinite(image.iso)&&image.iso>0;}
export function canCreateISO(images:ReadonlyArray<Pick<ImageSession,'inputKind'|'iso'>>){return images.length>=2&&images.every(isISOAnchor)&&new Set(images.map(image=>image.iso)).size>=2;}
export interface PresetApplyRequest {id:string;targets:import('./synchronize.js').SyncDocument[];amount?:number;operationId:string}
export interface PresetPreviewRequest {id:string;target:import('./synchronize.js').SyncDocument;amount?:number;revision:number}
export interface PresetApplyResult {results:import('./synchronize.js').SyncResult[];warnings:string[]}
export interface PresetPackManifest {id:string;version:string;engineVersions:string[];presets:{id:string;path:string;sha256:string}[];assets:{path:string;sha256:string}[]}
// Amount is deliberately limited to neutral, zero-centred controls. Absolute WB,
// curves, geometry, masks and detail radii are held fixed, with explicit warnings.
const amountFields=new Set(['exposure','contrast','highlights','shadows','whites','blacks','saturation','vibrance','texture','clarity','dehaze','glow','vignette','lensManualDistortion','lensVignette']);
const isoFields=new Set([...amountFields,'temperature','tint','sharpening','sharpenRadius','sharpenDetail','sharpenEdgeMask','luminanceNoise','luminanceNoiseDetail','luminanceNoiseContrast','colorNoise','colorNoiseDetail','colorNoiseSmoothness','grain','grainSize','grainRoughness','postCropVignetteFeather','postCropVignetteRoundness','postCropVignetteMidpoint','postCropVignetteHighlights','curveRefineSaturation','glowRange','glowSpread','glowWarmth']);
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,ordered(v)])):value;
const same=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
export function isoAnchors(documents:ISOPresetInput['documents'],groups:SyncGroup[]):ISOAnchor[]{
 if(!Array.isArray(documents)||documents.length<2)throw new Error('至少选择两张不同 ISO 的 RAW。');
 const anchors=new Map<number,AdjustmentPatch>();
 for(const doc of documents){
  if(!isISOAnchor(doc.image))throw new Error(`${doc.image.name} 缺少有效 RAW 输入类型或 ISO。`);
  const patch=capturePreset({name:'ISO',group:'ISO',groups,adjustments:doc.adjustments}).adjustments,previous=anchors.get(doc.image.iso);
  if(previous&&!same(previous,patch))throw new Error(`ISO ${doc.image.iso} 的设置冲突。`);
  anchors.set(doc.image.iso,patch);
 }
 if(anchors.size<2)throw new Error('至少需要两个不同 ISO 锚点。');
 const values=[...anchors].sort((a,b)=>a[0]-b[0]).map(([iso,adjustments])=>({iso,adjustments}));
 validateISOAnchors(values);return values;
}
export function validateISOAnchors(anchors:ISOAnchor[]){
 if(!Array.isArray(anchors)||anchors.length<2)throw new Error('ISO 预设至少需要两个锚点。');
 let previous=0;
 const keys=Object.keys(anchors[0].adjustments).sort();
 for(const anchor of anchors){
  if(!Number.isFinite(anchor.iso)||anchor.iso<=previous)throw new Error('ISO 锚点必须按正数递增且不重复。');previous=anchor.iso;
  if(!same(Object.keys(anchor.adjustments).sort(),keys))throw new Error('ISO 锚点的调节字段必须一致。');
  for(const key of keys){const v=(anchor.adjustments as any)[key];if(isoFields.has(key)){if(typeof v!=='number'||!Number.isFinite(v))throw new Error('ISO 数值无效。');}
   else if(!same(v,(anchors[0].adjustments as any)[key]))throw new Error(`${key} 不支持 ISO 插值；请保持所有锚点的设置一致。`);
  }
 }
}
// Overlay only sparse control groups; no neutral defaults or numeric mappings
// are introduced here. Full arrays and fixed/spatial groups remain replacements.
function overlayISO(base:AdjustmentPatch,anchor:AdjustmentPatch):AdjustmentPatch{
 const overlay=(a:unknown,b:unknown):unknown=>{
  if(!b||typeof b!=='object'||Array.isArray(b))return structuredClone(b);
  const before=(a&&typeof a==='object'?a:{}) as Record<string,unknown>,after=b as Record<string,unknown>;
  return Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(after)])].map(key=>[key,Object.hasOwn(after,key)?overlay(before[key],after[key]):structuredClone(before[key])]));
 };
 const result={...structuredClone(base),...structuredClone(anchor)};
 for(const key of ['hsl','parametricCurve','colorGrading','calibration'] as const)if(base[key]&&anchor[key])(result as Record<string,unknown>)[key]=overlay(base[key],anchor[key]);
 return result;
}
export function presetAtISO(anchors:ISOAnchor[],iso:number,base:AdjustmentPatch={}):AdjustmentPatch{
 validateISOAnchors(anchors);if(!Number.isFinite(iso)||iso<=0)throw new Error('目标照片缺少有效 ISO，未应用预设。');
 const upper=anchors.findIndex(a=>a.iso>=iso);if(upper===0)return overlayISO(base,anchors[0].adjustments);if(upper<0)return overlayISO(base,anchors.at(-1)!.adjustments);
 const lo=anchors[upper-1],hi=anchors[upper],t=Math.log2(iso/lo.iso)/Math.log2(hi.iso/lo.iso),result=structuredClone(lo.adjustments) as Record<string,unknown>;
 for(const key of Object.keys(result))if(isoFields.has(key)){
  const v=Number(result[key])+(Number((hi.adjustments as any)[key])-Number(result[key]))*t;
  result[key]=['exposure','sharpenRadius'].includes(key)?Number(v.toFixed(4)):Math.round(v);
 }
 return overlayISO(base,result as AdjustmentPatch);
}
export function presetAmount(patch:AdjustmentPatch,amount=100):{adjustments:AdjustmentPatch;warnings:string[]}{
 if(!Number.isFinite(amount)||amount<0||amount>200)throw new Error('预设强度须为 0–200。');
 if(amount===100)return {adjustments:structuredClone(patch),warnings:[]};
 const result=structuredClone(patch) as Record<string,unknown>,fixed:string[]=[];
 for(const [key,value] of Object.entries(result)){
  if(amountFields.has(key)&&typeof value==='number'){
   const limit=key==='exposure'?5:100,v=value*amount/100;
   if(Math.abs(v)>limit)throw new Error(`${key} 在 ${amount}% 强度下为 ${v}，超出范围 -${limit}–${limit}；未应用任何修改。`);
   result[key]=key==='exposure'?Number(v.toFixed(4)):Math.round(v);
  }else fixed.push(key);
 }
 return {adjustments:result as AdjustmentPatch,warnings:[...(fixed.length?[`以下调节固定为预设值，不参与强度缩放：${fixed.join('、')}`]:[]),'当前强度仅缩放已列出的零中心参数；与 ACR 18.7 的逐项强度映射尚未完成对照。']};
}
