import {dirty,snapshot,type DocumentState,type HistoryState} from './model';

export interface HistoryTransition {documents:DocumentState[];operationId?:string;changed:boolean;sequence:number}

export function undoDocuments(documents:DocumentState[],targets:Set<string>,redo:boolean,sequence:number):HistoryTransition{
  const candidates=documents.filter(document=>targets.has(document.image.path)&&(redo?document.future:document.past).length);
  const selected=candidates.sort((a,b)=>((redo?b.future:b.past).at(-1)?.sequence??0)-((redo?a.future:a.past).at(-1)?.sequence??0))[0];
  if(!selected)return {documents,changed:false,sequence};
  const operationId=(redo?selected.future:selected.past).at(-1)?.operationId;
  let nextSequence=sequence;
  const next=documents.map(document=>{
    if(!targets.has(document.image.path)||(operationId?(redo?document.future:document.past).at(-1)?.operationId!==operationId:document.image.path!==selected.image.path))return document;
    const stack=redo?document.future:document.past;if(!stack.length)return document;
    const target=stack.at(-1)!;
    const inverse:HistoryState={...snapshot(document),operationId:target.operationId,sequence:++nextSequence};
    if('before' in target)inverse.before=document.before?structuredClone(document.before):null;
    const restored=snapshot(target);if(JSON.stringify(restored.adjustments)===JSON.stringify(document.adjustments))restored.adjustments=document.adjustments;
    return {...document,...restored,...('before' in target?{before:target.before?structuredClone(target.before):undefined}:{}),past:redo?[...document.past,inverse]:document.past.slice(0,-1),future:redo?document.future.slice(0,-1):[...document.future,inverse],dirty:dirty({...document,rating:target.rating,label:target.label},target.adjustments,target.profileId)};
  });
  return {documents:next,operationId,changed:true,sequence:nextSequence};
}
