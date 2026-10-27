import type {Adjustments,EditDocument} from './index.js';
import {ENGINE_VERSION,READABLE_ENGINE_VERSIONS} from './index.js';
import {SYNC_GROUPS,type SyncGroup} from './synchronize.js';
export interface PresetDocument {xmpPacket?:string;warnings?:string[];engineVersion:string;name:string;group:string;groups:SyncGroup[];artProfile:string;adjustments:Partial<Adjustments>;maskAssets?:EditDocument['maskAssets'];approximateWB?:boolean}
export interface PresetSummary {id:string;name:string;group:string;groups:SyncGroup[];approximateWB:boolean;warnings?:string[]}
export interface PresetInput {name:string;group:string;groups:SyncGroup[];adjustments:Adjustments;artProfile?:string}
export function presetName(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>100||/[\x00-\x1f]/.test(value))throw new Error('名称须为 1–100 个字符。');return value.trim();}
export function presetFields(groups:SyncGroup[]){if(!Array.isArray(groups)||!groups.length||new Set(groups).size!==groups.length||groups.some(id=>!SYNC_GROUPS.some(g=>g.id===id)))throw new Error('请选择有效的预设调整项。');return SYNC_GROUPS.filter(g=>groups.includes(g.id)).flatMap(g=>[...g.fields]);}
export function capturePreset(input:PresetInput):PresetDocument{
 const adjustments:Record<string,unknown>={};for(const key of presetFields(input.groups))if(input.adjustments[key]!==undefined)adjustments[key]=structuredClone(input.adjustments[key]);
 return {engineVersion:ENGINE_VERSION,name:presetName(input.name),group:presetName(input.group),groups:[...input.groups],artProfile:'',adjustments,approximateWB:input.groups.includes('whiteBalance')&&!!input.adjustments.wbApproximate};
}
export function validatePreset(value:PresetDocument){
 if(!value||(value.engineVersion!==''&&!READABLE_ENGINE_VERSIONS.has(value.engineVersion))||value.artProfile!=='')throw new Error('不支持的 XMP 预设处理版本。');
 presetName(value.name);presetName(value.group);const fields=presetFields(value.groups);
 if(!value.adjustments||typeof value.adjustments!=='object'||Array.isArray(value.adjustments)||Object.keys(value.adjustments).some(key=>!fields.includes(key as typeof fields[number])))throw new Error('预设包含未选择的调整项。');

}
// Required neutral fields only provide context for native validation; they are never saved or applied as selected values.
export const presetValidationBase:Adjustments={exposure:0,contrast:0,temperature:6500,tint:0,saturation:0,vibrance:0,curve:[{x:0,y:0},{x:1,y:1}],crop:null,rotation:0,masks:[]};
