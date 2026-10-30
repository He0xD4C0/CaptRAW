import type {BrowserWindow} from 'electron';
import type {
  AutoPerspective,
  BrushPreparation,
  CurveSampling,
  ObjectSelection,
} from '@captraw/desktop-core/editing';
import type {NativeEngine} from '@captraw/desktop-core/engine';
import type {
  BatchDocumentSaver,
  Documents,
  SessionDocumentSaver,
  XMP,
} from '@captraw/desktop-core/documents';
import type {InputProfiles} from '@captraw/desktop-core/profiles';
import type {Presets,PresetPreview,Synchronizer} from '@captraw/desktop-core/presets';
import type {BatchExporter} from '@captraw/desktop-core/export';
import type {EngineEvent,ImageSession,SourceIdentity} from '@captraw/contracts';

export type OpenDocument=Awaited<ReturnType<Documents['readForImage']>>;
export interface MainRuntime {
  win:BrowserWindow;
  binary:string;
  resources:string;
  cache:string;
  send:(event:EngineEvent)=>void;
  session:ImageSession|undefined;
  engine:NativeEngine|undefined;
  openingEngine:NativeEngine|undefined;
  comparisonEngine:NativeEngine|undefined;
  comparisonSequence:number;
  comparisonFrames:Map<string,string>;
  autoPerspective:AutoPerspective;
  curveSampling:CurveSampling|undefined;
  exporter:NativeEngine|undefined;
  exportCancelled:boolean;
  exportTemp:string|undefined;
  exportPending:boolean;
  savePending:boolean;
  openingImage:boolean;
  quitting:boolean;
  dirtyCount:number;
  dirtyPaths:Set<string>;
  frames:Map<string,string>;
  openingDocuments:Map<string,{loaded:OpenDocument|undefined;recipeFile:string}>;
  documents:Documents;
  batchSaver:BatchDocumentSaver;
  sessionSaver:SessionDocumentSaver;
  inputProfiles:InputProfiles;
  presets:Presets;
  presetPreview:PresetPreview;
  synchronizer:Synchronizer;
  objects:ObjectSelection;
  brushes:BrushPreparation;
  batchExporter:BatchExporter;
  xmp:XMP;
  brushSnapshot:{sessionId:string;revision:number;adjustments:import('@captraw/contracts').Adjustments;artProfile:string}|undefined;
  native():NativeEngine;
  requireSession(id:string):ImageSession;
  openImage(path:string,expectedSource?:SourceIdentity):Promise<ImageSession>;
  stopComparison():void;
}
