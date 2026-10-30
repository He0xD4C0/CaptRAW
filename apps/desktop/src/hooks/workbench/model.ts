import type {Adjustments,ImageSession} from '@captraw/contracts';

export interface EditingState {adjustments:Adjustments;profile:string;profileId:number;rating?:number;label?:string}
export type HistoryState=EditingState&{before?:EditingState|null;operationId?:string;sequence?:number};
export interface DocumentState extends EditingState {
  xmpPacket?:string;
  nativePacket?:string;
  needsNativeSave?:boolean;
  image:ImageSession;
  initial:Adjustments;
  dirty:boolean;
  saved:Adjustments;
  savedProfileId:number;
  savedRating?:number;
  savedLabel?:string;
  opened?:EditingState;
  before?:EditingState;
  past:HistoryState[];
  future:HistoryState[];
  thumbnail?:string;
  previewToken?:string;
  thumbnailFrame?:string;
}

export const copy=<T,>(value:T):T=>structuredClone(value);
export const snapshot=(d:EditingState):EditingState=>copy({adjustments:d.adjustments,profile:d.profile,profileId:d.profileId,rating:d.rating,label:d.label});
export const dirty=(d:DocumentState,a:Adjustments=d.adjustments,profileId=d.profileId,rating=d.rating,label=d.label)=>!!d.needsNativeSave||profileId!==d.savedProfileId||JSON.stringify(a)!==JSON.stringify(d.saved)||rating!==d.savedRating||label!==d.savedLabel;
export const historySnapshot=(d:EditingState,operationId:string,sequence:number):HistoryState=>({...snapshot(d),operationId,sequence});
