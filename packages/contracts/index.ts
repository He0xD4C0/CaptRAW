import type {ExportOptions} from './export-options.js';
export type Point = { x: number; y: number; radius?: number; erase?: boolean };
export function validRating(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&(value===-1||(value>=0&&value<=5));}
export type MaskType = 'brush' | 'linear' | 'radial' | 'luminance' | 'color' | 'raster';
export interface ColorSample {l:number;c:number;h:number;point:Point;end?:Point;sourcePoint?:Point} // Optional unrotated source pixel-center anchor, normalized by W-1/H-1.
export interface MaskGeometry {
  id: string; name: string; type: MaskType; enabled: boolean; inverted: boolean;
  feather: number;
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
  details?:{hue:number;texture:number;clarity:number;noise:number;noiseDetail:number};
}
export interface ColorProfileSettings {
  mode:'auto'|'matrix'|'embedded'|'inherited';
  reference?:string;
  toneCurve:boolean;lookTable:boolean;hueSatMap:boolean;baselineExposure:boolean;illuminant:0|1|2;
}
export interface InputProfileOption {
  id:ColorProfileSettings['mode'];reference?:string;sha256?:string;cameraModel?:string;embedPolicy?:number;name:string;kind:'dcp'|'icc'|'matrix'|'srgb';
  dcp?:{toneCurve:boolean;lookTable:boolean;hueSatMap:boolean;baselineExposure:boolean;illuminants:{id:1|2;temperature:number}[]};
}
export interface BlackWhiteSettings {
  enabled:boolean;mixer:number[];
  base?:{preset:string;filter:string;weights:number[];gamma:number[];tint:{amount:number;hue:number}};
}
export interface SpotSettings {method:'clone'|'heal';radius:number;feather:number;opacity:number;detail:number;retainTexture?:boolean}
export interface RepairSpot extends SpotSettings {id:string;name:string;enabled:boolean;source:Point;target:Point}
export interface ParametricCurveSettings {highlights:number;lights:number;darks:number;shadows:number;splits:[number,number,number]}
export interface ColorGradingWheel {hue:number;saturation:number;luminance:number}
export interface ColorGradingSettings {shadows:ColorGradingWheel;midtones:ColorGradingWheel;highlights:ColorGradingWheel;global:ColorGradingWheel;blending:number;balance:number}
export interface DefringeSettings {purpleAmount:number;purpleHueLo:number;purpleHueHi:number;greenAmount:number;greenHueLo:number;greenHueHi:number}
export interface CalibrationSettings {redHue:number;redSaturation:number;greenHue:number;greenSaturation:number;blueHue:number;blueSaturation:number}
export interface LensProfileSettings {mode:'auto'|'manual';cameraMake:string;cameraModel:string;lens:string;distortion:boolean;vignette:boolean;ca:boolean}
export interface LensProfileStatus {cameraMake:string;cameraModel:string;lens:string;distortion:boolean;vignette:boolean;ca:boolean;reason:string}
export interface LensCatalog {cameras:{make:string;model:string}[];lenses:{make:string;name:string}[]}
export type AutoPerspectiveDirection='horizontal'|'vertical'|'both';
// Saved guide endpoints are unrotated source pixel centers normalized by W-1/H-1.
export interface PerspectiveGuide {axis:'horizontal'|'vertical';start:Point;end:Point}
export interface AutoPerspectiveRequest {id:string;sessionId:string;direction:AutoPerspectiveDirection;lines?:PerspectiveGuide[]; /* RPC lines use current display pixel centers. */ adjustments:Adjustments;artProfile:string}
export interface PerspectiveSettings {enabled:boolean;horizontal:number;vertical:number;angle:number;shear:number;focalLength:number;cropFactor:number;aspect:number}
export interface Adjustments {
  perspective?:PerspectiveSettings;
  perspectiveGuides?:PerspectiveGuide[];
  lensProfile?:LensProfileSettings;
  colorGrading?:ColorGradingSettings;
  parametricCurve?:ParametricCurveSettings;
  exposure: number; temperature: number; tint: number; contrast: number;
  saturation: number; vibrance: number; curve: Point[];
  rotation: number; crop: { x: number; y: number; width: number; height: number } | null;
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
  postCropVignetteFeather?:number;postCropVignetteRoundness?:number;
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
export function partialAdjustmentGroups(patch:AdjustmentPatch):('hsl'|'parametricCurve'|'colorGrading'|'calibration')[]{
  const groups:('hsl'|'parametricCurve'|'colorGrading'|'calibration')[]=[];
  if(patch.hsl&&['hue','saturation','luminance'].some(channel=>Array.from({length:8},(_,i)=>patch.hsl?.[channel as 'hue'|'saturation'|'luminance']?.[i]).some(value=>value===undefined)))groups.push('hsl');
  const curve=patch.parametricCurve;
  if(curve&&(['shadows','darks','lights','highlights'].some(key=>curve[key as 'shadows'|'darks'|'lights'|'highlights']===undefined)||[0,1,2].some(i=>curve.splits?.[i as 0|1|2]===undefined)))groups.push('parametricCurve');
  const grade=patch.colorGrading;
  if(grade&&(grade.blending===undefined||grade.balance===undefined||(['shadows','midtones','highlights','global'] as const).some(region=>(['hue','saturation','luminance'] as const).some(key=>grade[region]?.[key]===undefined))))groups.push('colorGrading');
  if(patch.calibration&&(['redHue','redSaturation','greenHue','greenSaturation','blueHue','blueSaturation'] as const).some(key=>patch.calibration?.[key]===undefined))groups.push('calibration');
  return groups;
}
// Resolve sparse XMP controls against the actual photo, never against preset defaults.
export function mergeAdjustmentPatch(base:Adjustments,patch:AdjustmentPatch):Adjustments{
  const {hsl,parametricCurve,colorGrading,...rest}=structuredClone(patch),next:Adjustments={...structuredClone(base),...rest};
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
  return next;
}
export interface EditDocument {
  rating?:number;
  xmpPacket?:string; warnings?:string[]; engineVersion: string; source: { path: string; size: number; sha256: string };
  artProfile: string; adjustments: Adjustments;baselineVersion?:4;
  maskAssets?:{schemaVersion:1;files:{id:string;path:string;bytes:number}[]};
  inputProfileAsset?:{id:string;path:string;bytes:number};
}
export interface ImageSession {
  rating?:number;
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
export interface CoordinateMapping {sessionId:string;revision:number;width:number;height:number;referenceAngle:number;points:({x:number;y:number}|null)[]}
export interface StraightenResult {angle:number;axis:'horizontal'|'vertical';previousAngle:number;residualDegrees:number}
export interface MaskPreview {id:string;url:string;x:number;y:number;width:number;height:number}
export type ComparisonLayout = 'off'|'left-right'|'top-bottom'|'split-vertical'|'split-horizontal';
export type ComparisonGeometry = Pick<Adjustments,'rotation'|'fineRotation'|'perspective'|'crop'|'lensCorrections'|'lensProfile'>;
export interface ComparisonSettings {adjustments:Adjustments;artProfile:string;geometry:ComparisonGeometry}
export interface PreviewFrame {
  sessionId: string; revision: number; url: string; width: number; height: number;
  fullWidth: number; fullHeight: number; kind: 'fit' | 'detail' | 'before';
  x?: number; y?: number; elapsedMs: number;
  histogram?:number[][];curveHistogram?:number[]|null;mask?:MaskPreview|null;luminance?:LuminancePreview|null;
}
export interface ExportResult {source:string;output?:string;error?:string}
export interface BatchSaveRequest {documents:{path:string;width:number;height:number;artProfile:string;adjustments:Adjustments;xmpPacket?:string;rating?:number}[]}
export interface BatchSaveResult {results:ExportResult[];cancelled:boolean}
export interface BatchExportRequest {documents:{path:string;width:number;height:number;artProfile:string;adjustments:Adjustments}[];format:'jpeg'|'tiff';colorSpace:OutputColorSpace;options?:ExportOptions}
export interface JobStatus { id: string; state: 'running' | 'done' | 'cancelled' | 'error'; progress: number; message: string; total?:number;results?:ExportResult[] }
export type EngineEvent = {event:'comparison-preview';frame:PreviewFrame} | {event:'comparison-error';sessionId:string;revision:number;message:string} | {event:'save-progress';message:string} | {event:'object-progress';id:string;message:string} | { event: 'preview'; frame: PreviewFrame } | { event: 'job'; job: JobStatus } | { event: 'error'; message: string } | {event:'synchronize-progress';message:string} | {event:'command';command:'open'|'save'|'close'};
export interface WhiteBalanceRequest {mode:'camera'|'auto'|'sample'|'preset'|'profile';preset?:string;x?:number;y?:number;size?:number;colorProfile?:ColorProfileSettings}
export interface WhiteBalanceResult {temperature:number;tint:number;wbMode:string;wbMultipliers:number[];wbApproximate:boolean;colorProfile?:ColorProfileSettings}
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
  open(path: string): Promise<ImageSession>;
  update(sessionId: string, revision: number, adjustments: Adjustments, artProfile?: string, maskId?:string, luminance?:boolean,colorSampling?:boolean): Promise<{ artProfile: string; lensStatus:LensProfileStatus }>;
  comparison(sessionId:string,revision:number,settings:ComparisonSettings|null):Promise<void>;
  comparisonViewport(sessionId:string,revision:number,x:number,y:number,width:number,height:number):Promise<void>;
  viewport(sessionId: string, revision: number, x: number, y: number, width: number, height: number): Promise<void>;
  coordinates(sessionId:string,revision:number,from:CoordinateSpace,to:CoordinateSpace,points:{x:number;y:number}[],referenceAngle?:number):Promise<CoordinateMapping>;
  // Read-only solve; endpoints are full display pixel centers, as in coordinates().
  straighten(sessionId:string,revision:number,start:Point,end:Point):Promise<StraightenResult>;
  sampleColor(sessionId:string,revision:number,start:Point,end?:Point):Promise<{l:number;c:number;h:number;pixels:number;revision:number}>;
  sampleLuminance(sessionId:string,revision:number,start:Point,end?:Point):Promise<LuminanceSample>;
  whiteBalance(sessionId:string,request:WhiteBalanceRequest):Promise<WhiteBalanceResult>;
  save(session: ImageSession, artProfile: string): Promise<string>;
  saveSelected(request:BatchSaveRequest):Promise<BatchSaveResult|null>;
  cancelSave():Promise<void>;
  export(sessionId: string, artProfile: string, format: 'jpeg' | 'tiff', colorSpace?:OutputColorSpace,options?:ExportOptions): Promise<string | null>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  confirmClose(name:string):Promise<'save'|'discard'|'cancel'>;
  setDirty(paths:string[]):Promise<void>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
}
declare global { interface Window { captraw: CaptRAWAPI; } }
export const ENGINE_VERSION='CaptRAW-26_ART-1.26.10_LibRaw-3b20539';
// Older XMP retains its profile-wide reference. Version 22 protects independent
// spatial leaf references from renderers that would silently ignore them.
export const READABLE_ENGINE_VERSIONS:ReadonlySet<string>=new Set([ENGINE_VERSION,'CaptRAW-25_ART-1.26.10_LibRaw-3b20539','CaptRAW-24_ART-1.26.10_LibRaw-3b20539','CaptRAW-23_ART-1.26.10_LibRaw-3b20539','CaptRAW-22_ART-1.26.10_LibRaw-3b20539','CaptRAW-21_ART-1.26.10_LibRaw-3b20539','CaptRAW-20_ART-1.26.10_LibRaw-3b20539']);

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
