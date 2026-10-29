import {useEffect,useRef,useState} from 'react';
import {Plus,MoreHorizontal,Star} from 'lucide-react';
import {Control,ControlEditContext} from './Panels';
import {SYNC_GROUPS,DEFAULT_SYNC_GROUPS,type SyncGroup} from '@captraw/contracts/synchronize';
import type {PresetSummary} from '@captraw/contracts/presets';
import {canCreateISO} from '@captraw/contracts/presets';
import type {useWorkbench} from './useWorkbench';
type Workbench=ReturnType<typeof useWorkbench>;
export function PresetsPanel({workbench:w}:{workbench:Workbench}){
 const [items,setItems]=useState<PresetSummary[]>([]),[errors,setErrors]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[menu,setMenu]=useState('');
 const [importNotice,setImportNotice]=useState<{name:string;warnings:string[]}>();
 const [form,setForm]=useState<{mode:'create'|'iso'|'duplicate'|'rename'|'update'|'delete';item?:PresetSummary}>();
 const [amount,setAmount]=useState(100),[lastPreset,setLastPreset]=useState<PresetSummary>(),[favoritesOnly,setFavoritesOnly]=useState(false);const amountRef=useRef(100);
 const amountGesture=useRef<number|undefined>(undefined);
 const [name,setName]=useState(''),[group,setGroup]=useState('用户预设'),[groups,setGroups]=useState<SyncGroup[]>([...DEFAULT_SYNC_GROUPS]);const dialog=useRef<HTMLDialogElement>(null);
 async function refresh(){const r=await window.captraw.listPresets();setItems(r.items);setErrors(r.errors);}
 useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[]);
 useEffect(()=>()=>w.cancelPresetAmount(),[]);
 useEffect(()=>{if(!form)return;const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[form]);
 function open(mode:NonNullable<typeof form>['mode'],item?:PresetSummary){setMenu('');setName(item?.name||'');setGroup(item?.group||'用户预设');setGroups(item?.groups||[...DEFAULT_SYNC_GROUPS]);setError('');setForm({mode,item});}
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function submit(){if(!form)return;await run(async()=>{
  if(form.mode==='delete')await window.captraw.deletePreset(form.item!.id);
  else if(form.mode==='duplicate')await window.captraw.duplicatePreset(form.item!.id,name,group);
  else if(form.mode==='iso')await window.captraw.createISOPreset({name,group,groups,documents:w.getSelectedDocuments().map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile}))});
  else if(form.mode==='rename')await window.captraw.renamePreset(form.item!.id,name,group);
  else{const prepared=await w.flush();if(!prepared)throw new Error('请先打开照片。');const input={name,group,groups,adjustments:prepared.doc.adjustments,artProfile:prepared.profile};if(form.mode==='update')await window.captraw.updatePreset(form.item!.id,input);else await window.captraw.createPreset(input);}
  setForm(undefined);
 });}
 const filtered=items.filter(p=>(!favoritesOnly||p.favorite)&&(p.name+' '+p.group).toLocaleLowerCase().includes(search.toLocaleLowerCase())),disabled=busy||w.presetBusy||w.opening;
 async function apply(p:PresetSummary,nextAmount=amountRef.current,strengthGesture=false){void w.presetPreview.cancel();if(await w.applyPreset(p.id,p.supportsAmount===false?100:nextAmount,strengthGesture))setLastPreset(p);}
 function beginAmount(){if(amountGesture.current!==undefined)return;amountGesture.current=amountRef.current;if(lastPreset)w.beginPresetAmount();}
 function cancelAmount(){const previous=amountGesture.current;if(previous===undefined)return false;amountGesture.current=undefined;amountRef.current=previous;setAmount(previous);w.cancelPresetAmount();return true;}
 function finishAmount(){if(amountGesture.current===undefined)return;amountGesture.current=undefined;void w.presetPreview.cancel();if(lastPreset)void apply(lastPreset,amountRef.current,true);}
 return <section className="presets-panel" aria-label="用户预设"><div className="preset-actions"><button disabled={disabled||w.busy} onClick={()=>open('create')}><Plus size={15}/>创建预设</button><button disabled={disabled||w.busy||!canCreateISO(w.getSelectedDocuments().map(d=>d.image))} title="至少两张已解码 RAW，具有有效且不同的 ISO" onClick={()=>open('iso')}>创建 ISO 自适应…</button><button disabled={disabled} onClick={()=>void run(async()=>{setImportNotice(undefined);const result=await window.captraw.importPreset();if(result?.warnings?.length)setImportNotice({name:result.name,warnings:result.warnings});})}>导入…</button></div>
  {importNotice&&<details className="xmp-notice preset-import-notice" open><summary>已导入 {importNotice.name} · XMP 导入说明</summary>{importNotice.warnings.map(message=><p key={message}>{message}</p>)}</details>}
  <label className="preset-search"><span>搜索预设</span><input type="search" aria-label="搜索预设" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  <label className="check-control"><input type="checkbox" checked={favoritesOnly} onChange={e=>setFavoritesOnly(e.target.checked)}/>仅收藏</label>
  {lastPreset?.supportsAmount!==false&&<ControlEditContext.Provider value={cancelAmount}><div className="preset-amount"><Control label="预设强度" value={amount} min={0} max={200} unit="%" change={value=>{beginAmount();amountRef.current=value;setAmount(value);if(lastPreset)w.presetPreview.show(lastPreset.id,value);}} commit={finishAmount}/></div></ControlEditContext.Provider>}
  <p className="preset-preview-status hint" role="status" title={w.presetPreview.error}>{w.presetPreview.error|| (w.presetPreview.pending?'正在预览预设…':w.presetPreview.preview?'预设预览 · 移开指针恢复，单击应用':'悬停预设查看效果')}</p>
  {!!w.presetWarnings.length&&<details className="xmp-notice" open><summary>预设应用说明</summary>{w.presetWarnings.map(message=><p key={message}>{message}</p>)}</details>}
  {!items.length&&<p className="hint">将当前调整保存为用户预设，在其他照片上重复使用。</p>}
  {[...new Set(filtered.map(p=>p.group))].map(g=><details key={g} open className="preset-group"><summary>{g}</summary>{filtered.filter(p=>p.group===g).map(p=><div key={p.id} className="preset-row"><button className="preset-apply" disabled={disabled||w.busy} onPointerEnter={()=>{if(!disabled&&!w.busy)w.presetPreview.show(p.id,p.supportsAmount===false?100:amountRef.current);}} onPointerLeave={()=>void w.presetPreview.cancel()} onFocus={()=>{if(!disabled&&!w.busy)w.presetPreview.show(p.id,p.supportsAmount===false?100:amountRef.current);}} onBlur={()=>void w.presetPreview.cancel()} onClick={()=>void apply(p)} title={SYNC_GROUPS.filter(g=>p.groups.includes(g.id)).map(g=>g.label).join('、')}>{p.name}{p.isoAdaptive?' · ISO':''}{p.origin==='builtin'?' · 内置':''}</button><button aria-label={`${p.favorite?'取消收藏':'收藏'} ${p.name}`} aria-pressed={!!p.favorite} disabled={disabled} onClick={()=>void run(()=>window.captraw.favoritePreset(p.id,!p.favorite))}><Star size={14} fill={p.favorite?'currentColor':'none'}/></button><button aria-label={`管理 ${p.name}`} disabled={disabled} onClick={()=>setMenu(menu===p.id?'':p.id)}><MoreHorizontal size={17}/></button>{menu===p.id&&<div className="preset-menu"><button onClick={()=>open('duplicate',p)}>创建用户副本…</button><button disabled={p.origin==='builtin'} onClick={()=>open('rename',p)}>重命名 / 分组</button><button disabled={w.busy||p.origin==='builtin'} onClick={()=>open('update',p)}>用当前设置更新</button><button onClick={()=>{setMenu('');void run(()=>window.captraw.exportPreset(p.id));}}>导出预设…</button><button disabled={p.origin==='builtin'} onClick={()=>open('delete',p)}>删除预设…</button></div>}{!!p.warnings?.length&&<details className="xmp-notice"><summary>XMP 兼容说明</summary>{p.warnings.map(message=><p key={message}>{message}</p>)}</details>}{p.approximateWB&&<small>白平衡使用近似色温 / 色调</small>}</div>)}</details>)}
  {errors.length>0&&<details className="sync-error"><summary>部分预设无法读取</summary>{errors.map(e=><p key={e}>{e}</p>)}</details>}
  {error&&!form&&<p role="alert" className="sync-error">{error}</p>}
  <p className="hint">单击应用到所选的可见照片，可共同或单张撤销。悬停仅预览当前照片，不改变编辑。输入配置文件保留；白平衡按色温 / 色调应用。蒙版是固定选区，不会自动识别新照片的对象。</p>
  {form&&<dialog ref={dialog} className="sync-dialog preset-dialog" aria-labelledby="preset-title" onCancel={e=>{e.preventDefault();if(!busy)setForm(undefined);}}><h2 id="preset-title">{form.mode==='delete'?'删除预设':form.mode==='rename'?'重命名预设':form.mode==='update'?'更新预设':form.mode==='iso'?'创建 ISO 自适应预设':form.mode==='duplicate'?'创建用户副本':'创建预设'}</h2>
   {form.mode==='delete'?<p>从预设列表删除“{form.item!.name}”？已应用的照片和编辑配方不受影响。</p>:<fieldset disabled={busy}><legend>预设信息</legend><label className="preset-field">名称<input autoFocus aria-label="预设名称" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label className="preset-field">分组<input aria-label="预设分组" list="preset-groups" maxLength={100} value={group} onChange={e=>setGroup(e.target.value)}/></label><datalist id="preset-groups">{[...new Set(items.map(p=>p.group))].map(g=><option key={g}>{g}</option>)}</datalist>
   {form.mode!=='rename'&&form.mode!=='duplicate'&&<><div className="sync-presets"><button onClick={()=>setGroups(SYNC_GROUPS.map(g=>g.id))}>全选</button><button onClick={()=>setGroups([])}>全不选</button><button onClick={()=>setGroups([...DEFAULT_SYNC_GROUPS])}>默认调整项</button></div><div className="sync-options">{SYNC_GROUPS.map(g=><label key={g.id}><input type="checkbox" checked={groups.includes(g.id)} onChange={e=>setGroups(old=>e.target.checked?[...old,g.id]:old.filter(id=>id!==g.id))}/>{g.label}</label>)}</div></>}
   </fieldset>}
   {form.mode==='iso'&&<p className="sync-note">至少两张不同 ISO 的 RAW。数值按 ISO 档位插值；曲线、枚举及空间设置须保持相同。同 ISO 冲突或缺少 ISO 时不会创建。</p>}
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
