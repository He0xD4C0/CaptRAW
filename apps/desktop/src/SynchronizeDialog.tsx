import {useEffect,useRef,useState} from 'react';
import {SYNC_GROUPS,DEFAULT_SYNC_GROUPS,type SyncGroup} from '@captraw/contracts/synchronize';
export function SynchronizeDialog({source,approximateWB,targets,progress,busy,error,apply,cancel}:{source:string;approximateWB:boolean;targets:string[];progress:string;busy:boolean;error:string;apply:(groups:SyncGroup[])=>void;cancel:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[groups,setGroups]=useState<SyncGroup[]>([...DEFAULT_SYNC_GROUPS]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="sync-dialog" aria-labelledby="sync-title" onCancel={e=>{e.preventDefault();cancel();}}>
  <h2 id="sync-title">同步设置</h2><p className="sync-source">从 <strong>{source}</strong> 同步到 {targets.length} 张照片</p>
  <details className="sync-targets"><summary>查看目标照片</summary><ul>{targets.map((name,i)=><li key={i}>{name}</li>)}</ul></details>
  <fieldset disabled={busy}><legend>选择要复制的调整项</legend><div className="sync-presets"><button onClick={()=>setGroups(SYNC_GROUPS.map(g=>g.id))}>全选</button><button onClick={()=>setGroups([])}>全不选</button><button onClick={()=>setGroups([...DEFAULT_SYNC_GROUPS])}>默认调整项</button></div><div className="sync-options">{SYNC_GROUPS.map(g=><label key={g.id}><input type="checkbox" checked={groups.includes(g.id)} onChange={e=>setGroups(old=>e.target.checked?[...old,g.id]:old.filter(id=>id!==g.id))}/>{g.label}</label>)}</div></fieldset>
  <p className="sync-note">输入色彩配置文件分别保留。白平衡按色温 / 色调同步；裁切、蒙版及修复位置按照片比例对应，修复半径保持原像素值。手动镜头配置会复制所选机身和镜头，须确认器材一致。</p>
  {approximateWB&&groups.includes('whiteBalance')&&<p className="sync-note">来源白平衡的色温 / 色调为近似值；同步不会复制其相机通道系数。</p>}
  <p className="sync-note">每张目标照片可单独撤销；同步后仍需保存编辑配方。</p>
  {error&&<p className="sync-error" role="alert">{error}</p>}{busy&&<p role="status">{progress||'正在准备同步…'}</p>}
  <footer><button onClick={cancel}>{busy?'取消同步':'取消'}</button><button className="primary" disabled={busy||!groups.length} onClick={()=>apply(groups)}>同步 {targets.length} 张照片</button></footer>
 </dialog>;
}
