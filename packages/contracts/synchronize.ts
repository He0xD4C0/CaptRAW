import {mergeAdjustmentPatch,validateWhiteBalanceTarget,validateCurveRefine,validatePerspective,type AdjustmentPatch,type Adjustments,type ImageSession,type EffectiveGeometry,type WhiteBalanceRequest,type AutoPerspectiveDirection,type PerspectiveSettings,type LensProfileSettings,type ColorProfileSettings,type DefringeSettings,type BlackWhiteSettings,type PreviewFrame} from './index.js';
export const SYNC_GROUPS = [
 {id:'profile',label:'输入配置文件与 Look',fields:['colorProfile']},
 {id:'light',label:'光线',fields:['exposure','contrast','highlights','shadows','whites','blacks']},
 {id:'hdr',label:'HDR 编辑与亮度余量',fields:['hdrEnabled','hdrHeadroom']},
 {id:'whiteBalance',label:'白平衡（色温 / 色调）',fields:['temperature','tint','incrementalTemperature','incrementalTint','relativeWBModel']},
 {id:'color',label:'饱和度与自然饱和度',fields:['saturation','vibrance']},
 {id:'curves',label:'点曲线与参数曲线',fields:['curve','curveName','curveRefineSaturation','curveRefineModel','redCurve','greenCurve','blueCurve','parametricCurve']},
 {id:'hsl',label:'混色器',fields:['hsl']},
 {id:'blackWhite',label:'黑白与黑白混色',fields:['blackWhite']},
 {id:'colorGrading',label:'颜色分级',fields:['colorGrading']},
 {id:'calibration',label:'颜色校准',fields:['calibration']},
 {id:'detail',label:'锐化与降噪',fields:['sharpening','sharpenRadius','sharpenDetail','sharpenEdgeMask','luminanceNoise','luminanceNoiseDetail','luminanceNoiseContrast','colorNoise','colorNoiseDetail','colorNoiseSmoothness','defringe']},
 {id:'effects',label:'纹理、清晰度与效果',fields:['glow','glowStyle','glowRange','glowSpread','glowWarmth','texture','clarity','dehaze','vignette','postCropVignetteFeather','postCropVignetteRoundness','postCropVignetteMidpoint','postCropVignetteHighlights','postCropVignetteStyle','grain','grainModel','grainSize','grainRoughness']},
 {id:'lens',label:'镜头校正',fields:['lensCorrections','lensProfile','lensManualDistortion','lensVignette']},
 {id:'perspective',label:'透视变换',fields:['perspective','perspectiveGuides']},
 {id:'crop',label:'裁切、旋转与翻转',fields:['crop','rotation','flipHorizontal','flipVertical','fineRotation','cropAspect']},
 {id:'masks',label:'蒙版（替换目标蒙版）',fields:['masks']},
 {id:'spots',label:'修复（替换目标修复）',fields:['spots']},
] as const;
export type SyncGroup=typeof SYNC_GROUPS[number]['id'];
export const DEFAULT_SYNC_GROUPS:SyncGroup[]=SYNC_GROUPS.map(g=>g.id).filter(id=>!['crop','perspective','masks','spots'].includes(id));
export interface SyncDocument {image:ImageSession;adjustments:Adjustments;profile:string}
export interface SyncResult {path:string;adjustments:Adjustments;profile:string;preview:string;frame?:PreviewFrame}
type Sparse<T>=T extends object?{[K in keyof T]?:Sparse<T[K]>}:T;
export interface EditCommand {operationId:string;set:AdjustmentPatch;unset:(keyof Adjustments)[];perspectiveModelSnapshot?:PerspectiveSettings;merge?:{perspective?:Sparse<PerspectiveSettings>;lensProfile?:Sparse<LensProfileSettings>;colorProfile?:Sparse<ColorProfileSettings>;defringe?:Sparse<DefringeSettings>;blackWhite?:Sparse<BlackWhiteSettings>}}
const editDefaults={
 perspective:{enabled:false,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1},
 lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:true,ca:true},
 colorProfile:{mode:'auto',toneCurve:false,lookTable:false,hueSatMap:true,baselineExposure:true,illuminant:0},
 defringe:{purpleAmount:0,purpleHueLo:30,purpleHueHi:70,greenAmount:0,greenHueLo:40,greenHueHi:60},
 blackWhite:{enabled:false,mixer:Array(8).fill(0)},
} as const;
export type RecomputedEdit={type:'whiteBalance';request:WhiteBalanceRequest;presetName?:string}|{type:'autoTone'}|{type:'autoPerspective';direction:AutoPerspectiveDirection};
export interface SyncRequest {source:SyncDocument;targets:SyncDocument[];groups:SyncGroup[];command?:EditCommand;commands?:(EditCommand&{path:string})[];recompute?:RecomputedEdit}
// The gesture's source already owns the user's draft. Submit its changed
// fields verbatim; cross-model conversion belongs only to the other targets.
export function sourceAdjustmentCommand(before:Adjustments,after:Adjustments,operationId:string):EditCommand{
 const set:Record<string,unknown>={},unset:(keyof Adjustments)[]=[];
 for(const key of new Set([...Object.keys(before),...Object.keys(after)]) as Set<keyof Adjustments>){
  if(JSON.stringify(before[key])===JSON.stringify(after[key]))continue;
  if(after[key]===undefined)unset.push(key);else set[key]=structuredClone(after[key]);
 }
 return {operationId,set:set as AdjustmentPatch,unset};
}
// A gesture copies only its changed controls, including individual HSL bands.
export function adjustmentCommand(before:Adjustments,after:Adjustments,operationId:string,geometry?:Pick<EffectiveGeometry,'perspective'>):EditCommand{
 if(!before.perspective&&after.perspective&&geometry?.perspective)before={...before,perspective:geometry.perspective};
 const set:Record<string,unknown>={},merge:NonNullable<EditCommand['merge']>={},unset:(keyof Adjustments)[]=[],same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const sparse=(a:any,b:any):any=>{
  const result:Record<string,unknown>={};
  for(const key of Object.keys(b))if(!same(a?.[key],b[key]))result[key]=b[key]!==null&&typeof b[key]==='object'?sparse(a?.[key],b[key]):structuredClone(b[key]);
  return result;
 };
 for(const key of new Set([...Object.keys(before),...Object.keys(after)]) as Set<keyof Adjustments>){
  if(same(before[key],after[key]))continue;
  if(after[key]===undefined){unset.push(key);continue;}
  if(key==='perspective'&&before.perspective?.manualModel&&before.perspective.manualModel!==after.perspective?.manualModel){set[key]=structuredClone(after[key]);continue;}
  if(key==='perspective'&&!before.perspective?.manualModel&&before.perspective?.aspect!==undefined&&before.perspective.aspect!==1&&after.perspective?.manualModel==='signed-framing-v1'){set[key]=structuredClone(after[key]);continue;}
  if(Object.hasOwn(editDefaults,key)&&after[key]!==null){
   const group=key as keyof typeof editDefaults;
   if(group==='colorProfile'){
    const a:Partial<ColorProfileSettings>={...(before.colorProfile??editDefaults.colorProfile)},b:Partial<ColorProfileSettings>={...after.colorProfile};delete a.look;delete b.look;
    const patch=sparse(a,b);
    if(!same(before.colorProfile?.look,after.colorProfile?.look))patch.look=structuredClone(after.colorProfile?.look??null);
    (merge as Record<string,unknown>)[key]=patch;continue;
   }
   const patch=sparse(before[key]??editDefaults[group],after[key]);
   if(group==='perspective'&&after.perspective?.manualModel==='signed-framing-v1'&&!before.perspective?.manualModel&&(before.perspective?.aspect??1)===1){
    // First use changes the neutral spelling (ART ratio 1 -> signed 0),
    // not the user's Aspect/Scale/other offsets on selected targets.
    for(const [field,neutral] of [['aspect',0],['scale',1],['offsetX',0],['offsetY',0],['constrainCrop',false]] as const)if(after.perspective[field]===neutral)delete patch[field];
   }
   // First framing use materializes the source's inherited gate. It is context,
   // not a changed checkbox: each unmarked target must retain its own ARP gate.
   if(group==='perspective'&&after.perspective?.manualModel&&!before.perspective?.manualModel&&['aspect','scale','offsetX','offsetY'].some(key=>Object.hasOwn(patch,key)))delete patch.constrainCrop;
   // A control inside an active tool must also activate a disabled target.
   if(group==='perspective'||group==='blackWhite')patch.enabled=(after[key] as PerspectiveSettings|BlackWhiteSettings).enabled;
   if(group==='perspective'&&after.perspective?.manualModel&&['aspect','scale','offsetX','offsetY','constrainCrop'].some(key=>Object.hasOwn(patch,key)))patch.manualModel=after.perspective.manualModel;
   (merge as Record<string,unknown>)[key]=patch;continue;
  }
  if(['hsl','parametricCurve','colorGrading','calibration'].includes(key)&&after[key]!==null){
   const neutral=key==='calibration'?{shadowTint:0,redHue:0,redSaturation:0,greenHue:0,greenSaturation:0,blueHue:0,blueSaturation:0,...before.calibration}:mergeAdjustmentPatch(before,{[key]:{}} as AdjustmentPatch)[key];
   set[key]=sparse(neutral,after[key]);
  }else set[key]=structuredClone(after[key]);
 }
 if(Object.hasOwn(set,'curveRefineSaturation')||Object.hasOwn(set,'curveRefineModel')){
  validateCurveRefine(after);set.curveRefineModel=after.curveRefineModel;set.curveRefineSaturation=after.curveRefineSaturation;
 }
 return {operationId,set:set as AdjustmentPatch,unset,...(Object.keys(merge).length?{merge}:{}),...(merge.perspective?.manualModel&&after.perspective?{perspectiveModelSnapshot:structuredClone(after.perspective)}:{})};
}
function convertPerspectiveEdit(current:PerspectiveSettings,patch:Sparse<PerspectiveSettings>,source:PerspectiveSettings,effectiveFill:boolean|undefined,boundsOnly:boolean):PerspectiveSettings{
 const fromSigned=source.manualModel==='signed-framing-v1';
 const has=(key:keyof PerspectiveSettings)=>Object.hasOwn(patch,key);
 const ratio=(a:number)=>a>=0?1/(1+a/500):1-a/500;
 const compensation=(r:number)=>Math.sqrt(Math.max(r,1/r));
 // Neutral ART framing is identity for the whole transform pipeline when its
 // actual inherited gate is retained. Non-neutral unmarked Aspect may have
 // been bypassed by ART, so merely retaining its number cannot prove equivalence.
 if(!current.manualModel){
  if(current.aspect!==1||(!boundsOnly&&typeof effectiveFill!=='boolean'))throw new Error('无法无损保持旧透视填满配置（自动填充）；本次联动未应用，请先明确升级或单张调整。');
  // The gate does not affect numerical bounds. Static validation discards this
  // temporary result; only the native full-profile projection can produce edits.
  current={...current,manualModel:'art-perspective-v1',scale:1,offsetX:0,offsetY:0,constrainCrop:boundsOnly?false:effectiveFill};
 }
 const toSigned=current.manualModel==='signed-framing-v1';
 const result={...current,...patch,manualModel:current.manualModel??'art-perspective-v1'} as PerspectiveSettings;
 if(fromSigned&&!toSigned){
  const oldRatio=current.aspect;
  const nextRatio=has('aspect')?ratio(patch.aspect!):oldRatio;
  if(has('aspect'))result.aspect=nextRatio;
  // Signed Aspect holds area scale S; native ART stores the fitted zoom Z.
  if(has('aspect')||has('scale'))result.scale=(has('scale')?patch.scale!:(current.scale??1)/compensation(oldRatio))*compensation(nextRatio);
  if(has('offsetX'))result.offsetX=patch.offsetX!*.0072;
  if(has('offsetY'))result.offsetY=patch.offsetY!*-.0072;
 }else if(!fromSigned&&toSigned){
  const oldRatio=ratio(current.aspect),nextRatio=has('aspect')?patch.aspect!:oldRatio;
  if(has('aspect'))result.aspect=nextRatio>=1?-500*(nextRatio-1):500*(1/nextRatio-1);
  // ART Aspect holds native zoom Z; changing its signed representation must
  // compensate S, while retaining the target's projective parameters.
  if(has('aspect')||has('scale'))result.scale=(has('scale')?patch.scale!:(current.scale??1)*compensation(oldRatio))/compensation(nextRatio);
  if(has('offsetX'))result.offsetX=patch.offsetX!/.0072;
  if(has('offsetY'))result.offsetY=patch.offsetY!/-.0072;
 }
 try{validatePerspective(result);}catch{throw new Error('无法无损转换到目标几何模型的合法范围；本次联动未应用，请显式升级或同步整组透视设置。');}
 return result;
}
export function applyEditCommand(base:Adjustments,command:EditCommand,geometry?:Pick<EffectiveGeometry,'effectiveFill'>):Adjustments{
 return editCommand(base,command,geometry,false);
}
// Range/model failures are knowable without starting a worker. No projected
// value or tentative adjustment from this pass is returned or published.
export function validateEditCommand(base:Adjustments,command:EditCommand):void{
 // An absent group can still inherit arbitrary ARP geometry. Its target bounds
 // are unknowable until native projection; validate source/syntax here only.
 const deferred=!base.perspective&&command.merge?.perspective?.manualModel&&command.perspectiveModelSnapshot;
 editCommand(deferred?{...base,perspective:deferred}:base,command,undefined,true);
}
function editCommand(base:Adjustments,command:EditCommand,geometry:Pick<EffectiveGeometry,'effectiveFill'>|undefined,boundsOnly:boolean):Adjustments{
 if(!command||typeof command.operationId!=='string'||!command.operationId||!command.set||typeof command.set!=='object'||Array.isArray(command.set)||!Array.isArray(command.unset))throw new Error('编辑操作无效。');
 const next=mergeAdjustmentPatch(base,command.set);
 const merged=(base:any,patch:any):any=>{
  const result=Array.isArray(base)?structuredClone(base):{...base};
  for(const key of Object.keys(patch))result[key]=patch[key]!==null&&typeof patch[key]==='object'?merged(base?.[key]??{},patch[key]):structuredClone(patch[key]);
  return result;
 };
 for(const group of Object.keys(command.merge||{}) as (keyof typeof editDefaults)[]){
  if(!Object.hasOwn(editDefaults,group))throw new Error('联动调整项无效。');
  if(group==='colorProfile'){
   const patch={...command.merge!.colorProfile};const replace=Object.hasOwn(patch,'look'),look=patch.look;delete patch.look;
   next.colorProfile=merged(base.colorProfile??editDefaults.colorProfile,patch);
   if(replace)next.colorProfile!.look=look==null?null:structuredClone(look) as NonNullable<ColorProfileSettings['look']>;
   continue;
  }
  if(group==='perspective'){
   const patch=command.merge!.perspective!,current:PerspectiveSettings=base.perspective??editDefaults.perspective;
   if(patch.manualModel&&patch.manualModel!==current.manualModel){
    const snapshot=command.perspectiveModelSnapshot;
    if(!snapshot||snapshot.manualModel!==patch.manualModel)throw new Error('跨几何模型的联动缺少完整参数快照。');
    validatePerspective(snapshot);next.perspective=convertPerspectiveEdit(current,patch,snapshot,geometry?.effectiveFill,boundsOnly);continue;
   }
  }
  (next as unknown as Record<string,unknown>)[group]=merged(base[group]??editDefaults[group],command.merge![group]);
 }
 for(const key of command.unset)delete (next as unknown as Record<string,unknown>)[key];
 validateCurveRefine(next);
 validatePerspective(next.perspective);
 return next;
}
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
  if(key==='flipHorizontal'||key==='flipVertical')values[key]=source.adjustments[key]??false;
  else if(source.adjustments[key]===undefined)delete values[key];else values[key]=structuredClone(source.adjustments[key]);
 }
 if(groups.includes('whiteBalance')){validateWhiteBalanceTarget(source.adjustments,target.image.inputKind);next.wbMultipliers=null;next.wbMode='custom';next.wbApproximate=false;}
 if(groups.includes('crop'))next.cropAspect=source.adjustments.cropAspect&&next.crop?next.crop.width*target.image.width/(next.crop.height*target.image.height):null;
 validateCurveRefine(next);
 return next;
}
