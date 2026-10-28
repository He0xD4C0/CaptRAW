import type {Adjustments,ImageSession} from './index.js';
export const SYNC_GROUPS = [
 {id:'light',label:'光线',fields:['exposure','contrast','highlights','shadows','whites','blacks']},
 {id:'whiteBalance',label:'白平衡（色温 / 色调）',fields:['temperature','tint']},
 {id:'color',label:'饱和度与自然饱和度',fields:['saturation','vibrance']},
 {id:'curves',label:'点曲线与参数曲线',fields:['curve','redCurve','greenCurve','blueCurve','parametricCurve']},
 {id:'hsl',label:'混色器',fields:['hsl']},
 {id:'blackWhite',label:'黑白与黑白混色',fields:['blackWhite']},
 {id:'colorGrading',label:'颜色分级',fields:['colorGrading']},
 {id:'calibration',label:'颜色校准',fields:['calibration']},
 {id:'detail',label:'锐化与降噪',fields:['sharpening','sharpenRadius','sharpenDetail','sharpenEdgeMask','luminanceNoise','luminanceNoiseDetail','luminanceNoiseContrast','colorNoise','colorNoiseDetail','colorNoiseSmoothness','defringe']},
 {id:'effects',label:'纹理、清晰度与效果',fields:['texture','clarity','dehaze','vignette','postCropVignetteFeather','postCropVignetteRoundness','grain']},
 {id:'lens',label:'镜头校正',fields:['lensCorrections','lensProfile','lensManualDistortion','lensVignette']},
 {id:'perspective',label:'透视变换',fields:['perspective','perspectiveGuides']},
 {id:'crop',label:'裁切与旋转',fields:['crop','rotation','fineRotation','cropAspect']},
 {id:'masks',label:'蒙版（替换目标蒙版）',fields:['masks']},
 {id:'spots',label:'修复点（替换目标修复）',fields:['spots']},
] as const;
export type SyncGroup=typeof SYNC_GROUPS[number]['id'];
export const DEFAULT_SYNC_GROUPS:SyncGroup[]=SYNC_GROUPS.map(g=>g.id).filter(id=>!['crop','perspective','masks','spots'].includes(id));
export interface SyncDocument {image:ImageSession;adjustments:Adjustments;profile:string}
export interface SyncResult {path:string;adjustments:Adjustments;profile:string;preview:string}
export interface SyncRequest {source:SyncDocument;targets:SyncDocument[];groups:SyncGroup[]}
export interface CameraExposureMatch {target:SyncDocument;delta:number;exposure:number}
export function cameraExposureValue(image:ImageSession):number|null{
 const {iso,aperture,shutter,exposureCompensation=0}=image;
 if(!Number.isFinite(iso)||iso<=0||!Number.isFinite(aperture)||!Number.isFinite(shutter)||Number(aperture)<=0||Number(shutter)<=0||!Number.isFinite(exposureCompensation))return null;
 const value=Math.log2(Number(aperture)*Number(aperture)/Number(shutter))-Math.log2(iso/100)-exposureCompensation;
 return Number.isFinite(value)?value:null;
}
export function matchExposureByCameraSettings(source:SyncDocument,targets:SyncDocument[]):CameraExposureMatch[]{
 if(!targets.length)throw new Error('请选择要匹配曝光的照片。');
 if(new Set(targets.map(target=>target.image.path)).size!==targets.length)throw new Error('匹配曝光包含重复照片。');
 if(targets.some(target=>target.image.path===source.image.path))throw new Error('来源照片不能同时作为曝光匹配目标。');
 const sourceValue=cameraExposureValue(source.image);
 if(sourceValue===null)throw new Error(`${source.image.name} 缺少可用的 ISO、光圈、快门或曝光补偿，无法按相机设置匹配曝光。`);
 return targets.map(target=>{
  const targetValue=cameraExposureValue(target.image);
  if(targetValue===null)throw new Error(`${target.image.name} 缺少可用的 ISO、光圈、快门或曝光补偿，无法按相机设置匹配曝光。`);
  const delta=Math.round((sourceValue-targetValue)*100)/100,exposure=Math.round((target.adjustments.exposure+delta)*100)/100;
  if(exposure<-5||exposure>5)throw new Error(`${target.image.name} 匹配后曝光 ${exposure.toFixed(2)} EV 超出当前显影范围 -5.00–5.00 EV；未应用任何修改。`);
  return {target,delta,exposure};
 });
}
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
