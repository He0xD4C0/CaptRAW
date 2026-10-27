import {useEffect,useState} from 'react';
import type {Adjustments,ImageSession,LensProfileSettings} from '@captraw/contracts';
const defaults:LensProfileSettings={mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:true,ca:true};
function displayName(make:string,name:string){if(!make)return name;const prefix=make+' ';while(name.startsWith(prefix))name=name.slice(prefix.length);return prefix+name;}
export function LensPanel({value,image,edit,disabled}:{value:Adjustments;image:ImageSession;edit:(fn:(a:Adjustments)=>Adjustments)=>void;disabled:boolean}){
 const settings=value.lensProfile||defaults,status=image.lensStatus,catalog=image.lensCatalog;
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
  <p className="hint">{!value.lensCorrections?'配置校正已关闭。':disabled?'':active.length?`已启用：${active.join('、')}。`:'当前没有应用配置校正。'}{settings.mode==='manual'&&' 手动选择须与实际器材一致。'}</p>
 </div>;
}
