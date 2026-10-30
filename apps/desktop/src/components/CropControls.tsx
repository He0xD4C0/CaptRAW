import {useEffect,useRef,useState} from 'react';
import {Check,ArrowLeftRight,Ruler} from 'lucide-react';
import type {Adjustments,ImageSession} from '@captraw/contracts';
import {fitCropAspect} from '../lib/geometry';
import {Control} from './Panels';
export function flipCrop(a:Adjustments,image:ImageSession):Adjustments {
  const c=a.crop||{x:0,y:0,width:1,height:1},ratio=1/(a.cropAspect||c.width*image.width/(c.height*image.height));
  return {...a,cropAspect:a.cropAspect?ratio:null,crop:fitCropAspect(c,ratio*image.height/image.width)};
}
interface UserRatio {id:string;name:string;width:number;height:number}
const ratioLibraryKey='captraw.crop-ratios.v1';
const sameRatio=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
const validRatio=(width:number,height:number)=>Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&Number.isFinite(width/height)&&width/height>=1e-6&&width/height<=1e6;
function readRatios():UserRatio[]{
  try{const stored=JSON.parse(localStorage.getItem(ratioLibraryKey)||'null');if(stored?.version!==1||!Array.isArray(stored.ratios))return [];
    const ids=new Set<string>(),names=new Set<string>();
    return stored.ratios.filter((r:UserRatio)=>{if(!r||typeof r.id!=='string'||!r.id||typeof r.name!=='string'||!r.name.trim()||r.name.length>80||!validRatio(r.width,r.height)||ids.has(r.id)||names.has(r.name.toLowerCase()))return false;ids.add(r.id);names.add(r.name.toLowerCase());return true;});
  }catch{return [];}
}
function RatioDialog({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.showModal();return()=>{ref.current?.close();previous?.focus();};},[]);
  return <dialog ref={ref} className="crop-ratio-dialog" aria-label={title} onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>e.stopPropagation()}><h2>{title}</h2>{children}</dialog>;
}
export function CropControls({value,image,edit,commit,done,straighten,toggleStraighten,straightenDisabled}:{value:Adjustments;image:ImageSession;edit:(fn:(a:Adjustments)=>Adjustments,transient?:boolean)=>void;commit:()=>void;done:()=>void;straighten:boolean;toggleStraighten:()=>void;straightenDisabled:boolean}){
  const turned=value.rotation%180!==0,locked=value.cropAspect||null,display=locked?(turned?1/locked:locked):null;
  const [users,setUsers]=useState(readRatios),[dialog,setDialog]=useState<'create'|'manage'|'rename'|null>(null),[name,setName]=useState(''),[width,setWidth]=useState(''),[height,setHeight]=useState(''),[renameId,setRenameId]=useState(''),[error,setError]=useState('');
  const close=()=>{setDialog(null);setError('');};
  const format=(n:number)=>Number(n.toPrecision(8)).toString();

  const horizontal=value.flipHorizontal??image.effectiveGeometry?.flipHorizontal??false,vertical=value.flipVertical??image.effectiveGeometry?.flipVertical??false;
  const original=(image.cameraCrop?.width||1)*image.width/((image.cameraCrop?.height||1)*image.height);
  const presets=[['原照',turned?1/original:original],['1 : 1',1],['4 : 3',4/3],['3 : 2',3/2],['5 : 4',5/4],['7 : 5',7/5],['16 : 9',16/9]] as const;
  const selected=display?presets.findIndex(([,r])=>sameRatio(r,display)):-1;
  const user=display?users.find(r=>sameRatio(r.width/r.height,display)||sameRatio(r.height/r.width,display)):undefined;
  const selectedKey=!locked?'free':selected>=0?String(selected):user?'user:'+user.id:'custom';
  function candidate(displayRatio:number){
    const ratio=value.rotation%180?1/displayRatio:displayRatio;
    const crop=fitCropAspect(value.crop||{x:0,y:0,width:1,height:1},ratio*image.height/image.width);
    return validRatio(ratio,1)&&Object.values(crop).every(Number.isFinite)&&crop.width>=.001&&crop.height>=.001;
  }
  function ratio(displayRatio:number|null){
    if(displayRatio!==null&&!candidate(displayRatio)){setError('比例超出当前图像可用的裁切范围。');return false;}
    setError('');if(displayRatio===null?!locked:display!==null&&sameRatio(displayRatio,display))return true;
    edit(a=>{if(displayRatio===null)return {...a,cropAspect:null};const ratio=a.rotation%180?1/displayRatio:displayRatio;return {...a,cropAspect:ratio,crop:fitCropAspect(a.crop||{x:0,y:0,width:1,height:1},ratio*image.height/image.width)};});return true;
  }
  function store(next:UserRatio[]){try{localStorage.setItem(ratioLibraryKey,JSON.stringify({version:1,ratios:next}));setUsers(next);setError('');return true;}catch{setError('无法保存用户比例库，请检查本地存储后重试。');return false;}}
  function create(){const c=value.crop||{width:1,height:1},r=display??(turned?c.height*image.height/(c.width*image.width):c.width*image.width/(c.height*image.height));setName('');setWidth(String(r));setHeight('1');setError('');setDialog('create');}
  function submit(e:React.FormEvent){
    e.preventDefault();const clean=name.trim();
    if(!clean||clean.length>80||/[\x00-\x1f]/.test(clean)){setError('名称须为1–80个可见字符。');return;}
    if(presets.some(([label])=>label.toLowerCase()===clean.toLowerCase())||users.some(r=>r.id!==renameId&&r.name.toLowerCase()===clean.toLowerCase())){setError('该名称已存在，请使用其他名称。');return;}
    if(dialog==='rename'){if(store(users.map(r=>r.id===renameId?{...r,name:clean}:r)))setDialog('manage');return;}
    const w=Number(width),h=Number(height),r=w/h;
    if(!width.trim()||!height.trim()||!validRatio(w,h)||!candidate(r)){setError('请输入有限的正宽高值，并使比例处于当前图像可裁切范围。');return;}
    if(presets.some(([,p])=>sameRatio(p,r)||sameRatio(p,1/r))||users.some(p=>sameRatio(p.width/p.height,r)||sameRatio(p.height/p.width,r))){setError('该比例已存在，可从比例菜单选择并切换横竖。');return;}
    if(store([...users,{id:crypto.randomUUID(),name:clean,width:w,height:h}])){ratio(r);close();}
  }
  return <div className="crop-actions"><label>比例 <select aria-label="裁切比例" value={selectedKey} onChange={e=>{const key=e.target.value;if(key==='custom')return;if(key==='free')ratio(null);else if(key.startsWith('user:')){const r=users.find(r=>r.id===key.slice(5));if(r)ratio(r.width/r.height);}else ratio(presets[Number(key)][1]);}}><option value="free">自由</option>{presets.map(([name],i)=><option key={i} value={i}>{name}</option>)}{users.length>0&&<optgroup label="用户比例">{users.map(r=>{const swapped=r.id===user?.id&&display!==null&&!sameRatio(display,r.width/r.height);return <option key={r.id} value={'user:'+r.id}>{r.name} · {format(swapped?r.height:r.width)} : {format(swapped?r.width:r.height)}</option>;})}</optgroup>}{locked&&selected<0&&!user&&<option value="custom">当前比例 · {format(display!)} : 1</option>}</select></label>
    <button onClick={()=>{setRenameId('');create();}}>自定义比例…</button><button onClick={()=>{setError('');setDialog('manage');}}>管理比例…</button>
    {error&&!dialog&&<span className="crop-ratio-error" role="alert">{error}</span>}
    {dialog&&<RatioDialog title={dialog==='create'?'自定义比例':dialog==='rename'?'重命名比例':'管理用户比例'} close={close}>
      {dialog==='manage'?<><p>内置比例保持不变。删除用户比例不会改变当前裁切。</p>{users.length?<ul>{users.map(r=><li key={r.id}><span>{r.name} · {format(r.width)} : {format(r.height)}</span><button aria-label={'重命名 '+r.name} onClick={()=>{setRenameId(r.id);setName(r.name);setError('');setDialog('rename');}}>重命名</button><button aria-label={'删除 '+r.name} onClick={()=>store(users.filter(item=>item.id!==r.id))}>删除</button></li>)}</ul>:<p>尚无用户比例。</p>}{error&&<p className="crop-ratio-error" role="alert">{error}</p>}<footer><button onClick={close}>完成</button></footer></>:<form noValidate onSubmit={submit}><label>名称<input aria-label="比例名称" autoFocus value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>{dialog==='create'&&<div className="crop-ratio-inputs"><label>宽<input aria-label="比例宽" type="number" step="any" value={width} onChange={e=>setWidth(e.target.value)}/></label><span>:</span><label>高<input aria-label="比例高" type="number" step="any" value={height} onChange={e=>setHeight(e.target.value)}/></label></div>}{error&&<p className="crop-ratio-error" role="alert">{error}</p>}<footer><button type="button" onClick={()=>dialog==='rename'?(setDialog('manage'),setError('')):close()}>取消</button><button className="primary" type="submit">{dialog==='create'?'创建并应用':'保存名称'}</button></footer></form>}
    </RatioDialog>}
    <label className="check-control"><input aria-label="锁定裁切比例" type="checkbox" checked={!!locked} onChange={e=>{if(!e.target.checked)ratio(null);else{const c=value.crop||{width:1,height:1},r=c.width*image.width/(c.height*image.height);ratio(turned?1/r:r);}}}/>锁定</label>
    <button aria-label="切换裁切横竖 X" title="切换横竖 X" onClick={()=>edit(a=>flipCrop(a,image))}><ArrowLeftRight size={15}/></button>
    <button aria-pressed={horizontal} disabled={straightenDisabled} onClick={()=>edit(a=>({...a,flipHorizontal:!horizontal}))}>水平翻转</button>
    <button aria-pressed={vertical} disabled={straightenDisabled} onClick={()=>edit(a=>({...a,flipVertical:!vertical}))}>垂直翻转</button>
    <Control label="角度" value={value.fineRotation??0} min={-45} max={45} step={.01} unit="°" change={fineRotation=>edit(a=>({...a,fineRotation}),true)} commit={commit}/>
    <button disabled={!value.fineRotation} onClick={()=>edit(a=>({...a,fineRotation:0}))}>重置角度</button>
    <button aria-pressed={straighten} disabled={straightenDisabled} title={straightenDisabled?'退出前后对比后画线拉直':'沿水平或竖直参照线拖动'} onClick={toggleStraighten}><Ruler size={15}/>拉直</button>
    {image.cameraCrop&&<button onClick={()=>edit(a=>({...a,crop:image.cameraCrop!,cropAspect:null}))}>相机原始构图</button>}
    <button onClick={()=>edit(a=>({...a,crop:null,cropAspect:null}))}>清除裁切</button><button className="primary small" onClick={done}><Check size={14}/>完成</button>
    <small>{straighten?'沿应当水平或竖直的边缘拖线 · 松开应用 · Esc 取消':'拖动边角缩放 · 框内移动 · 框外新建'}</small>
  </div>;
}
