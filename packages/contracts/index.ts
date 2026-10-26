export type Point = { x: number; y: number; radius?: number; erase?: boolean };
export type MaskType = 'brush' | 'linear' | 'radial';
export interface MaskGeometry {
  id: string; name: string; type: MaskType; enabled: boolean; inverted: boolean;
  feather: number;
  points: Point[]; start: Point; end: Point;
  initialized?:boolean;
}
export interface MaskComponent extends MaskGeometry {operation:'add'|'subtract'|'intersect'}
export interface LocalMask extends MaskGeometry {
  brightness:number;contrast:number;saturation:number;
  components?:MaskComponent[];
}
export interface ColorProfileSettings {
  mode:'auto'|'matrix'|'embedded'|'inherited';
  reference?:string;
  toneCurve:boolean;lookTable:boolean;hueSatMap:boolean;baselineExposure:boolean;illuminant:0|1|2;
}
export interface InputProfileOption {
  id:ColorProfileSettings['mode'];name:string;kind:'dcp'|'icc'|'matrix'|'srgb';
  dcp?:{toneCurve:boolean;lookTable:boolean;hueSatMap:boolean;baselineExposure:boolean;illuminants:{id:1|2;temperature:number}[]};
}
export interface Adjustments {
  exposure: number; temperature: number; tint: number; contrast: number;
  saturation: number; vibrance: number; curve: Point[];
  rotation: number; crop: { x: number; y: number; width: number; height: number } | null;
  masks: LocalMask[];
  wbMode?:string;wbMultipliers?:number[]|null;wbApproximate?:boolean;
  colorProfile?:ColorProfileSettings;
  highlights?:number;shadows?:number;whites?:number;blacks?:number;
  sharpening?:number;sharpenRadius?:number;luminanceNoise?:number;colorNoise?:number;
  dehaze?:number;vignette?:number;grain?:number;
  lensCorrections?:boolean;
  redCurve?:Point[];greenCurve?:Point[];blueCurve?:Point[];
  hsl?:{hue:number[];saturation:number[];luminance:number[]};
}
export interface RecipeV1 {
  schemaVersion: 1; engineVersion: string; source: { path: string; size: number; sha256: string };
  artProfile: string; adjustments: Adjustments;baselineVersion?:2|3;
}
export interface ImageSession {
  id: string; path: string; name: string; width: number; height: number;
  camera: string; lens: string; iso: number; adjustments: Adjustments; recipe?: RecipeV1;
  initialAdjustments?: Adjustments;
  baselineVersion?:2|3;whiteBalancePresets?:{id:string;name:string}[];
  inputProfiles?:InputProfileOption[];
  aperture?:number;shutter?:number;focalLength?:number;
}
export interface MaskPreview {id:string;url:string;x:number;y:number;width:number;height:number}
export interface PreviewFrame {
  sessionId: string; revision: number; url: string; width: number; height: number;
  fullWidth: number; fullHeight: number; kind: 'fit' | 'detail' | 'before';
  x?: number; y?: number; elapsedMs: number;
  histogram?:number[][];mask?:MaskPreview|null;
}
export interface JobStatus { id: string; state: 'running' | 'done' | 'cancelled' | 'error'; progress: number; message: string; }
export type EngineEvent = { event: 'preview'; frame: PreviewFrame } | { event: 'job'; job: JobStatus } | { event: 'error'; message: string } | {event:'command';command:'open'|'save'|'close'};
export interface WhiteBalanceRequest {mode:'camera'|'auto'|'sample'|'preset';preset?:string;x?:number;y?:number;size?:number}
export interface WhiteBalanceResult {temperature:number;tint:number;wbMode:string;wbMultipliers:number[];wbApproximate:boolean}
export interface CaptRAWAPI {
  chooseFiles(): Promise<string[]>;
  droppedFiles(files: File[]): string[];
  open(path: string,baselineVersion?:2|3): Promise<ImageSession>;
  update(sessionId: string, revision: number, adjustments: Adjustments, artProfile?: string, maskId?:string): Promise<{ artProfile: string }>;
  viewport(sessionId: string, revision: number, x: number, y: number, width: number, height: number): Promise<void>;
  whiteBalance(sessionId:string,request:WhiteBalanceRequest):Promise<WhiteBalanceResult>;
  before(sessionId: string, revision: number): Promise<void>;
  save(session: ImageSession, artProfile: string): Promise<string>;
  export(sessionId: string, artProfile: string, format: 'jpeg' | 'tiff'): Promise<string | null>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  confirmClose(name:string):Promise<'save'|'discard'|'cancel'>;
  setDirty(paths:string[]):Promise<void>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
}
declare global { interface Window { captraw: CaptRAWAPI; } }
export const ENGINE_VERSION='CaptRAW-4_ART-1.26.10_LibRaw-3b20539';
