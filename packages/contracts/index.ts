export type {ExportFormat} from './export-options.js';
import type {ExportOptions,ExportFormat} from './export-options.js';
export type Point = { x: number; y: number; radius?: number; erase?: boolean };
export type PointCurvePresetName='Linear'|'Medium Contrast'|'Strong Contrast';
export type PointCurveName=PointCurvePresetName|'Custom';
export type CurveSampleChannel='curve'|'redCurve'|'greenCurve'|'blueCurve';
export interface CurveSampleRequest {
 id:string;sessionId:string;revision:number;channel:CurveSampleChannel;
 // 完整变换后画布像素中心坐标；非 0–1、非源坐标。
 point:Point;
}
export interface CurveSampleResult {
 id:string;sessionId:string;revision:number;channel:CurveSampleChannel;
 domain:'art-tone-input-v1'|'art-rgb-input-v1';input:number;output:number;values:number[];
 point:Point;sampleSize:number;reused:boolean;
}
export interface CanvasEditTransaction {
 sessionId:string;revision:number;valid:()=>boolean;release:()=>void;
 apply:(change:(a:Adjustments)=>Adjustments)=>boolean;
 // The visible target snapshots are captured at begin, never at commit time.
 applyGlobal:(change:(a:Adjustments)=>Adjustments)=>Promise<boolean>;
}
export type CurveRefineModel='weighted-std-v1';
export function isPointCurveIdentity(points:readonly Point[]){return points.length>=2&&points[0].x===0&&points.at(-1)!.x===1&&points.every(p=>Math.abs(p.x-p.y)<.000009);}
export function validateCurveRefine(value:Pick<AdjustmentPatch,'curveRefineModel'|'curveRefineSaturation'>){
 if(value.curveRefineModel===undefined&&value.curveRefineSaturation===undefined)return;
 if(value.curveRefineModel!=='weighted-std-v1')throw new Error('不支持的曲线优化处理模型。');
 if(!Number.isInteger(value.curveRefineSaturation)||Number(value.curveRefineSaturation)<0||Number(value.curveRefineSaturation)>100)throw new Error('曲线优化饱和度须为 0–100 整数。');
}
// Actual ACR 18.7 (2743) TIFF/XMP references; coordinates remain normalized doubles.
export const POINT_CURVE_PRESETS:Readonly<Record<PointCurvePresetName,readonly Point[]>>={
 'Linear':[{x:0,y:0},{x:1,y:1}],
 'Medium Contrast':[[0,0],[32,22],[64,56],[128,128],[192,196],[255,255]].map(([x,y])=>({x:x/255,y:y/255})),
 'Strong Contrast':[[0,0],[32,16],[64,50],[128,128],[192,202],[255,255]].map(([x,y])=>({x:x/255,y:y/255})),
};
export function matchesPointCurvePreset(points:readonly Point[]|undefined,name:PointCurvePresetName){const expected=POINT_CURVE_PRESETS[name];return !!points&&points.length===expected.length&&points.every((p,i)=>p.x===expected[i].x&&p.y===expected[i].y);}
export function pointCurveName(value:Pick<AdjustmentPatch,'curve'|'redCurve'|'greenCurve'|'blueCurve'|'curveName'>):PointCurveName{
 if(value.curveName==='Custom')return 'Custom';
 if((value.curveName==='Medium Contrast'||value.curveName==='Strong Contrast')&&matchesPointCurvePreset(value.curve,value.curveName))return value.curveName;
 return [value.curve,value.redCurve,value.greenCurve,value.blueCurve].every(p=>matchesPointCurvePreset(p,'Linear'))?'Linear':'Custom';
}
export function validRating(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&(value===-1||(value>=0&&value<=5));}
export type MaskType = 'brush' | 'linear' | 'radial' | 'luminance' | 'color' | 'raster';
export interface ColorSample {l:number;c:number;h:number;point:Point;end?:Point;sourcePoint?:Point} // Optional unrotated source pixel-center anchor, normalized by W-1/H-1.
// Backend-owned authoring transform; consumers preserve it without interpreting ART fields.
export interface MaskGeometryReference {version:1|2|3;data:string}
export interface SourceFrame {
 readonly version:1;readonly policy:'legacy'|'active-area-v1';
 readonly decoderModel?:'sensor-crop-v1'; // Absent preserves the original decoder geometry.
 readonly sensor:'rendered'|'bayer'|'xtrans'|'linear'|'foveon';
 readonly border:number;readonly fullWidth:number;readonly fullHeight:number;
 readonly width:number;readonly height:number;
 readonly layoutWidth:number;readonly layoutHeight:number;
 readonly decoded:{readonly left:number;readonly top:number;readonly width:number;readonly height:number;readonly rotation:number};
}
export {sourceFrameOpenSnapshot,sourceFramePolicyForDocument,validateSourceFrame} from './source-frame.js';
export interface MaskRasterAsset {path:string;sha256:string;width:number;height:number}
export interface BrushSettings {flow:number;density:number;autoMask:boolean}
export interface BrushPoint {x:number;y:number;radius:number}
// One ordered operation. Parameters and authoring geometry are frozen at pen-down.
// coverage is independent unit coverage; density is applied only during replay.
export interface BrushStrokeV1 {
  id:string;gestureId:string;operation:'paint'|'erase';
  flow:number;density:number;feather:number;
  canvas:{width:number;height:number};points:BrushPoint[];
  geometryReference:MaskGeometryReference;
  autoMask:false|{model:'art-deltae-seed-v1';tolerance:number;seed?:ColorSample};
  coverage?:MaskRasterAsset;
}
export interface BrushProgramV1 {version:1;strokes:BrushStrokeV1[]}
export interface BrushPrepareRequest {id:string;sessionId:string;revision:number;stroke:BrushStrokeV1}
export {validateBrushPrograms} from './brush.js';
export interface MaskGeometry {
  id: string; name: string; type: MaskType; enabled: boolean; inverted: boolean;
  feather: number;
  // Absent preserves the legacy gradient width and sampling. Endpoints are full/zero for v1.
  linearGradientModel?:'full-zero-v1';
  geometryReference?:MaskGeometryReference;
  brush?:BrushProgramV1; // Ordered operations over the untouched legacy points base.
  referenceAngle?:number; // Spatial leaf's fine-rotation canvas; absent inherits its ART profile.
  raster?:{path:string;sha256:string;width:number;height:number}; // Canonical, unrotated full-image bounds; pixel-center sampling.
  colorSamples?:ColorSample[];colorRefine?:number;
  luminanceRange?:[number,number,number,number]; // Outer low, inner low, inner high, outer high (Lab L*).
  points: Point[]; start: Point; end: Point;
  initialized?:boolean;
}
export interface MaskComponent extends MaskGeometry {operation:'add'|'subtract'|'intersect'}
export interface LocalMask extends MaskGeometry {
  brightness:number;contrast:number;saturation:number;
  components?:MaskComponent[];
  tone?:{highlights:number;shadows:number;whites:number;blacks:number};
  whiteBalance?:{temperature:number;tint:number};
  details?:{hue:number;texture:number;clarity:number;noise:number;noiseDetail:number;glow?:number}; // Local Glow: signed integer -100..100; shared style/range/spread/warmth. Negative pixel combination awaits ACR reference.
}
export function validateLinearGradientModels(masks:readonly LocalMask[]|undefined){
 if(masks===undefined)return;
 if(!Array.isArray(masks))throw new Error('蒙版必须为数组。');
 const visit=(m:LocalMask|MaskComponent,depth:number)=>{
  if(depth>8)throw new Error('蒙版组件嵌套过深。');
  if(m.linearGradientModel!==undefined){
   if(m.linearGradientModel!=='full-zero-v1'||m.type!=='linear'||('components' in m&&m.components))throw new Error('线性渐变处理模型无效。');
   if(m.feather!==0)throw new Error('完整端点渐变不使用额外羽化。');
  }
  if('components' in m&&m.components)for(const c of m.components)visit(c,depth+1);
 };
 for(const m of masks)visit(m,0);
}
export interface EnhancedProfileTable {fingerprint:string;data:string}
export interface EnhancedProfileXMPNode {localized?:string;value?:string;options?:number;type?:string;lang?:string;items?:EnhancedProfileXMPNode[];fields?:{ns:string;name:string;node:EnhancedProfileXMPNode|null}[];qualifiers?:{ns:string;name:string;node:EnhancedProfileXMPNode|null}[]}
export interface EnhancedProfileData {
  schemaVersion:1;uuid:string;name:string;group:string;copyright:string;
  baseProfile:string;cameraModelRestriction:string;
  supportsAmount:boolean;supportsSceneReferred:boolean;supportsOutputReferred:boolean;
  supportsColor:boolean;supportsMonochrome:boolean;
  supportsHighDynamicRange:boolean;supportsNormalDynamicRange:boolean;
  parameters:Record<string,string>;tables:EnhancedProfileTable[];
  curve?:Point[];
  xmpPacket:string;
  standardLook?:EnhancedProfileXMPNode;
}
export interface EnhancedLookSettings {profile:EnhancedProfileData;amount:number}
export interface ColorProfileSettings {
  mode:'auto'|'matrix'|'embedded'|'inherited';
  reference?:string;
  toneCurve:boolean;lookTable:boolean;hueSatMap:boolean;baselineExposure:boolean;illuminant:0|1|2;
  look?:EnhancedLookSettings|null; // null explicitly clears across IPC and selected-photo edits.
}
export interface InputProfileOption {
  id:ColorProfileSettings['mode'];reference?:string;sha256?:string;cameraModel?:string;embedPolicy?:number;name:string;kind:'dcp'|'icc'|'matrix'|'srgb'|'look';
  enhanced?:EnhancedProfileData;settings?:ColorProfileSettings;
  dcp?:{toneCurve:boolean;lookTable:boolean;hueSatMap:boolean;baselineExposure:boolean;illuminants:{id:1|2;temperature:number}[]};
}
export interface BlackWhiteSettings {
  enabled:boolean;mixer:number[];
  base?:{preset:string;filter:string;weights:number[];gamma:number[];tint:{amount:number;hue:number}};
}
export interface SpotSettings {method:'clone'|'heal';radius:number;feather:number;opacity:number;detail:number;retainTexture?:boolean;sourceMode?:'auto'|'manual';searchSeed?:number}
export interface RepairSpot extends SpotSettings {
  id:string;name:string;enabled:boolean;source:Point;target:Point;
  // One connected path in unrotated source pixel centers normalized by W-1/H-1.
  // Absent means the legacy circular point; target equals path[0].
  path?:Point[];
}
export interface ParametricCurveSettings {highlights:number;lights:number;darks:number;shadows:number;splits:[number,number,number]}
export interface ColorGradingWheel {hue:number;saturation:number;luminance:number}
export interface ColorGradingSettings {shadows:ColorGradingWheel;midtones:ColorGradingWheel;highlights:ColorGradingWheel;global:ColorGradingWheel;blending:number;balance:number}
export interface DefringeSettings {purpleAmount:number;purpleHueLo:number;purpleHueHi:number;greenAmount:number;greenHueLo:number;greenHueHi:number}
// ShadowTint: standard CRS integer -100..100; omitted legacy values are neutral.
export interface CalibrationSettings {shadowTint?:number;redHue:number;redSaturation:number;greenHue:number;greenSaturation:number;blueHue:number;blueSaturation:number}
export interface LensProfileSettings {mode:'auto'|'manual';cameraMake:string;cameraModel:string;lens:string;distortion:boolean;vignette:boolean;ca:boolean}
export interface LensProfileStatus {cameraMake:string;cameraModel:string;lens:string;distortion:boolean;vignette:boolean;ca:boolean;reason:string}
export interface LensCatalog {cameras:{make:string;model:string}[];lenses:{make:string;name:string}[]}
export type AutoPerspectiveDirection='horizontal'|'vertical'|'both';
// Saved guide endpoints are unrotated source pixel centers normalized by W-1/H-1.
export interface PerspectiveGuide {axis:'horizontal'|'vertical';start:Point;end:Point}
export interface AutoPerspectiveRequest {id:string;sessionId:string;direction:AutoPerspectiveDirection;lines?:PerspectiveGuide[]; /* RPC lines use current display pixel centers. */ adjustments:Adjustments;artProfile:string;sourceFrame?:SourceFrame}
export interface PerspectiveSettings {enabled:boolean;horizontal:number;vertical:number;angle:number;shear:number;focalLength:number;cropFactor:number;aspect:number;
  // Absent retains the historical ART path, including aspect-only bypass.
  manualModel?:'art-perspective-v1'|'signed-framing-v1';scale?:number;offsetX?:number;offsetY?:number;constrainCrop?:boolean;
}
export function validatePerspective(value:PerspectiveSettings|undefined){
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean')throw new Error('透视设置无效。');
  const signed=value.manualModel==='signed-framing-v1';
  const ranges={horizontal:[-200,200],vertical:[-200,200],angle:[-20,20],shear:[-50,50],focalLength:[0,1200],cropFactor:[.1,10],aspect:signed?[-100,100]:[.5,2],scale:signed?[.5,1.5]:[.1,4],offsetX:signed?[-100,100]:[-.5,.5],offsetY:signed?[-100,100]:[-.5,.5]} as const;
  for(const key of Object.keys(ranges) as (keyof typeof ranges)[]){const v=value[key],[min,max]=ranges[key];if(v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max))throw new Error('透视参数超出支持范围：'+key);}
  if(value.manualModel!==undefined&&value.manualModel!=='art-perspective-v1'&&value.manualModel!=='signed-framing-v1')throw new Error('不支持的手动透视处理版本。');
  if(value.manualModel===undefined&&['scale','offsetX','offsetY','constrainCrop'].some(key=>Object.hasOwn(value,key)))throw new Error('手动透视参数缺少处理版本。');
  if(value.constrainCrop!==undefined&&typeof value.constrainCrop!=='boolean')throw new Error('约束裁切必须为布尔值。');
}
export interface Adjustments {
  readonly sourceFrame?:SourceFrame; // Immutable source geometry, outside adjustment groups.
  hdrEnabled?:boolean;
  hdrHeadroom?:number; // ART white point in EV above relative white; not Adobe HDRMaxValue.
  perspective?:PerspectiveSettings;
  perspectiveGuides?:PerspectiveGuide[];
  lensProfile?:LensProfileSettings;
  colorGrading?:ColorGradingSettings;
  parametricCurve?:ParametricCurveSettings;
  exposure: number; temperature: number; tint: number; contrast: number;
  // Rendered inputs use zero-centred offsets, never Kelvin. Absent keeps legacy WB.
  incrementalTemperature?:number;incrementalTint?:number;relativeWBModel?:'art-ctl-v1';
  saturation: number; vibrance: number; curve: Point[];
  curveName?:PointCurveName; // Point-curve metadata only; no refinement algorithm is implied.
  curveRefineSaturation?:number;curveRefineModel?:CurveRefineModel; // Absent retains STD; explicit adjustment opts into the mature ART blend.
  rotation: number; crop: { x: number; y: number; width: number; height: number } | null;
  flipHorizontal?:boolean;flipVertical?:boolean; // After coarse rotation; absent retains an inherited ART profile.
  fineRotation?:number; // Effective ART rotation in degrees; absent preserves the stored profile.
  cropAspect?:number|null; // Locked width/height in the unrotated image, UI constraint only.
  masks: LocalMask[];
  wbMode?:string;wbMultipliers?:number[]|null;wbApproximate?:boolean;
  colorProfile?:ColorProfileSettings;
  blackWhite?:BlackWhiteSettings;
  spots?:RepairSpot[];
  highlights?:number;shadows?:number;whites?:number;blacks?:number;
  sharpening?:number;sharpenRadius?:number;luminanceNoise?:number;colorNoise?:number;
  sharpenDetail?:number;sharpenEdgeMask?:number;
  luminanceNoiseDetail?:number;luminanceNoiseContrast?:number;colorNoiseDetail?:number;colorNoiseSmoothness?:number;
  texture?:number;clarity?:number;
  dehaze?:number;vignette?:number;grain?:number;
  glow?:number;glowStyle?:'diffusion'|'bloom'|'halation';glowRange?:number;glowSpread?:number;glowWarmth?:number;
  // Missing model/style retains the pre-28 ART appearance. Switching is explicit.
  grainModel?:'procedural-v1';grainSize?:number;grainRoughness?:number;
  postCropVignetteFeather?:number;postCropVignetteRoundness?:number;
  postCropVignetteMidpoint?:number;postCropVignetteHighlights?:number;
  postCropVignetteStyle?:'highlight-priority'|'color-priority'|'paint-overlay';
  lensCorrections?:boolean;
  lensManualDistortion?:number;lensVignette?:number;
  defringe?:DefringeSettings;
  calibration?:Partial<CalibrationSettings>;
  redCurve?:Point[];greenCurve?:Point[];blueCurve?:Point[];
  hsl?:{hue:number[];saturation:number[];luminance:number[]};
}
export type AdjustmentPatch=Omit<Partial<Adjustments>,'hsl'|'parametricCurve'|'colorGrading'>&{
  hsl?:Partial<Record<'hue'|'saturation'|'luminance',Record<number,number>>>;
  parametricCurve?:Partial<Omit<ParametricCurveSettings,'splits'>>&{splits?:Partial<Record<0|1|2,number>>};
  colorGrading?:{shadows?:Partial<ColorGradingWheel>;midtones?:Partial<ColorGradingWheel>;highlights?:Partial<ColorGradingWheel>;global?:Partial<ColorGradingWheel>;blending?:number;balance?:number};
};
export function hasRelativeWhiteBalance(value:AdjustmentPatch){return value.incrementalTemperature!==undefined||value.incrementalTint!==undefined||value.relativeWBModel!==undefined;}
export function validateWhiteBalanceTarget(value:AdjustmentPatch,inputKind:InputKind){
  if((hasRelativeWhiteBalance(value)||value.temperature!==undefined||value.tint!==undefined)&&!['mosaic-raw','linear-raw','rendered'].includes(inputKind))throw new Error('无法确认照片输入类型，未复制白平衡。');
  if(hasRelativeWhiteBalance(value)){if(inputKind!=='rendered')throw new Error('相对白平衡仅适用于已渲染图像；不能把相对数值复制为 RAW 色温。');}
  else if(inputKind==='rendered'&&(value.temperature!==undefined||value.tint!==undefined))throw new Error('绝对色温不能复制为已渲染图像的相对白平衡；请分别调整或逐图自动计算。');
}
export function partialAdjustmentGroups(patch:AdjustmentPatch):('hsl'|'parametricCurve'|'colorGrading'|'calibration')[]{
  const groups:('hsl'|'parametricCurve'|'colorGrading'|'calibration')[]=[];
  if(patch.hsl&&['hue','saturation','luminance'].some(channel=>Array.from({length:8},(_,i)=>patch.hsl?.[channel as 'hue'|'saturation'|'luminance']?.[i]).some(value=>value===undefined)))groups.push('hsl');
  const curve=patch.parametricCurve;
  if(curve&&(['shadows','darks','lights','highlights'].some(key=>curve[key as 'shadows'|'darks'|'lights'|'highlights']===undefined)||[0,1,2].some(i=>curve.splits?.[i as 0|1|2]===undefined)))groups.push('parametricCurve');
  const grade=patch.colorGrading;
  if(grade&&(grade.blending===undefined||grade.balance===undefined||(['shadows','midtones','highlights','global'] as const).some(region=>(['hue','saturation','luminance'] as const).some(key=>grade[region]?.[key]===undefined))))groups.push('colorGrading');
  if(patch.calibration&&(['shadowTint','redHue','redSaturation','greenHue','greenSaturation','blueHue','blueSaturation'] as const).some(key=>patch.calibration?.[key]===undefined))groups.push('calibration');
  return groups;
}
// Resolve sparse XMP controls against the actual photo, never against preset defaults.
export function mergeAdjustmentPatch(base:Adjustments,patch:AdjustmentPatch):Adjustments{
  const {hsl,parametricCurve,colorGrading,...rest}=structuredClone(patch),next:Adjustments={...structuredClone(base),...rest};
  if(hasRelativeWhiteBalance(patch)){
    next.relativeWBModel=patch.relativeWBModel??base.relativeWBModel??'art-ctl-v1';
    next.incrementalTemperature=patch.incrementalTemperature??base.incrementalTemperature??0;
    next.incrementalTint=patch.incrementalTint??base.incrementalTint??0;
    next.wbMultipliers=patch.wbMultipliers??null;
  }else if(patch.temperature!==undefined||patch.tint!==undefined){delete next.incrementalTemperature;delete next.incrementalTint;delete next.relativeWBModel;}
  if(hsl){
    next.hsl={hue:[],saturation:[],luminance:[]};
    for(const channel of ['hue','saturation','luminance'] as const)next.hsl[channel]=Array.from({length:8},(_,index)=>hsl[channel]?.[index]??base.hsl?.[channel][index]??0);
  }
  if(parametricCurve){
    const current=base.parametricCurve??{shadows:0,darks:0,lights:0,highlights:0,splits:[25,50,75] as [number,number,number]}, {splits,...values}=parametricCurve;
    next.parametricCurve={...current,...values,splits:current.splits.map((value,index)=>splits?.[index as 0|1|2]??value) as [number,number,number]};
    const positions=next.parametricCurve.splits;
    if(positions.some(value=>!Number.isFinite(value)||value<1||value>99)||positions[1]-positions[0]<1||positions[2]-positions[1]<1)throw new Error('参数曲线分界与当前设置冲突，请调整分界后重试。');
  }
  if(colorGrading){
    const wheel={hue:0,saturation:0,luminance:0},current=base.colorGrading??{shadows:wheel,midtones:wheel,highlights:wheel,global:wheel,blending:50,balance:0};
    next.colorGrading={...current,...colorGrading,shadows:{...current.shadows,...colorGrading.shadows},midtones:{...current.midtones,...colorGrading.midtones},highlights:{...current.highlights,...colorGrading.highlights},global:{...current.global,...colorGrading.global}};
  }
  if(patch.calibration)next.calibration={...base.calibration,...patch.calibration};
  validateCurveRefine(next);
  return next;
}
export interface EditDocument {
  rating?:number;
  label?:string;
  xmpPacket?:string; warnings?:string[]; engineVersion: string; source: { path: string; size: number; sha256: string };
  artProfile: string; adjustments: Adjustments;baselineVersion?:4;
  maskAssets?:{schemaVersion:1;files:{id:string;path:string;bytes:number}[]};
  inputProfileAsset?:{id:string;path:string;bytes:number};
}
export type InputKind='mosaic-raw'|'linear-raw'|'rendered';
export interface EffectiveGeometry {
  readonly rotation:number;readonly angle:number;
  readonly flipHorizontal:boolean;readonly flipVertical:boolean;
  readonly sourceFlipHorizontal:boolean;readonly sourceFlipVertical:boolean;
}
export interface SourceIdentity {readonly size:number;readonly sha256:string;readonly version:string}
export interface ImageSession {
  readonly sourceFrame?:SourceFrame;
  sourceIdentity:SourceIdentity;
  effectiveGeometry?:EffectiveGeometry; // Read-only native projection; never materialize absent recipe controls from it.
  inputKind:InputKind;
  rating?:number;
  label?:string;
  id: string; path: string; name: string; width: number; height: number;
  lensCatalog?:LensCatalog;lensStatus?:LensProfileStatus;
  profileCamera?:string;
  camera: string; lens: string; iso: number; adjustments: Adjustments; recipe?: EditDocument;
  xmpWarnings?:string[];
  initialAdjustments?: Adjustments;
  baselineVersion?:4;whiteBalancePresets?:{id:string;name:string}[];
  inputProfiles?:InputProfileOption[];
  cameraCrop?:Adjustments['crop'];
  aperture?:number;shutter?:number;focalLength?:number;exposureCompensation?:number;
}
export interface LuminancePreview {url:string;x:number;y:number;width:number;height:number}
export interface LuminanceSample {minimum:number;maximum:number;pixels:number;revision:number}
export type CoordinateSpace='display'|'reference'|'source';
// Full, coarse-rotated canvas pixel centers: no crop offset or normalized coordinates.
// Off-image points are preserved; null means that the inverse could not be solved.
export interface CoordinateMapping {sessionId:string;revision:number;width:number;height:number;referenceAngle:number;geometryReference?:MaskGeometryReference;points:({x:number;y:number}|null)[]}
export interface RepairSourceRequest {
  sessionId:string;revision:number;
  // Unrotated source pixel centers normalized by W-1/H-1, as RepairSpot.path.
  path:Point[];radius:number;feather:number;seed:number;exclude?:Point;
}
export interface RepairSourceResult {
  sessionId:string;revision:number;source:Point;
  // Source minus path[0], in the same unrotated normalized source domain.
  offset:Point;
}
export interface StraightenResult {angle:number;axis:'horizontal'|'vertical';previousAngle:number;residualDegrees:number}
export interface MaskPreview {id:string;url:string;x:number;y:number;width:number;height:number}
// Relative white is 1; this transport alone does not certify HDR presentation.
export interface LinearPreview {url:string;width:number;height:number;rowBytes:number;encoding:'rgba16float-le';colorSpace:'rec709-linear';histogram?:{bins:number[][];headroom:number;below:number[];above:number[]}}
export type ComparisonLayout = 'off'|'left-right'|'top-bottom'|'split-vertical'|'split-horizontal';
export type ComparisonGeometry = Pick<Adjustments,'rotation'|'flipHorizontal'|'flipVertical'|'fineRotation'|'perspective'|'crop'|'lensCorrections'|'lensProfile'|'lensManualDistortion'>;
export interface ComparisonSettings {adjustments:Adjustments;artProfile:string;geometry:ComparisonGeometry}
export interface PreviewFrame {
  sessionId: string; revision: number; url: string; width: number; height: number;
  fullWidth: number; fullHeight: number; kind: 'fit' | 'detail' | 'before';
  x?: number; y?: number; elapsedMs: number;
  histogram?:number[][];curveHistogram?:number[]|null;mask?:MaskPreview|null;luminance?:LuminancePreview|null;linear?:LinearPreview|null;
}
export interface ExportResult {source:string;output?:string;error?:string}
export interface BatchSaveRequest {documents:ExportDocumentSnapshot[]}
export interface BatchSaveItemResult extends ExportResult {xmpPacket?:string}
export interface BatchSaveResult {results:BatchSaveItemResult[];cancelled:boolean}
export interface ExportDocumentSnapshot {path:string;width:number;height:number;artProfile:string;adjustments:Adjustments;xmpPacket?:string;rating?:number;label?:string;sourceIdentity?:SourceIdentity}
export interface SessionSaveRequest {sessionId:string;documents:ExportDocumentSnapshot[]}
export interface ExportRequest {document:ExportDocumentSnapshot;format:ExportFormat;colorSpace:OutputColorSpace;options?:ExportOptions}
export interface BatchExportRequest {documents:ExportDocumentSnapshot[];format:ExportFormat;colorSpace:OutputColorSpace;options?:ExportOptions}
export interface JobStatus { id: string; state: 'running' | 'done' | 'cancelled' | 'error'; progress: number; message: string; total?:number;results?:ExportResult[] }
export type EngineEvent = {event:'comparison-preview';frame:PreviewFrame} | {event:'comparison-error';sessionId:string;revision:number;message:string} | {event:'save-progress';message:string} | {event:'object-progress';id:string;message:string} | { event: 'preview'; frame: PreviewFrame } | { event: 'job'; job: JobStatus } | { event: 'error'; message: string } | {event:'synchronize-progress';message:string} | {event:'command';command:'open'|'save'|'close'|'export'|'copy-all'|'copy-selected'|'paste'};
export interface WhiteBalanceRequest {mode:'camera'|'auto'|'sample'|'preset'|'profile';preset?:string;x?:number;y?:number;size?:number;colorProfile?:ColorProfileSettings}
export interface WhiteBalanceResult {temperature:number;tint:number;incrementalTemperature?:number;incrementalTint?:number;relativeWBModel?:'art-ctl-v1';wbMode:string;wbMultipliers:number[]|null;wbApproximate:boolean;colorProfile?:ColorProfileSettings}
export const OUTPUT_COLOR_SPACES={'srgb':'sRGB','adobe-rgb':'Adobe RGB (1998)','prophoto-rgb':'ProPhoto RGB','display-p3':'Display P3','rec2020':'Rec. 2020'} as const;
export type OutputColorSpace=keyof typeof OUTPUT_COLOR_SPACES;
export interface ObjectBox {start:Point;end:Point}
export interface ObjectPrompt {point:Point;exclude:boolean}
export interface ObjectCandidateResult {id:string;revision:number;selected:number;candidates:{index:number;pixels:number;url:string}[]}
export type PersonPart='hair'|'bodySkin'|'faceSkin'|'clothes'|'accessories';
export interface PersonPartsResult {id:string;revision:number;parts:{part:PersonPart;classIndex:number;pixels:number;url:string}[]}
export type SemanticMaskPart='subject'|'background';
export interface SemanticMasksResult {id:string;revision:number;parts:{part:SemanticMaskPart;classIndex:number;pixels:number;url:string}[]}
export interface SkyMaskResult {id:string;revision:number;pixels:number;url:string}
export interface ObjectMaskResult {raster:NonNullable<MaskGeometry['raster']>;referenceAngle:number}
export interface CaptRAWAPI {
  prepareBrush(request:BrushPrepareRequest):Promise<BrushStrokeV1|null>;
  cancelBrush(id?:string):Promise<void>;
  autoPerspective(request:AutoPerspectiveRequest):Promise<PerspectiveSettings|null>;
  cancelAutoPerspective(id:string):Promise<void>;
  importInputProfile(sessionId:string):Promise<InputProfileOption|null>;
  listInputProfiles():Promise<{items:InputProfileOption[];errors:string[]}>;
  inspectInputProfile(reference:string):Promise<InputProfileOption>;
  listPresets():Promise<{items:import('./presets.js').PresetSummary[];errors:string[]}>;
  createPreset(input:import('./presets.js').PresetInput):Promise<import('./presets.js').PresetSummary>;
  updatePreset(id:string,input:import('./presets.js').PresetInput):Promise<import('./presets.js').PresetSummary>;
  renamePreset(id:string,name:string,group:string):Promise<import('./presets.js').PresetSummary>;
  deletePreset(id:string):Promise<void>;
  importPreset():Promise<import('./presets.js').PresetSummary|null>;
  exportPreset(id:string):Promise<string|null>;
  applyPreset(id:string,target:import('./synchronize.js').SyncDocument):Promise<import('./synchronize.js').SyncResult[]|null>;
  previewPreset(request:import('./presets.js').PresetPreviewRequest):Promise<import('./presets.js').PresetApplyResult|null>;
  cancelPresetPreview():Promise<void>;
  applyPresets(request:import('./presets.js').PresetApplyRequest):Promise<import('./presets.js').PresetApplyResult|null>;
  createISOPreset(input:import('./presets.js').ISOPresetInput):Promise<import('./presets.js').PresetSummary>;
  favoritePreset(id:string,favorite:boolean):Promise<import('./presets.js').PresetSummary>;
  duplicatePreset(id:string,name:string,group:string):Promise<import('./presets.js').PresetSummary>;
  listPresetPacks():Promise<import('./presets.js').PresetPackManifest[]>;
  beginObject(sessionId:string,adjustments:Adjustments,artProfile:string):Promise<{id:string;width:number;height:number}>;
  predictObject(id:string,prompts:ObjectPrompt[],box?:ObjectBox):Promise<ObjectCandidateResult>;
  predictPersonParts(id:string):Promise<PersonPartsResult>;
  predictSemanticMasks(id:string):Promise<SemanticMasksResult>;
  predictSkyMask(id:string):Promise<SkyMaskResult>;
  commitObject(id:string,revision:number,index:number):Promise<ObjectMaskResult>;
  commitPersonPart(id:string,revision:number,part:PersonPart):Promise<ObjectMaskResult>;
  commitSemanticMask(id:string,revision:number,part:SemanticMaskPart):Promise<ObjectMaskResult>;
  commitSkyMask(id:string,revision:number):Promise<ObjectMaskResult>;
  cancelObject(id?:string):Promise<void>;
  exportBatch(request:BatchExportRequest):Promise<ExportResult[]|null>;
  synchronize(request:import('./synchronize.js').SyncRequest):Promise<import('./synchronize.js').SyncResult[]|null>;
  cancelSynchronize():Promise<void>;
  parametricCurve(settings:ParametricCurveSettings):Promise<{samples:number[]}>;
  chooseFiles(): Promise<string[]>;
  droppedFiles(files: File[]): string[];
  open(path: string,expectedSource?:SourceIdentity): Promise<ImageSession>;
  update(sessionId: string, revision: number, adjustments: Adjustments, artProfile?: string, maskId?:string, luminance?:boolean,colorSampling?:boolean): Promise<{ artProfile: string; lensStatus:LensProfileStatus;geometry?:EffectiveGeometry }>;
  comparison(sessionId:string,revision:number,settings:ComparisonSettings|null,linearPreview?:boolean):Promise<void>;
  comparisonViewport(sessionId:string,revision:number,x:number,y:number,width:number,height:number):Promise<void>;
  viewport(sessionId: string, revision: number, x: number, y: number, width: number, height: number): Promise<void>;
  coordinates(sessionId:string,revision:number,from:CoordinateSpace,to:CoordinateSpace,points:{x:number;y:number}[],referenceAngle?:number,geometryReference?:MaskGeometryReference|'current'):Promise<CoordinateMapping>;
  repairSource(request:RepairSourceRequest):Promise<RepairSourceResult>;
  // Read-only solve; endpoints are full display pixel centers, as in coordinates().
  straighten(sessionId:string,revision:number,start:Point,end:Point):Promise<StraightenResult>;
  sampleColor(sessionId:string,revision:number,start:Point,end?:Point):Promise<{l:number;c:number;h:number;pixels:number;revision:number}>;
  sampleLuminance(sessionId:string,revision:number,start:Point,end?:Point):Promise<LuminanceSample>;
  sampleCurve(request:CurveSampleRequest):Promise<CurveSampleResult|null>;
  cancelCurveSample(id?:string):Promise<void>;
  whiteBalance(sessionId:string,request:WhiteBalanceRequest):Promise<WhiteBalanceResult>;
  save(session: ImageSession, artProfile: string): Promise<string>;
  saveSelected(request:BatchSaveRequest):Promise<BatchSaveResult|null>;
  saveSession(request:SessionSaveRequest):Promise<BatchSaveResult|null>;
  // Explicit single-document retry; the native picker chooses and remembers its target.
  saveSessionAs(request:SessionSaveRequest):Promise<BatchSaveResult|null>;
  forgetSession(sessionId:string):Promise<void>;
  confirmDiscardSession(names:string[]):Promise<boolean>;
  cancelSave():Promise<void>;
  export(request:ExportRequest): Promise<string | null>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  confirmClose(name:string):Promise<'save'|'discard'|'cancel'>;
  setDirty(paths:string[]):Promise<void>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
}
declare global { interface Window { captraw: CaptRAWAPI; } }
export const ENGINE_VERSION='CaptRAW-32_ART-1.26.10_LibRaw-3b20539';
// Older XMP retains its profile-wide reference. Version 22 protects independent
// spatial leaf references from renderers that would silently ignore them.
// Version 29 protects explicit source frames and v2 authoring references.
// Version 32 protects standard-only perspective scale and curve-refine models.
export const READABLE_ENGINE_VERSIONS:ReadonlySet<string>=new Set([ENGINE_VERSION,'CaptRAW-31_ART-1.26.10_LibRaw-3b20539','CaptRAW-30_ART-1.26.10_LibRaw-3b20539','CaptRAW-29_ART-1.26.10_LibRaw-3b20539','CaptRAW-28_ART-1.26.10_LibRaw-3b20539','CaptRAW-27_ART-1.26.10_LibRaw-3b20539','CaptRAW-26_ART-1.26.10_LibRaw-3b20539','CaptRAW-25_ART-1.26.10_LibRaw-3b20539','CaptRAW-24_ART-1.26.10_LibRaw-3b20539','CaptRAW-23_ART-1.26.10_LibRaw-3b20539','CaptRAW-22_ART-1.26.10_LibRaw-3b20539','CaptRAW-21_ART-1.26.10_LibRaw-3b20539','CaptRAW-20_ART-1.26.10_LibRaw-3b20539']);

export type ToneHistogram=readonly (readonly number[])[];
export function autoTone(adjustments:Adjustments,histogram:ToneHistogram|null|undefined):Adjustments{
 const next=structuredClone(adjustments);
 if(!histogram||histogram.length!==3||histogram.some(channel=>channel.length!==256||channel.some(value=>!Number.isFinite(value)||value<0)))return next;
 const luminance=Array.from({length:256},(_,index)=>histogram[0][index]*.2126+histogram[1][index]*.7152+histogram[2][index]*.0722);
 const total=luminance.reduce((sum,value)=>sum+value,0);if(!(total>0))return next;
 const percentile=(fraction:number)=>{
  const target=total*fraction;let sum=0;
  for(let index=0;index<256;index++){sum+=luminance[index];if(sum>=target)return index/255;}
  return 1;
 };
 const p01=percentile(.01),p10=percentile(.10),p20=percentile(.20),median=percentile(.50),p80=percentile(.80),p95=percentile(.95),p99=percentile(.99);
 const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value)),exposureDelta=Math.round(clamp(Math.log2(.45/Math.max(.02,median)),-2,2)*20)/20;
 next.exposure=Math.round(clamp(next.exposure+exposureDelta,-5,5)*20)/20;
 next.contrast=Math.round(clamp(next.contrast+clamp((.52-(p80-p20))*80,-25,25),-100,100));
 next.highlights=Math.round(clamp((next.highlights??0)+clamp((.92-p95)*180,-30,20),-100,100));
 next.shadows=Math.round(clamp((next.shadows??0)+clamp((.10-p10)*220,-25,35),-100,100));
 next.whites=Math.round(clamp((next.whites??0)+clamp((.95-p99)*160,-20,20),-100,100));
 next.blacks=Math.round(clamp((next.blacks??0)+clamp((.025-p01)*220,-20,15),-100,100));
 return next;
}
