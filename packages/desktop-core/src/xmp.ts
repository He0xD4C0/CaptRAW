import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import type {Adjustments} from '@captraw/contracts';
export const CRS='http://ns.adobe.com/camera-raw-settings/1.0/',CT='https://captraw.org/ns/develop/1.0/';
export interface XMPNode {localized?:string;value?:string;options?:number;type?:string;lang?:string;items?:XMPNode[];fields?:XMPProperty[]}
export interface XMPProperty {ns:string;name:string;node:XMPNode|null}
export interface XMPResult {packet?:string;properties:XMPProperty[]}
export class XMP {
 constructor(private binary:string){}
 async call(method:'read'|'write',packet:string,changes:XMPProperty[]=[]):Promise<XMPResult>{
  return new Promise((accept,reject)=>{
   const child=spawn(this.binary,[],{stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[],errors:Buffer[]=[];let size=0,settled=false;
   const finish=(error?:Error,value?:XMPResult)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();error?reject(error):accept(value!);};
   const timer=setTimeout(()=>finish(new Error('XMP 处理超时。')),30000);
   child.on('error',error=>finish(error));child.stdin.on('error',error=>finish(error));
   child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>128*1024*1024)finish(new Error('XMP 响应超过限制。'));else chunks.push(chunk);});
   child.stderr.on('data',(chunk:Buffer)=>{if(errors.reduce((n,b)=>n+b.length,0)<65536)errors.push(chunk);});
   child.on('close',code=>{try{if(code!==0)throw new Error(Buffer.concat(errors).toString()||'XMP 处理失败。');const response=JSON.parse(Buffer.concat(chunks).toString());if(response.error)throw new Error(response.error);finish(undefined,response.result);}catch(e){finish(e instanceof Error?e:new Error(String(e)));}});
   child.stdin.end(JSON.stringify({id:1,method,packet,changes})+'\n');
  });
 }
 async read(path:string){const info=await stat(path);if(!info.isFile()||info.size>64*1024*1024)throw new Error('XMP 文件大小无效。');const bytes=await readFile(path);const packet=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {packet,...await this.call('read',packet)};}
}
// The extension contains typed RDF values only for ART-specific state; no JSON strings in XMP.
export function encode(value:unknown):XMPNode {
 if(value===null)return {value:'',type:'null'};
 if(Array.isArray(value))return {items:value.map(encode),options:0x600};
 if(typeof value==='object'&&value)return {fields:Object.entries(value).filter(([,v])=>v!==undefined).map(([name,v])=>({ns:CT,name,node:encode(v)}))};
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('XMP 参数必须为有限数值。');
 if(!['string','number','boolean'].includes(typeof value))throw new Error('XMP 参数类型无效。');
 return {value:String(value),type:typeof value};
}
export function decode(node:XMPNode):any {
 if(node.items)return node.items.map(decode);
 if(node.fields){const value:Record<string,unknown>={};for(const p of node.fields){if(p.ns!==CT||!p.node||['__proto__','prototype','constructor'].includes(p.name))throw new Error('无效的显影扩展字段。');value[p.name]=decode(p.node);}return value;}
 if(node.type==='null')return null;
 if(node.type==='number'){const n=Number(node.value);if(!node.value?.trim()||!Number.isFinite(n))throw new Error('无效的 XMP 数值。');return n;}
 if(node.type==='boolean'){if(!['true','false'].includes(node.value||''))throw new Error('无效的 XMP 布尔值。');return node.value==='true';}
 if(node.type==='string'||!node.type)return node.value||'';
 throw new Error('未知的显影扩展类型。');
}
export const property=(ns:string,name:string,node:XMPNode|null):XMPProperty=>({ns,name,node});
export const text=(value:unknown):XMPNode=>({value:String(value)});
export function lookup(properties:XMPProperty[],ns:string,name:string){return properties.find(p=>p.ns===ns&&p.name===name)?.node??undefined;}
export function readExtension(properties:XMPProperty[],name:string){const value=lookup(properties,CT,name);return value?decode(value):undefined;}
const curves={curve:'ToneCurvePV2012',redCurve:'ToneCurvePV2012Red',greenCurve:'ToneCurvePV2012Green',blueCurve:'ToneCurvePV2012Blue'} as const;
const endpointIdentity=(points?:Adjustments['curve'])=>points?.length===2&&points[0].x===0&&points[0].y===0&&points[1].x===1&&points[1].y===1;
export const standardKeys=['exposure','temperature','tint',...Object.keys(curves)] as (keyof Adjustments)[];
export function encodeAdjustments(adjustments:Partial<Adjustments>):XMPProperty[]{
 const fields: XMPProperty[]=[];
 for(const [key,name] of [['exposure','Exposure2012'],['temperature','Temperature'],['tint','Tint']] as const){if(key!=='exposure'&&adjustments[key]!==undefined&&!Number.isInteger(adjustments[key]))throw new Error(`XMP ${name} 必须为整数。`);fields.push(property(CRS,name,adjustments[key]===undefined?null:text(adjustments[key])));}
 if(adjustments.temperature!==undefined||adjustments.tint!==undefined)fields.push(property(CRS,'WhiteBalance',text('Custom')));
 for(const [key,name] of Object.entries(curves) as [keyof typeof curves,string][]){const points=adjustments[key];fields.push(property(CRS,name,points?{items:points.map(p=>text(`${p.x*255}, ${p.y*255}`)),options:0x600}:null));}
 const curvePoints=(Object.keys(curves) as (keyof typeof curves)[]).map(key=>adjustments[key]);
 if(curvePoints.some(points=>points!==undefined))fields.push(property(CRS,'ToneCurveName2012',text(curvePoints.every(endpointIdentity)?'Linear':'Custom')));
 const native=structuredClone(adjustments);for(const key of standardKeys)delete native[key];
 fields.push(property(CT,'ARTAdjustments',encode(native)),property(CT,'ARTWhiteBalanceCoordinates',adjustments.wbMultipliers?encode([adjustments.temperature,adjustments.tint]):null));
 return fields;
}
export function decodeAdjustments(properties:XMPProperty[]){
 const raw=readExtension(properties,'ARTAdjustments');if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw new Error('无效的 ART 调整结构。');
 const adjustments:Partial<Adjustments>=raw||{};
 // Reject duplicated ownership: standard properties are the only persisted representation of these controls.
 if(standardKeys.some(key=>Object.hasOwn(adjustments,key)))throw new Error('显影扩展重复定义标准 XMP 参数。');
 for(const [key,name,low,high] of [['exposure','Exposure2012',-5,5],['temperature','Temperature',2000,50000],['tint','Tint',-150,150]] as const){const node=lookup(properties,CRS,name);if(node){const n=Number(node.value);if(!node.value?.trim()||!Number.isFinite(n)||n<low||n>high)throw new Error(`XMP ${name} 超出当前显影核心范围。`);adjustments[key]=n;}}
 for(const [key,name] of [['temperature','Temperature'],['tint','Tint']] as const)if(adjustments[key]!==undefined&&!Number.isInteger(adjustments[key]))throw new Error(`XMP ${name} 必须为整数。`);
 for(const [key,name] of Object.entries(curves) as [keyof typeof curves,string][]){const node=lookup(properties,CRS,name);if(!node)continue;
  if(!node.items||node.items.length<2||node.items.length>128)throw new Error('XMP 曲线点数量无效。');
  let previous=-1;adjustments[key]=node.items.map(item=>{
   const tokens=item.value?.split(',').map(v=>v.trim());
   if(!tokens||tokens.length!==2||tokens.some(v=>!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)))throw new Error('XMP 曲线点无效。');
   const parts=tokens.map(Number);if(parts.some(v=>!Number.isFinite(v)||v<0||v>255)||parts[0]<=previous)throw new Error('XMP 曲线点无效。');previous=parts[0];return {x:parts[0]/255,y:parts[1]/255};
  });
 }
 if(adjustments.wbMultipliers){const anchor=readExtension(properties,'ARTWhiteBalanceCoordinates');if(!Array.isArray(anchor)||anchor[0]!==adjustments.temperature||anchor[1]!==adjustments.tint){adjustments.wbMultipliers=null;adjustments.wbMode='custom';adjustments.wbApproximate=false;}}
 const recognized=new Set(['Exposure2012','Temperature','Tint','ToneCurveName2012',...Object.values(curves),'Version','ProcessVersion','Name','Group','UUID','PresetType','SupportsAmount','HasSettings']);
 const wb=lookup(properties,CRS,'WhiteBalance')?.value,hasWB=adjustments.temperature!==undefined||adjustments.tint!==undefined;
 if(wb==='Custom'||hasWB)recognized.add('WhiteBalance');
 const unsupported=properties.filter(p=>p.ns===CRS&&!recognized.has(p.name)).map(p=>p.name);
 const warnings:string[]=[];
 const curveName=lookup(properties,CRS,'ToneCurveName2012'),curvePoints=(Object.keys(curves) as (keyof typeof curves)[]).map(key=>adjustments[key]).filter(points=>points!==undefined);
 if(curveName){
  if(!curvePoints.length)warnings.push(`ToneCurveName2012=${curveName.value||'（空）'} 仅有名称，没有 PV2012 曲线坐标，尚未应用；未按名称推断或生成曲线。`);
  else if(curveName.value==='Linear'&&curvePoints.some(points=>points[0].x!==0||points.at(-1)!.x!==1||points.some(p=>p.x!==p.y)))warnings.push('ToneCurveName2012=Linear 与记录的曲线坐标不一致；CaptRAW 使用记录的坐标，保存时同步为 Custom。Adobe 对名称与坐标的处理优先级尚未验证。');
  else if(curveName.value!=='Linear'&&curveName.value!=='Custom')warnings.push(`ToneCurveName2012=${curveName.value||'（空）'} 与曲线坐标的对应关系尚未验证；CaptRAW 使用记录的坐标，未按名称生成曲线。Adobe 对名称与坐标的处理优先级尚未验证。`);
 }
 if(!readExtension(properties,'EngineVersion'))warnings.push('Adobe 参数按当前 ART 管线显影；尚未验证与 ACR 的像素等效。');
 if(!readExtension(properties,'EngineVersion')&&(adjustments.temperature!==undefined||adjustments.tint!==undefined))warnings.push('色温 / 色调按当前相机 DCP 或矩阵转换；未导入 Adobe 相机配置，颜色仍可能不同。');
 if(hasWB&&wb&&wb!=='Custom')warnings.push(`WhiteBalance=${wb} 采用文件中已记录的色温 / 色调，未按 Adobe 模式重新计算；保存为固定的自定义白平衡。`);
 if(unsupported.length)warnings.push('以下 Adobe 字段已保留，尚未参与显影：'+unsupported.join('、'));
 return {adjustments,warnings};
}
