import {useEffect,useRef,useState} from 'react';
import type {Adjustments,Point,RepairSpot,SpotSettings} from '@captraw/contracts';
import type {CanvasEditTransaction} from '../lib/geometry';
import {automaticRepairSource,repairNormalizedPoint} from '../lib/repairGeometry';

export interface RepairInteraction {
  source?:Point;selectingSource:boolean;selectedId:string;guides:boolean;settings:SpotSettings;
  pick:(point:Point,source:boolean,transaction:CanvasEditTransaction,path?:Point[],sample?:Point)=>void|Promise<void>;
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
  queue:Point[];path:Point[];original:Props;selection:string;source:boolean;
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
    const o=g.original;
    if(!g.dirty&&!g.queue.length){
      if(g.closed){
        g.running=true;
        try{
          if(g.hit&&g.draft){const next=g.draft;g.token.apply(a=>({...a,spots:a.spots?.map(s=>s.id===next.id?next:s)}));}
          else if(!g.hit&&g.path.length){
            const target=g.path[0],path=g.path.length>1?g.path:undefined;
            let sample:Point|undefined;
            if(!g.source&&o.repair?.settings.sourceMode==='auto'){
              sample=await automaticRepairSource({sessionId:g.token.sessionId,revision:g.token.revision,path:g.path,
                radius:o.repair.settings.radius,feather:o.repair.settings.feather,seed:0},()=>valid(g));
            }
            if(valid(g))await o.repair!.pick(g.source?g.path.at(-1)!:target,g.source,g.token,path,sample);
          }
        }catch(error){if(valid(g))p.error(String(error));}
        finally{if(active.current===g)clear();}
      }return;
    }
    g.dirty=false;g.running=true;
    const points=g.hit?[g.first,g.latest]:g.queue.splice(0,4096);
    try{
      const result=await window.captraw.coordinates(g.token.sessionId,g.token.revision,'display','source',points);
      if(!valid(g)){if(active.current===g)clear();return;}
      if(result.width!==o.width||result.height!==o.height)throw new Error('照片尺寸已变化，请重新取样。');
      const mapped=result.points.map(q=>{
        if(!q)throw new Error('无法映射此位置，当前修复操作未保存。');
        const at=repairNormalizedPoint(q,o.recipeWidth,o.recipeHeight,o.rotation);
        if(![at.x,at.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('当前位置超出原图，当前修复操作未保存。');
        return at;
      });
      if(g.hit){
        const old=g.hit.spot[g.hit.part],dx=mapped[1].x-mapped[0].x,dy=mapped[1].y-mapped[0].y;
        const at={x:old.x+dx,y:old.y+dy};
        const path=g.hit.part==='target'?g.hit.spot.path?.map(q=>({x:q.x+dx,y:q.y+dy})):g.hit.spot.path;
        if([at,...path||[]].some(q=>q.x<0||q.x>1||q.y<0||q.y>1))throw new Error('修复轨迹不能移出原图。');
        const source=g.hit.part==='source'?at:g.hit.spot.source,target=g.hit.part==='target'?at:g.hit.spot.target;
        if(path?.some(q=>q.x+source.x-target.x<0||q.x+source.x-target.x>1||q.y+source.y-target.y<0||q.y+source.y-target.y>1))throw new Error('来源无法覆盖整条修复轨迹，请选择其他位置。');
        g.draft={...g.hit.spot,[g.hit.part]:at,...(path?{path}:{}),...(g.hit.part==='source'?{sourceMode:'manual' as const}:{})};setDraft(g.draft);
      }else{
        g.path.push(...mapped);
        const source=o.repair?.source;
        if(source&&!g.source){g.draft={...o.repair!.settings,id:'draft',name:'连续修复草稿',enabled:true,source,target:g.path[0],path:g.path.length>1?g.path:undefined};setDraft(g.draft);}
      }
    }catch(error){if(active.current===g){const current=valid(g);clear();if(current)p.error(String(error));}}
    finally{g.running=false;if(active.current===g)void pump(g);}
  }
  function begin(at:Point,source:boolean,hit?:Gesture['hit']){
    if(active.current){p.error('上一次修复操作正在应用，请稍后继续。');return false;}
    if(!p.sessionId||p.revision===undefined||!p.repair)return false;
    const token=p.begin(p.sessionId,p.revision,'修复操作');
    if(!token){p.error('请等待当前照片预览完成后再修复。');return false;}
    const g:Gesture={token,first:at,latest:at,dirty:true,running:false,closed:false,hit:hit?structuredClone(hit):undefined,
      queue:hit?[]:[at],path:[],original:p,selection:selection(p),source:source||p.repair.selectingSource};
    active.current=g;setPending(true);if(hit)p.repair.select(hit.spot.id);void pump(g);return true;
  }
  function append(g:Gesture,at:Point){
    if(at.x!==g.latest.x||at.y!==g.latest.y){
      if(!g.hit){
        const dx=at.x-g.latest.x,dy=at.y-g.latest.y,count=Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(1,g.original.repair!.settings.radius/4)));
        if(g.path.length+g.queue.length+count>32768){clear();p.error('修复轨迹过长，请分成较短的笔画。');return;}
        for(let i=1;i<=count;++i)g.queue.push({x:g.latest.x+dx*i/count,y:g.latest.y+dy*i/count});
      }
      g.latest=at;g.dirty=true;
    }
    void pump(g);
  }
  function move(at:Point){const g=active.current;if(g&&!g.closed)append(g,at);}
  function end(at:Point){const g=active.current;if(g&&!g.closed){append(g,at);g.closed=true;void pump(g);}}
  return {draft,pending,active:()=>!!active.current,begin,move,end,cancel:clear};
}
