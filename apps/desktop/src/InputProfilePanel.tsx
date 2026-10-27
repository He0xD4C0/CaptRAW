import {useEffect,useRef,useState} from 'react';
import type {ColorProfileSettings,ImageSession,InputProfileOption} from '@captraw/contracts';
const key=(p:InputProfileOption)=>p.id==='inherited'?p.reference!:p.id;
export function InputProfilePanel({image,value,disabled,change}:{image:ImageSession;value?:ColorProfileSettings;disabled:boolean;change:(value:Partial<ColorProfileSettings>)=>void}){
 const [library,setLibrary]=useState<InputProfileOption[]>([]),[current,setCurrent]=useState<InputProfileOption>(),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const active=useRef(image.id),latestChange=useRef(change);active.current=image.id;latestChange.current=change;
 useEffect(()=>()=>{active.current='';},[]);
 useEffect(()=>{let live=true;window.captraw.listInputProfiles().then(result=>{if(live){setLibrary(result.items);setError(result.errors.join('\n'));}}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[image.id]);
 useEffect(()=>{let live=true;setCurrent(undefined);if(value?.mode==='inherited'&&value.reference)window.captraw.inspectInputProfile(value.reference).then(info=>{if(live)setCurrent(info);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[value?.mode,value?.reference]);
 const choices=[...(image.inputProfiles||[]),...library.filter(p=>!current?.sha256||p.sha256!==current.sha256||p.reference===current.reference)];
 if(current&&!choices.some(p=>key(p)===key(current)))choices.push(current);
 const selected=value?.mode==='inherited'?value.reference!:(value?.mode||'auto');
 const option=choices.find(p=>key(p)===selected),dcp=option?.dcp;
 const raw=/\.(nef|cr3|cr2|arw|raf|dng|orf|rw2|pef)$/i.test(image.path);
 const mismatch=(p:InputProfileOption)=>p.kind==='dcp'&&(!raw||!!p.cameraModel&&p.cameraModel.trim().toUpperCase()!==(image.profileCamera||image.camera).trim().toUpperCase());
 function select(p:InputProfileOption){setError('');latestChange.current({mode:p.id,reference:p.reference,illuminant:0});}
 async function importFile(){
  const id=image.id;setPending(true);setError('');
  try{const imported=await window.captraw.importInputProfile(id);if(active.current!==id||!imported)return;setLibrary(old=>[...old.filter(p=>key(p)!==key(imported)),imported]);select(imported);}
  catch(e){if(active.current===id)setError(String(e));}finally{setPending(false);}
 }
 return <>
  <div className="profile-select"><label htmlFor="input-profile">配置文件</label><select id="input-profile" aria-label="输入配置文件" value={selected} disabled={disabled||pending} onChange={e=>{const p=choices.find(p=>key(p)===e.target.value);if(p)select(p);}}>
   {choices.map(p=><option key={key(p)} value={key(p)} disabled={mismatch(p)}>{p.name}{p.id==='inherited'&&choices.filter(c=>c.name===p.name).length>1?' · '+(p.sha256?.slice(0,8)||p.cameraModel||p.kind.toUpperCase()):''}{mismatch(p)?'（机型不匹配）':''}</option>)}
   {!option&&value?.mode==='inherited'&&<option value={selected}>配方中的自定义配置文件</option>}
  </select></div>
  <button className="profile-import" disabled={disabled||pending} onClick={()=>void importFile()}>{pending?'正在导入…':'导入 DCP / ICC…'}</button>
  {value?.mode==='inherited'&&<p className="hint">{option?.kind==='icc'?'RGB ICC 不提供机型约束，请确认适用于此照片。':option?.cameraModel?`适用机型：${option.cameraModel}`:'此 DCP 未声明机型，请确认适用于此相机。'} {option?.embedPolicy===2?'此 DCP 禁止随附；保存编辑前请改选配置文件。':'保存编辑时随附配置文件。'}</p>}
  {error&&<p className="hint" role="alert">{error}</p>}
  {dcp&&<div className="dcp-options">{dcp.illuminants.length>1&&<div className="profile-select"><label htmlFor="dcp-light">光源</label><select id="dcp-light" aria-label="DCP 光源" value={value?.illuminant||0} disabled={disabled||pending} onChange={e=>change({illuminant:Number(e.target.value) as 0|1|2})}><option value="0">自动插值</option>{dcp.illuminants.map(l=><option key={l.id} value={l.id}>{Math.round(l.temperature)} K</option>)}</select></div>}
   {([['toneCurve','配置文件色调曲线'],['hueSatMap','基础颜色表'],['lookTable','风格表'],['baselineExposure','基准曝光补偿']] as const).filter(([k])=>dcp[k]).map(([k,label])=><label className="check-control" key={k}><input type="checkbox" disabled={disabled||pending} checked={value?.[k]??(k==='hueSatMap'||k==='baselineExposure')} onChange={e=>change({[k]:e.target.checked})}/>{label}</label>)}
  </div>}
 </>;
}
