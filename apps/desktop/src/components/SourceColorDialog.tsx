import {useState} from 'react';
import type {ImageSession,InputProfileOption} from '@captraw/contracts';

export function SourceColorDialog({image,onApply,onDismiss}:{image:ImageSession;onApply:(profile:InputProfileOption)=>void;onDismiss:()=>void}){
  const profiles=(image.inputProfiles??[]).filter(profile=>profile.kind==='icc'&&profile.reference);
  const current=image.adjustments.colorProfile?.reference;
  const [selected,setSelected]=useState(current??profiles[0]?.reference??'');
  const choice=profiles.find(profile=>profile.reference===selected);
  return <aside className="source-color-dialog" aria-label="源色彩空间">
    <div><strong>确认源色彩空间</strong><span>{image.name}</span></div>
    <p>文件没有可靠的色彩空间声明。当前按 sRGB 解释；这不会转换文件像素，只会记录输入解释。</p>
    <label>源空间<select aria-label="源色彩空间" value={selected} onChange={event=>setSelected(event.target.value)}>{profiles.map(profile=><option key={profile.reference} value={profile.reference}>{profile.name}</option>)}</select></label>
    <div className="source-color-actions"><button onClick={onDismiss}>保持 sRGB</button><button className="primary" disabled={!choice} onClick={()=>choice&&onApply(choice)}>使用所选空间</button></div>
  </aside>;
}
