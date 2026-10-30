import {useEffect,useRef,useState} from 'react';
import type {PerspectiveGuide,PerspectiveSettings,Point,PreviewFrame} from '@captraw/contracts';
import type {DocumentState} from './workbench/model';
import {rotatePoint,type CanvasEditTransaction} from '../lib/geometry';

interface Props {document?:DocumentState;frame?:PreviewFrame;enabled:boolean;busy:boolean;begin:(id:string,revision:number,label:string)=>CanvasEditTransaction|null;done:()=>void;error:(message:string)=>void}
interface Line extends PerspectiveGuide {source:PerspectiveGuide}
interface Drag {index:number;end:'start'|'end';line:PerspectiveGuide;origin:Point;last:Point;scale:number}
export function useGuidedPerspective(p:Props){
 const latest=useRef(p);latest.current=p;
 const session=useRef<{id:string;token:CanvasEditTransaction}|undefined>(undefined),drag=useRef<Drag|undefined>(undefined),items=useRef<Line[]>([]),epoch=useRef(0);
 const awaiting=useRef<{sessionId:string;revision:number}|undefined>(undefined);
 const [loupe,setLoupe]=useState(true);
 const [lines,setLines]=useState<Line[]>([]),[draft,setDraft]=useState<Drag>(),[selected,setSelected]=useState(-1),[pending,setPending]=useState(false),[ready,setReady]=useState(false),[failed,setFailed]=useState(false);
 const assign=(next:Line[])=>{items.current=next;setLines(next);};
 function clear(){++epoch.current;const job=session.current;session.current=undefined;job?.token.release();if(job)void window.captraw.cancelAutoPerspective(job.id).catch(e=>latest.current.error(String(e)));drag.current=undefined;setDraft(undefined);setPending(false);setFailed(false);}
 function cancel(){awaiting.current=undefined;clear();p.done();}
 function transaction(){
  if(session.current)return session.current;
  if(!p.enabled||p.busy||!p.document||!p.frame||!ready||awaiting.current)return;
  const token=p.begin(p.document.image.id,p.frame.revision,'引导透视');
  if(!token){p.error('请等待当前预览完成后再绘制引导线。');return;}
  return session.current={id:crypto.randomUUID(),token};
 }
 const valid=(job:NonNullable<typeof session.current>)=>session.current===job&&job.token.valid()&&latest.current.enabled;
 useEffect(()=>{
  clear();assign([]);setReady(false);
  if(!p.enabled||!p.document||!p.frame){awaiting.current=undefined;setSelected(-1);return;}
  const wait=awaiting.current;
  if(wait?.sessionId!==p.document.image.id)awaiting.current=undefined;
  else if(p.frame.revision<wait.revision)return;
  else awaiting.current=undefined;
  if(p.busy)return;
  const generation=epoch.current,frame=p.frame,rotation=p.document.adjustments.rotation;
  const source=p.document.adjustments.perspectiveGuides||[];
  const points=source.flatMap(g=>[g.start,g.end]).map(point=>{const q=rotatePoint(point,rotation);return {x:q.x*(frame.fullWidth-1),y:q.y*(frame.fullHeight-1)};});
  void (async()=>{
   const result=points.length?await window.captraw.coordinates(frame.sessionId,frame.revision,'source','display',points):undefined;
   if(generation!==epoch.current)return;
   if(result?.points.some(q=>!q))throw Error('引导线无法映射到当前照片。请先恢复几何设置后重试。');
   assign(source.map((g,i)=>({source:g,axis:rotation%180?(g.axis==='horizontal'?'vertical':'horizontal'):g.axis,start:result!.points[i*2]!,end:result!.points[i*2+1]!})));setSelected(i=>i<source.length?i:-1);setReady(true);
  })().catch(e=>{if(generation===epoch.current)p.error(String(e));});
 },[p.enabled,p.document?.image.id,p.document?.adjustments,p.document?.profileId,p.frame?.revision,p.busy]);
 useEffect(()=>()=>{++epoch.current;const job=session.current;session.current=undefined;job?.token.release();if(job)void window.captraw.cancelAutoPerspective(job.id).catch(()=>{});},[]);
 const bound=(q:Point)=>({x:Math.max(0,Math.min((p.frame?.fullWidth||1)-1,q.x)),y:Math.max(0,Math.min((p.frame?.fullHeight||1)-1,q.y))});
 function begin(at:Point,scale:number){
  if(!ready||pending||drag.current)return false;
  let index=-1,end:'start'|'end'='end',distance=9;
  items.current.forEach((g,i)=>(['start','end'] as const).forEach(key=>{const d=Math.hypot(g[key].x-at.x,g[key].y-at.y)*scale;if(d<distance){index=i;end=key;distance=d;}}));
  if(index<0&&items.current.length>=4){p.error('最多四条引导线；可拖动端点或删除选中的线。');return false;}
  if(!transaction())return false;
  const q=bound(at),line=index<0?{axis:'vertical' as const,start:q,end:q}:items.current[index];
  drag.current={index,end,line:{axis:line.axis,start:line.start,end:line.end},origin:q,last:at,scale};setDraft(drag.current);setSelected(index);return true;
 }
 function move(at:Point,precision=false){const d=drag.current;if(!d)return;const factor=precision ? .25 : 1,q=d.line[d.end];d.line={...d.line,[d.end]:bound({x:q.x+(at.x-d.last.x)*factor,y:q.y+(at.y-d.last.y)*factor})};d.last=at;setDraft({...d});}
 function persist(job:NonNullable<typeof session.current>,current:Line[],result?:PerspectiveSettings){
  if(!valid(job))return;
  const doc=latest.current.document!,next={...doc.adjustments,perspectiveGuides:current.map(g=>g.source),...(result?{perspective:result}:{})};
  const changed=JSON.stringify(next)!==JSON.stringify(doc.adjustments);
  clear();
  if(changed){awaiting.current={sessionId:job.token.sessionId,revision:job.token.revision+1};setReady(false);}
  if(!job.token.apply(()=>next)){awaiting.current=undefined;setReady(false);}
 }
 async function correct(current:Line[],job:NonNullable<typeof session.current>){
  if(!valid(job))return;
  const horizontal=current.filter(g=>g.axis==='horizontal').length,vertical=current.length-horizontal;
  setPending(true);setFailed(false);p.error('');
  try{
   if(horizontal>2||vertical>2)throw Error('水平和垂直各最多两条，请删除多余的同向引导线后重画。本次操作尚未保存。');
   if(horizontal<2&&vertical<2){persist(job,current);return;}
   const result=await window.captraw.autoPerspective({id:job.id,sessionId:job.token.sessionId,direction:horizontal&&vertical?'both':horizontal?'horizontal':'vertical',lines:current.map(({axis,start,end})=>({axis,start,end})),adjustments:latest.current.document!.adjustments,artProfile:latest.current.document!.profile});
   if(result&&valid(job))persist(job,current,result);
  }catch(e){if(valid(job)){setPending(false);setFailed(true);p.error(`${String(e)} 可修正引导线后重试，或按 Esc 取消本次操作。`);}}
 }
 async function end(at:Point,precision=false){
  const d=drag.current,job=session.current;if(!d||!job)return;move(at,precision);drag.current=undefined;
  const generation=epoch.current,frame=p.frame!;
  if(Math.hypot(d.line.end.x-d.line.start.x,d.line.end.y-d.line.start.y)*d.scale<4||(d.index>=0&&Math.hypot(at.x-d.origin.x,at.y-d.origin.y)*d.scale<.1)){setDraft(undefined);if(!failed)clear();return;}
  if(d.index<0)d.line.axis=Math.abs(d.line.end.x-d.line.start.x)>=Math.abs(d.line.end.y-d.line.start.y)?'horizontal':'vertical';
  setPending(true);
  try{
   const result=await window.captraw.coordinates(job.token.sessionId,job.token.revision,'display','source',[d.line.start,d.line.end]);
   if(!valid(job)||generation!==epoch.current)return;
   if(result.points.some(q=>!q))throw Error('引导线无法映射，请换一条图像内的边缘。');
   const rotation=p.document!.adjustments.rotation,points=result.points.map(q=>rotatePoint({x:q!.x/(frame.fullWidth-1),y:q!.y/(frame.fullHeight-1)},-rotation));
   const line={...d.line,source:{axis:rotation%180?(d.line.axis==='horizontal'?'vertical' as const:'horizontal' as const):d.line.axis,start:points[0],end:points[1]}};
   const next=[...items.current],index=d.index<0?next.length:d.index;next[index]=line;assign(next);setSelected(index);setDraft(undefined);
   await correct(next,job);
  }catch(e){if(valid(job)){setDraft(undefined);setPending(false);setFailed(true);p.error(String(e));}}
 }
 function retry(){if(pending||drag.current)return;const job=transaction();if(job)void correct(items.current,job);}
 function remove(){
  if(pending||selected<0)return;const job=transaction();if(!job)return;
  const next=items.current.filter((_,i)=>i!==selected);assign(next);setSelected(-1);void correct(next,job);
 }
 function finish(){if(pending||drag.current||!ready)return;if(failed)retry();else cancel();}
 return {enabled:p.enabled,loupe,setLoupe,lines,draft,selected,select:setSelected,pending,ready,failed,begin,move,end,active:()=>!!drag.current,cancel,finish,retry,remove};
}
