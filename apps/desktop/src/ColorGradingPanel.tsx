import {useEffect,useId,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {RotateCcw} from 'lucide-react';
import {Control} from './Panels';
import type {Adjustments,ColorGradingSettings,ColorGradingWheel} from '@captraw/contracts';

type Region='shadows'|'midtones'|'highlights'|'global';
const names:Record<Region,string>={shadows:'阴影',midtones:'中间调',highlights:'高光',global:'全局'};
const empty:ColorGradingWheel={hue:0,saturation:0,luminance:0};
const defaults:ColorGradingSettings={shadows:empty,midtones:empty,highlights:empty,global:empty,blending:50,balance:0};
const point=(v:ColorGradingWheel)=>({x:Math.cos(v.hue*Math.PI/180)*v.saturation/100,y:-Math.sin(v.hue*Math.PI/180)*v.saturation/100});
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

function Wheel({region,value,change,commit,menu}:{region:Region;value:ColorGradingWheel;change:(v:ColorGradingWheel,transient?:boolean)=>void;commit:()=>void;menu:()=>void}){
 const id=useId(),handle=point(value),ref=useRef<HTMLDivElement>(null);
 const drag=useRef<{id:number;initial:ColorGradingWheel;last:ColorGradingWheel;anchor:ColorGradingWheel;pointer:{x:number;y:number};point:{x:number;y:number};lock:string;soft:boolean}|undefined>(undefined);
 const position=(e:ReactPointerEvent<HTMLDivElement>)=>{const b=e.currentTarget.getBoundingClientRect(),radius=e.currentTarget.clientWidth/2-5;return {x:(e.clientX-b.x-b.width/2)/radius,y:(e.clientY-b.y-b.height/2)/radius};};
 function move(e:ReactPointerEvent<HTMLDivElement>){
  const d=drag.current;if(!d||d.id!==e.pointerId)return;
  const p=position(e),gain=e.altKey?.1:1;
  d.point={x:d.point.x+(p.x-d.pointer.x)*gain,y:d.point.y+(p.y-d.pointer.y)*gain};d.pointer=p;
  const lock=e.shiftKey?'hue':e.metaKey||e.ctrlKey?'saturation':'';
  if(lock!==d.lock){d.anchor=d.last;d.lock=lock;}
  const length=Math.hypot(d.point.x,d.point.y);
  let hue=length<.005?d.last.hue:(Math.atan2(-d.point.y,d.point.x)*180/Math.PI+360)%360;
  let saturation=clamp(length*100,0,100);
  if(d.soft&&!lock){const a=d.initial.hue*Math.PI/180,perpendicular=Math.abs(d.point.x*Math.sin(a)+d.point.y*Math.cos(a));
   if(perpendicular<.08){hue=d.initial.hue;saturation=clamp((d.point.x*Math.cos(a)-d.point.y*Math.sin(a))*100,0,100);}else d.soft=false;
  }
  if(lock==='hue'){const a=d.anchor.hue*Math.PI/180;hue=d.anchor.hue;saturation=clamp((d.point.x*Math.cos(a)-d.point.y*Math.sin(a))*100,0,100);}
  if(lock==='saturation')saturation=d.anchor.saturation;
  d.last={...d.initial,hue:Math.round(hue)%360,saturation:Math.round(saturation)};change(d.last,true);
 }
 function finish(cancel=false){const d=drag.current;if(!d)return;drag.current=undefined;if(cancel)change(d.initial,true);queueMicrotask(commit);}
 return <div ref={ref} className="grading-wheel" role="group" aria-label={`${names[region]}色轮`} aria-describedby={id} tabIndex={0}
  data-hue={value.hue} data-saturation={value.saturation}
  onPointerDown={e=>{if(e.button!==0||e.detail===2)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
   const p=position(e),onHandle=Math.hypot(p.x-handle.x,p.y-handle.y)<.16;
   drag.current={id:e.pointerId,initial:{...value},last:{...value},anchor:{...value},pointer:p,point:onHandle||e.altKey?handle:p,lock:e.shiftKey?'hue':e.metaKey||e.ctrlKey?'saturation':'',soft:onHandle&&value.saturation>0};
   if(!onHandle&&!e.altKey)move(e);
  }} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish()}
  onDoubleClick={()=>change({...value,hue:0,saturation:0})} onContextMenu={e=>{e.preventDefault();menu();}}
  onKeyDown={e=>{
   if(e.key==='Escape'&&drag.current){e.preventDefault();e.stopPropagation();finish(true);return;}
   if(e.key==='F10'&&e.shiftKey){e.preventDefault();e.stopPropagation();menu();return;}
   const step=e.shiftKey?10:1;
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','Delete','Backspace'].includes(e.key)){
    e.preventDefault();e.stopPropagation();
    if(e.key==='Delete'||e.key==='Backspace')change({...value,hue:0,saturation:0});
    else if(e.key==='Home')change({...value,saturation:0});
    else if(e.key==='ArrowLeft'||e.key==='ArrowRight')change({...value,hue:(value.hue+(e.key==='ArrowLeft'?-step:step)+360)%360});
    else change({...value,saturation:clamp(value.saturation+(e.key==='ArrowDown'?-step:step),0,100)});
   }
  }}>
  <span className="grading-center"/><span className="grading-spoke" style={{width:`calc(${value.saturation/100} * (50% - 5px))`,transform:`rotate(${-value.hue}deg)`}}/>
  <span className="grading-handle" style={{left:`calc(50% + ${handle.x} * (50% - 5px))`,top:`calc(50% + ${handle.y} * (50% - 5px))`}}/>
  <span id={id} className="sr-only">色相 {value.hue} 度，饱和度 {value.saturation}。左右键调整色相，上下键调整饱和度。Shift 锁定色相，⌘ 或 Ctrl 锁定饱和度，Option 或 Alt 微调。双击复位色相和饱和度。</span>
 </div>;
}

export function ColorGradingPanel({value,edit,commit}:{value?:ColorGradingSettings;edit:(fn:(a:Adjustments)=>Adjustments,transient?:boolean)=>void;commit:()=>void}){
 const [view,setView]=useState<Region|'all'>('all'),[menu,setMenu]=useState<Region>(),[clipboard,setClipboard]=useState<ColorGradingWheel>();
 const menuRef=useRef<HTMLDivElement>(null),g=value||defaults;
 const change=(region:Region,v:ColorGradingWheel,transient=false)=>edit(a=>({...a,colorGrading:{...(a.colorGrading||defaults),[region]:v}}),transient);
 const setting=(key:'blending'|'balance',v:number)=>edit(a=>({...a,colorGrading:{...(a.colorGrading||defaults),[key]:v}}),true);
 const reset=(all:boolean)=>edit(a=>({...a,colorGrading:all?structuredClone(defaults):{...(a.colorGrading||defaults),shadows:{...empty},midtones:{...empty},highlights:{...empty}}}));
 useEffect(()=>{if(!menu)return;menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const dismiss=(e:PointerEvent)=>{if(!menuRef.current?.contains(e.target as Node))setMenu(undefined);};
  document.addEventListener('pointerdown',dismiss);return ()=>document.removeEventListener('pointerdown',dismiss);
 },[menu]);
 const regions:Region[]=view==='all'?['midtones','shadows','highlights']:[view];
 return <div className="color-grading-panel">
  <div className="grading-views" role="group" aria-label="颜色分级视图">{(['all','shadows','midtones','highlights','global'] as const).map(v=><button key={v} aria-label={v==='all'?'三轮总览':`${names[v]}分级视图`} title={v==='all'?'三轮总览':names[v]} aria-pressed={view===v} onClick={()=>{setMenu(undefined);setView(v);}}><span className={`grading-view-icon ${v}`} aria-hidden="true"/></button>)}<button className="grading-reset" aria-label="复位全部颜色分级" title="复位全部颜色分级" onClick={()=>reset(true)}><RotateCcw size={13}/></button></div>
  <div className={`grading-wheels ${view==='all'?'three':'single'}`}>{regions.map(region=><div key={region} className={`grading-region ${region}`}>
   <div className="grading-region-heading"><button aria-label={`单独查看${names[region]}`} onClick={()=>setView(region)}>{names[region]}</button><button title={`复位${names[region]}分级`} aria-label={`复位${names[region]}分级`} onClick={()=>change(region,{...empty})}><RotateCcw size={11}/></button></div>
   <Wheel region={region} value={g[region]} change={(v,t)=>change(region,v,t)} commit={commit} menu={()=>setMenu(region)}/>
   {view!=='all'&&<><Control label={`${names[region]}分级色相`} caption="色相" value={g[region].hue} min={0} max={360} unit="°" change={v=>change(region,{...g[region],hue:v},true)} commit={commit}/><Control label={`${names[region]}分级饱和度`} caption="饱和度" value={g[region].saturation} min={0} max={100} change={v=>change(region,{...g[region],saturation:v},true)} commit={commit}/></>}
   <Control label={`${names[region]}分级明度`} caption="明度" value={g[region].luminance} min={-100} max={100} change={v=>change(region,{...g[region],luminance:v},true)} commit={commit}/>
  </div>)}</div>
  {view!=='global'&&<div className="grading-ranges"><Control label="分级混合" caption="混合" value={g.blending} min={0} max={100} change={v=>setting('blending',v)} commit={commit}/><Control label="分级平衡" caption="平衡" value={g.balance} min={-100} max={100} change={v=>setting('balance',v)} commit={commit}/></div>}
  {menu&&<div ref={menuRef} className="grading-menu" role="menu" aria-label={`${names[menu]}色轮菜单`} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(undefined);}}}>
   <button role="menuitem" onClick={()=>{change(menu,{...empty});setMenu(undefined);}}>复位此色轮</button><button role="menuitem" onClick={()=>{reset(false);setMenu(undefined);}}>复位三轮</button><button role="menuitem" onClick={()=>{reset(true);setMenu(undefined);}}>复位全部颜色分级</button>
   <button role="menuitem" onClick={()=>{setClipboard({...g[menu]});setMenu(undefined);}}>复制色轮设置</button><button role="menuitem" disabled={!clipboard} onClick={()=>{if(clipboard)change(menu,{...clipboard});setMenu(undefined);}}>粘贴色轮设置</button>
  </div>}
 </div>;
}
