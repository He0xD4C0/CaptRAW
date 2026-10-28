import {useRef} from 'react';
import type {Adjustments,PerspectiveSettings} from '@captraw/contracts';
import type {useGuidedPerspective} from './useGuidedPerspective';
import type {useAutoPerspective} from './useAutoPerspective';
import {Control} from './Panels';

const defaults:PerspectiveSettings={enabled:false,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1};
export function PerspectivePanel({guided,startGuided,automatic,value,edit,commit}:{guided:ReturnType<typeof useGuidedPerspective>;startGuided:()=>void;automatic:ReturnType<typeof useAutoPerspective>;value:Adjustments;edit:(fn:(a:Adjustments)=>Adjustments,transient?:boolean)=>void;commit:()=>void}){
 const p=value.perspective||defaults,snapshot=useRef(p);
 return <div role="group" aria-label="透视变换">
  <div className="preset-actions" role="group" aria-label="自动透视">{([['horizontal','自动水平'],['vertical','自动垂直'],['both','自动联合']] as const).map(([direction,label])=><button key={direction} disabled={automatic.disabled||automatic.pending} title="根据照片中的直线校正；请先退出对比或画布工具" onClick={()=>void automatic.run(direction)}>{label}</button>)}</div>
  {automatic.pending&&<div role="status">正在分析照片直线… <button onClick={automatic.cancel}>取消自动透视</button></div>}
  <button className="guided-trigger" aria-pressed={guided.enabled} disabled={!guided.enabled&&(automatic.disabled||automatic.pending)} onClick={guided.enabled?guided.cancel:startGuided}>引导透视</button>
  {guided.enabled&&<div className="guided-controls" role="group" aria-label="透视引导线">
   <p className="hint">沿边缘拖线，松手后自动校正；每次操作可单独撤销。少于两条同向线时保留已有校正。</p>
   <label className="check-control"><input type="checkbox" checked={guided.loupe} onChange={e=>guided.setLoupe(e.target.checked)}/>显示放大镜 <small>Shift+L · ⌥ 精细拖动</small></label>
   <div className="preset-actions">{guided.lines.map((g,i)=><button key={i} aria-pressed={guided.selected===i} onClick={()=>guided.select(i)}>{i+1} · {g.axis==='horizontal'?'水平':'垂直'}</button>)}</div>
   <div className="preset-actions"><button disabled={!guided.ready||guided.pending||!!guided.draft||guided.selected<0} onClick={guided.remove}>删除引导线</button><button disabled={!guided.ready||guided.pending||!!guided.draft||guided.failed} onClick={guided.finish}>完成引导校正</button>{guided.failed&&<button onClick={guided.retry}>重试引导校正</button>}{(guided.pending||guided.failed||guided.draft)&&<button onClick={guided.cancel}>取消当前操作</button>}</div>
   <p role="status">{guided.pending?'正在定位或校正…':!guided.ready?'正在准备引导线…':`${guided.lines.length} / 4 条引导线 · ${guided.failed?'本次未保存 · Enter 重试':'松手自动校正 · Enter 完成'} · Esc 结束`}</p>
  </div>}
  <label className="check-control"><input type="checkbox" checked={p.enabled} onChange={e=>edit(a=>({...a,perspective:{...(a.perspective||defaults),enabled:e.target.checked}}))}/>启用透视变换</label>
  {([['vertical','垂直透视',-200,200,.1],['horizontal','水平透视',-200,200,.1],['angle','透视旋转',-20,20,.01],['shear','倾斜',-50,50,.1]] as const).map(([key,label,min,max,step])=><Control key={key} label={label} value={p[key]} min={min} max={max} step={step} unit={key==='angle'?'°':''} begin={()=>{snapshot.current=structuredClone(p);}} cancel={()=>edit(a=>({...a,perspective:snapshot.current}),true)} change={v=>edit(a=>({...a,perspective:{...(a.perspective||defaults),enabled:true,[key]:v}}),true)} commit={commit}/>)}
  <button onClick={()=>edit(a=>({...a,perspective:{...defaults}}))}>重置透视变换</button>
  <p className="hint">拖动调节会自动启用。取消勾选可暂时关闭并保留数值；裁切与拉直角度单独保留。</p>
 </div>;
}
