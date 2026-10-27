import {useEffect,useRef,useState} from 'react';
import type {Adjustments,Point,RepairSpot,SpotSettings} from '@captraw/contracts';
import type {CanvasEditTransaction} from './geometry';
import {repairNormalizedPoint} from './repairGeometry';

export interface RepairInteraction {
  source?:Point;selectingSource:boolean;selectedId:string;guides:boolean;settings:SpotSettings;
  pick:(point:Point,source:boolean,transaction:CanvasEditTransaction)=>void;
  select:(id:string)=>void;
}
interface Props {
  sessionId?:string;revision?:number;adjustments?:Adjustments;tool:string;repair?:RepairInteraction;
  width:number;height:number;recipeWidth:number;recipeHeight:number;rotation:number;
  begin:(sessionId:string,revision:number,label:string)=>CanvasEditTransaction|null;
  error:(message:string)=>void;
}
interface Gesture {
  token:CanvasEditTransaction;first:Point;latest:Point;dirty:boolean;running:boolean;closed:boolean;
  hit?:{spot:RepairSpot;part:'source'|'target'};draft?:RepairSpot;point?:Point;
  original:Props;selection:string;source:boolean;
}
const selection=(p:Props)=>JSON.stringify([p.repair?.selectedId,p.repair?.source,p.repair?.selectingSource,p.repair?.settings]);

export function useRepairGesture(p:Props){
  const active=useRef<Gesture|undefined>(undefined),latest=useRef(p);latest.current=p;
  const [draft,setDraft]=useState<RepairSpot>(),[pending,setPending]=useState(false);
  function clear(){active.current?.token.release();active.current=undefined;setDraft(undefined);setPending(false);}
  const valid=(g:Gesture)=>active.current===g&&g.token.valid()&&latest.current.tool==='repair'&&
    latest.current.sessionId===g.original.sessionId&&(g.hit?
      [g.original.repair?.selectedId,g.hit.spot.id].includes(latest.current.repair?.selectedId):selection(latest.current)===g.selection);
  useEffect(()=>{const g=active.current;if(g&&!valid(g))clear();},[p.sessionId,p.tool,p.adjustments,selection(p)]);
  useEffect(()=>()=>{active.current?.token.release();active.current=undefined;},[]);
  async function pump(g:Gesture):Promise<void>{
    if(g.running||active.current!==g)return;
    if(!valid(g)){clear();return;}
    if(!g.dirty){
      if(g.closed){
        clear();
        if(g.hit&&g.draft){const next=g.draft;g.token.apply(a=>({...a,spots:a.spots?.map(s=>s.id===next.id?next:s)}));}
        else if(!g.hit&&g.point)g.original.repair!.pick(g.point,g.source,g.token);
      }return;
    }
    g.dirty=false;g.running=true;const points=g.hit?[g.first,g.latest]:[g.latest],o=g.original;
    try{
      const result=await window.captraw.coordinates(g.token.sessionId,g.token.revision,'display','source',points);
      if(!valid(g)){if(active.current===g)clear();return;}
      if(result.width!==o.width||result.height!==o.height)throw new Error('照片尺寸已变化，请重新取样。');
      const mapped=result.points.map(q=>{
        if(!q)throw new Error('无法映射此位置，当前修复操作未保存。');
        return repairNormalizedPoint(q,o.recipeWidth,o.recipeHeight,o.rotation);
      });
      let at=mapped[0];
      if(g.hit){const old=g.hit.spot[g.hit.part];at={x:old.x+(mapped[1].x-at.x),y:old.y+(mapped[1].y-at.y)};}
      if(!Number.isFinite(at.x)||!Number.isFinite(at.y)||at.x<0||at.x>1||at.y<0||at.y>1)
        throw new Error('当前位置超出原图，当前修复操作未保存。');
      if(g.hit){g.draft={...g.hit.spot,[g.hit.part]:at};setDraft(g.draft);}else g.point=at;
    }catch(error){if(active.current===g){const current=valid(g);clear();if(current)p.error(String(error));}}
    finally{g.running=false;if(active.current===g)void pump(g);}
  }
  function begin(at:Point,source:boolean,hit?:Gesture['hit']){
    if(active.current){p.error('上一次修复操作正在应用，请稍后继续。');return false;}
    if(!p.sessionId||p.revision===undefined||!p.repair)return false;
    const token=p.begin(p.sessionId,p.revision,'修复操作');
    if(!token){p.error('请等待当前照片预览完成后再修复。');return false;}
    const g:Gesture={token,first:at,latest:at,dirty:true,running:false,closed:false,hit:hit?structuredClone(hit):undefined,
      original:p,selection:selection(p),source};
    active.current=g;setPending(true);if(hit)p.repair.select(hit.spot.id);void pump(g);return true;
  }
  function move(at:Point){const g=active.current;if(!g||g.closed||!g.hit)return;append(g,at);}
  function append(g:Gesture,at:Point){if(at.x!==g.latest.x||at.y!==g.latest.y){g.latest=at;g.dirty=true;}void pump(g);}
  function end(at:Point){const g=active.current;if(g&&!g.closed){append(g,at);g.closed=true;void pump(g);}}
  return {draft,pending,active:()=>!!active.current,begin,move,end,cancel:clear};
}
