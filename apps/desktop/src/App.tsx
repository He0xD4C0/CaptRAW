import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Aperture, ArrowDownToLine, Brush, Check, ChevronDown, Circle, Crop, Eraser, FolderOpen, Hand, Layers2, Pipette, MoveDownRight, RotateCcw, RotateCw, Save, SlidersHorizontal, Undo2, Redo2, X, Image as ImageIcon } from 'lucide-react';
import { useWorkbench } from './useWorkbench';
import { Viewport, type Tool } from './Viewport';
import { AdjustmentsPanel, MaskPanel } from './Panels';
import {Histogram} from './Histogram';
import type { MaskType } from '../../../packages/contracts';
export function App() {
  const w=useWorkbench();
  const [tool,setTool]=useState<Tool>('hand'),[tab,setTab]=useState('adjust'),[selectedId,setSelectedId]=useState(''),[componentId,setComponentId]=useState('');
  const [brushSize,setBrushSize]=useState(.25),[overlay,setOverlay]=useState(true),[comparing,setComparing]=useState(false),[exportMenu,setExportMenu]=useState(false);
  const [sampleSize,setSampleSize]=useState(11);
  const a=w.active?.adjustments,selected=a?.masks.find(m=>m.id===selectedId)||a?.masks[0];
  const profileName=w.active?.image.inputProfiles?.find(p=>p.id===(a?.colorProfile?.mode||'auto'))?.name||(a?.colorProfile?.mode==='inherited'?'配方中的配置文件':'ART 默认显影');
  const component=selected?.components?.find(c=>c.id===componentId)||selected?.components?.[0];
  const geometry=selected?.components?(component?{...selected,...component,id:selected.id,enabled:selected.enabled&&component.enabled}:undefined):selected;
  const previewMaskId=tab==='mask'&&overlay&&selected?.enabled?selected.id:'';
  useEffect(()=>w.setMaskPreview(previewMaskId),[previewMaskId]);
  const choose=async()=>{const files=await window.captraw.chooseFiles();void w.openPaths(files);};
  function addMask(type:MaskType){const id=w.addMask(type);setSelectedId(id);setComponentId('');setTool(type);setTab('mask');}
  function addComponent(type:MaskType,operation:'add'|'subtract'|'intersect'){
    if(!selected)return;const id=crypto.randomUUID(),name=`${type==='brush'?'画笔':type==='linear'?'线性':'径向'} ${(selected.components?.length||1)+1}`;
    const next={id,name,type,operation,enabled:true,inverted:false,feather:30,points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},initialized:false};
    w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected.id?{...m,components:[...(m.components||[{id:crypto.randomUUID(),name:m.name,type:m.type,enabled:true,inverted:false,feather:m.feather,points:m.points,start:m.start,end:m.end,operation:'add' as const}]),next]}:m)}));
    setComponentId(id);setTool(type);setTab('mask');
  }
  function activate(next:Tool){
    if(!w.active)return;
    if(next==='brush'||next==='linear'||next==='radial'){
      if(geometry?.type!==next){addMask(next);return;}setTab('mask');
    }
    if(next==='eraser'&&geometry?.type!=='brush')return;
    if(next==='crop'||next==='white-balance')setTab('adjust');setTool(next);
  }
  function compare(value:boolean){setComparing(value);void w.compare(value);}
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{
      const editable=(e.target as HTMLElement)?.matches('input,textarea,[contenteditable]');
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();void choose();return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void w.save();return;}
      if(editable||(!(e.metaKey||e.ctrlKey)&&(e.target as HTMLElement)?.matches('select')))return;
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();w.undo(e.shiftKey);return;}
      if(!e.metaKey&&!e.ctrlKey&&(e.key==='\\'||e.key.toLowerCase()==='p')&&!e.repeat&&w.active){e.preventDefault();compare(!comparing);return;}
      if(e.key==='Escape'){setTool('hand');setTab('adjust');setExportMenu(false);return;}
      if(!e.metaKey&&!e.ctrlKey&&e.key.toLowerCase()==='m'){setTab('mask');setTool(geometry?.type||'hand');return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='w'){e.preventDefault();if(w.active)void w.closeDocument(w.active.image.id);return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='r'){e.preventDefault();w.reset();return;}
      if(e.metaKey||e.ctrlKey)return;
      const key=e.key.toLowerCase();
      if(key==='e'){setTab('adjust');setTool('hand');return;}
      if(key==='k'&&!e.repeat){if(e.shiftKey&&selected)addComponent('brush','add');else addMask('brush');return;}
      if((key==='r'||key==='l')&&w.active){w.edit(a=>({...a,rotation:(a.rotation+(key==='r'?90:270))%360}));return;}
      if(key==='y'){setOverlay(v=>!v);return;}
      if(key==='x'&&tab==='mask'&&selected){w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected.id?{...m,inverted:!m.inverted}:m)}));return;}
      if(tab==='mask'&&(e.code==='BracketLeft'||e.code==='BracketRight'||e.key==='['||e.key===']')){
        e.preventDefault();const delta=e.code==='BracketLeft'||e.key==='['?-1:1;
        if(e.shiftKey&&geometry){w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected?.id?(component?{...m,components:m.components?.map(c=>c.id===component.id?{...c,feather:Math.max(0,Math.min(100,c.feather+delta*5))}:c)}:{...m,feather:Math.max(0,Math.min(100,m.feather+delta*5))}):m)}));}
        else setBrushSize(size=>Math.max(.02,Math.min(1.5,size*(delta>0?1.1:1/1.1))));return;
      }
      const shortcuts:Record<string,Tool>={h:'hand',g:'linear',j:'radial',c:'crop',i:'white-balance'};
      if(shortcuts[e.key.toLowerCase()])activate(shortcuts[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown',down);
    return()=>{window.removeEventListener('keydown',down);};
  },[w.active,selected,component,comparing,tab]);
  useEffect(()=>{setSelectedId('');setComponentId('');setTool('hand');setComparing(false);},[w.active?.image.id]);
  return <div className="app">
    <header className="titlebar"><div className="brand"><Aperture size={21} strokeWidth={1.5}/><b>Capt<span>RAW</span></b><em>显影工作台</em></div><div className="document-title">{w.active?<>{w.active.image.name}{w.active.dirty&&<i className="dirty-dot"/>}<button className="close-document" aria-label="关闭当前文件" title="关闭当前文件 ⌘W" onClick={()=>w.closeDocument(w.active!.image.id)}><X size={14}/></button></>:<span>每张原片，都值得好好显影。</span>}</div><div className="header-actions"><button className="icon-text" disabled={w.opening} onClick={choose} title="打开照片 ⌘O"><FolderOpen size={15}/>打开</button><button className="icon-text" disabled={!w.active||w.opening} onClick={w.save} title="保存编辑配方 ⌘S"><Save size={15}/>保存</button><div className="export-container"><button className="export-button" disabled={!w.active||w.opening||w.job?.state==='running'} onClick={()=>setExportMenu(!exportMenu)}><ArrowDownToLine size={15}/>导出<ChevronDown size={12}/></button>{exportMenu&&<div className="export-menu"><button onClick={()=>{setExportMenu(false);void w.exportImage('jpeg');}}><strong>JPEG</strong><span>sRGB · 适合分享</span></button><button onClick={()=>{setExportMenu(false);void w.exportImage('tiff');}}><strong>TIFF · 16 位</strong><span>sRGB ICC · 保留细腻层次</span></button></div>}</div></div></header>
    <div className="workbench" inert={w.opening}>
    <main className="stage"><div className="stage-toolbar"><div className="stage-meta">{w.active?<><span className="camera-name">{w.active.image.camera}</span><span>{w.active.image.iso?`ISO ${w.active.image.iso}`:''}</span><span>{w.frame?`${w.frame.fullWidth} × ${w.frame.fullHeight}`:''}</span></>:<span>RAW DEVELOPMENT</span>}</div><div className="stage-actions"><button title="撤销 ⌘Z" aria-label="撤销" disabled={!w.active?.past.length} onClick={()=>w.undo()}><Undo2 size={15}/></button><button title="重做 ⇧⌘Z" aria-label="重做" disabled={!w.active?.future.length} onClick={()=>w.undo(true)}><Redo2 size={15}/></button><span className="toolbar-separator"/><button className={comparing?'active':''} disabled={!a} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);compare(true);}} onPointerUp={()=>compare(false)} onPointerCancel={()=>compare(false)} title="按住查看初始显影；P 或反斜杠切换对比"><Layers2 size={15}/><span>{comparing?'初始显影':'按住对比'}</span></button></div></div>
      <Viewport frame={w.frame} detailFrame={w.detailFrame} adjustments={a} tool={tool} selectedMask={tab==='mask'&&geometry?.enabled?geometry:undefined} maskId={previewMaskId} componentId={component?.id} sample={point=>w.whiteBalance({mode:'sample',x:point.x,y:point.y,size:sampleSize})} brushSize={brushSize} overlay={overlay} busy={w.busy} edit={w.edit} commit={w.commit} open={choose} drop={w.openPaths} viewport={w.viewport}/>
      {w.error&&<div className="error-banner" role="alert"><span>{w.error.replace('Error: ','')}</span>{w.active&&<button onClick={()=>w.switchDocument(w.active!.image.id,true)}>重新载入当前编辑</button>}<button title="关闭错误" onClick={()=>w.setError('')}><X size={15}/></button></div>}
      {tool==='white-balance'&&a&&<div className="sample-actions"><Pipette size={14}/><span>白平衡取样</span><select aria-label="取样大小" value={sampleSize} onChange={e=>setSampleSize(Number(e.target.value))}>{[5,11,25].map(n=><option key={n} value={n}>{n} × {n} 像素</option>)}</select><button onClick={()=>setTool('hand')}>完成取样</button></div>}
      {tool==='crop'&&a&&<div className="crop-actions"><span>在照片上拖动裁切</span><button onClick={()=>w.edit(a=>({...a,crop:null}))}>清除裁切</button><button className="primary small" onClick={()=>setTool('hand')}><Check size={14}/>完成</button></div>}
    <footer className="filmstrip"><button className="add-images" disabled={w.opening} title="添加照片" onClick={choose}><FolderOpen size={20}/><span>添加照片</span></button><div className="filmstrip-items">{w.documents.map(d=><div key={d.image.id} className={`film-item ${d.image.id===w.active?.image.id?'selected':''}`}><button className="film-open" disabled={w.opening} onClick={()=>w.switchDocument(d.image.id)} title={d.image.path}>{d.thumbnail?<img src={d.thumbnail} data-frame={d.thumbnailFrame} alt={d.image.name}/>:<ImageIcon size={25} strokeWidth={1}/>}<span>{d.image.name}</span>{d.dirty&&<i className="dirty-dot"/>}</button><button className="film-close" aria-label={`关闭 ${d.image.name}`} title="关闭文件" disabled={w.opening} onClick={()=>w.closeDocument(d.image.id)}><X size={13}/></button></div>)}{!w.documents.length&&<div className="filmstrip-empty"><span>当前会话</span><small>打开的照片会显示在这里</small></div>}</div><div className="image-count">{w.documents.length.toString().padStart(2,'0')}<small>张照片</small></div></footer>
    </main>
    <aside className="inspector"><Histogram frame={w.frame} image={w.active?.image}/><div className="profile-line"><b>{tab==='mask'?'蒙版':'编辑'}</b><span title={tab==='mask'?'局部调整':profileName}>{tab==='mask'?'局部调整':profileName}</span></div><Tabs.Root value={tab} onValueChange={value=>{setTab(value);setTool(value==='mask'?geometry?.type||'hand':'hand');}}><Tabs.List className="inspector-tabs"><Tabs.Trigger value="adjust"><SlidersHorizontal size={15}/>调节</Tabs.Trigger><Tabs.Trigger value="mask"><Circle size={15}/>蒙版{a?.masks.length?<span>{a.masks.length}</span>:null}</Tabs.Trigger></Tabs.List><div className="inspector-content">{a?<><Tabs.Content value="adjust"><AdjustmentsPanel value={a} edit={w.edit} commit={w.commit} image={w.active!.image} whiteBalance={w.whiteBalance} picker={()=>activate('white-balance')} pickerActive={tool==='white-balance'} disabled={w.busy}/></Tabs.Content><Tabs.Content value="mask"><MaskPanel masks={a.masks} selected={selected} componentId={component?.id} addComponent={addComponent} onComponent={id=>{setComponentId(id);const c=selected?.components?.find(c=>c.id===id);if(c)setTool(c.type);}} onSelect={id=>{setSelectedId(id);setComponentId('');const mask=a.masks.find(m=>m.id===id);if(mask)setTool(mask.components?.[0]?.type||mask.type);}} add={addMask} edit={w.edit} commit={w.commit} brushSize={brushSize} setBrushSize={setBrushSize} overlay={overlay} setOverlay={setOverlay}/></Tabs.Content></>:<div className="inspector-placeholder"><SlidersHorizontal size={27} strokeWidth={1}/><p>打开照片，开始调整</p><span>光线、色彩与局部细节</span></div>}</div></Tabs.Root><div className="inspector-footer"><span className="profile-badge">sRGB</span><span>无损编辑</span><button disabled={!a} title="重置全部编辑" onClick={w.reset}><RotateCcw size={13}/>重置</button></div></aside><aside className="tools" aria-label="工具"><button aria-label="编辑" title="编辑" className={tab==='adjust'&&tool!=='crop'?'selected':''} onClick={()=>{setTab('adjust');setTool('hand');}}><SlidersHorizontal size={20}/></button><button aria-label="裁切 C" title="裁切 C" className={tool==='crop'?'selected':''} disabled={!a} onClick={()=>activate('crop')}><Crop size={20}/></button><button aria-label="蒙版 M" title="蒙版 M" className={tab==='mask'?'selected':''} disabled={!a} onClick={()=>{setTab('mask');setTool(geometry?.type||'hand');}}><Circle size={20}/></button>{tab==='mask'&&<><div className="tool-divider"/><button aria-label="画笔蒙版 K" title="画笔 K" onClick={()=>activate('brush')}><Brush size={19}/></button><button aria-label="蒙版橡皮擦" title="橡皮擦 · 按住 Option 临时擦除" disabled={geometry?.type!=='brush'} onClick={()=>activate('eraser')}><Eraser size={19}/></button></>}<div className="tool-divider"/><button aria-label="白平衡 I" title="白平衡 I" disabled={!a||w.busy} className={tool==='white-balance'?'selected':''} onClick={()=>activate('white-balance')}><Pipette size={19}/></button><button aria-label="平移 H" title="平移 H" onClick={()=>setTool('hand')}><Hand size={19}/></button><button aria-label="顺时针旋转 90 度" title="旋转 90°" disabled={!a} onClick={()=>w.edit(a=>({...a,rotation:(a.rotation+90)%360}))}><RotateCw size={19}/></button></aside></div>

    <div className="statusbar"><span><i className={w.busy?'status-dot busy':'status-dot'}/>{w.busy?'正在处理照片…':w.status}</span><span className="status-actions"><button disabled={!w.active||w.opening} onClick={()=>w.closeDocument(w.active!.image.id)}>关闭文件</button><button disabled={!w.active||w.opening} onClick={w.finish}>完成</button><span>SDR · sRGB · 16 位输出</span></span></div>
    {w.job&&<div className={`job-toast ${w.job.state}`} role="status"><div><ArrowDownToLine size={17}/><span>{w.job.message}</span>{w.job.state==='running'&&<button onClick={()=>window.captraw.cancel()}>取消</button>}</div>{w.job.state==='running'&&<progress max={1} value={w.job.progress}/>}</div>}
  </div>;
}
