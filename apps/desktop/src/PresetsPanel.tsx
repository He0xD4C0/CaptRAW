import {useEffect,useRef,useState} from 'react';
import {Plus,MoreHorizontal} from 'lucide-react';
import {SYNC_GROUPS,DEFAULT_SYNC_GROUPS,type SyncGroup} from '@captraw/contracts/synchronize';
import type {PresetSummary} from '@captraw/contracts/presets';
import type {useWorkbench} from './useWorkbench';
type Workbench=ReturnType<typeof useWorkbench>;
export function PresetsPanel({workbench:w}:{workbench:Workbench}){
 const [items,setItems]=useState<PresetSummary[]>([]),[errors,setErrors]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[menu,setMenu]=useState('');
 const [form,setForm]=useState<{mode:'create'|'rename'|'update'|'delete';item?:PresetSummary}>();
 const [name,setName]=useState(''),[group,setGroup]=useState('用户预设'),[groups,setGroups]=useState<SyncGroup[]>([...DEFAULT_SYNC_GROUPS]);const dialog=useRef<HTMLDialogElement>(null);
 async function refresh(){const r=await window.captraw.listPresets();setItems(r.items);setErrors(r.errors);}
 useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[]);
 useEffect(()=>{if(!form)return;const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[form]);
 function open(mode:NonNullable<typeof form>['mode'],item?:PresetSummary){setMenu('');setName(item?.name||'');setGroup(item?.group||'用户预设');setGroups(item?.groups||[...DEFAULT_SYNC_GROUPS]);setError('');setForm({mode,item});}
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function submit(){if(!form)return;await run(async()=>{
  if(form.mode==='delete')await window.captraw.deletePreset(form.item!.id);
  else if(form.mode==='rename')await window.captraw.renamePreset(form.item!.id,name,group);
  else{const prepared=await w.flush();if(!prepared)throw new Error('请先打开照片。');const input={name,group,groups,adjustments:prepared.doc.adjustments,artProfile:prepared.profile};if(form.mode==='update')await window.captraw.updatePreset(form.item!.id,input);else await window.captraw.createPreset(input);}
  setForm(undefined);
 });}
 const filtered=items.filter(p=>(p.name+' '+p.group).toLocaleLowerCase().includes(search.toLocaleLowerCase())),disabled=busy||w.presetBusy;
 return <section className="presets-panel" aria-label="用户预设"><div className="preset-actions"><button disabled={disabled||w.busy} onClick={()=>open('create')}><Plus size={15}/>创建预设</button><button disabled={disabled} onClick={()=>void run(()=>window.captraw.importPreset())}>导入…</button></div>
  <label className="preset-search"><span>搜索预设</span><input type="search" aria-label="搜索预设" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  {!items.length&&<p className="hint">将当前调整保存为用户预设，在其他照片上重复使用。</p>}
  {[...new Set(filtered.map(p=>p.group))].map(g=><details key={g} open className="preset-group"><summary>{g}</summary>{filtered.filter(p=>p.group===g).map(p=><div key={p.id} className="preset-row"><button className="preset-apply" disabled={disabled||w.busy} onClick={()=>void w.applyPreset(p.id)} title={SYNC_GROUPS.filter(g=>p.groups.includes(g.id)).map(g=>g.label).join('、')}>{p.name}</button><button aria-label={`管理 ${p.name}`} disabled={disabled} onClick={()=>setMenu(menu===p.id?'':p.id)}><MoreHorizontal size={17}/></button>{menu===p.id&&<div className="preset-menu"><button onClick={()=>open('rename',p)}>重命名 / 分组</button><button disabled={w.busy} onClick={()=>open('update',p)}>用当前设置更新</button><button onClick={()=>{setMenu('');void run(()=>window.captraw.exportPreset(p.id));}}>导出预设…</button><button onClick={()=>open('delete',p)}>删除预设…</button></div>}{!!p.warnings?.length&&<details className="xmp-notice"><summary>XMP 兼容说明</summary>{p.warnings.map(message=><p key={message}>{message}</p>)}</details>}{p.approximateWB&&<small>白平衡使用近似色温 / 色调</small>}</div>)}</details>)}
  {errors.length>0&&<details className="sync-error"><summary>部分预设无法读取</summary>{errors.map(e=><p key={e}>{e}</p>)}</details>}
  {error&&!form&&<p role="alert" className="sync-error">{error}</p>}
  <p className="hint">应用到当前照片，可撤销。输入配置文件保留；白平衡按色温 / 色调应用。蒙版是固定选区，不会自动识别新照片的对象。</p>
  {form&&<dialog ref={dialog} className="sync-dialog preset-dialog" aria-labelledby="preset-title" onCancel={e=>{e.preventDefault();if(!busy)setForm(undefined);}}><h2 id="preset-title">{form.mode==='delete'?'删除预设':form.mode==='rename'?'重命名预设':form.mode==='update'?'更新预设':'创建预设'}</h2>
   {form.mode==='delete'?<p>从预设列表删除“{form.item!.name}”？已应用的照片和编辑配方不受影响。</p>:<fieldset disabled={busy}><legend>预设信息</legend><label className="preset-field">名称<input autoFocus aria-label="预设名称" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label className="preset-field">分组<input aria-label="预设分组" list="preset-groups" maxLength={100} value={group} onChange={e=>setGroup(e.target.value)}/></label><datalist id="preset-groups">{[...new Set(items.map(p=>p.group))].map(g=><option key={g}>{g}</option>)}</datalist>
   {form.mode!=='rename'&&<><div className="sync-presets"><button onClick={()=>setGroups(SYNC_GROUPS.map(g=>g.id))}>全选</button><button onClick={()=>setGroups([])}>全不选</button><button onClick={()=>setGroups([...DEFAULT_SYNC_GROUPS])}>默认调整项</button></div><div className="sync-options">{SYNC_GROUPS.map(g=><label key={g.id}><input type="checkbox" checked={groups.includes(g.id)} onChange={e=>setGroups(old=>e.target.checked?[...old,g.id]:old.filter(id=>id!==g.id))}/>{g.label}</label>)}</div></>}
   </fieldset>}
   {form.mode!=='delete'&&<p className="sync-note">只保存所选调整。裁切、蒙版按照片比例对应；修复半径保留像素值。手动镜头配置仅适用于相同器材。{w.active?.adjustments.wbApproximate&&groups.includes('whiteBalance')?'当前白平衡色温 / 色调为近似值。':''}</p>}
   {error&&<p role="alert" className="sync-error">{error}</p>}<footer><button disabled={busy} onClick={()=>setForm(undefined)}>取消</button><button className="primary" disabled={busy||(form.mode!=='delete'&&(!name.trim()||!group.trim()||!groups.length))} onClick={()=>void submit()}>{busy?'正在保存…':form.mode==='delete'?'删除':form.mode==='update'?'更新':'保存预设'}</button></footer>
  </dialog>}
 </section>;
}

export function PresetProgress({cancel}:{cancel:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 return <dialog ref={dialog} className="sync-dialog" aria-label="应用预设" onCancel={e=>{e.preventDefault();cancel();}}><h2>正在应用预设</h2><p role="status">正在处理照片；完成后可撤销。</p><footer><button onClick={cancel}>取消应用</button></footer></dialog>;
}
