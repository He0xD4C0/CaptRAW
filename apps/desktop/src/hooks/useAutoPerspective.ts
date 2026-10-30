import {useEffect,useRef,useState} from 'react';
import type {AutoPerspectiveDirection,PreviewFrame} from '@captraw/contracts';
import type {DocumentState} from './workbench/model';
import type {CanvasEditTransaction} from '../lib/geometry';

interface Props {document?:DocumentState;frame?:PreviewFrame;enabled:boolean;busy:boolean;begin:(id:string,revision:number,label:string)=>CanvasEditTransaction|null;error:(message:string)=>void}
export function useAutoPerspective(p:Props){
 const current=useRef<{id:string;token:CanvasEditTransaction}|undefined>(undefined),latest=useRef(p);latest.current=p;
 const [pending,setPending]=useState(false);
 function cancel(){const job=current.current;if(!job)return;current.current=undefined;job.token.release();setPending(false);void window.captraw.cancelAutoPerspective(job.id).catch(e=>p.error(String(e)));}
 useEffect(()=>{const job=current.current;if(job&&(!p.enabled||!job.token.valid()))cancel();},[p.document?.image.id,p.document?.adjustments,p.document?.profileId,p.frame?.revision,p.enabled]);
 useEffect(()=>()=>{const job=current.current;if(job){current.current=undefined;job.token.release();void window.captraw.cancelAutoPerspective(job.id).catch(()=>{});}},[]);
 async function run(direction:AutoPerspectiveDirection){
  if(current.current||!p.enabled||p.busy||!p.document||!p.frame)return;
  const token=p.begin(p.document.image.id,p.frame.revision,'自动透视');if(!token){p.error('请等待当前预览完成后再自动校正。');return;}
  const job={id:crypto.randomUUID(),token};current.current=job;setPending(true);p.error('');
  try{
   const result=await window.captraw.autoPerspective({id:job.id,sessionId:token.sessionId,direction,adjustments:p.document.adjustments,artProfile:p.document.profile});
   if(current.current!==job||!latest.current.enabled||!token.valid())return;
   if(result)token.apply(a=>({...a,perspective:result}));
  }catch(error){if(current.current===job&&token.valid())p.error(String(error));}
  finally{if(current.current===job){current.current=undefined;token.release();setPending(false);}}
 }
 return {run,cancel,pending,disabled:!p.enabled||p.busy};
}
