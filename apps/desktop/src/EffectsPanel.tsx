import type {Adjustments} from '@captraw/contracts';
import {Control} from './Panels';
// Shared Glow controls, grain and post-crop vignetting.
export function EffectsPanel({value,edit,commit}:{value:Adjustments;edit:(fn:(a:Adjustments)=>Adjustments,transient?:boolean)=>void;commit:()=>void}){
 const grain=value.grainModel==='procedural-v1',vignette=!!value.postCropVignetteStyle;
 const control=(key:keyof Adjustments,label:string,min:number,max:number,fallback=0)=> <Control label={label} value={Number(value[key]??fallback)} min={min} max={max} change={v=>edit(a=>({...a,[key]:Math.round(v)}),true)} commit={commit}/>;
 return <>
  {control('glow','发光',0,100)}
  <label>发光样式<select aria-label="发光样式" value={value.glowStyle??'diffusion'} onChange={e=>edit(a=>({...a,glowStyle:e.target.value as NonNullable<Adjustments['glowStyle']>}))}><option value="diffusion">漫射</option><option value="bloom">光华</option><option value="halation">光晕</option></select></label>
  {control('glowRange','发光范围',0,100,50)}{control('glowSpread','发光扩散',0,100,50)}{control('glowWarmth','发光暖度',-100,100)}
  <p className="hint">样式、范围、扩散和暖度由全局与所有蒙版共用。</p>
  {control('vignette','晕影',-100,100)}
  {!vignette&&<><p className="hint">保留原有外观。更新处理会改变外观，可撤销。</p><button onClick={()=>edit(a=>({...a,postCropVignetteStyle:'highlight-priority',postCropVignetteMidpoint:50,postCropVignetteHighlights:0}))}>更新晕影处理</button></>}
  <fieldset disabled={!vignette}>
   <label>晕影样式<select aria-label="晕影样式" value={value.postCropVignetteStyle??'highlight-priority'} onChange={e=>{const style=e.target.value as NonNullable<Adjustments['postCropVignetteStyle']>;edit(a=>({...a,postCropVignetteStyle:style}));}}><option value="highlight-priority">高光优先</option><option value="color-priority">颜色优先</option><option value="paint-overlay">绘画叠加</option></select></label>
   {control('postCropVignetteMidpoint','晕影中点',0,100,50)}
  </fieldset>
  {control('postCropVignetteRoundness','晕影圆度',-100,100)}{control('postCropVignetteFeather','晕影羽化',0,100,50)}
  <fieldset disabled={!vignette||(value.vignette??0)>=0||value.postCropVignetteStyle==='paint-overlay'}>{control('postCropVignetteHighlights','晕影高光',0,100)}</fieldset>
  {control('grain','颗粒',0,100)}
  {!grain&&<><p className="hint">保留原有外观。更新处理会改变外观，可撤销。</p><button onClick={()=>edit(a=>({...a,grainModel:'procedural-v1',grainSize:25,grainRoughness:50}))}>更新颗粒处理</button></>}
  <fieldset disabled={!grain||!value.grain}>{control('grainSize','颗粒大小',0,100,25)}{control('grainRoughness','颗粒粗糙度',0,100,50)}</fieldset>
 </>;
}
