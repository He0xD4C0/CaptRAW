import type { MaskGeometry, Point } from '@captraw/contracts';
import { rotatePoint } from './geometry';

export class MaskGuideCancelled extends Error {
  constructor() { super('Mask guide mapping cancelled'); this.name='MaskGuideCancelled'; }
}

// Sampled chord error uses a safety margin; an arbitrary black-box map cannot
// provide a mathematical bound between samples. Quarter probes also catch
// inflections missed by a midpoint-only test. All geometry comes from map().
export async function mappedMaskGuide(
  mask:MaskGeometry,width:number,height:number,rotation:number,scale:number,
  map:(points:Point[])=>Promise<(Point|null)[]>,alive:()=>boolean=()=>true,
):Promise<{handles:(Point|null)[];segments:Point[][]}> {
  const check=()=>{if(!alive())throw new MaskGuideCancelled();};
  check();
  if(mask.type!=='radial'&&mask.type!=='linear')return {handles:[],segments:[]};
  if(![width,height,scale].every(v=>Number.isFinite(v)&&v>0)||
     !Number.isFinite(rotation)||rotation%90!==0||
     ![mask.start.x,mask.start.y,mask.end.x,mask.end.y].every(Number.isFinite))
    throw new Error('Invalid mask guide geometry');
  const center={x:(mask.start.x+mask.end.x)/2,y:(mask.start.y+mask.end.y)/2};
  const reference=(p:Point)=>{const q=rotatePoint(p,rotation);return {x:q.x*width,y:q.y*height};};
  const curve=(t:number):Point=>{
    if(mask.type==='linear')return reference({x:mask.start.x+(mask.end.x-mask.start.x)*t,y:mask.start.y+(mask.end.y-mask.start.y)*t});
    const angle=(t===1?0:t)*2*Math.PI;
    return reference({x:center.x+Math.abs(mask.end.x-mask.start.x)/2*Math.cos(angle),y:center.y+Math.abs(mask.end.y-mask.start.y)/2*Math.sin(angle)});
  };
  let used=0;
  const query=async(points:Point[])=>{
    if(used+points.length>32768)throw new Error('Mask guide sampling budget exceeded');
    used+=points.length;const output:(Point|null)[]=[];
    for(let i=0;i<points.length;i+=4096){
      check();const batch=points.slice(i,i+4096),result=await map(batch);check();
      if(result.length!==batch.length||result.some(p=>p!==null&&(!Number.isFinite(p.x)||!Number.isFinite(p.y))))
        throw new Error('Invalid mask guide mapping result');
      output.push(...result);
    }
    return output;
  };
  const count=mask.type==='radial'?16:8;
  const initial=Array.from({length:count+1},(_,i)=>i/count);
  const mapped=await query([reference(mask.start),reference(mask.end),reference(center),...initial.map(curve)]);
  const handles=mapped.slice(0,3),samples=new Map<number,Point|null>();
  initial.forEach((t,i)=>samples.set(t,mapped[i+3]));
  type Interval={a:number;b:number;depth:number};
  let pending:Interval[]=initial.slice(0,-1).map((a,i)=>({a,b:initial[i+1],depth:0}));
  const leaves:{a:number;points:(Point|null)[]}[]=[];
  const distance=(p:Point,a:Point,b:Point)=>{
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)*scale;
  };
  while(pending.length){
    check();const needed=new Set<number>();
    for(const {a,b} of pending)for(const f of [.25,.5,.75]){const t=a+(b-a)*f;if(!samples.has(t))needed.add(t);}
    const parameters=[...needed],values=await query(parameters.map(curve));
    parameters.forEach((t,i)=>samples.set(t,values[i]));
    const next:Interval[]=[];
    for(const {a,b,depth} of pending){
      const points=[a,a+(b-a)*.25,(a+b)/2,a+(b-a)*.75,b].map(t=>samples.get(t)!);
      if(points.every(p=>p===null)){leaves.push({a,points:[null]});continue;}
      const valid=points.every(p=>p!==null);
      if(valid&&points.slice(1,-1).every(p=>distance(p!,points[0]!,points[4]!)<=.125)){
        leaves.push({a,points});continue;
      }
      if(depth>=16){
        // A failed inverse is a break, never a chord across the failed region.
        if(!valid){leaves.push({a,points:[points[0],null,points[4]]});continue;}
        throw new Error('Mask guide subdivision budget exceeded');
      }
      const mid=(a+b)/2;next.push({a,b:mid,depth:depth+1},{a:mid,b,depth:depth+1});
    }
    pending=next;
  }
  check();const segments:Point[][]=[];let segment:Point[]=[];
  const finish=()=>{if(segment.length>1)segments.push(segment);segment=[];};
  for(const leaf of leaves.sort((a,b)=>a.a-b.a))for(const p of leaf.points){
    if(p===null){finish();continue;}
    const previous=segment[segment.length-1];
    if(!previous||previous.x!==p.x||previous.y!==p.y)segment.push(p);
  }
  finish();return {handles,segments};
}
