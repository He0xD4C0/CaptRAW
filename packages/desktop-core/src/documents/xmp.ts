import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {terminateProcess} from '../engine/runtime.js';
import type {Adjustments,AdjustmentPatch,LocalMask,MaskComponent} from '@captraw/contracts';
import {ENGINE_VERSION,READABLE_ENGINE_VERSIONS,validateBrushPrograms,validateLinearGradientModels,hasRelativeWhiteBalance,validateSourceFrame,pointCurveName,matchesPointCurvePreset,validatePerspective,validateCurveRefine} from '@captraw/contracts';
import {parseEnhancedProfile,enhancedLookProperties} from '../profiles/enhanced-profiles.js';
export const CRS='http://ns.adobe.com/camera-raw-settings/1.0/',CT='https://captraw.org/ns/develop/1.0/',TIFF='http://ns.adobe.com/tiff/1.0/',XMP_BASIC='http://ns.adobe.com/xap/1.0/';
export interface XMPNode {localized?:string;value?:string;options?:number;type?:string;lang?:string;items?:XMPNode[];fields?:XMPProperty[];qualifiers?:XMPProperty[]}
export interface XMPProperty {ns:string;name:string;node:XMPNode|null}
export interface XMPResult {packet?:string;properties:XMPProperty[]}
export class XMP {
 constructor(private binary:string){}
 async call(method:'read'|'write'|'file-read'|'file-write',packet:string,changes:XMPProperty[]=[],file?:{path:string;format:'jpeg'|'tiff'}):Promise<XMPResult>{
  return new Promise((accept,reject)=>{
   const child=spawn(this.binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true}),chunks:Buffer[]=[],errors:Buffer[]=[];let size=0,settled=false;
   const finish=(error?:Error,value?:XMPResult)=>{if(settled)return;settled=true;clearTimeout(timer);terminateProcess(child);error?reject(error):accept(value!);};
   const timer=setTimeout(()=>finish(new Error('XMP 处理超时。')),30000);
   child.on('error',error=>finish(error));child.stdin.on('error',error=>finish(error));
   child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>128*1024*1024)finish(new Error('XMP 响应超过限制。'));else chunks.push(chunk);});
   child.stderr.on('data',(chunk:Buffer)=>{if(errors.reduce((n,b)=>n+b.length,0)<65536)errors.push(chunk);});
   child.on('close',code=>{try{if(code!==0)throw new Error(Buffer.concat(errors).toString()||'XMP 处理失败。');const response=JSON.parse(Buffer.concat(chunks).toString());if(response.error)throw new Error(response.error);finish(undefined,response.result);}catch(e){finish(e instanceof Error?e:new Error(String(e)));}});
   child.stdin.end(JSON.stringify({id:1,method,packet,changes,...file})+'\n');
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
// Keep unknown RDF fields while the caller explicitly removes owned editing state.
// Arrays retain their requested order/length; identified items carry their own metadata.
export function mergeXMPNode(previous:XMPNode,next:XMPNode,preserve:(path:string,field:XMPProperty)=>boolean=()=>true,path=''):XMPNode {
 if(previous.fields&&!next.fields&&previous.fields.some(field=>preserve(path,field)))throw new Error('XMP 节点类型变化无法保留未知结构：'+path);
 const result=structuredClone(next);
 const properties=(old:XMPProperty[],values:XMPProperty[],fields:boolean):XMPProperty[]=>{
  const merged=structuredClone(values);
  for(const property of old){
   const index=merged.findIndex(p=>p.ns===property.ns&&p.name===property.name);
   if(index<0){if(!fields||preserve(path,property))merged.push(structuredClone(property));}
   else if(property.node&&merged[index].node)merged[index].node=mergeXMPNode(property.node,merged[index].node!,preserve,path+'/'+property.name);
  }
  return merged;
 };
 if(previous.qualifiers||next.qualifiers)result.qualifiers=properties(previous.qualifiers||[],next.qualifiers||[],false);
 if(previous.lang!==undefined&&next.lang===undefined)result.lang=previous.lang;
 if(previous.fields&&next.fields)result.fields=properties(previous.fields,next.fields,true);
 if(previous.items&&next.items){
  const id=(item:XMPNode)=>item.fields?.find(p=>p.ns===CT&&p.name==='id')?.node?.value;
  result.items=next.items.map((item,index)=>{
   const key=id(item),old=key===undefined?previous.items![index]:previous.items!.find(p=>id(p)===key);
   return old?mergeXMPNode(old,item,preserve,path+`[${key??index}]`):structuredClone(item);
  });
 }
 return result;
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
type StandardAdjustment={key:keyof Adjustments;name:string;min:number;max:number;integer:boolean};
const standardAdjustments:readonly StandardAdjustment[]=[
 {key:'exposure',name:'Exposure2012',min:-5,max:5,integer:false},
 {key:'temperature',name:'Temperature',min:1500,max:50000,integer:true},
 {key:'tint',name:'Tint',min:-150,max:150,integer:true},
 {key:'incrementalTemperature',name:'IncrementalTemperature',min:-100,max:100,integer:true},
 {key:'incrementalTint',name:'IncrementalTint',min:-100,max:100,integer:true},
 {key:'contrast',name:'Contrast2012',min:-100,max:100,integer:true},
 {key:'highlights',name:'Highlights2012',min:-100,max:100,integer:true},
 {key:'shadows',name:'Shadows2012',min:-100,max:100,integer:true},
 {key:'whites',name:'Whites2012',min:-100,max:100,integer:true},
 {key:'blacks',name:'Blacks2012',min:-100,max:100,integer:true},
 {key:'vibrance',name:'Vibrance',min:-100,max:100,integer:true},
 {key:'saturation',name:'Saturation',min:-100,max:100,integer:true},
 {key:'texture',name:'Texture',min:-100,max:100,integer:true},
 {key:'clarity',name:'Clarity2012',min:-100,max:100,integer:true},
 {key:'dehaze',name:'Dehaze',min:-100,max:100,integer:true},
 {key:'vignette',name:'PostCropVignetteAmount',min:-100,max:100,integer:true},
 {key:'grain',name:'GrainAmount',min:0,max:100,integer:true},
 {key:'glow',name:'Glow',min:0,max:100,integer:true},
 {key:'glowRange',name:'GlowRange',min:0,max:100,integer:true},
 {key:'glowSpread',name:'GlowSpread',min:0,max:100,integer:true},
 {key:'glowWarmth',name:'GlowWarmth',min:-100,max:100,integer:true},
 {key:'sharpening',name:'Sharpness',min:0,max:150,integer:true},
 {key:'sharpenRadius',name:'SharpenRadius',min:.5,max:3,integer:false},
 {key:'luminanceNoise',name:'LuminanceSmoothing',min:0,max:100,integer:true},
 {key:'colorNoise',name:'ColorNoiseReduction',min:0,max:100,integer:true},
 {key:'lensManualDistortion',name:'LensManualDistortionAmount',min:-100,max:100,integer:true},
 {key:'lensVignette',name:'VignetteAmount',min:-100,max:100,integer:true},
];
// Sub-0.5 radii belong to the old ART renderer, never to Adobe's CRS field.
const glowStyles=['diffusion','bloom','halation'] as const;
const legacySharpenRadius=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=.1&&v<.5;
const parametricValues=[
 {key:'shadows',name:'ParametricShadows',min:-100,max:100},
 {key:'darks',name:'ParametricDarks',min:-100,max:100},
 {key:'lights',name:'ParametricLights',min:-100,max:100},
 {key:'highlights',name:'ParametricHighlights',min:-100,max:100},
] as const;
const parametricSplits=[
 {key:'shadowSplit',name:'ParametricShadowSplit',min:1,max:99},
 {key:'midtoneSplit',name:'ParametricMidtoneSplit',min:1,max:99},
 {key:'highlightSplit',name:'ParametricHighlightSplit',min:1,max:99},
] as const;
const parametricAdjustments=[...parametricValues,...parametricSplits];
function validateSplits(splits:Partial<Record<0|1|2,number>>){
 for(const i of [0,1,2] as const){const value=splits[i];if(value===undefined)continue;
  if(!Number.isInteger(value)||value<i+1||value>97+i)throw new Error('XMP 参数曲线分界无效。');
  for(const j of [0,1,2] as const)if(j>i&&splits[j]!==undefined&&splits[j]!-value<j-i)throw new Error('XMP 参数曲线分界无效。');
 }
}
const hslNames=['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta'] as const;
const hslAdjustments=['hue','saturation','luminance'].flatMap(group=>hslNames.map((name,index)=>({group,name:`${group==='hue'?'Hue':group==='saturation'?'Saturation':'Luminance'}Adjustment${name}`,index}))) as {group:'hue'|'saturation'|'luminance';name:string;index:number}[];
const colorGradingAdjustments=[
 ['shadows','hue','SplitToningShadowHue',0,360],['shadows','sat','SplitToningShadowSaturation',0,100],['shadows','luminance','ColorGradeShadowLum',-100,100],
 ['midtones','hue','ColorGradeMidtoneHue',0,360],['midtones','sat','ColorGradeMidtoneSat',0,100],['midtones','luminance','ColorGradeMidtoneLum',-100,100],
 ['highlights','hue','SplitToningHighlightHue',0,360],['highlights','sat','SplitToningHighlightSaturation',0,100],['highlights','luminance','ColorGradeHighlightLum',-100,100],
 ['global','hue','ColorGradeGlobalHue',0,360],['global','sat','ColorGradeGlobalSat',0,100],['global','luminance','ColorGradeGlobalLum',-100,100],
] as const;
// Versions through 0.60 wrote these five nonstandard names in CaptRAW-owned XMP.
const legacyGradingVersion='CaptRAW-24_ART-1.26.10_LibRaw-3b20539';
const legacyGradingNames:Record<string,string>={SplitToningShadowHue:'ColorGradeShadowHue',SplitToningShadowSaturation:'ColorGradeShadowSat',SplitToningHighlightHue:'ColorGradeHighlightHue',SplitToningHighlightSaturation:'ColorGradeHighlightSat',SplitToningBalance:'ColorGradeBalance'};
const blackWhiteAdjustments=hslNames.map((name,index)=>({name:`GrayMixer${name}`,index}));
const defringeAdjustments=[
 {key:'purpleAmount',name:'DefringePurpleAmount',min:0,max:100},
 {key:'purpleHueLo',name:'DefringePurpleHueLo',min:0,max:100},
 {key:'purpleHueHi',name:'DefringePurpleHueHi',min:0,max:100},
 {key:'greenAmount',name:'DefringeGreenAmount',min:0,max:100},
 {key:'greenHueLo',name:'DefringeGreenHueLo',min:0,max:100},
 {key:'greenHueHi',name:'DefringeGreenHueHi',min:0,max:100},
] as const;
const calibrationAdjustments=[
 {key:'shadowTint',name:'ShadowTint'},
 {key:'redHue',name:'RedHue'},
 {key:'redSaturation',name:'RedSaturation'},
 {key:'greenHue',name:'GreenHue'},
 {key:'greenSaturation',name:'GreenSaturation'},
 {key:'blueHue',name:'BlueHue'},
 {key:'blueSaturation',name:'BlueSaturation'},
] as const;
const sharpeningDetailAdjustments=[
 {key:'sharpenDetail',name:'SharpenDetail'},
 {key:'sharpenEdgeMask',name:'SharpenEdgeMasking'},
] as const;
const postCropVignetteAdjustments=[
 {key:'grainSize',name:'GrainSize',min:0,max:100},
 {key:'grainRoughness',name:'GrainFrequency',min:0,max:100},
 {key:'postCropVignetteMidpoint',name:'PostCropVignetteMidpoint',min:0,max:100},
 {key:'postCropVignetteHighlights',name:'PostCropVignetteHighlightContrast',min:0,max:100},
 {key:'postCropVignetteFeather',name:'PostCropVignetteFeather',min:0,max:100},
 {key:'postCropVignetteRoundness',name:'PostCropVignetteRoundness',min:-100,max:100},
] as const;
const noiseReductionAdjustments=[
 {key:'luminanceNoiseDetail',name:'LuminanceNoiseReductionDetail'},
 {key:'luminanceNoiseContrast',name:'LuminanceNoiseReductionContrast'},
 {key:'colorNoiseDetail',name:'ColorNoiseReductionDetail'},
 {key:'colorNoiseSmoothness',name:'ColorNoiseReductionSmoothness'},
] as const;
// ART flips the rotated canvas. TIFF rows/columns define all eight D4 orientations.
// https://developer.adobe.com/xmp/docs/xmp-namespaces/tiff/
const orientationTransforms:Record<number,{rotation:0|90|180|270;flipHorizontal:boolean;flipVertical:boolean}>={
 1:{rotation:0,flipHorizontal:false,flipVertical:false},2:{rotation:0,flipHorizontal:true,flipVertical:false},
 3:{rotation:180,flipHorizontal:false,flipVertical:false},4:{rotation:0,flipHorizontal:false,flipVertical:true},
 5:{rotation:90,flipHorizontal:true,flipVertical:false},6:{rotation:90,flipHorizontal:false,flipVertical:false},
 7:{rotation:90,flipHorizontal:false,flipVertical:true},8:{rotation:270,flipHorizontal:false,flipVertical:false},
};
function orientationOf(rotation:number,horizontal=false,vertical=false){
 const values:Record<number,number[]>={0:[1,2,4,3],90:[6,5,7,8],180:[3,4,2,1],270:[8,7,5,6]};
 return values[rotation][Number(horizontal)+2*Number(vertical)];
}
function flipCrop(crop:NonNullable<Adjustments['crop']>,horizontal=false,vertical=false){
 return {...crop,x:horizontal?Number((1-crop.x-crop.width).toPrecision(15)):crop.x,y:vertical?Number((1-crop.y-crop.height).toPrecision(15)):crop.y};
}
function rotatePoint(x:number,y:number,rotation:number){
 switch((rotation%360+360)%360){case 90:return {x:1-y,y:x};case 180:return {x:1-x,y:1-y};case 270:return {x:y,y:1-x};default:return {x,y};}
}
function rotateCrop(crop:NonNullable<Adjustments['crop']>,rotation:number){
 const first=rotatePoint(crop.x,crop.y,rotation),second=rotatePoint(crop.x+crop.width,crop.y+crop.height,rotation);
 const clean=(value:number)=>Number(value.toPrecision(15));
 return {x:clean(Math.min(first.x,second.x)),y:clean(Math.min(first.y,second.y)),width:clean(Math.abs(second.x-first.x)),height:clean(Math.abs(second.y-first.y))};
}
type AdobeMaskComponent=MaskComponent&{luminanceRange?:[number,number,number,number]};
function propertyOf(node:XMPNode|undefined,name:string){return node?.fields?.find(field=>field.ns===CRS&&field.name===name)?.node??undefined;}
function textOf(node:XMPNode|undefined,name:string){return propertyOf(node,name)?.value?.trim()||undefined;}
function numberOf(node:XMPNode|undefined,name:string){const text=textOf(node,name);if(text===undefined)return undefined;const value=Number(text);if(!text||!Number.isFinite(value))throw new Error(`XMP MaskGroupBasedCorrections.${name} 必须为有限数值。`);return value;}
function booleanOf(node:XMPNode|undefined,name:string){const text=textOf(node,name)?.toLowerCase();if(text===undefined)return undefined;if(text!=='true'&&text!=='false')throw new Error(`XMP MaskGroupBasedCorrections.${name} 必须为 True 或 False。`);return text==='true';}
function adobeMaskId(value:string|undefined,fallback:string){const clean=value?.replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);return `adobe-${clean||fallback}`;}
function clampNumber(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
export function decodeAdobeMaskGroups(node:XMPNode|undefined,warnings:string[],fullZero=true):LocalMask[]{
 if(!node)return [];
 if(!node.items)throw new Error('XMP MaskGroupBasedCorrections 必须为 RDF Seq。');
 const masks:LocalMask[]=[];
 for(const [groupIndex,correction] of node.items.entries()){
  if(!correction.fields)throw new Error('XMP 局部蒙版修正项无效。');
  const enabled=booleanOf(correction,'CorrectionActive')??true;
  const amountValue=numberOf(correction,'CorrectionAmount')??1;
  if(amountValue<0||amountValue>1)warnings.push(`Adobe 蒙版 CorrectionAmount=${amountValue} 超出 0–1，已夹紧。`);
  const amount=clampNumber(amountValue,0,1),name=textOf(correction,'CorrectionName')||`Adobe 蒙版 ${groupIndex+1}`;
  const rawId=textOf(correction,'CorrectionSyncID');
  const groupId=adobeMaskId(rawId,`mask-${groupIndex+1}`);
  const readLocal=(field:string,scale:number,min:number,max:number)=>{
   const value=numberOf(correction,field);if(value===undefined)return 0;
   const scaled=value*scale*amount;if(scaled<min||scaled>max)warnings.push(`Adobe 蒙版 ${field} 超出当前范围，已夹紧。`);
   return clampNumber(scaled,min,max);
  };
  const brightness=readLocal('LocalExposure2012',4,-4,4),contrast=readLocal('LocalContrast2012',100,-100,100),saturation=readLocal('LocalSaturation',100,-100,100);
  const tone={highlights:readLocal('LocalHighlights2012',100,-100,100),shadows:readLocal('LocalShadows2012',100,-100,100),whites:readLocal('LocalWhites2012',100,-100,100),blacks:readLocal('LocalBlacks2012',100,-100,100)};
  const whiteBalance={temperature:readLocal('LocalTemperature',100,-100,100),tint:readLocal('LocalTint',100,-100,100)};
  const details={hue:readLocal('LocalHue',100,-180,180),texture:readLocal('LocalTexture',100,-100,100),clarity:readLocal('LocalClarity2012',100,-100,100),noise:readLocal('LocalLuminanceNoise',100,0,100),noiseDetail:50,...(numberOf(correction,'LocalGlow')!==undefined?{glow:readLocal('LocalGlow',100,-100,100)}:{})};
  for(const field of ['LocalDehaze','LocalSharpness','LocalMoire','LocalDefringe','LocalGrain','LocalToningHue','LocalToningSaturation'])if((numberOf(correction,field)??0)!==0)warnings.push(`Adobe 蒙版 ${field} 当前没有等价局部控件，尚未应用。`);
  const refine=numberOf(correction,'LocalCurveRefineSaturation');if(refine!==undefined&&refine!==100)warnings.push('Adobe 蒙版 LocalCurveRefineSaturation 当前没有等价控件，尚未应用。');
  const container=propertyOf(correction,'CorrectionMasks');
  if(!container?.items?.length){warnings.push(`Adobe 蒙版“${name}”没有可识别的 CorrectionMasks，尚未应用。`);continue;}
  const components:AdobeMaskComponent[]=[];let incomplete=false;
  for(const [componentIndex,maskNode] of container.items.entries()){
   if(!maskNode.fields)throw new Error('XMP Adobe 蒙版组件必须为 RDF 结构。');
   const what=textOf(maskNode,'What')||'Mask/Unknown',maskName=textOf(maskNode,'MaskName')||`${name} · ${componentIndex+1}`;
   const mode=numberOf(maskNode,'MaskBlendMode')??0;
   if(mode!==0&&mode!==1&&mode!==2)throw new Error(`Adobe 蒙版 ${what} 的 MaskBlendMode=${mode} 无效。`);
   const operation:MaskComponent['operation']=mode===1?'subtract':mode===2?'intersect':'add';
   const maskValue=numberOf(maskNode,'MaskValue')??1,baseInverted=booleanOf(maskNode,'MaskInverted')??false,feather=clampNumber(numberOf(maskNode,'Feather')??0,0,100);
   const common={id:adobeMaskId(textOf(maskNode,'MaskSyncID'),`${rawId||groupIndex+1}-${componentIndex+1}`),name:maskName,enabled:booleanOf(maskNode,'MaskActive')??true,inverted:baseInverted,feather,points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},operation,initialized:true};
   if(what==='Mask/Gradient'){
    if(booleanOf(maskNode,'Bidirectional')){warnings.push(`Adobe 双向线性渐变“${maskName}”尚未实现，整组未应用；原始结构保留。`);incomplete=true;continue;}
    const zero={x:numberOf(maskNode,'ZeroX')??.5,y:numberOf(maskNode,'ZeroY')??.5},full={x:numberOf(maskNode,'FullX')??.5,y:numberOf(maskNode,'FullY')??.5};
    if(![zero.x,zero.y,full.x,full.y].every(value=>value>=0&&value<=1))throw new Error('XMP Adobe 线性渐变坐标超出 0–1。');
    if(fullZero&&feather!==0)warnings.push('Adobe 线性渐变的 Feather 字段尚未验证；按 Full/Zero 端点显影，原字段保留。');
    components.push({...common,type:'linear',...(fullZero?{linearGradientModel:'full-zero-v1' as const,feather:0}:{}),start:full,end:zero});
   }else if(what==='Mask/CircularGradient'){
    const left=numberOf(maskNode,'Left')??.2,top=numberOf(maskNode,'Top')??.2,right=numberOf(maskNode,'Right')??.8,bottom=numberOf(maskNode,'Bottom')??.8,angle=numberOf(maskNode,'Angle')??0;
    if(![left,top,right,bottom].every(value=>value>=0&&value<=1)||left>=right||top>=bottom)throw new Error('XMP Adobe 径向蒙版范围无效。');
    if(Math.abs(angle)>1e-6){warnings.push('Adobe 旋转径向蒙版尚未支持角度，未应用。');incomplete=true;continue;}
    const flipped=booleanOf(maskNode,'Flipped')??false,version=numberOf(maskNode,'Version');
    components.push({...common,type:'radial',start:{x:left,y:top},end:{x:right,y:bottom},inverted:baseInverted===flipped,feather:version===undefined?feather/2:feather});
   }else if(what==='Mask/Paint'){
    const dabs=propertyOf(maskNode,'Dabs'),points:MaskComponent['points']=[],erase=maskValue<=0;
    let radius=clampNumber(numberOf(maskNode,'Radius')??.1,.001,5),unsupported=false;
    if(!dabs?.items?.length){warnings.push(`Adobe 画笔蒙版“${maskName}”没有可读取的 RDF Dabs 数组，尚未应用。`);incomplete=true;continue;}
    for(const dab of dabs.items){
     const [command,...tokens]=(dab.value?.trim()||'').split(/\s+/),values=tokens.map(Number);
     if(tokens.some(token=>!token||!Number.isFinite(Number(token))))throw new Error('XMP Adobe Dabs 必须包含有限数值。');
     if(command==='r'&&values.length===1){if(values[0]<=0)throw new Error('XMP Adobe 画笔半径必须大于零。');radius=clampNumber(values[0],.001,5);}
     else if(command==='d'&&values.length===2){if(values.some(value=>value<0||value>1))throw new Error('XMP Adobe 画笔坐标超出 0–1。');points.push({x:values[0],y:values[1],radius,erase});}
     else unsupported=true;
    }
    if(unsupported||!points.length){warnings.push(`Adobe 画笔蒙版“${maskName}”包含未支持的 Dabs 指令或没有落笔点，尚未应用。`);incomplete=true;continue;}
    warnings.push(`Adobe 画笔蒙版“${maskName}”使用 ART 笔尖；半径、流量、笔压和边缘尚未验证与 ACR 等效。`);
    components.push({...common,type:'brush',points});
   }else if(what==='Mask/RangeMask'){
    const range=propertyOf(maskNode,'CorrectionRangeMask'),type=Number(textOf(range,'Type')??NaN);
    if(type!==2){warnings.push(`Adobe ${type===3?'深度范围':'范围'}蒙版当前尚无可等价图像数据，尚未应用。`);incomplete=true;continue;}
    const values=(textOf(range,'LumRange')||'').trim().split(/\s+/).map(Number);
    if(values.length!==4||values.some(value=>!Number.isFinite(value)||value<0||value>1)||values[0]>values[1]||values[1]>values[2]||values[2]>values[3])throw new Error('XMP Adobe 亮度范围蒙版无效。');
    components.push({...common,type:'luminance',luminanceRange:values.map(value=>value*100) as [number,number,number,number],inverted:baseInverted!==(booleanOf(range,'Invert')??false)});
   }else if(what==='Mask/Image'){
    const subtype=Number(textOf(maskNode,'MaskSubType')??'');warnings.push(`Adobe AI 蒙版 ${maskName}（MaskSubType=${Number.isFinite(subtype)?subtype:'未知'}）只记录选区引用，尚不能从 XMP 重建像素，未应用。`);incomplete=true;
   }else{warnings.push(`Adobe 蒙版 ${what} 尚未支持，未应用。`);incomplete=true;}
  }
  if(incomplete){warnings.push(`Adobe 蒙版“${name}”包含未支持的组件，整组未应用；原始 XMP 结构保留。`);continue;}
  if(!components.length)continue;
  const first=components[0];
  masks.push({id:groupId,name,type:first.type,enabled,inverted:false,feather:first.feather,points:[],start:first.start,end:first.end,brightness,contrast,saturation,
   ...(Object.values(tone).some(value=>value!==0)?{tone}:{}),...(Object.values(whiteBalance).some(value=>value!==0)?{whiteBalance}:{}),
   ...(details.hue!==0||details.texture!==0||details.clarity!==0||details.noise!==0||(details.glow??0)!==0?{details}:{}),components});
 }
 return masks;
}
export const standardKeys=[...standardAdjustments.map(field=>field.key),...Object.keys(curves),'curveName','curveRefineSaturation','hdrEnabled','parametricCurve','hsl','colorGrading','defringe','calibration','sharpenDetail','sharpenEdgeMask',...noiseReductionAdjustments.map(field=>field.key),...postCropVignetteAdjustments.map(field=>field.key),'postCropVignetteStyle','glowStyle','rotation','crop'] as (keyof Adjustments)[];
export function encodeAdjustments(adjustments:AdjustmentPatch,previousProperties:XMPProperty[]=[]):XMPProperty[]{
 if(adjustments.sourceFrame!==undefined)validateSourceFrame(adjustments.sourceFrame);
 const relative=hasRelativeWhiteBalance(adjustments);
 if(relative&&adjustments.relativeWBModel!==undefined&&adjustments.relativeWBModel!=='art-ctl-v1')throw new Error('不支持的相对白平衡处理版本。');
 if(relative&&adjustments.wbMultipliers)throw new Error('相对白平衡不能同时保存相机白平衡系数。');
 validateBrushPrograms(adjustments.masks);
 validateLinearGradientModels(adjustments.masks);
 validatePerspective(adjustments.perspective);
 validateRepairPaths(adjustments.spots);
 validateCurveRefine(adjustments);
 const fields: XMPProperty[]=[];
 if(adjustments.colorProfile!==undefined)fields.push(...enhancedLookProperties(adjustments.colorProfile,previousProperties));
 if(adjustments.hdrEnabled!==undefined&&typeof adjustments.hdrEnabled!=='boolean')throw new Error('XMP HDR 编辑开关无效。');
 if(adjustments.hdrHeadroom!==undefined&&(!Number.isFinite(adjustments.hdrHeadroom)||adjustments.hdrHeadroom<1||adjustments.hdrHeadroom>4))throw new Error('HDR 亮度余量须为 1–4 EV。');
 fields.push(property(CRS,'HDREditMode',adjustments.hdrEnabled===undefined?null:text(adjustments.hdrEnabled?1:0)));
 if(readExtension(previousProperties,'EngineVersion')===legacyGradingVersion)for(const name of Object.values(legacyGradingNames))if(lookup(previousProperties,CRS,name))fields.push(property(CRS,name,null));
 for(const {key,name,min,max,integer} of standardAdjustments){
  if(relative&&(key==='temperature'||key==='tint')){fields.push(property(CRS,name,null));continue;}
  const value=adjustments[key] as number|undefined,legacy=key==='sharpenRadius'&&legacySharpenRadius(value);
  if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||(!legacy&&(value<min||value>max))))throw new Error(`XMP ${name} 超出当前显影核心范围。`);
  if(integer&&value!==undefined&&!Number.isInteger(value))throw new Error(`XMP ${name} 必须为整数。`);
  fields.push(property(CRS,name,value===undefined||legacy?null:text(value)));
 }
 if(adjustments.glowStyle!==undefined&&!glowStyles.includes(adjustments.glowStyle))throw new Error('XMP 发光样式无效。');
 fields.push(property(CRS,'GlowStyle',adjustments.glowStyle===undefined?null:text(glowStyles.indexOf(adjustments.glowStyle))));
 for(const mask of adjustments.masks??[])if(mask.details?.glow!==undefined&&(!Number.isInteger(mask.details.glow)||mask.details.glow<-100||mask.details.glow>100))throw new Error('XMP 局部发光须为 -100–100 整数。');
 if(relative||adjustments.temperature!==undefined||adjustments.tint!==undefined)fields.push(property(CRS,'WhiteBalance',text(relative&&adjustments.wbMode==='camera'&&!adjustments.incrementalTemperature&&!adjustments.incrementalTint?'As Shot':'Custom')));
 const parametric=adjustments.parametricCurve;
 for(const {key,name,min,max} of parametricValues){const value=parametric?.[key];if(value!==undefined&&(!Number.isInteger(value)||value<min||value>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);fields.push(property(CRS,name,value===undefined?null:text(value)));}
 for(const [index,{name,min,max}] of parametricSplits.entries()){const value=parametric?.splits?.[index as 0|1|2];if(value!==undefined&&(!Number.isInteger(value)||value<min||value>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);fields.push(property(CRS,name,value===undefined?null:text(value)));}
 if(parametric?.splits)validateSplits(parametric.splits);
 for(const {group,name,index} of hslAdjustments){const value=adjustments.hsl?.[group]?.[index];if(value!==undefined&&(!Number.isInteger(value)||value<-100||value>100))throw new Error(`XMP ${name} 超出当前显影核心范围。`);fields.push(property(CRS,name,value===undefined?null:text(value)));}
 for(const [region,key,name,min,max] of colorGradingAdjustments){const value=adjustments.colorGrading?.[region]?.[key==='sat'?'saturation':key];if(value!==undefined&&(!Number.isInteger(value)||value<min||value>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);fields.push(property(CRS,name,value===undefined?null:text(value)));}
 for(const [key,name,min,max] of [['blending','ColorGradeBlending',0,100],['balance','SplitToningBalance',-100,100]] as const){const value=adjustments.colorGrading?.[key];if(value!==undefined&&(!Number.isInteger(value)||value<min||value>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);fields.push(property(CRS,name,value===undefined?null:text(value)));}
 const blackWhite=adjustments.blackWhite;fields.push(property(CRS,'ConvertToGrayscale',blackWhite?text(blackWhite.enabled?'True':'False'):null));
 for(const {name,index} of blackWhiteAdjustments){const value=blackWhite?.mixer?.[index];if(value!==undefined&&(!Number.isInteger(value)||value<-100||value>100))throw new Error(`XMP ${name} 超出当前显影核心范围。`);fields.push(property(CRS,name,value===undefined?null:text(value)));}
 if(adjustments.defringe){
  for(const {key,name,min,max} of defringeAdjustments){const value=adjustments.defringe[key];if(!Number.isInteger(value)||value<min||value>max)throw new Error(`XMP ${name} 超出当前显影核心范围。`);fields.push(property(CRS,name,text(value)));}
  if(adjustments.defringe.purpleHueLo>=adjustments.defringe.purpleHueHi||adjustments.defringe.greenHueLo>=adjustments.defringe.greenHueHi)throw new Error('XMP 色差去边色相范围无效。');
 }
 // ShadowTint is now owned: removing it must not resurrect a previously saved tint.
 for(const {key,name} of calibrationAdjustments){const value=adjustments.calibration?.[key];if(value!==undefined&&(!Number.isInteger(value)||value<-100||value>100))throw new Error(`XMP ${name} 超出当前显影核心范围。`);if(value!==undefined||key==='shadowTint')fields.push(property(CRS,name,value===undefined?null:text(value)));}
 for(const {key,name} of sharpeningDetailAdjustments){const value=adjustments[key];if(value!==undefined&&(!Number.isInteger(value)||value<0||value>100))throw new Error(`XMP ${name} 超出当前显影核心范围。`);if(value!==undefined)fields.push(property(CRS,name,text(value)));}
 const styles={'highlight-priority':1,'color-priority':2,'paint-overlay':3} as const;
 if(adjustments.postCropVignetteStyle!==undefined){const style=styles[adjustments.postCropVignetteStyle];if(!style)throw new Error('XMP 晕影样式无效。');fields.push(property(CRS,'PostCropVignetteStyle',text(style)));}else fields.push(property(CRS,'PostCropVignetteStyle',null));
 if(adjustments.grainModel!==undefined&&adjustments.grainModel!=='procedural-v1')throw new Error('不支持的颗粒模型。');
 for(const {key,name,min,max} of postCropVignetteAdjustments){const value=adjustments[key];if(value!==undefined&&(!Number.isInteger(value)||value<min||value>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);if(value!==undefined)fields.push(property(CRS,name,text(value)));}
 for(const {key,name} of noiseReductionAdjustments){const value=adjustments[key];if(value!==undefined&&(!Number.isInteger(value)||value<0||value>100))throw new Error(`XMP ${name} 超出当前显影核心范围。`);if(value!==undefined)fields.push(property(CRS,name,text(value)));}
 for(const key of ['flipHorizontal','flipVertical'] as const)if(adjustments[key]!==undefined&&typeof adjustments[key]!=='boolean')throw new Error('XMP 翻转必须为布尔值。');
 if(adjustments.rotation!==undefined||adjustments.flipHorizontal!==undefined||adjustments.flipVertical!==undefined){const rotation=adjustments.rotation??0;if(![0,90,180,270].includes(rotation))throw new Error('XMP 旋转必须为 0、90、180 或 270 度。');fields.push(property(TIFF,'Orientation',text(orientationOf(rotation,adjustments.flipHorizontal,adjustments.flipVertical))));}
 if(adjustments.fineRotation!==undefined&&(!Number.isFinite(adjustments.fineRotation)||adjustments.fineRotation<-45||adjustments.fineRotation>45))throw new Error('XMP 旋转角度超出当前显影核心范围。');
 if(adjustments.crop!==undefined){
  if(adjustments.crop===null){fields.push(property(CRS,'HasCrop',text('False')),property(CRS,'CropTop',text('0')),property(CRS,'CropLeft',text('0')),property(CRS,'CropBottom',text('1')),property(CRS,'CropRight',text('1')),property(CRS,'CropAngle',text('0')));}
  else{
   const crop=flipCrop(rotateCrop(adjustments.crop,adjustments.rotation??0),adjustments.flipHorizontal,adjustments.flipVertical),angle=adjustments.fineRotation??0;
   if(![crop.x,crop.y,crop.width,crop.height,angle].every(Number.isFinite)||crop.x<0||crop.y<0||crop.width<.001||crop.height<.001||crop.x+crop.width>1.00001||crop.y+crop.height>1.00001||angle<-45||angle>45)throw new Error('XMP 裁切或角度超出当前显影核心范围。');
   fields.push(property(CRS,'HasCrop',text('True')),property(CRS,'CropTop',text(crop.y)),property(CRS,'CropLeft',text(crop.x)),property(CRS,'CropBottom',text(crop.y+crop.height)),property(CRS,'CropRight',text(crop.x+crop.width)),property(CRS,'CropAngle',text(angle)));
  }
 }else if(adjustments.fineRotation!==undefined)for(const name of ['HasCrop','CropTop','CropLeft','CropBottom','CropRight','CropAngle'])fields.push(property(CRS,name,null));
 for(const [key,name] of Object.entries(curves) as [keyof typeof curves,string][]){const points=adjustments[key];fields.push(property(CRS,name,points?{items:points.map(p=>text(`${p.x*255}, ${p.y*255}`)),options:0x600}:null));}
 const curvePoints=(Object.keys(curves) as (keyof typeof curves)[]).map(key=>adjustments[key]);
 if(adjustments.curveName!==undefined&&!['Linear','Custom','Medium Contrast','Strong Contrast'].includes(adjustments.curveName))throw new Error('XMP 点曲线名称无效。');
 if(curvePoints.some(points=>points!==undefined)||adjustments.curveName!==undefined)fields.push(property(CRS,'ToneCurveName2012',text(pointCurveName(adjustments))));
 if(adjustments.curveRefineModel!==undefined)fields.push(property(CRS,'CurveRefineSaturation',text(adjustments.curveRefineSaturation!)));
 else if(readExtension(previousProperties,'ARTAdjustments')?.curveRefineModel==='weighted-std-v1')fields.push(property(CRS,'CurveRefineSaturation',null));
 // Adobe defines CropAngle only for HasCrop=True; free rotation remains ART-specific.
 // https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/
 const native=structuredClone(adjustments);for(const key of standardKeys)delete native[key];if(adjustments.crop)delete native.fineRotation;
 const perspective=adjustments.perspective;
 if(perspective){
  const signed=perspective.manualModel==='signed-framing-v1',active=perspective.enabled&&!!perspective.manualModel;
  fields.push(property(CRS,'PerspectiveScale',text(active?perspectiveScaleDecimal(String(perspective.scale??1),2):'100')));
  if(signed){
   for(const [key,name] of [['aspect','PerspectiveAspect'],['offsetX','PerspectiveX'],['offsetY','PerspectiveY']] as const){
    fields.push(property(CRS,name,text(active?perspective[key]??0:0)));
    if(active)delete (native.perspective as Partial<NonNullable<Adjustments['perspective']>>)[key];
   }
  }else if(readExtension(previousProperties,'ARTAdjustments')?.perspective?.manualModel==='signed-framing-v1'){
   for(const name of ['PerspectiveAspect','PerspectiveX','PerspectiveY'])fields.push(property(CRS,name,null));
  }
  // Disabled scale is remembered only in the bypassed ART group. Standard
  // readers receive neutral 100; active recipes have one scale authority.
  if(active)delete native.perspective!.scale;
 }else if(readExtension(previousProperties,'ARTAdjustments')?.perspective?.manualModel){
  fields.push(property(CRS,'PerspectiveScale',null));
  if(readExtension(previousProperties,'ARTAdjustments')?.perspective?.manualModel==='signed-framing-v1')for(const name of ['PerspectiveAspect','PerspectiveX','PerspectiveY'])fields.push(property(CRS,name,null));
 }
 if(legacySharpenRadius(adjustments.sharpenRadius))native.sharpenRadius=adjustments.sharpenRadius;
 if(native.blackWhite){const {base}=native.blackWhite;if(base===undefined)delete native.blackWhite;else native.blackWhite={base} as NonNullable<Adjustments['blackWhite']>;}
 fields.push(property(CT,'ARTAdjustments',encode(native)),property(CT,'ARTWhiteBalanceCoordinates',!relative&&adjustments.wbMultipliers?encode([adjustments.temperature,adjustments.tint]):null));
 return fields;
}
// Repair paths use the existing typed RDF extension; keep Adobe retouch trees
// untouched until their coordinate/solver semantics have a verified mapping.
function validateRepairPaths(spots:Adjustments['spots']){
 if(spots===undefined)return;
 if(!Array.isArray(spots))throw new Error('XMP 修复必须为数组。');
 for(const spot of spots){
  if(spot.sourceMode!==undefined&&!['auto','manual'].includes(spot.sourceMode))throw new Error('XMP 修复来源模式无效。');
  if(spot.searchSeed!==undefined&&(!Number.isSafeInteger(spot.searchSeed)||spot.searchSeed<0))throw new Error('XMP 修复搜索次数无效。');
  if(spot.path===undefined)continue;
  if(!Array.isArray(spot.path)||spot.path.length<2||spot.path.length>32768)throw new Error('XMP 连续修复轨迹无效。');
  for(const point of spot.path)if(!point||![point.x,point.y].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1))throw new Error('XMP 连续修复坐标无效。');
  if(spot.path[0].x!==spot.target.x||spot.path[0].y!==spot.target.y)throw new Error('XMP 修复轨迹起点与目标不一致。');
 }
}
// Shift the decimal spelling, not a binary float product: migrating an old
// private ratio must recover the exact same double after percent decoding.
function perspectiveScaleDecimal(value:string,places:number){
 const m=value.trim().match(/^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
 if(!m)throw new Error('XMP PerspectiveScale 必须为有效百分值。');
 const digits=m[1]+(m[2]||''),point=m[1].length+Number(m[3]||0)+places;
 const shifted=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
 return shifted.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}
export function decodeAdjustments(properties:XMPProperty[]){
 const raw=readExtension(properties,'ARTAdjustments');if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw new Error('无效的 ART 调整结构。');
 const adjustments:AdjustmentPatch=raw||{};
 if(raw&&Object.hasOwn(raw,'curveRefineSaturation'))throw new Error('曲线优化饱和度必须使用标准 CurveRefineSaturation 属性。');
 if(adjustments.curveRefineModel!==undefined){
  const node=lookup(properties,CRS,'CurveRefineSaturation');
  if(!node?.value?.trim()||node.fields||node.items)throw new Error('曲线优化处理模型缺少有效标准数值。');
  adjustments.curveRefineSaturation=Number(node.value);validateCurveRefine(adjustments);
 }
 validatePerspective(adjustments.perspective);
 if(adjustments.sourceFrame!==undefined)validateSourceFrame(adjustments.sourceFrame);
 const relativeNodes=['IncrementalTemperature','IncrementalTint'].some(name=>lookup(properties,CRS,name));
 if((relativeNodes||raw?.relativeWBModel!==undefined)&&['Temperature','Tint'].some(name=>lookup(properties,CRS,name)))throw new Error('XMP 同时含绝对色温与相对白平衡，无法确定单位；未应用。');
 if(lookup(properties,CRS,'Look')){
  const parsed=parseEnhancedProfile(properties,'');
  if(adjustments.colorProfile?.look){
   const saved=adjustments.colorProfile.look;
   const parameters=(p:Record<string,string>)=>JSON.stringify(Object.entries(p).sort(([a],[b])=>a.localeCompare(b))),tables=(p:typeof saved.profile.tables)=>JSON.stringify(p.map(t=>[t.fingerprint.toLowerCase(),t.data]).sort(([a],[b])=>a.localeCompare(b)));
   if(saved.profile.uuid!==parsed.profile.uuid||parameters(saved.profile.parameters)!==parameters(parsed.profile.parameters)||tables(saved.profile.tables)!==tables(parsed.profile.tables))throw new Error('标准 Look 与编辑快照的表资产冲突，未应用。');
   saved.amount=parsed.amount;
  }else adjustments.colorProfile={mode:'auto',toneCurve:false,lookTable:false,hueSatMap:true,baselineExposure:true,illuminant:0,look:parsed};
 }
 validateBrushPrograms(adjustments.masks);
 validateLinearGradientModels(adjustments.masks);
 validateRepairPaths(adjustments.spots);
 const engineVersion=readExtension(properties,'EngineVersion'),legacyConflicts:string[]=[],partialGroups:string[]=[],warnings:string[]=[];
 const scaleNode=lookup(properties,CRS,'PerspectiveScale');
 let signedFraming=false;
 const privatePerspective=adjustments.perspective;
 if(privatePerspective?.manualModel==='signed-framing-v1'||(!privatePerspective&&!readExtension(properties,'ARTProfile')&&!engineVersion)){
  const values={aspect:0,offsetX:0,offsetY:0,scale:1};
  for(const [key,name] of [['aspect','PerspectiveAspect'],['offsetX','PerspectiveX'],['offsetY','PerspectiveY'],['scale','PerspectiveScale']] as const){
   const node=lookup(properties,CRS,name);if(!node)continue;
   if(node.fields||node.items||!node.value?.trim()||!Number.isFinite(Number(node.value)))throw new Error(`XMP ${name} 必须为有限数值。`);
   values[key]=key==='scale'?Number(perspectiveScaleDecimal(node.value,-2)):Number(node.value);
  }
  if(privatePerspective){
   signedFraming=true;
   if(privatePerspective.enabled){
    for(const key of ['aspect','scale','offsetX','offsetY'] as const)if(Object.hasOwn(privatePerspective,key))throw new Error('有符号几何扩展重复定义标准 XMP 参数。');
    for(const name of ['PerspectiveAspect','PerspectiveScale','PerspectiveX','PerspectiveY'])if(!lookup(properties,CRS,name))throw new Error('有符号几何模型缺少标准 XMP 参数。');
    Object.assign(privatePerspective,values);
   }else if(values.aspect!==0||values.offsetX!==0||values.offsetY!==0||values.scale!==1)warnings.push('有符号几何当前停用，保留停用数值；下次保存标准几何迁移为中性值。');
  }else if(values.aspect!==0||values.offsetX!==0||values.offsetY!==0||values.scale!==1){
   adjustments.perspective={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,manualModel:'signed-framing-v1',...values};signedFraming=true;
   warnings.push('手动几何使用已验证的版本化候选映射；尚未确认 Adobe 完整公式或像素等效。');
  }
  if(signedFraming)validatePerspective(adjustments.perspective);
 }
 if(scaleNode&&!signedFraming){
  const spelling=scaleNode.value?.trim()||'',percent=Number(spelling),perspective=adjustments.perspective;
  if(!spelling||!Number.isFinite(percent)||percent<=0)throw new Error('XMP PerspectiveScale 必须为有效正百分值。');
  const ratio=Number(perspectiveScaleDecimal(spelling,-2)),savedVersion=typeof engineVersion==='string'?engineVersion.match(/^CaptRAW-(\d+)_/):null;
  const privateScale=perspective?.scale;
  if(perspective&&privateScale!==undefined){
   const expected=perspective.enabled?privateScale:1;
   if(ratio!==expected)warnings.push(`旧私有缩放优先于 PerspectiveScale=${spelling}；为保留现有外观，继续使用 ART 值，下次保存迁移为 ${perspective.enabled?perspectiveScaleDecimal(String(privateScale),2):'100'}%。`);
  }else if(perspective?.manualModel==='art-perspective-v1'&&!(savedVersion&&Number(savedVersion[1])<=31)){
   if(perspective.enabled){
    if(ratio<.1||ratio>4)throw new Error('PerspectiveScale 超出当前核心支持范围 10–400%。');
    perspective.scale=ratio;
   }else if(percent!==100)warnings.push('透视变换当前停用，非中性的 PerspectiveScale 未覆盖已有停用状态；下次保存迁移为 100%。');
  }else if(perspective||readExtension(properties,'ARTProfile')||engineVersion){
   // Old ARP geometry remains authoritative, even when a formerly unsupported
   // standard field happens to say 100. Native open projects its actual value.
   const profile=readExtension(properties,'ARTProfile');
   if(percent!==100||(typeof profile==='string'&&/^CaptRAWManualV1=true\r?$/m.test(profile)))warnings.push(`已有 ART 几何配置保留；PerspectiveScale=${spelling} 未重新解释旧像素，保存时按当前 ART 缩放迁移。`);
  }else if(percent!==100){
   if(ratio<.1||ratio>4)throw new Error('PerspectiveScale 超出当前核心支持范围 10–400%。');
   adjustments.perspective={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1,manualModel:'art-perspective-v1',scale:ratio};
  }
 }
 const hdrMode=lookup(properties,CRS,'HDREditMode');
 if(raw&&Object.hasOwn(raw,'hdrEnabled'))throw new Error('HDR 编辑开关必须使用标准 HDREditMode 属性。');
 if(hdrMode){
  if(!['0','1'].includes(hdrMode.value?.trim()||''))throw new Error('XMP HDR 编辑模式尚不支持，已停止载入。');
  adjustments.hdrEnabled=hdrMode.value!.trim()==='1';
  if(adjustments.hdrEnabled&&!engineVersion)warnings.push('HDR 编辑开关按 0 / 1 载入；Adobe 高光限制及 SDR 映射尚未等效，亮度余量使用 ART 设置。');
 }
 if(adjustments.hdrHeadroom!==undefined&&(!Number.isFinite(adjustments.hdrHeadroom)||adjustments.hdrHeadroom<1||adjustments.hdrHeadroom>4))throw new Error('HDR 亮度余量须为 1–4 EV。');
 const migratePrivate=(key:keyof Adjustments,value:unknown,label:string)=>{
  if(!raw||!Object.hasOwn(raw,key))return false;
  if(engineVersion===ENGINE_VERSION)throw new Error('显影扩展重复定义标准 XMP 参数。');
  if(JSON.stringify(adjustments[key])===JSON.stringify(value)){delete adjustments[key];return false;}
  legacyConflicts.push(label);return true;
 };
 for(const {key,name,min,max,integer} of standardAdjustments){
  const node=lookup(properties,CRS,name),value=Number(node?.value);
  // Repair earlier CaptRAW-written CRS radii without accepting invalid Adobe files.
  const legacyStandard=key==='sharpenRadius'&&legacySharpenRadius(value)&&READABLE_ENGINE_VERSIONS.has(engineVersion);
  if(node&&(!node.value?.trim()||!Number.isFinite(value)||(!legacyStandard&&(value<min||value>max))))throw new Error(`XMP ${name} 超出当前显影核心范围。`);
  if(node&&integer&&!Number.isInteger(value))throw new Error(`XMP ${name} 必须为整数。`);
  if(raw&&Object.hasOwn(raw,key)){
   const legacyPrivate=key==='sharpenRadius'&&legacySharpenRadius(raw.sharpenRadius)&&!node;
   if(engineVersion===ENGINE_VERSION&&!legacyPrivate)throw new Error('显影扩展重复定义标准 XMP 参数。');
   if(node){
    if(adjustments[key]===value)delete adjustments[key];
    else legacyConflicts.push(name);
   }
   if(!node||legacyConflicts.at(-1)===name)continue;
  }
  if(node)(adjustments as Record<string,unknown>)[key]=value;
 }
 if(adjustments.sharpenRadius!==undefined){
  const radius=adjustments.sharpenRadius;
  if(typeof radius!=='number'||!Number.isFinite(radius)||radius<.1||radius>3)throw new Error('XMP 锐化半径超出当前显影核心范围。');
  if(legacySharpenRadius(radius))warnings.push(`保留旧锐化半径 ${radius}；新的半径调整范围为 0.5–3。`);
 }
 for(const {key,name,integer} of standardAdjustments.filter(field=>field.integer))
  if(adjustments[key]!==undefined&&typeof adjustments[key]==='number'&&!Number.isInteger(adjustments[key]))throw new Error(`XMP ${name} 必须为整数。`);
 const glowStyleNode=lookup(properties,CRS,'GlowStyle');
 if(glowStyleNode){
  const code=Number(glowStyleNode.value);
  if(!glowStyleNode.value?.trim()||!Number.isInteger(code)||code<0||code>2)throw new Error('XMP 发光样式无效。');
  if(!migratePrivate('glowStyle',glowStyles[code],'GlowStyle'))adjustments.glowStyle=glowStyles[code];
 }
 for(const mask of adjustments.masks??[])if(mask.details?.glow!==undefined&&(!Number.isInteger(mask.details.glow)||mask.details.glow<-100||mask.details.glow>100))throw new Error('XMP 局部发光须为 -100–100 整数。');
 const orientationNode=lookup(properties,TIFF,'Orientation'),orientation=Number(orientationNode?.value);let standardRotation:0|90|180|270|undefined,orientationWarning='';
 if(orientationNode){
  if(!orientationNode.value?.trim()||!Number.isInteger(orientation)||orientation<1||orientation>8)throw new Error('XMP tiff:Orientation 无效。');
  for(const key of ['flipHorizontal','flipVertical'] as const)if(raw?.[key]!==undefined&&typeof raw[key]!=='boolean')throw new Error('XMP 翻转必须为布尔值。');
  let transform=orientationTransforms[orientation];
  // Preserve the exact two-toggle representation when its TIFF orientation agrees.
  // An external orientation edit wins over stale private flip fields.
  if(raw?.flipHorizontal!==undefined||raw?.flipVertical!==undefined){
   const rotation=([0,90,180,270] as const).find(r=>orientationOf(r,raw.flipHorizontal??false,raw.flipVertical??false)===orientation);
   if(rotation!==undefined)transform={rotation,flipHorizontal:raw.flipHorizontal??false,flipVertical:raw.flipVertical??false};
  }
  standardRotation=transform.rotation;
  if(!migratePrivate('rotation',standardRotation,'TIFF Orientation'))adjustments.rotation=standardRotation;
  // Earlier CaptRAW writers emitted rotation-only Orientation alongside typed
  // ART state. Missing flip fields meant "inherit the ARP", not "clear both".
  // A standalone standard Orientation, including 1, explicitly sets direction.
  const inheritedFlips=raw!==undefined&&raw.flipHorizontal===undefined&&raw.flipVertical===undefined&&[1,3,6,8].includes(orientation);
  if(!inheritedFlips){adjustments.flipHorizontal=transform.flipHorizontal;adjustments.flipVertical=transform.flipVertical;}
 }
 const parametricNodes=parametricAdjustments.map(field=>lookup(properties,CRS,field.name)),parametricPresent=parametricNodes.some(Boolean);
 if(parametricPresent){
  const values=parametricAdjustments.map((field,index)=>{const node=parametricNodes[index],value=Number(node?.value);if(node&&(!node.value?.trim()||!Number.isFinite(value)||!Number.isInteger(value)||value<field.min||value>field.max))throw new Error(`XMP ${field.name} 超出当前显影核心范围。`);return value;});
  const patch:NonNullable<AdjustmentPatch['parametricCurve']>={};
  parametricValues.forEach((field,index)=>{if(parametricNodes[index])patch[field.key]=values[index];});
  const splits:Partial<Record<0|1|2,number>>={};
  for(const index of [0,1,2] as const)if(parametricNodes[index+4])splits[index]=values[index+4];
  if(Object.keys(splits).length){validateSplits(splits);patch.splits=parametricNodes.every(Boolean)?[values[4],values[5],values[6]]:splits;}
  let conflict=false;
  if(raw&&Object.hasOwn(raw,'parametricCurve')){
   if(engineVersion===ENGINE_VERSION)throw new Error('显影扩展重复定义标准 XMP 参数。');
   if(parametricNodes.every(Boolean)&&JSON.stringify(raw.parametricCurve)===JSON.stringify(patch))delete adjustments.parametricCurve;else{legacyConflicts.push('Parametric*');conflict=true;}
  }
  if(!conflict)adjustments.parametricCurve=patch;
 }
 const hslNodes=hslAdjustments.map(field=>lookup(properties,CRS,field.name)),hslPresent=hslNodes.some(Boolean);
 if(hslPresent){
  const value:NonNullable<AdjustmentPatch['hsl']>={};
  hslAdjustments.forEach((field,index)=>{const node=hslNodes[index],number=Number(node?.value);if(node&&(!node.value?.trim()||!Number.isFinite(number)||!Number.isInteger(number)||number<-100||number>100))throw new Error(`XMP ${field.name} 超出当前显影核心范围。`);if(node){value[field.group]??={};value[field.group]![field.index]=number;}});
  if(hslNodes.every(Boolean))for(const channel of ['hue','saturation','luminance'] as const)value[channel]=Array.from({length:8},(_,index)=>value[channel]![index]);
  let conflict=false;
  if(raw&&Object.hasOwn(raw,'hsl')){
   if(engineVersion===ENGINE_VERSION)throw new Error('显影扩展重复定义标准 XMP 参数。');
   if(hslNodes.every(Boolean)&&JSON.stringify(raw.hsl)===JSON.stringify(value))delete adjustments.hsl;else{legacyConflicts.push('HSL');conflict=true;}
  }
  if(!conflict)adjustments.hsl=value;
 }
 const legacyGrading=engineVersion===legacyGradingVersion&&Object.values(legacyGradingNames).some(name=>lookup(properties,CRS,name));
 const gradingNode=(name:string)=>legacyGrading&&legacyGradingNames[name]?lookup(properties,CRS,legacyGradingNames[name])??lookup(properties,CRS,name):lookup(properties,CRS,name);
 if(legacyGrading)warnings.push('旧 CaptRAW XMP 使用了误写的颜色分级字段；当前保留原编辑值，下次保存改写为 Adobe SplitToning 标准字段。');
 const gradingNodes=colorGradingAdjustments.map(field=>gradingNode(field[2])),gradingPresent=gradingNodes.some(Boolean)||gradingNode('ColorGradeBlending')||gradingNode('SplitToningBalance');
 if(gradingPresent){
  const value:NonNullable<AdjustmentPatch['colorGrading']>={};
  colorGradingAdjustments.forEach(([region,key,name,min,max],index)=>{const node=gradingNodes[index],number=Number(node?.value);if(node&&(!node.value?.trim()||!Number.isFinite(number)||!Number.isInteger(number)||number<min||number>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);if(node){value[region]??={};value[region]![key==='sat'?'saturation':key]=number;}});
  for(const [key,name,min,max] of [['blending','ColorGradeBlending',0,100],['balance','SplitToningBalance',-100,100]] as const){const node=gradingNode(name),number=Number(node?.value);if(node&&(!node.value?.trim()||!Number.isFinite(number)||!Number.isInteger(number)||number<min||number>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);if(node)value[key]=number;}
  const classic=['SplitToningShadowHue','SplitToningShadowSaturation','SplitToningHighlightHue','SplitToningHighlightSaturation','SplitToningBalance'].every(name=>gradingNode(name))&&!colorGradingAdjustments.some((field,index)=>field[2].startsWith('ColorGrade')&&gradingNodes[index])&&!gradingNode('ColorGradeBlending');
  if(classic){
   value.shadows={...value.shadows,luminance:0};value.highlights={...value.highlights,luminance:0};value.midtones={hue:0,saturation:0,luminance:0};value.global={hue:0,saturation:0,luminance:0};value.blending=100;
   warnings.push('旧式分离色调按兼容规则载入：混合设为 100，中间调、全局和分级明度复位。');
  }
  const complete=classic||(gradingNodes.every(Boolean)&&value.blending!==undefined&&value.balance!==undefined);let conflict=false;
  if(raw&&Object.hasOwn(raw,'colorGrading')){
   if(engineVersion===ENGINE_VERSION)throw new Error('显影扩展重复定义标准 XMP 参数。');
   if(complete&&JSON.stringify(raw.colorGrading)===JSON.stringify(value))delete adjustments.colorGrading;else{legacyConflicts.push('ColorGrade*');conflict=true;}
  }
  if(!conflict)adjustments.colorGrading=value;
 }
 const convertNode=lookup(properties,CRS,'ConvertToGrayscale'),grayNodes=blackWhiteAdjustments.map(field=>lookup(properties,CRS,field.name)),grayPresent=grayNodes.some(Boolean);
 if(convertNode||grayPresent){
  const convert=convertNode?.value?.trim().toLowerCase();if(convertNode&&convert!=='true'&&convert!=='false')throw new Error('XMP ConvertToGrayscale 必须为 True 或 False。');
  const mixer=grayNodes.map((node,index)=>{const value=Number(node?.value);if(node&&(!node.value?.trim()||!Number.isFinite(value)||!Number.isInteger(value)||value<-100||value>100))throw new Error(`XMP ${blackWhiteAdjustments[index].name} 超出当前显影核心范围。`);return value;});
  if(convert&&grayNodes.every(Boolean)){
   const base=raw?.blackWhite?.base?structuredClone(raw.blackWhite.base):undefined,complete={enabled:convert==='true',mixer,...(base?{base}:{})};
   if(raw?.blackWhite&&(Object.hasOwn(raw.blackWhite,'enabled')||Object.hasOwn(raw.blackWhite,'mixer'))){
    if(engineVersion===ENGINE_VERSION)throw new Error('显影扩展重复定义标准 XMP 参数。');
    if(JSON.stringify({enabled:raw.blackWhite.enabled,mixer:raw.blackWhite.mixer})===JSON.stringify({enabled:complete.enabled,mixer:complete.mixer})){delete raw.blackWhite.enabled;delete raw.blackWhite.mixer;}
    else legacyConflicts.push('GrayMixer*');
   }
   if(!legacyConflicts.includes('GrayMixer*'))adjustments.blackWhite=complete;
  }else if(convert!=='false'||grayPresent)partialGroups.push('GrayMixer*');
 }
 const defringeNodes=defringeAdjustments.map(field=>lookup(properties,CRS,field.name)),defringePresent=defringeNodes.some(Boolean);
 if(defringePresent){
  if(defringeNodes.every(Boolean)){
   const values=Object.fromEntries(defringeAdjustments.map((field,index)=>{const node=defringeNodes[index],value=Number(node?.value);if(!node?.value?.trim()||!Number.isFinite(value)||!Number.isInteger(value)||value<field.min||value>field.max)throw new Error(`XMP ${field.name} 超出当前显影核心范围。`);return [field.key,value];})) as unknown as NonNullable<Adjustments['defringe']>;
   if(values.purpleHueLo>=values.purpleHueHi||values.greenHueLo>=values.greenHueHi)throw new Error('XMP 色差去边色相范围无效。');
   if(!migratePrivate('defringe',values,'Defringe*'))adjustments.defringe=values;
  }else partialGroups.push('Defringe*');
 }
 const calibrationNodes=calibrationAdjustments.map(field=>lookup(properties,CRS,field.name)),calibrationPresent=calibrationNodes.some(Boolean);
 if(calibrationPresent){
  const values:Partial<NonNullable<Adjustments['calibration']>>={};
  calibrationAdjustments.forEach((field,index)=>{const node=calibrationNodes[index],value=Number(node?.value);if(node&&(!node.value?.trim()||!Number.isFinite(value)||!Number.isInteger(value)||value<-100||value>100))throw new Error(`XMP ${field.name} 超出当前显影核心范围。`);if(node)values[field.key]=value;});
  if(!migratePrivate('calibration',values,'Calibration'))adjustments.calibration=values;
 }
 for(const {key,name} of sharpeningDetailAdjustments){
  const node=lookup(properties,CRS,name),value=Number(node?.value);
  if(node&&(!node.value?.trim()||!Number.isFinite(value)||!Number.isInteger(value)||value<0||value>100))throw new Error(`XMP ${name} 超出当前显影核心范围。`);
  if(node&&!migratePrivate(key,value,name))(adjustments as Record<string,unknown>)[key]=value;
 }
 const vignetteStyle=lookup(properties,CRS,'PostCropVignetteStyle');
 if(vignetteStyle){const styles:Record<string,NonNullable<Adjustments['postCropVignetteStyle']>>={'1':'highlight-priority','2':'color-priority','3':'paint-overlay'};const style=styles[vignetteStyle.value?.trim()||''];if(!style)throw new Error('不支持的 Adobe 裁切后晕影样式。');adjustments.postCropVignetteStyle=style;}
 for(const {key,name,min,max} of postCropVignetteAdjustments){
  const node=lookup(properties,CRS,name),value=Number(node?.value);
  if(node&&(!node.value?.trim()||!Number.isFinite(value)||!Number.isInteger(value)||value<min||value>max))throw new Error(`XMP ${name} 超出当前显影核心范围。`);
  if(node&&!migratePrivate(key,value,name))(adjustments as Record<string,unknown>)[key]=value;
 }
 if(!engineVersion){
  if((adjustments.grain??0)>0||adjustments.grainSize!==undefined||adjustments.grainRoughness!==undefined)adjustments.grainModel='procedural-v1';
  if((adjustments.vignette??0)!==0||adjustments.postCropVignetteMidpoint!==undefined||adjustments.postCropVignetteHighlights!==undefined)adjustments.postCropVignetteStyle??='highlight-priority';
  if((adjustments.grain??0)>0||(adjustments.vignette??0)!==0)warnings.push('Adobe 颗粒／晕影参数已载入；采用独立算法，尚未通过 ACR 18.7 效果等效验收。');
 }
 for(const {key,name} of noiseReductionAdjustments){
  const node=lookup(properties,CRS,name),value=Number(node?.value);
  if(node&&(!node.value?.trim()||!Number.isFinite(value)||!Number.isInteger(value)||value<0||value>100))throw new Error(`XMP ${name} 超出当前显影核心范围。`);
  if(node&&!migratePrivate(key,value,name))(adjustments as Record<string,unknown>)[key]=value;
 }
 const hasCropNode=lookup(properties,CRS,'HasCrop'),cropNodes=Object.fromEntries(['CropTop','CropLeft','CropBottom','CropRight','CropAngle'].map(name=>[name,lookup(properties,CRS,name)])) as Record<string,XMPNode|undefined>,cropPresent=hasCropNode||Object.values(cropNodes).some(Boolean);
 if(cropPresent){
  const hasCrop=hasCropNode?.value?.trim().toLowerCase();if(hasCropNode&&hasCrop!=='true'&&hasCrop!=='false')throw new Error('XMP HasCrop 必须为 True 或 False。');
  if(hasCrop==='false'){
   if(!migratePrivate('crop',null,'Crop*'))adjustments.crop=null;
   if(cropNodes.CropAngle&&Number(cropNodes.CropAngle.value)!==0)warnings.push('HasCrop=False 的 CropAngle 未作为自由旋转载入；Adobe 仅定义启用裁框时的角度。');
  }
  else if(hasCrop==='true'&&Object.values(cropNodes).every(Boolean)&&(!orientationNode||standardRotation!==undefined)){
   const values=Object.fromEntries(Object.entries(cropNodes).map(([name,node])=>{const value=Number(node?.value);if(!node?.value?.trim()||!Number.isFinite(value))throw new Error(`XMP ${name} 必须为有限数值。`);return [name,value];}));
   const top=values.CropTop,left=values.CropLeft,bottom=values.CropBottom,right=values.CropRight,angle=values.CropAngle;
   if(top<0||top>=bottom||left<0||left>=right||right>1||bottom>1||right-left<.001||bottom-top<.001)throw new Error('XMP 裁切矩形无效。');
   if(angle<-45||angle>45)throw new Error('XMP CropAngle 超出当前显影核心范围。');
   const oriented={x:left,y:top,width:right-left,height:bottom-top},crop=rotateCrop(flipCrop(oriented,adjustments.flipHorizontal,adjustments.flipVertical),-(adjustments.rotation??0));
   const cropConflict=raw&&Object.hasOwn(raw,'crop'),angleConflict=raw&&Object.hasOwn(raw,'fineRotation'),conflict=Boolean(cropConflict||angleConflict)&&(migratePrivate('crop',crop,'Crop*')||migratePrivate('fineRotation',angle,'Crop*'));
   if(!conflict){adjustments.crop=crop;adjustments.fineRotation=angle;}
  }else partialGroups.push('Crop*');
 }
 if(raw?.fineRotation!==undefined&&!adjustments.crop&&adjustments.fineRotation!==0)warnings.push('无裁框的自由旋转保存在 ART 扩展；尚未等效为 Adobe 裁框角度。');
 for(const [key,name] of Object.entries(curves) as [keyof typeof curves,string][]){const node=lookup(properties,CRS,name);if(!node)continue;
  if(!node.items||node.items.length<2||node.items.length>128)throw new Error('XMP 曲线点数量无效。');
  let previous=-1;adjustments[key]=node.items.map(item=>{
   const tokens=item.value?.split(',').map(v=>v.trim());
   if(!tokens||tokens.length!==2||tokens.some(v=>!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)))throw new Error('XMP 曲线点无效。');
   const parts=tokens.map(Number);if(parts.some(v=>!Number.isFinite(v)||v<0||v>255)||parts[0]<=previous)throw new Error('XMP 曲线点无效。');previous=parts[0];return {x:parts[0]/255,y:parts[1]/255};
  });
 }
 const adobeMaskNode=lookup(properties,CRS,'MaskGroupBasedCorrections');
 if(adobeMaskNode){
  if(raw&&Object.hasOwn(raw,'masks')){
   if(!Array.isArray(raw.masks))throw new Error('XMP CaptRAW 蒙版必须为数组。');
   if(adobeMaskNode.items?.length)warnings.push('文件同时包含 CaptRAW 私有蒙版和 Adobe MaskGroupBasedCorrections；当前保留 CaptRAW 蒙版，Adobe 结构原样保存但未覆盖现有编辑。');
  }else{const parsed=decodeAdobeMaskGroups(adobeMaskNode,warnings,!engineVersion);if(parsed.length)adjustments.masks=parsed;}
 }
 if(hasRelativeWhiteBalance(adjustments)){
  if(adjustments.relativeWBModel!==undefined&&adjustments.relativeWBModel!=='art-ctl-v1')throw new Error('不支持的相对白平衡处理版本。');
  adjustments.relativeWBModel='art-ctl-v1';
  if(adjustments.wbMultipliers)throw new Error('相对白平衡含有冲突的相机白平衡系数。');
 }else if(adjustments.wbMultipliers){const anchor=readExtension(properties,'ARTWhiteBalanceCoordinates');if(!Array.isArray(anchor)||anchor[0]!==adjustments.temperature||anchor[1]!==adjustments.tint){adjustments.wbMultipliers=null;adjustments.wbMode='custom';adjustments.wbApproximate=false;}}
 const recognized=new Set([...standardAdjustments.map(field=>field.name),...parametricAdjustments.map(field=>field.name),...hslAdjustments.map(field=>field.name),...colorGradingAdjustments.map(field=>field[2]),...blackWhiteAdjustments.map(field=>field.name),...defringeAdjustments.map(field=>field.name),...calibrationAdjustments.map(field=>field.name),...sharpeningDetailAdjustments.map(field=>field.name),...postCropVignetteAdjustments.map(field=>field.name),...noiseReductionAdjustments.map(field=>field.name),'PostCropVignetteStyle','GlowStyle','ConvertToGrayscale','ColorGradeBlending','SplitToningBalance','ToneCurveName2012','MaskGroupBasedCorrections','HasCrop','CropTop','CropLeft','CropBottom','CropRight','CropAngle',...Object.values(curves),'Version','ProcessVersion','Name','Group','UUID','PresetType','SupportsAmount','HasSettings']);
 if(legacyGrading)for(const name of Object.values(legacyGradingNames))recognized.add(name);
 const wb=lookup(properties,CRS,'WhiteBalance')?.value,hasWB=adjustments.temperature!==undefined||adjustments.tint!==undefined||hasRelativeWhiteBalance(adjustments);
 if(wb==='Custom'||hasWB)recognized.add('WhiteBalance');
 recognized.add('HDREditMode');
 recognized.add('PerspectiveScale');
 if(signedFraming)for(const name of ['PerspectiveAspect','PerspectiveX','PerspectiveY'])recognized.add(name);
 if(adjustments.colorProfile?.look){recognized.add('Look');if(adjustments.colorProfile.look.profile.baseProfile)recognized.add('CameraProfile');for(const t of adjustments.colorProfile.look.profile.tables)recognized.add('Table_'+t.fingerprint);}
 if(adjustments.curveRefineModel!==undefined)recognized.add('CurveRefineSaturation');
 const unsupported=properties.filter(p=>p.ns===CRS&&!recognized.has(p.name)).map(p=>p.name);
 const curveName=lookup(properties,CRS,'ToneCurveName2012'),curvePoints=(Object.keys(curves) as (keyof typeof curves)[]).map(key=>adjustments[key]).filter(points=>points!==undefined);
 if(curveName){
  if(!curvePoints.length)warnings.push(`ToneCurveName2012=${curveName.value||'（空）'} 仅有名称，没有 PV2012 曲线坐标，尚未应用；未按名称推断或生成曲线。`);
  else if(curveName.value==='Linear'&&curvePoints.some(points=>points[0].x!==0||points.at(-1)!.x!==1||points.some(p=>p.x!==p.y)))warnings.push('ToneCurveName2012=Linear 与记录的曲线坐标不一致；CaptRAW 使用记录的坐标，保存时同步为 Custom。Adobe 对名称与坐标的处理优先级尚未验证。');
  else if(curveName.value==='Medium Contrast'||curveName.value==='Strong Contrast'){
   if(matchesPointCurvePreset(adjustments.curve,curveName.value))adjustments.curveName=curveName.value;
   else warnings.push(`ToneCurveName2012=${curveName.value} 与已核验的 ACR 18.7 曲线坐标不一致；使用文件坐标，保存为 Custom。`);
  }else if(curveName.value!=='Linear'&&curveName.value!=='Custom')warnings.push(`ToneCurveName2012=${curveName.value||'（空）'} 与曲线坐标的对应关系尚未验证；CaptRAW 使用记录的坐标，未按名称生成曲线。Adobe 对名称与坐标的处理优先级尚未验证。`);
 }
 if(!readExtension(properties,'EngineVersion'))warnings.push('Adobe 参数按当前 ART 管线显影；尚未验证与 ACR 的像素等效。');
 if(!readExtension(properties,'EngineVersion')&&(adjustments.temperature!==undefined||adjustments.tint!==undefined))warnings.push('色温 / 色调按当前相机 DCP 或矩阵转换；未导入 Adobe 相机配置，颜色仍可能不同。');
 if(relativeNodes&&!readExtension(properties,'EngineVersion'))warnings.push('JPEG／TIFF 相对白平衡字段已核验；当前同值效果与 Adobe 仍有差异，请复核色温与色调。');
 if(hasWB&&wb&&wb!=='Custom')warnings.push(`WhiteBalance=${wb} 采用文件中已记录的色温 / 色调，未按 Adobe 模式重新计算；保存为固定的自定义白平衡。`);
 if(orientationWarning)warnings.push(orientationWarning);
 if(partialGroups.length)warnings.push(`以下 Adobe 字段组不完整，尚未参与显影：${partialGroups.join('、')}`);
 if(legacyConflicts.length)warnings.push('旧 CaptRAW 配方同时含有冲突的 Adobe 标准字段；为保留现有编辑，使用私有 ART 值并将在下次保存迁移为：'+legacyConflicts.join('、'));
 if(unsupported.length)warnings.push('以下 Adobe 字段已保留，尚未参与显影：'+unsupported.join('、'));
 return {adjustments,warnings};
}
