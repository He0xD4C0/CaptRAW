import {useEffect,useRef,useState} from 'react';
import type {Adjustments,PreviewFrame} from '@captraw/contracts';
import type {DocumentState} from './useWorkbench';

// The preview process never changes the document or participates in its history.
export function usePresetPreview(active:DocumentState|undefined){
 const [preview,setPreview]=useState<{frame:PreviewFrame;adjustments:Adjustments}>(),[pending,setPending]=useState(false),[error,setError]=useState('');
 const current=useRef(active);current.current=active;
 const token=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),queue=useRef<Promise<unknown>>(Promise.resolve());
 function cancel(){
  ++token.current;clearTimeout(timer.current);setPreview(undefined);setPending(false);setError('');
  const stopping=window.captraw.cancelPresetPreview().catch(()=>{});
  queue.current=Promise.allSettled([queue.current,stopping]);return queue.current;
 }
 function show(id:string,amount:number){
  const doc=current.current;if(!doc)return;
  void cancel();const revision=++token.current;clearTimeout(timer.current);setPreview(undefined);setError('');
  timer.current=setTimeout(()=>{
   queue.current=queue.current.catch(()=>{}).then(async()=>{
    if(revision!==token.current)return;
    setPending(true);
    try{
     const result=await window.captraw.previewPreset({id,amount,revision,target:{image:doc.image,adjustments:structuredClone(doc.adjustments),profile:doc.profile}});
     if(revision!==token.current||current.current?.image.id!==doc.image.id||current.current.adjustments!==doc.adjustments||current.current.profileId!==doc.profileId)return;
     const value=result?.results[0];
     if(value?.frame)setPreview({frame:{...value.frame,sessionId:doc.image.id},adjustments:value.adjustments});
    }catch(error){if(revision===token.current)setError(String(error));}
    finally{if(revision===token.current)setPending(false);}
   });
  },220);
 }
 useEffect(()=>{void cancel();},[active?.image.id,active?.adjustments,active?.profileId]);
 useEffect(()=>()=>{clearTimeout(timer.current);++token.current;void window.captraw.cancelPresetPreview();},[]);
 return {preview,pending,error,show,cancel};
}
