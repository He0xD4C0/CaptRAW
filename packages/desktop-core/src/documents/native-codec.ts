import {readFile,stat} from 'node:fs/promises';
import {READABLE_ENGINE_VERSIONS,validRating,validateSourceFrame,validateBrushPrograms,validateLinearGradientModels,validatePerspective,validateCurveRefine,type EditDocument} from '@captraw/contracts';
import {validatePreset,type PresetDocument} from '@captraw/contracts/presets';

export type NativeKind='edit'|'preset'|'favorites';
export type DocumentStorageKind='native'|'legacy-xmp'|'adobe-xmp'|'embedded-xmp';
type RecordValue=Record<string,unknown>;
interface Container extends RecordValue {format:'CaptRAW';kind:NativeKind;version:1;payload:RecordValue;sourceXMP?:string;sourceXMPHistory?:string[]}
const maximum=64*1024*1024;
const object=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value:RecordValue,key:string)=>Object.hasOwn(value,key);
export function nativeSidecar(path:string){return path+'.captraw';}
export async function readNativePacket(path:string){
 const info=await stat(path);if(!info.isFile()||info.size>maximum)throw new Error('原生文档必须是小于 64 MiB 的普通文件。');
 return new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path));
}
function xml(value:unknown){if(value!==undefined&&(typeof value!=='string'||!!value.trim()&&!value.trimStart().startsWith('<')))throw new Error('sourceXMP 必须为 XML 来源元数据，不能是原生 JSON。');}
function strings(value:unknown,label:string){if(value!==undefined&&(!Array.isArray(value)||value.some(v=>typeof v!=='string')))throw new Error(label+'必须为文本列表。');}
function parse(packet:string,kind:NativeKind):Container{
 if(typeof packet!=='string'||Buffer.byteLength(packet)>maximum)throw new Error('原生文档大小无效。');
 let value:unknown;try{value=JSON.parse(packet);}catch{throw new Error('原生文档 JSON 无效。');}
 if(!object(value)||value.format!=='CaptRAW'||value.version!==1||value.kind!==kind||!object(value.payload))throw new Error('原生文档 format/kind/version 不受支持；不接受历史旧 JSON。');
 if(own(value.payload,'nativePacket')||own(value.payload,'xmpPacket'))throw new Error('原生 payload 不能嵌套保存 packet；XML 来源位于 sourceXMP。');
 xml(value.sourceXMP);strings(value.sourceXMPHistory,'来源 XML 历史');
 for(const packet of value.sourceXMPHistory as string[]||[])xml(packet);
 return value as unknown as Container;
}
function adjustment(value:unknown){
 if(!object(value))throw new Error('原生调整快照无效。');
 // Pixel/model semantics stay in the existing validators and native validate.
 validateSourceFrameIfPresent(value.sourceFrame);validateBrushPrograms(value.masks);
 validateLinearGradientModels(value.masks as EditDocument['adjustments']['masks']);
 validatePerspective(value.perspective as EditDocument['adjustments']['perspective']);validateCurveRefine(value as unknown as EditDocument['adjustments']);
}
function validateSourceFrameIfPresent(value:unknown){if(value!==undefined)validateSourceFrame(value);}
function common(value:RecordValue){
 if(typeof value.engineVersion!=='string'||value.engineVersion!==''&&!READABLE_ENGINE_VERSIONS.has(value.engineVersion)||typeof value.artProfile!=='string')throw new Error('原生文档显影处理版本或配置无效。');
 adjustment(value.adjustments);strings(value.warnings,'导入说明');strings(value.unsupportedSettings,'未支持设置');
}
function edit(value:RecordValue){
 common(value);
 if(!READABLE_ENGINE_VERSIONS.has(value.engineVersion as string))throw new Error('原生编辑缺少受支持的处理版本。');
 const source=value.source;
 if(!object(source)||typeof source.path!=='string'||!source.path||!Number.isSafeInteger(source.size)||Number(source.size)<0||typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256))throw new Error('原生编辑的原片关联无效。');
 if(value.baselineVersion!==undefined&&value.baselineVersion!==4)throw new Error('原生编辑初始显影版本不受支持。');
 if(value.rating!==undefined&&!validRating(value.rating))throw new Error('评分须为 -1（拒绝）或 0–5。');
 if(value.label!==undefined&&typeof value.label!=='string')throw new Error('颜色标签必须为文本。');
}
function finite(value:unknown,depth=0):void{
 if(depth>128)throw new Error('原生文档嵌套过深。');
 if(typeof value==='number'&&!Number.isFinite(value)||typeof value==='bigint'||typeof value==='function'||typeof value==='symbol')throw new Error('原生文档包含不可保存的值。');
 if(Array.isArray(value)){for(const item of value)finite(item,depth+1);}
 else if(object(value))for(const item of Object.values(value))finite(item,depth+1);
}
const editKeys=['engineVersion','source','artProfile','adjustments','baselineVersion','rating','label','warnings','unsupportedSettings','maskAssets','inputProfileAsset'];
const presetKeys=['engineVersion','name','group','groups','artProfile','adjustments','isoAnchors','supportsAmount','supportsAmount2','maskAssets','inputProfileAsset','warnings','unsupportedSettings','approximateWB'];
function encode(kind:NativeKind,value:RecordValue,keys:string[],carried:readonly (string|undefined)[]=[]){
 const previous=typeof value.nativePacket==='string'?parse(value.nativePacket,kind):undefined;
 const payload={...previous?.payload};
 for(const key of keys){if(value[key]===undefined)delete payload[key];else payload[key]=structuredClone(value[key]);}
 const sourceXMP=value.xmpPacket!==undefined?value.xmpPacket:previous?.sourceXMP;xml(sourceXMP);
 const history=[...new Set([...(previous?.sourceXMPHistory||[]),previous?.sourceXMP,...carried].filter((p):p is string=>typeof p==='string'&&!!p&&p!==sourceXMP))];
 for(const packet of history)xml(packet);
 const container:Container={...previous,format:'CaptRAW',kind,version:1,payload};
 if(sourceXMP!==undefined)container.sourceXMP=sourceXMP as string;else delete container.sourceXMP;
 if(history.length)container.sourceXMPHistory=history;else delete container.sourceXMPHistory;
 finite(container);const packet=JSON.stringify(container,null,2)+'\n';parse(packet,kind);return packet;
}
export function encodeNativeEdit(value:EditDocument,carried:readonly (string|undefined)[]=[]){
 edit(value as unknown as RecordValue);return encode('edit',value as unknown as RecordValue,editKeys,carried);
}
export function decodeNativeEdit(packet:string):EditDocument{
 const value=parse(packet,'edit');edit(value.payload);
 return {...value.payload,xmpPacket:value.sourceXMP,nativePacket:packet} as unknown as EditDocument;
}
export function encodeNativePreset(value:PresetDocument){
 common(value as unknown as RecordValue);validatePreset(value);
 for(const anchor of value.isoAnchors||[])adjustment(anchor.adjustments);
 return encode('preset',value as unknown as RecordValue,presetKeys);
}
export function decodeNativePreset(packet:string):PresetDocument{
 const value=parse(packet,'preset');common(value.payload);
 const preset={...value.payload,xmpPacket:value.sourceXMP,nativePacket:packet} as unknown as PresetDocument;validatePreset(preset);for(const anchor of preset.isoAnchors||[])adjustment(anchor.adjustments);return preset;
}
export function encodeNativeFavorites(ids:readonly string[]){
 if(ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new Error('收藏预设标识无效。');
 return encode('favorites',{ids:[...new Set(ids)]},['ids']);
}
export function decodeNativeFavorites(packet:string){
 const value=parse(packet,'favorites'),ids=value.payload.ids;
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new Error('收藏预设标识无效。');
 return [...new Set(ids)] as string[];
}
