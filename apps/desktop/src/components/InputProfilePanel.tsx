import {useEffect,useRef,useState} from 'react';
import type {ColorProfileSettings,ImageSession,InputProfileOption} from '@captraw/contracts';
import {Control} from './Panels';
const key=(p:InputProfileOption)=>p.enhanced?'look:'+p.enhanced.uuid+':'+(p.sha256||'current'):p.id==='inherited'?p.reference!:p.id;
export function InputProfilePanel({image,value,disabled,change,commit}:{image:ImageSession;value?:ColorProfileSettings;disabled:boolean;change:(value:Partial<ColorProfileSettings>,transient?:boolean)=>void;commit:()=>void}){
 const [library,setLibrary]=useState<InputProfileOption[]>([]),[current,setCurrent]=useState<InputProfileOption>(),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const active=useRef(image.id),latestChange=useRef(change);active.current=image.id;latestChange.current=change;
 useEffect(()=>()=>{active.current='';},[]);
 useEffect(()=>{let live=true;window.captraw.listInputProfiles().then(result=>{if(live){setLibrary(result.items);setError(result.errors.join('\n'));}}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[image.id]);
 useEffect(()=>{let live=true;setCurrent(undefined);if(value?.mode==='inherited'&&value.reference)window.captraw.inspectInputProfile(value.reference).then(info=>{if(live)setCurrent(info);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[value?.mode,value?.reference]);
 const choices=[...(image.inputProfiles||[]),...library.filter(p=>!current?.sha256||p.sha256!==current.sha256||p.reference===current.reference)];
 if(current&&!choices.some(p=>key(p)===key(current)))choices.push(current);
 const activeLook=value?.look;
 if(activeLook&&!choices.some(p=>p.enhanced&&JSON.stringify(p.enhanced)===JSON.stringify(activeLook.profile)))choices.push({id:'inherited',kind:'look',name:activeLook.profile.name,enhanced:activeLook.profile,settings:value});
 const lookOption=activeLook?choices.find(p=>p.enhanced&&JSON.stringify(p.enhanced)===JSON.stringify(activeLook.profile)):undefined;
 const selected=lookOption?key(lookOption):value?.mode==='inherited'?value.reference!:(value?.mode||'auto');
 const option=choices.find(p=>key(p)===selected),dcp=activeLook?undefined:option?.dcp;
 const raw=image.inputKind!=='rendered';
 const mismatch=(p:InputProfileOption)=>(p.kind==='dcp'&&!raw)||!!p.cameraModel&&p.cameraModel.trim().toUpperCase()!==(image.profileCamera||image.camera).trim().toUpperCase()||!!p.enhanced&&((raw&&!p.enhanced.supportsSceneReferred)||(!raw&&!p.enhanced.supportsOutputReferred));
 function select(p:InputProfileOption){setError('');latestChange.current(p.enhanced&&!p.enhanced.baseProfile&&!p.settings?.reference?{look:{profile:structuredClone(p.enhanced),amount:1}}:p.settings?structuredClone(p.settings):{mode:p.id,reference:p.reference,illuminant:0,look:null});}
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
  <button className="profile-import" disabled={disabled||pending} onClick={()=>void importFile()}>{pending?'正在导入…':'导入 DCP / ICC / Look…'}</button>
  {activeLook&&<><p className="hint">{activeLook.profile.group?activeLook.profile.group+' · ':''}{activeLook.profile.baseProfile||'当前输入配置'}{activeLook.profile.copyright?' · '+activeLook.profile.copyright:''}</p>{activeLook.profile.supportsAmount?<div inert={pending}><Control label="Look 强度" value={Math.round(activeLook.amount*100)} min={0} max={200} unit="%" change={amount=>change({look:{...activeLook,amount:amount/100}},true)} commit={commit}/></div>:<p className="hint">此 Look 固定为 100%，不提供强度调节。</p>}</>}
  {!activeLook&&value?.mode==='inherited'&&<p className="hint">{option?.kind==='icc'?'RGB ICC 不提供机型约束，请确认适用于此照片。':option?.cameraModel?`适用机型：${option.cameraModel}`:'此 DCP 未声明机型，请确认适用于此相机。'} {option?.embedPolicy===2?'此 DCP 禁止随附；保存编辑前请改选配置文件。':'保存编辑时随附配置文件。'}</p>}
  {error&&<p className="hint" role="alert">{error}</p>}
  {dcp&&<div className="dcp-options">{dcp.illuminants.length>1&&<div className="profile-select"><label htmlFor="dcp-light">光源</label><select id="dcp-light" aria-label="DCP 光源" value={value?.illuminant||0} disabled={disabled||pending} onChange={e=>change({illuminant:Number(e.target.value) as 0|1|2})}><option value="0">自动插值</option>{dcp.illuminants.map(l=><option key={l.id} value={l.id}>{Math.round(l.temperature)} K</option>)}</select></div>}
   {([['toneCurve','配置文件色调曲线'],['hueSatMap','基础颜色表'],['lookTable','风格表'],['baselineExposure','基准曝光补偿']] as const).filter(([k])=>dcp[k]).map(([k,label])=><label className="check-control" key={k}><input type="checkbox" disabled={disabled||pending} checked={value?.[k]??(k==='hueSatMap'||k==='baselineExposure')} onChange={e=>change({[k]:e.target.checked})}/>{label}</label>)}
  </div>}
 </>;
}
