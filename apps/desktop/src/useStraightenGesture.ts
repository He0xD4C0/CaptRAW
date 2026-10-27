import {useEffect,useRef,useState} from 'react';
import type {Adjustments,Point} from '@captraw/contracts';
import type {CanvasEditTransaction} from './geometry';

interface Props {
  sessionId?:string;revision?:number;adjustments?:Adjustments;enabled:boolean;
  width:number;height:number;scale:number;viewKey:string;
  begin:(sessionId:string,revision:number,label:string)=>CanvasEditTransaction|null;
  done:()=>void;error:(message:string)=>void;
}
interface Gesture {token:CanvasEditTransaction;start:Point;end:Point;original:Props;closed:boolean}
export function useStraightenGesture(p:Props){
  const active=useRef<Gesture|undefined>(undefined),latest=useRef(p);latest.current=p;
  const [line,setLine]=useState<{start:Point;end:Point}>(),[pending,setPending]=useState(false);
  function clear(){active.current?.token.release();active.current=undefined;setLine(undefined);setPending(false);}
  const valid=(g:Gesture)=>active.current===g&&g.token.valid()&&latest.current.enabled&&
    latest.current.sessionId===g.original.sessionId&&latest.current.viewKey===g.original.viewKey;
  useEffect(()=>{const g=active.current;if(g&&!valid(g))clear();},[p.sessionId,p.revision,p.adjustments,p.enabled,p.viewKey]);
  useEffect(()=>()=>{active.current?.token.release();active.current=undefined;},[]);
  const bound=(at:Point)=>({x:Math.max(-.5,Math.min(p.width-.5,at.x)),y:Math.max(-.5,Math.min(p.height-.5,at.y))});
  function begin(at:Point){
    if(active.current||!p.enabled||!p.sessionId||p.revision===undefined)return false;
    const token=p.begin(p.sessionId,p.revision,'拉直操作');
    if(!token){p.error('请等待当前照片预览完成后再拉直。');return false;}
    const start=bound(at);active.current={token,start,end:start,original:p,closed:false};setLine({start,end:start});return true;
  }
  function move(at:Point){const g=active.current;if(!g||g.closed)return;g.end=bound(at);setLine({start:g.start,end:g.end});}
  async function end(at:Point){
    const g=active.current;if(!g||g.closed)return;
    move(at);g.closed=true;
    if(!valid(g)||Math.hypot(g.end.x-g.start.x,g.end.y-g.start.y)*g.original.scale<4){clear();return;}
    setPending(true);
    try{
      const result=await window.captraw.straighten(g.token.sessionId,g.token.revision,g.start,g.end);
      if(!valid(g)){if(active.current===g)clear();return;}
      clear();
      if(g.token.apply(a=>({...a,fineRotation:result.angle})))g.original.done();
    }catch(error){if(active.current===g){const current=valid(g);clear();if(current)p.error(String(error));}}
  }
  return {line,pending,active:()=>!!active.current,begin,move,end,cancel:clear};
}
