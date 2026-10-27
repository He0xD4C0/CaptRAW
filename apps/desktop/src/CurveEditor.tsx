import {useEffect,useRef,useState} from 'react';
import type {Point} from '@captraw/contracts';
import {sampleCurve} from './curve';
import {CurveHistogram} from './Histogram';

function CurveCoordinate({axis,value,min,max,change,commit}:{axis:'x'|'y';value?:number;min:number;max:number;change:(value:number)=>void;commit:()=>void}){
  const format=(v?:number)=>v===undefined?'':String(Number((v*255).toFixed(9)));
  const [draft,setDraft]=useState(format(value));
  const focused=useRef(false),edited=useRef(false),original=useRef(value),cancelled=useRef(false);
  useEffect(()=>{if(!focused.current)setDraft(format(value));},[value]);
  function finish(){
    focused.current=false;
    if(!edited.current){setDraft(format(value));return;}
    const n=Number(draft),next=cancelled.current||!draft.trim()||!Number.isFinite(n)?original.current:Math.max(min,Math.min(max,Math.round(n)))/255;
    if(next!==undefined&&next!==value)change(next);
    setDraft(format(next));commit();
  }
  return <label>{axis==='x'?'输入':'输出'} <input aria-label={axis==='x'?'曲线输入':'曲线输出'} type="number" min={min} max={max} step={1} value={draft} title={format(value)} disabled={value===undefined||min>max}
    onFocus={()=>{focused.current=true;original.current=value;edited.current=false;cancelled.current=false;}}
    onChange={e=>{const text=e.target.value,n=Number(text);setDraft(text);edited.current=true;if(text.trim()&&Number.isFinite(n)&&n>=min&&n<=max){const next=Math.round(n)/255;if(next!==value)change(next);}}}
    onBlur={finish} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelled.current=e.key==='Escape';e.currentTarget.blur();}}}/></label>;
}

export function CurveEditor({points,change,commit,histogram}:{histogram?:number[]|null;points:Point[];change:(points:Point[],transient?:boolean)=>void;commit:()=>void}){
  const [selected,setSelected]=useState<number>();
  const current=useRef(points);current.current=points;
  const dragging=useRef<{index:number;before:Point[];selected?:number;x:number;y:number;moved:boolean}|undefined>(undefined);
  const keyGesture=useRef(false);
  useEffect(()=>{if(selected!==undefined&&selected>=points.length)setSelected(undefined);},[points.length,selected]);
  function apply(next:Point[],transient=true){
    if(next.length===current.current.length&&next.every((p,i)=>p.x===current.current[i].x&&p.y===current.current[i].y))return;
    current.current=next;change(next,transient);
  }
  function limits(at:number){const p=current.current;return {min:at?Math.floor(p[at-1].x*255+1e-9)+1:0,max:at<p.length-1?Math.ceil(p[at+1].x*255-1e-9)-1:255};}
  function coordinate(e:React.PointerEvent<SVGSVGElement>){const b=e.currentTarget.getBoundingClientRect();return {x:Math.round(Math.max(0,Math.min(1,(e.clientX-b.left)/b.width))*255)/255,y:Math.round(Math.max(0,Math.min(1,1-(e.clientY-b.top)/b.height))*255)/255};}
  function down(e:React.PointerEvent<SVGSVGElement>){
    if(e.button!==0)return;e.currentTarget.focus({preventScroll:true});
    const p=coordinate(e),b=e.currentTarget.getBoundingClientRect(),before=current.current;let at=-1,distance=9;
    before.forEach((q,i)=>{const d=Math.hypot(q.x*b.width-(e.clientX-b.left),(1-q.y)*b.height-(e.clientY-b.top));if(d<distance){distance=d;at=i;}});
    if(at<0){if(before.length>=128||before.some(q=>Math.abs(q.x-p.x)<.001))return;const next=[...before,p].sort((a,b)=>a.x-b.x);at=next.indexOf(p);apply(next);}
    dragging.current={index:at,before,selected,x:e.clientX,y:e.clientY,moved:false};setSelected(at);e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:React.PointerEvent<SVGSVGElement>){
    const drag=dragging.current;if(!drag)return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<2)return;drag.moved=true;
    const p=coordinate(e),{min,max}=limits(drag.index);
    p.x=min<=max?Math.max(min,Math.min(max,Math.round(p.x*255)))/255:current.current[drag.index].x;
    apply(current.current.map((q,i)=>i===drag.index?p:q));
  }
  function finishPointer(cancel=false){const drag=dragging.current;if(!drag)return;dragging.current=undefined;if(cancel){apply(drag.before);setSelected(drag.selected);}commit();}
  function finishKeys(){if(keyGesture.current){keyGesture.current=false;commit();}}
  function remove(){if(selected===undefined||selected===0||selected===current.current.length-1)return;finishKeys();apply(current.current.filter((_,i)=>i!==selected),false);setSelected(undefined);}
  function keyDown(e:React.KeyboardEvent<SVGSVGElement>){
    if(e.key==='Escape'&&dragging.current){e.preventDefault();e.stopPropagation();finishPointer(true);return;}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();return;}
    if(selected===undefined||!current.current[selected]||e.metaKey||e.ctrlKey||e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();const {min,max}=limits(selected),p={...current.current[selected]},step=e.shiftKey?10:1;
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){if(min>max)return;p.x=Math.max(min,Math.min(max,Math.round(p.x*255)+(e.key==='ArrowRight'?step:-step)))/255;}
    else p.y=Math.max(0,Math.min(255,Math.round(p.y*255)+(e.key==='ArrowUp'?step:-step)))/255;
    keyGesture.current=true;apply(current.current.map((q,i)=>i===selected?p:q));
  }
  const samples=sampleCurve(points),path=samples.map((y,i)=>`${i?'L':'M'}${i/(samples.length-1)*256},${(1-Math.min(1,y))*256}`).join(' ');
  const point=selected===undefined?undefined:points[selected],bounds=point?limits(selected!):{min:0,max:255};
  return <div className="curve-editor"><svg className="curve" viewBox="0 0 256 256" tabIndex={0} aria-label="多点色调曲线" onPointerDown={down} onPointerMove={move} onPointerUp={()=>finishPointer()} onPointerCancel={()=>finishPointer(true)} onLostPointerCapture={()=>finishPointer()} onDoubleClick={remove} onKeyDown={keyDown} onKeyUp={finishKeys} onBlur={finishKeys}>
    <defs><pattern id="curve-grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#747474" strokeWidth=".5"/></pattern><clipPath id="curve-clip"><rect width="256" height="256"/></clipPath></defs>
    <CurveHistogram bins={histogram}/><rect width="256" height="256" fill="url(#curve-grid)"/><path d="M0 256L256 0" stroke="#777"/>
    <path data-testid="curve-path" d={path} clipPath="url(#curve-clip)" fill="none" stroke="currentColor" strokeWidth="1.8"/>
    {points.map((p,i)=><circle key={i} cx={p.x*256} cy={(1-p.y)*256} r={i===selected?4:3} fill={i===selected?'#fff':'#bdbdbd'} stroke="#202020"/>)}
  </svg><div className="curve-coordinates">{(['x','y'] as const).map(axis=><CurveCoordinate key={`${selected}:${axis}`} axis={axis} value={point?.[axis]} min={axis==='x'?bounds.min:0} max={axis==='x'?bounds.max:255} change={v=>{if(selected!==undefined)apply(current.current.map((p,i)=>i===selected?{...p,[axis]:v}:p));}} commit={commit}/>)}<button disabled={selected===undefined||selected===0||selected===points.length-1} onClick={remove}>删除点</button></div><small className="hint">单击添加 · 拖动 / 方向键调整 · Shift 加速 · Delete 删除</small></div>;
}
