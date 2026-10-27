import type {Adjustments,ImageSession} from './index.js';
export const SYNC_GROUPS = [
 {id:'light',label:'光线',fields:['exposure','contrast','highlights','shadows','whites','blacks']},
 {id:'whiteBalance',label:'白平衡（色温 / 色调）',fields:['temperature','tint']},
 {id:'color',label:'饱和度与自然饱和度',fields:['saturation','vibrance']},
 {id:'curves',label:'点曲线与参数曲线',fields:['curve','redCurve','greenCurve','blueCurve','parametricCurve']},
 {id:'hsl',label:'混色器',fields:['hsl']},
 {id:'blackWhite',label:'黑白与黑白混色',fields:['blackWhite']},
 {id:'colorGrading',label:'颜色分级',fields:['colorGrading']},
 {id:'detail',label:'锐化与降噪',fields:['sharpening','sharpenRadius','luminanceNoise','colorNoise']},
 {id:'effects',label:'纹理、清晰度与效果',fields:['texture','clarity','dehaze','vignette','grain']},
 {id:'lens',label:'镜头校正',fields:['lensCorrections','lensProfile']},
 {id:'crop',label:'裁切与旋转',fields:['crop','rotation','fineRotation','cropAspect']},
 {id:'masks',label:'蒙版（替换目标蒙版）',fields:['masks']},
 {id:'spots',label:'修复点（替换目标修复）',fields:['spots']},
] as const;
export type SyncGroup=typeof SYNC_GROUPS[number]['id'];
export const DEFAULT_SYNC_GROUPS:SyncGroup[]=SYNC_GROUPS.map(g=>g.id).filter(id=>!['crop','masks','spots'].includes(id));
export interface SyncDocument {image:ImageSession;adjustments:Adjustments;profile:string}
export interface SyncResult {path:string;adjustments:Adjustments;profile:string;preview:string}
export interface SyncRequest {source:SyncDocument;targets:SyncDocument[];groups:SyncGroup[]}
export function synchronizedAdjustments(source:SyncDocument,target:SyncDocument,groups:SyncGroup[]):Adjustments{
 if(!Array.isArray(groups)||!groups.length||groups.some(id=>!SYNC_GROUPS.some(g=>g.id===id)))throw new Error('请选择有效的同步调整项。');
 const next=structuredClone(target.adjustments),values=next as unknown as Record<string,unknown>;
 for(const group of SYNC_GROUPS)if(groups.includes(group.id))for(const key of group.fields){
  if(source.adjustments[key]===undefined)delete values[key];else values[key]=structuredClone(source.adjustments[key]);
 }
 if(groups.includes('whiteBalance')){next.wbMultipliers=null;next.wbMode='custom';next.wbApproximate=false;}
 if(groups.includes('crop'))next.cropAspect=source.adjustments.cropAspect&&next.crop?next.crop.width*target.image.width/(next.crop.height*target.image.height):null;
 return next;
}
