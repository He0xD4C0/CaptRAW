import {useEffect,useRef,useState} from 'react';
import type {Adjustments,LocalMask,MaskGeometry,Point} from '@captraw/contracts';
import {rotatePoint} from './geometry';

export interface MaskEditTransaction {
  sessionId:string;revision:number;valid:()=>boolean;apply:(mask:MaskGeometry)=>boolean;release:()=>void;
}
export type MaskHandle='start'|'end'|'move';
interface Props {
  sessionId?:string;revision?:number;mask?:LocalMask;componentId?:string;tool:string;
  adjustments?:Adjustments;width:number;height:number;rotation:number;radius:number;
  begin:(sessionId:string,revision:number,maskId:string,componentId?:string)=>MaskEditTransaction|null;
  error:(message:string)=>void;
}
interface Gesture {
  token:MaskEditTransaction;original:LocalMask;draft:LocalMask;handle?:MaskHandle;
  paint:boolean;first:Point;previous:Point;latest:Point;pending:Point[];strokes:Point[];screen:Point[];
  width:number;height:number;rotation:number;radius:number;reference?:number;
  running:boolean;dirty:boolean;closed:boolean;
}
// Drafts never enter document history or change the native revision. A single
// request drains ordered brush samples, or the latest absolute shape position.
export function useMaskGesture(p:Props){
  const active=useRef<Gesture|undefined>(undefined);
  const [draft,setDraft]=useState<LocalMask>(),[screen,setScreen]=useState<Point[]>([]),[pending,setPending]=useState(false);
  function clear(){active.current?.token.release();active.current=undefined;setDraft(undefined);setScreen([]);setPending(false);}
  useEffect(()=>{clear();},[p.sessionId,p.componentId,p.mask?.id,p.tool,p.adjustments]);
  useEffect(()=>()=>{active.current?.token.release();active.current=undefined;},[]);
  const valid=(g:Gesture)=>active.current===g&&g.token.valid();
  async function pump(g:Gesture):Promise<void>{
    if(g.running||active.current!==g)return;
    if(!g.token.valid()){clear();return;}
    const points=g.paint?g.pending.splice(0,4096):g.dirty?[g.first,g.latest]:[];g.dirty=false;
    if(!points.length){
      if(g.closed){const next=g.draft;clear();g.token.apply(next);}return;
    }
    g.running=true;
    try{
      const result=await window.captraw.coordinates(g.token.sessionId,g.token.revision,'display','reference',
        points.map(q=>({x:q.x*g.width,y:q.y*g.height})),g.reference);
      if(!valid(g)){if(active.current===g)clear();return;}
      if(result.width!==g.width||result.height!==g.height)throw new Error('照片尺寸已变化，请重新绘制蒙版。');
      const mapped=result.points.map((q,i)=>{
        if(!q)throw new Error('无法映射此位置，当前笔画未保存。');
        const value=rotatePoint({x:q.x/g.width,y:q.y/g.height},-g.rotation);
        if(value.x<0||value.x>1||value.y<0||value.y>1)throw new Error('当前位置超出蒙版参考画布，当前操作未保存。');
        return {...points[i],...value};
      });
      g.reference=result.referenceAngle;
      if(g.paint){g.strokes.push(...mapped);g.draft={...g.original,points:[...g.original.points,...g.strokes]};}
      else{
        const [first,last]=mapped;let start=first,end=last;
        if(g.handle==='move'){
          const old=g.original;
          const dx=Math.max(-Math.min(old.start.x,old.end.x),Math.min(1-Math.max(old.start.x,old.end.x),last.x-first.x));
          const dy=Math.max(-Math.min(old.start.y,old.end.y),Math.min(1-Math.max(old.start.y,old.end.y),last.y-first.y));
          start={x:old.start.x+dx,y:old.start.y+dy};end={x:old.end.x+dx,y:old.end.y+dy};
        }else if(g.handle){
          const old=g.original[g.handle],next={x:Math.max(0,Math.min(1,old.x+last.x-first.x)),y:Math.max(0,Math.min(1,old.y+last.y-first.y))};
          start=g.handle==='start'?next:g.original.start;end=g.handle==='end'?next:g.original.end;
        }
        g.draft={...g.original,start,end};
      }
      g.draft={...g.draft,referenceAngle:g.reference,initialized:true};setDraft(g.draft);
    }catch(error){
      if(active.current===g){const current=g.token.valid();clear();if(current)p.error(String(error));}
    }finally{g.running=false;if(active.current===g)void pump(g);}
  }
  function append(g:Gesture,at:Point,erase:boolean){
    if(at.x===g.previous.x&&at.y===g.previous.y&&(g.paint?g.screen.length>0&&g.screen.at(-1)?.erase===erase:!!g.handle))return;
    if(g.paint){
      const distance=Math.hypot((at.x-g.previous.x)*g.width,(at.y-g.previous.y)*g.height);
      const spacing=Math.max(1,g.radius*.1*Math.min(g.width,g.height)*.25),count=Math.min(1000,Math.max(1,Math.ceil(distance/spacing)));
      const points=Array.from({length:count},(_,i)=>{const amount=(i+1)/count;return {x:g.previous.x+(at.x-g.previous.x)*amount,y:g.previous.y+(at.y-g.previous.y)*amount,radius:g.radius,erase};});
      g.pending.push(...points);g.screen.push(...points);setScreen([...g.screen]);
    }else{g.latest=at;g.dirty=true;}
    g.previous=at;void pump(g);
  }
  function begin(at:Point,handle:MaskHandle|undefined,erase:boolean){
    if(active.current){p.error('上一笔蒙版正在应用，请稍后继续。');return false;}
    if(!p.sessionId||p.revision===undefined||!p.mask)return false;
    const token=p.begin(p.sessionId,p.revision,p.mask.id,p.componentId);
    if(!token){p.error('请等待当前照片预览完成后再绘制。');return false;}
    const original=structuredClone(p.mask),paint=p.tool==='brush'||p.tool==='eraser';
    const g:Gesture={token,original,draft:original,handle,paint,first:at,previous:at,latest:at,pending:[],strokes:[],screen:[],
      width:p.width,height:p.height,rotation:p.rotation,radius:p.radius,reference:original.referenceAngle,running:false,dirty:false,closed:false};
    active.current=g;setDraft(original);setPending(true);append(g,at,erase);return true;
  }
  function move(at:Point,erase:boolean){const g=active.current;if(g&&!g.closed)append(g,at,erase);}
  function end(at:Point,erase:boolean){const g=active.current;if(g&&!g.closed){append(g,at,erase);g.closed=true;void pump(g);}}
  return {draft,screen,pending,active:()=>!!active.current,begin,move,end,cancel:clear};
}
