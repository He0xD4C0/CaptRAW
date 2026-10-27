import {Check,ArrowLeftRight,Ruler} from 'lucide-react';
import type {Adjustments,ImageSession} from '@captraw/contracts';
import {fitCropAspect} from './geometry';
import {Control} from './Panels';
export function flipCrop(a:Adjustments,image:ImageSession):Adjustments {
  const c=a.crop||{x:0,y:0,width:1,height:1},ratio=1/(a.cropAspect||c.width*image.width/(c.height*image.height));
  return {...a,cropAspect:a.cropAspect?ratio:null,crop:fitCropAspect(c,ratio*image.height/image.width)};
}
export function CropControls({value,image,edit,commit,done,straighten,toggleStraighten}:{value:Adjustments;image:ImageSession;edit:(fn:(a:Adjustments)=>Adjustments,transient?:boolean)=>void;commit:()=>void;done:()=>void;straighten:boolean;toggleStraighten:()=>void}){
  const turned=value.rotation%180!==0,locked=value.cropAspect||null,display=locked?(turned?1/locked:locked):null;
  const original=(image.cameraCrop?.width||1)*image.width/((image.cameraCrop?.height||1)*image.height);
  const presets=[['原照',turned?1/original:original],['1 : 1',1],['4 : 3',4/3],['3 : 2',3/2],['5 : 4',5/4],['7 : 5',7/5],['16 : 9',16/9]] as const;
  const selected=display?presets.findIndex(([,r])=>Math.abs(r-display)<1e-6):-1;
  function ratio(displayRatio:number|null){edit(a=>{if(!displayRatio)return {...a,cropAspect:null};const ratio=a.rotation%180?1/displayRatio:displayRatio;return {...a,cropAspect:ratio,crop:fitCropAspect(a.crop||{x:0,y:0,width:1,height:1},ratio*image.height/image.width)};});}
  return <div className="crop-actions"><label>比例 <select aria-label="裁切比例" value={locked?(selected<0?'custom':String(selected)):'free'} onChange={e=>ratio(e.target.value==='free'?null:presets[Number(e.target.value)][1])}><option value="free">自由</option>{presets.map(([name],i)=><option key={i} value={i}>{name}</option>)}{locked&&selected<0&&<option value="custom">当前比例</option>}</select></label>
    <label className="check-control"><input aria-label="锁定裁切比例" type="checkbox" checked={!!locked} onChange={e=>{if(!e.target.checked)ratio(null);else{const c=value.crop||{width:1,height:1},r=c.width*image.width/(c.height*image.height);ratio(turned?1/r:r);}}}/>锁定</label>
    <button aria-label="切换裁切横竖 X" title="切换横竖 X" onClick={()=>edit(a=>flipCrop(a,image))}><ArrowLeftRight size={15}/></button>
    <Control label="角度" value={value.fineRotation??0} min={-45} max={45} step={.01} unit="°" change={fineRotation=>edit(a=>({...a,fineRotation}),true)} commit={commit}/>
    <button disabled={!value.fineRotation} onClick={()=>edit(a=>({...a,fineRotation:0}))}>重置角度</button>
    <button aria-pressed={straighten} title="沿水平或竖直参照线拖动" onClick={toggleStraighten}><Ruler size={15}/>拉直</button>
    {image.cameraCrop&&<button onClick={()=>edit(a=>({...a,crop:image.cameraCrop!,cropAspect:null}))}>相机原始构图</button>}
    <button onClick={()=>edit(a=>({...a,crop:null,cropAspect:null}))}>清除裁切</button><button className="primary small" onClick={done}><Check size={14}/>完成</button>
    <small>{straighten?'沿应当水平或竖直的边缘拖线 · 松开应用 · Esc 取消':'拖动边角缩放 · 框内移动 · 框外新建'}</small>
  </div>;
}
