import {useEffect,useRef,useState} from 'react';
import type {Adjustments,Point} from '@captraw/contracts';
import {rotatePoint,type CanvasEditTransaction} from '../lib/geometry';

interface Props {
  sessionId?:string;revision?:number;adjustments?:Adjustments;tool:string;maskId?:string;componentId?:string;
  width:number;height:number;rotation:number;scale:number;viewKey:string;
  begin:(sessionId:string,revision:number,label:string)=>CanvasEditTransaction|null;
  sample:(start:Point,end:Point|undefined,append:boolean,transaction:CanvasEditTransaction)=>Promise<void>;
  cancelSample:()=>void;error:(message:string)=>void;
}
interface Gesture {token:CanvasEditTransaction;start:Point;end:Point;append:boolean;original:Props;closed:boolean}
export function useRangeGesture(p:Props){
  const active=useRef<Gesture|undefined>(undefined),latest=useRef(p);latest.current=p;
  const [box,setBox]=useState<{start:Point;end:Point}>(),[pending,setPending]=useState(false);
  const valid=(g:Gesture)=>active.current===g&&g.token.valid()&&latest.current.tool===g.original.tool&&
    latest.current.maskId===g.original.maskId&&latest.current.componentId===g.original.componentId&&latest.current.viewKey===g.original.viewKey;
  function clear(){active.current?.token.release();active.current=undefined;setBox(undefined);setPending(false);}
  function cancel(){if(active.current){p.cancelSample();clear();}}
  useEffect(()=>{const g=active.current;if(g&&!valid(g))cancel();},[p.sessionId,p.revision,p.adjustments,p.tool,p.maskId,p.componentId,p.viewKey]);
  useEffect(()=>()=>{active.current?.token.release();active.current=undefined;},[]);
  function begin(at:Point,append:boolean){
    if(active.current||!['color','luminance'].includes(p.tool)||!p.sessionId||p.revision===undefined)return false;
    const token=p.begin(p.sessionId,p.revision,'范围取样');
    if(!token){p.error('请等待当前照片预览完成后再取样。');return false;}
    active.current={token,start:at,end:at,append,original:p,closed:false};setBox({start:at,end:at});return true;
  }
  function move(at:Point){const g=active.current;if(!g||g.closed)return;g.end=at;setBox({start:g.start,end:at});}
  async function end(at:Point){
    const g=active.current;if(!g||g.closed)return;move(at);g.closed=true;
    if(!valid(g)){cancel();return;}
    const a=rotatePoint(g.start,g.original.rotation),b=rotatePoint(g.end,g.original.rotation);
    const area=Math.hypot((a.x-b.x)*g.original.width,(a.y-b.y)*g.original.height)*g.original.scale>3;
    setPending(true);
    const transaction={...g.token,valid:()=>valid(g),apply:(change:(a:Adjustments)=>Adjustments)=>valid(g)&&g.token.apply(change)};
    try{await g.original.sample(g.start,area?g.end:undefined,g.append,transaction);}
    catch(error){if(valid(g))p.error(String(error));}
    finally{if(active.current===g)clear();}
  }
  return {box,pending,active:()=>!!active.current,begin,move,end,cancel};
}
