import {useEffect,useState} from 'react';
import type {Adjustments,ImageSession,LensProfileSettings} from '@captraw/contracts';
const defaults:LensProfileSettings={mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:true,ca:true};
const defringeDefaults={purpleAmount:0,purpleHueLo:30,purpleHueHi:70,greenAmount:0,greenHueLo:40,greenHueHi:60};
function displayName(make:string,name:string){if(!make)return name;const prefix=make+' ';while(name.startsWith(prefix))name=name.slice(prefix.length);return prefix+name;}
function ManualCorrection({label,value,change,commit,disabled,min=-100,max=100}:{label:string;value:number;change:(value:number)=>void;commit:()=>void;disabled:boolean;min?:number;max?:number}){
 const set=(next:number)=>{const n=Math.max(min,Math.min(max,Math.round(next)));if(n!==value)change(n);};
 return <div className="control lens-manual-control"><div className="control-label"><label>{label}</label><input aria-label={label} type="number" min={min} max={max} step={1} value={value} disabled={disabled} onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))set(e.target.valueAsNumber);}} onBlur={commit}/></div><input aria-label={`${label}滑杆`} className="lens-native-slider" type="range" min={min} max={max} step={1} value={value} disabled={disabled} onChange={e=>set(e.target.valueAsNumber)} onPointerUp={commit} onKeyUp={commit}/></div>;
}
function DefringeBand({label,amount,low,high,change,commit,disabled}:{label:string;amount:number;low:number;high:number;change:(value:number,key:'amount'|'low'|'high')=>void;commit:()=>void;disabled:boolean}){
 return <div className="defringe-band"><ManualCorrection label={`${label}去边`} min={0} value={amount} change={value=>change(value,'amount')} commit={commit} disabled={disabled}/><div className="defringe-range"><label>{label}色相下限<input aria-label={`${label}色相下限`} type="number" min={0} max={high-1} value={low} disabled={disabled} onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))change(Math.max(0,Math.min(high-1,Math.round(e.target.valueAsNumber))),'low');}} onBlur={commit}/></label><label>{label}色相上限<input aria-label={`${label}色相上限`} type="number" min={low+1} max={100} value={high} disabled={disabled} onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))change(Math.max(low+1,Math.min(100,Math.round(e.target.valueAsNumber))),'high');}} onBlur={commit}/></label></div></div>;
}
export function LensPanel({value,image,edit,commit,disabled}:{value:Adjustments;image:ImageSession;edit:(fn:(a:Adjustments)=>Adjustments,transient?:boolean)=>void;commit:()=>void;disabled:boolean}){
 const settings=value.lensProfile||defaults,status=image.lensStatus,catalog=image.lensCatalog;
 const defringe=value.defringe||defringeDefaults;
 const [search,setSearch]=useState('');useEffect(()=>setSearch(''),[image.id]);
 const change=(next:Partial<LensProfileSettings>)=>edit(a=>({...a,lensProfile:{...(a.lensProfile||defaults),...next}}));
 const cameras=[...new Map((catalog?.cameras||[]).map(c=>[JSON.stringify([c.make,c.model]),c])).entries()].sort((a,b)=>a[0].localeCompare(b[0]));
 const lenses=[...new Map((catalog?.lenses||[]).map(l=>[l.name,l])).values()].sort((a,b)=>a.make.localeCompare(b.make)||a.name.localeCompare(b.name));
 const matches=lenses.filter(l=>l.name===settings.lens||`${l.make} ${l.name}`.toLowerCase().includes(search.trim().toLowerCase()));
 const controls=[['distortion','畸变校正'],['vignette','暗角校正'],['ca','色差校正']] as const;
 const active=controls.filter(([key])=>settings[key]&&status?.[key]).map(([,label])=>label);
 return <div className="lens-panel">
  <label className="check-control"><input type="checkbox" disabled={disabled} checked={!!value.lensCorrections} onChange={e=>edit(a=>({...a,lensCorrections:e.target.checked}))}/>启用镜头配置文件校正</label>
  <div className="profile-select"><label htmlFor="lens-mode">设置</label><select id="lens-mode" aria-label="镜头配置模式" disabled={disabled||!value.lensCorrections} value={settings.mode} onChange={e=>{
   const mode=e.target.value as LensProfileSettings['mode'];change({mode,...(mode==='manual'&&!settings.cameraMake?{cameraMake:status?.cameraMake||'',cameraModel:status?.cameraModel||'',lens:status?.lens||''}:{})});setSearch('');
  }}><option value="auto">自动</option><option value="manual">自定义</option></select></div>
  {settings.mode==='manual'&&<div className="lens-choices">
   <label>相机配置<select aria-label="相机配置" disabled={disabled||!value.lensCorrections} value={settings.cameraMake&&settings.cameraModel?JSON.stringify([settings.cameraMake,settings.cameraModel]):''} onChange={e=>{const [cameraMake,cameraModel]=e.target.value?JSON.parse(e.target.value):['',''];change({cameraMake,cameraModel});}}><option value="">选择相机</option>{cameras.map(([id,c])=><option key={id} value={id}>{displayName(c.make,c.model)}</option>)}</select></label>
   <label>查找镜头<input type="search" aria-label="查找镜头配置" placeholder="厂商或镜头名称" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <label>镜头配置<select aria-label="镜头配置" disabled={disabled||!value.lensCorrections} value={settings.lens} onChange={e=>change({lens:e.target.value})}><option value="">选择镜头</option>{matches.map(l=><option key={l.name} value={l.name}>{displayName(l.make,l.name)}</option>)}</select></label>
   {matches.length===0&&<small className="hint">未找到符合搜索条件的镜头。</small>}
  </div>}
  <div className="lens-status" role="status" aria-label="镜头匹配状态" aria-busy={disabled}>
   {disabled?'正在检查配置…':status?.reason||<><span>{displayName(status?.cameraMake||'',status?.cameraModel||'')}</span><strong>{status?.lens.replace(/^(\S+) \1 /,'$1 ')}</strong></>}
  </div>
  <div className="lens-corrections">{controls.map(([key,label])=><label className="check-control" key={key}><input type="checkbox" aria-label={label} disabled={disabled||!value.lensCorrections||!status?.[key]} checked={settings[key]&&!!status?.[key]} onChange={e=>change({[key]:e.target.checked})}/>{label}{!disabled&&!status?.[key]&&<small>不可用</small>}</label>)}</div>
  <div className="lens-manual-corrections" aria-label="手动光学校正"><ManualCorrection label="手动扭曲" value={value.lensManualDistortion??0} change={v=>edit(a=>({...a,lensManualDistortion:v}),true)} commit={commit} disabled={disabled}/><ManualCorrection label="镜头暗角" value={value.lensVignette??0} change={v=>edit(a=>({...a,lensVignette:v}),true)} commit={commit} disabled={disabled}/></div>
  <details className="lens-defringe"><summary>色差去边</summary><p className="hint">使用 ART 原生 Lab 色差边缘抑制；色相窗口映射为近似实现，不等同于 Adobe 算法。</p><DefringeBand label="紫色" amount={defringe.purpleAmount} low={defringe.purpleHueLo} high={defringe.purpleHueHi} change={(v,key)=>edit(a=>{const current=a.defringe||defringeDefaults,next=key==='amount'?{...current,purpleAmount:v}:key==='low'?{...current,purpleHueLo:v}:{...current,purpleHueHi:v};return {...a,defringe:next};},true)} commit={commit} disabled={disabled}/><DefringeBand label="绿色" amount={defringe.greenAmount} low={defringe.greenHueLo} high={defringe.greenHueHi} change={(v,key)=>edit(a=>{const current=a.defringe||defringeDefaults,next=key==='amount'?{...current,greenAmount:v}:key==='low'?{...current,greenHueLo:v}:{...current,greenHueHi:v};return {...a,defringe:next};},true)} commit={commit} disabled={disabled}/></details>
  <p className="hint">{!value.lensCorrections?'配置校正已关闭。':disabled?'':active.length?`已启用：${active.join('、')}。`:'当前没有应用配置校正。'}{settings.mode==='manual'&&' 手动选择须与实际器材一致。'}</p>
 </div>;
}
