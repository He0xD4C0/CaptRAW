import {useEffect,useRef,useState} from 'react';
import type {Point} from '../../../packages/contracts';
import {sampleCurve} from './curve';
export function CurveEditor({points,change,commit}:{points:Point[];change:(points:Point[],transient?:boolean)=>void;commit:()=>void}){
  const [selected,setSelected]=useState<number>();const dragging=useRef<number|undefined>(undefined);
  useEffect(()=>{if(selected!==undefined&&selected>=points.length)setSelected(undefined);},[points.length,selected]);
  function coordinate(e:React.PointerEvent<SVGSVGElement>){const b=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,1-(e.clientY-b.top)/b.height))};}
  function down(e:React.PointerEvent<SVGSVGElement>){
    if(e.button!==0)return;const p=coordinate(e),b=e.currentTarget.getBoundingClientRect();
    let at=points.findIndex(q=>Math.hypot((q.x-p.x)*b.width,(q.y-p.y)*b.height)<9);
    if(at<0){if(points.length>=128)return;const next=[...points,{x:Math.max(.001,Math.min(.999,p.x)),y:p.y}].sort((a,b)=>a.x-b.x);at=next.findIndex(q=>q.x===Math.max(.001,Math.min(.999,p.x)));if(next.some((q,i)=>i&&q.x-next[i-1].x<.001))return;change(next,true);}
    dragging.current=at;setSelected(at);e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:React.PointerEvent<SVGSVGElement>){const at=dragging.current;if(at===undefined)return;const p=coordinate(e);p.x=at===0?0:at===points.length-1?1:Math.max(points[at-1].x+.001,Math.min(points[at+1].x-.001,p.x));change(points.map((q,i)=>i===at?p:q),true);}
  function remove(){if(selected===undefined||selected===0||selected===points.length-1)return;change(points.filter((_,i)=>i!==selected));setSelected(undefined);}
  const samples=sampleCurve(points),path=samples.map((y,i)=>`${i?'L':'M'}${i/(samples.length-1)*256},${(1-Math.min(1,y))*256}`).join(' ');
  return <div className="curve-editor"><svg className="curve" viewBox="0 0 256 256" tabIndex={0} aria-label="多点色调曲线" onPointerDown={down} onPointerMove={move} onPointerUp={()=>{dragging.current=undefined;commit();}} onPointerCancel={()=>{dragging.current=undefined;commit();}} onDoubleClick={remove} onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}}}>
    <defs><pattern id="curve-grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#747474" strokeWidth=".5"/></pattern><clipPath id="curve-clip"><rect width="256" height="256"/></clipPath></defs>
    <rect width="256" height="256" fill="url(#curve-grid)"/><path d="M0 256L256 0" stroke="#777"/>
    <path data-testid="curve-path" d={path} clipPath="url(#curve-clip)" fill="none" stroke="currentColor" strokeWidth="1.8"/>
    {points.map((p,i)=><circle key={i} cx={p.x*256} cy={(1-p.y)*256} r={i===selected?4:3} fill={i===selected?'#fff':'#bdbdbd'} stroke="#202020"/>)}
  </svg><div className="curve-coordinates"><label>输入 <input aria-label="曲线输入" type="number" min={0} max={255} value={selected===undefined?'':Math.round(points[selected]?.x*255)||0} disabled={selected===undefined||selected===0||selected===points.length-1} onChange={e=>{if(selected===undefined)return;const x=Math.max(points[selected-1].x+.001,Math.min(points[selected+1].x-.001,Number(e.target.value)/255));change(points.map((p,i)=>i===selected?{...p,x}:p),true);}} onBlur={commit}/></label><label>输出 <input aria-label="曲线输出" type="number" min={0} max={255} value={selected===undefined?'':Math.round(points[selected]?.y*255)||0} disabled={selected===undefined} onChange={e=>{if(selected!==undefined)change(points.map((p,i)=>i===selected?{...p,y:Math.max(0,Math.min(1,Number(e.target.value)/255))}:p),true);}} onBlur={commit}/></label><button disabled={selected===undefined||selected===0||selected===points.length-1} onClick={remove}>删除点</button></div><small className="hint">单击添加 · 拖动调整 · Delete 删除 · 双击移除点</small></div>;
}
