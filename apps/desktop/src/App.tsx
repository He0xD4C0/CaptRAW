import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Blend, ArrowLeftRight, Copy, ArrowDownToLine, Brush, ChevronDown, Circle, Crop, Eraser, FolderOpen, Hand, Layers2, Pipette, RotateCcw, RotateCw, Save, SlidersHorizontal, Undo2, Redo2, X, Image as ImageIcon } from 'lucide-react';
import {useComparison,comparisonLayouts,comparisonNames} from './useComparison';
import { useWorkbench } from './useWorkbench';
import logo from './assets/logo.svg';
import { Viewport, type Tool } from './Viewport';
import { AdjustmentsPanel, MaskPanel } from './Panels';
import {useObjectSelection,ObjectSelectionPanel} from './ObjectSelection';
import {PresetsPanel,PresetProgress} from './PresetsPanel';
import {RepairPanel} from './RepairPanel';
import {CropControls,flipCrop} from './CropControls';
import {DEFAULT_EXPORT_OPTIONS,type ExportOptions} from '@captraw/contracts/export-options';
import {ExportMenu} from './ExportMenu';
import {SynchronizeDialog} from './SynchronizeDialog';
import {BatchSaveDialog} from './BatchSaveDialog';
import {Histogram} from './Histogram';
import {rotateCrop} from './geometry';
import {OUTPUT_COLOR_SPACES,type MaskGeometry,type MaskType,type Point,type SpotSettings,type RepairSpot,type OutputColorSpace } from '@captraw/contracts';
const maskTool=(type?:MaskType):Tool=>!type||type==='raster'?'hand':type;
export function App() {
  const w=useWorkbench();
  const comparison=useComparison(w.active);const dual=comparison.layout!=='off',comparing=comparison.showBefore,setComparing=comparison.setShowBefore;
  const [selectedPaths,setSelectedPaths]=useState<string[]>([]);
  useEffect(()=>setSelectedPaths(w.active?[w.active.image.path]:[]),[w.active?.image.path]);
  const selectedDocuments=w.documents.filter(d=>selectedPaths.includes(d.image.path));
  function selectDocument(path:string,event:React.MouseEvent){
    if(w.opening||w.syncOpen)return;
    if(event.shiftKey&&w.active){const start=w.documents.findIndex(d=>d.image.path===w.active!.image.path),end=w.documents.findIndex(d=>d.image.path===path);setSelectedPaths(w.documents.slice(Math.min(start,end),Math.max(start,end)+1).map(d=>d.image.path));}
    else if(event.metaKey||event.ctrlKey){if(path!==w.active?.image.path)setSelectedPaths(old=>old.includes(path)?old.filter(p=>p!==path):[...old,path]);}
    else{setSelectedPaths([path]);const doc=w.documents.find(d=>d.image.path===path);if(doc)void w.switchDocument(doc.image.id);}
  }
  const [tool,setTool]=useState<Tool>('hand'),[tab,setTab]=useState('adjust'),[selectedId,setSelectedId]=useState(''),[componentId,setComponentId]=useState('');
  const [brushSize,setBrushSize]=useState(.25),[overlay,setOverlay]=useState(true),[exportMenu,setExportMenu]=useState(false);
  const [sampleSize,setSampleSize]=useState(11);const [luminanceMap,setLuminanceMap]=useState(false);
  const [outputOptions,setOutputOptions]=useState<ExportOptions>(()=>structuredClone(DEFAULT_EXPORT_OPTIONS));
  const [outputColorSpace,setOutputColorSpace]=useState<OutputColorSpace>('srgb');
  const [spotId,setSpotId]=useState(''),[spotSource,setSpotSource]=useState<Point>(),[selectingSource,setSelectingSource]=useState(true),[spotGuides,setSpotGuides]=useState(true);
  const [spotDefaults,setSpotDefaults]=useState<SpotSettings>({method:'heal',radius:40,feather:50,opacity:100,detail:0,retainTexture:false});
  const a=w.active?.adjustments,selected=a?.masks.find(m=>m.id===selectedId)||a?.masks[0];
  const visibleAdjustments=a;
  const visibleCrop=rotateCrop(visibleAdjustments?.crop||null,visibleAdjustments?.rotation||0);
  const selectedSpot=a?.spots?.find(s=>s.id===spotId),spotSettings=selectedSpot||spotDefaults;
  useEffect(()=>{if(selectedSpot)setSpotSource(selectedSpot.source);},[selectedSpot?.source.x,selectedSpot?.source.y]);
  const profileName=w.active?.image.inputProfiles?.find(p=>p.id===(a?.colorProfile?.mode||'auto'))?.name||(a?.colorProfile?.mode==='inherited'?'配方中的配置文件':'ART 默认显影');
  const component=selected?.components?.find(c=>c.id===componentId)||selected?.components?.[0];
  const geometry=selected?.components?(component?{...selected,...component,id:selected.id,enabled:selected.enabled&&component.enabled}:undefined):selected;
  const object=useObjectSelection(w.flush,raster=>{
    const id=crypto.randomUUID(),part=crypto.randomUUID(),name=`对象 ${(a?.masks.length||0)+1}`;
    const geometry:MaskGeometry={id:part,name,type:'raster',enabled:true,inverted:false,feather:0,points:[],start:{x:0,y:0},end:{x:1,y:1},raster};
    w.edit(a=>({...a,masks:[...a.masks,{...geometry,id,brightness:0,contrast:0,saturation:0,raster:undefined,components:[{...geometry,operation:'add'}]}]}));setSelectedId(id);setComponentId(part);setTool('hand');setOverlay(true);
  });
  useEffect(()=>object.check(w.active),[w.active?.image.id,a]);
  useEffect(()=>{if(object.active&&(tab!=='mask'||tool!=='object'||comparing))object.cancel();},[tab,tool,comparing]);
  function startObject(){setTab('mask');setTool('object');void object.start();}
  const rangeActive=tab==='mask'&&geometry?.type==='luminance'&&!comparing;
  useEffect(()=>w.setLuminance(rangeActive),[rangeActive]);
  const colorActive=tab==='mask'&&geometry?.type==='color'&&!comparing;
  useEffect(()=>w.setColorSampling(colorActive),[colorActive]);
  useEffect(()=>w.cancelLuminanceSample(),[w.active?.image.id,selected?.id,component?.id,tab,tool]);
  const previewMaskId=tab==='mask'&&!object.active&&overlay&&selected?.enabled?selected.id:'';
  useEffect(()=>w.setMaskPreview(previewMaskId),[previewMaskId]);
  const choose=async()=>{const files=await window.captraw.chooseFiles();void w.openPaths(files);};
  function addMask(type:Exclude<MaskType,'raster'>){const id=w.addMask(type);setSelectedId(id);setComponentId('');setTool(maskTool(type));setTab('mask');}
  function addComponent(type:Exclude<MaskType,'raster'>,operation:'add'|'subtract'|'intersect'){
    if(!selected)return;const id=crypto.randomUUID(),name=`${type==='brush'?'画笔':type==='linear'?'线性':type==='luminance'?'亮度范围':type==='color'?'颜色范围':'径向'} ${(selected.components?.length||1)+1}`;
    const next={id,name,type,operation,enabled:true,inverted:false,feather:30,points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},initialized:type==='luminance',...(type==='color'?{colorSamples:[],colorRefine:50}:{}),...(type==='luminance'?{luminanceRange:[0,0,100,100] as [number,number,number,number]}:{})};
    w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected.id?{...m,components:[...(m.components||[{id:crypto.randomUUID(),name:m.name,type:m.type,enabled:true,inverted:false,feather:m.feather,raster:m.raster,points:m.points,start:m.start,end:m.end,luminanceRange:m.luminanceRange,colorSamples:m.colorSamples,colorRefine:m.colorRefine,operation:'add' as const}]),next]}:m)}));
    setComponentId(id);setTool(maskTool(type));setTab('mask');
  }
  function removeColor(index:number){
    if(!selected||geometry?.type!=='color')return;
    w.edit(a=>({...a,masks:a.masks.map(m=>{
      if(m.id!==selected.id)return m;
      const remove=<T extends MaskGeometry>(g:T):T=>({...g,colorSamples:g.colorSamples?.filter((_,i)=>i!==index)});
      return m.components?{...m,components:m.components.map(c=>c.id===component?.id?remove(c):c)}:remove(m);
    })}));
  }
  function selectSpot(id:string){setTool('repair');const spot=a?.spots?.find(s=>s.id===id);if(!spot)return;setSpotId(id);setSpotSource(spot.source);setSelectingSource(false);setSpotDefaults(spot);}
  function updateSpot(change:Partial<SpotSettings>,transient=false){setSpotDefaults(s=>({...s,...change}));if(selectedSpot)w.edit(a=>({...a,spots:a.spots?.map(s=>s.id===spotId?{...s,...change}:s)}),transient);}
  function removeSpot(id:string){w.edit(a=>({...a,spots:a.spots?.filter(s=>s.id!==id)}));if(id===spotId)setSpotId('');}
  function repairPick(point:Point,source:boolean){
    if(source||selectingSource||!spotSource){setSpotSource(point);setSelectingSource(false);setSpotId('');return;}
    const id=crypto.randomUUID(),spot:RepairSpot={...spotDefaults,id,name:`修复点 ${(a?.spots?.length||0)+1}`,enabled:true,source:spotSource,target:point};
    w.edit(a=>({...a,spots:[...(a.spots||[]),spot]}));setSpotId(id);
  }
  function moveSpot(direction:number){w.edit(a=>{const spots=[...(a.spots||[])],i=spots.findIndex(s=>s.id===spotId),j=i+direction;if(i<0||j<0||j>=spots.length)return a;[spots[i],spots[j]]=[spots[j],spots[i]];return {...a,spots};});}
  function activate(next:Tool){
    if(!w.active)return;
    if(next==='brush'||next==='linear'||next==='radial'){
      if(geometry?.type!==next){addMask(next);return;}setTab('mask');
    }
    if(next==='eraser'&&geometry?.type!=='brush')return;
    if(next==='repair')setTab('repair');
    if(next==='crop'||next==='white-balance')setTab('adjust');setTool(next);
  }
  function compare(value:boolean){if(w.opening)return;if(dual)comparison.setLayout('off');setComparing(value);}
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{
      if(w.syncOpen||document.querySelector('dialog[open]'))return;
      const editable=(e.target as HTMLElement)?.matches('input,textarea,[contenteditable]');
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();void choose();return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void w.save();return;}
      if(e.key==='Escape'){setTool('hand');setTab('adjust');setExportMenu(false);return;}
      if(editable||(!(e.metaKey||e.ctrlKey)&&(e.target as HTMLElement)?.matches('select')))return;
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();w.undo(e.shiftKey);return;}
      if(!editable&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='q'&&!e.repeat&&w.active){e.preventDefault();if(comparing)compare(false);comparison.cycle(e.shiftKey);return;}
      if(!e.metaKey&&!e.ctrlKey&&!e.repeat&&w.active&&(e.code==='KeyP'||e.key.toLowerCase()==='p')){
        e.preventDefault();
        if(e.altKey&&!e.shiftKey){if(!w.busy&&!comparing)w.comparisonState('capture');}
        else if(e.shiftKey&&!e.altKey){setTab('presets');setTool('hand');}
        else if(!e.altKey&&!e.shiftKey)compare(!comparing);
        return;
      }
      if(!e.metaKey&&!e.ctrlKey&&e.key.toLowerCase()==='m'){setTab('mask');setTool(maskTool(geometry?.type));return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='w'){e.preventDefault();if(w.active)void w.closeDocument(w.active.image.id);return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='r'){e.preventDefault();w.reset();return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'){e.preventDefault();setSelectedPaths(w.documents.map(d=>d.image.path));return;}
      if(e.altKey&&e.code==='KeyS'&&selectedDocuments.length>1&&!w.busy&&!comparing){e.preventDefault();w.openSynchronize();return;}
      if(e.metaKey||e.ctrlKey)return;
      const key=e.key.toLowerCase();
      if(key==='x'&&tool==='crop'&&w.active){e.preventDefault();w.edit(a=>flipCrop(a,w.active!.image));return;}
      if(e.key==='Enter'&&tool==='crop'){setTool('hand');return;}
      if(key==='b'){activate('repair');return;}
      if(tab==='repair'&&(key==='delete'||key==='backspace')&&selectedSpot){e.preventDefault();removeSpot(selectedSpot.id);return;}
      if(tab==='repair'&&(e.code==='BracketLeft'||e.code==='BracketRight'||e.key==='['||e.key===']')){e.preventDefault();const delta=e.code==='BracketLeft'||e.key==='['?-5:5;updateSpot(e.shiftKey?{feather:Math.max(0,Math.min(100,spotSettings.feather+delta))}:{radius:Math.max(2,Math.min(200,spotSettings.radius+delta))});return;}
      if(key==='e'){setTab('adjust');setTool('hand');return;}
      if(key==='k'&&!e.repeat){if(e.shiftKey&&selected)addComponent('brush','add');else addMask('brush');return;}
      if(key==='l'&&e.shiftKey&&w.active&&!e.repeat){e.preventDefault();addMask('luminance');return;}
      if((key==='r'||key==='l')&&w.active){w.edit(a=>({...a,rotation:(a.rotation+(key==='r'?90:270))%360}));return;}
      if(key==='y'){setOverlay(v=>!v);return;}
      if(key==='x'&&tab==='mask'&&selected){w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected.id?{...m,inverted:!m.inverted}:m)}));return;}
      if(tab==='mask'&&geometry?.type!=='luminance'&&(e.code==='BracketLeft'||e.code==='BracketRight'||e.key==='['||e.key===']')){
        e.preventDefault();const delta=e.code==='BracketLeft'||e.key==='['?-1:1;
        if(e.shiftKey&&geometry){w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected?.id?(component?{...m,components:m.components?.map(c=>c.id===component.id?{...c,feather:Math.max(0,Math.min(100,c.feather+delta*5))}:c)}:{...m,feather:Math.max(0,Math.min(100,m.feather+delta*5))}):m)}));}
        else setBrushSize(size=>Math.max(.02,Math.min(1.5,size*(delta>0?1.1:1/1.1))));return;
      }
      const shortcuts:Record<string,Tool>={h:'hand',g:'linear',j:'radial',c:'crop',i:'white-balance'};
      if(shortcuts[e.key.toLowerCase()])activate(shortcuts[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown',down);
    return()=>{window.removeEventListener('keydown',down);};
  },[w.active,selected,component,comparing,tab,tool,selectedSpot,spotDefaults,spotSource,selectingSource,w.syncOpen,w.busy,selectedPaths,w.documents,dual,comparison.layout]);
  useEffect(()=>{setSelectedId('');setComponentId('');setSpotId('');setSpotSource(undefined);setSelectingSource(true);setTool('hand');setComparing(false);},[w.active?.image.id]);
  return <div className="app">
    <header className="titlebar"><div className="brand"><img src={logo} width={28} height={28} alt="CaptRAW 标志"/><b>Capt<span>RAW</span></b><em>显影工作台</em></div><div className="document-title">{w.active?<>{w.active.image.name}{w.active.dirty&&<i className="dirty-dot"/>}<button className="close-document" aria-label="关闭当前文件" title="关闭当前文件 ⌘W" onClick={()=>w.closeDocument(w.active!.image.id)}><X size={14}/></button></>:<span>每张原片，都值得好好显影。</span>}</div><div className="header-actions"><button className="icon-text" disabled={w.opening} onClick={choose} title="打开照片 ⌘O"><FolderOpen size={15}/>打开</button><button className="icon-text" disabled={!w.active||w.opening} onClick={w.save} title="保存编辑配方 ⌘S"><Save size={15}/>保存</button><div className="export-container"><button className="export-button" disabled={!w.active||w.opening||w.exportPending||w.job?.state==='running'} onClick={()=>setExportMenu(!exportMenu)}><ArrowDownToLine size={15}/>导出<ChevronDown size={12}/></button>{exportMenu&&<ExportMenu options={outputOptions} setOptions={setOutputOptions} image={w.active?.image} adjustments={a} count={selectedDocuments.length} colorSpace={outputColorSpace} change={setOutputColorSpace} close={()=>setExportMenu(false)} run={format=>{setExportMenu(false);void w.exportImage(format,outputColorSpace,selectedPaths,structuredClone(outputOptions));}}/>}</div></div></header>
    <div className="workbench" inert={w.opening}>
    <main className="stage"><div className="stage-toolbar"><div className="stage-meta">{w.active?<><span className="camera-name">{w.active.image.camera}</span><span>{w.active.image.iso?`ISO ${w.active.image.iso}`:''}</span><span>{w.frame?`${Math.round(w.frame.fullWidth*(visibleCrop?.width??1))} × ${Math.round(w.frame.fullHeight*(visibleCrop?.height??1))}`:''}</span></>:<span>RAW DEVELOPMENT</span>}</div><div className="stage-actions"><button title="撤销 ⌘Z" aria-label="撤销" disabled={!w.active?.past.length} onClick={()=>w.undo()}><Undo2 size={15}/></button><button title="重做 ⇧⌘Z" aria-label="重做" disabled={!w.active?.future.length} onClick={()=>w.undo(true)}><Redo2 size={15}/></button><span className="toolbar-separator"/><button className={comparing?'active':''} disabled={!a||!w.active?.opened||w.opening} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);compare(true);}} onPointerUp={()=>compare(false)} onPointerCancel={()=>compare(false)} title="按住查看前状态；P 切换对比"><Layers2 size={15}/><span>{comparing?comparison.label:'按住对比'}</span></button></div></div>
      {tool==='crop'&&a&&<CropControls value={a} image={w.active!.image} edit={w.edit} done={()=>setTool('hand')}/>}
      <Viewport sessionId={w.active?.image.id} beforeLabel={comparing?comparison.label:undefined} comparison={dual?comparison:undefined} object={!dual&&object.active?{url:object.url,prompts:object.prompts,pick:object.pick,mode:object.mode,box:object.box,ready:object.ready,pickBox:object.pickBox}:undefined} frame={comparing?comparison.frame:w.frame} detailFrame={comparing?comparison.detail:w.detailFrame} adjustments={visibleAdjustments} tool={comparing||dual?'hand':tool} luminanceMap={!dual&&rangeActive&&luminanceMap} sampleRange={(start,end,append)=>{if(selected){if(colorActive)void w.sampleColor(selected.id,component?.id,start,end,append);else void w.sampleLuminance(selected.id,component?.id,start,end);}}} removeColor={removeColor} selectedMask={!dual&&!comparing&&!object.active&&tab==='mask'&&geometry?.enabled?geometry:undefined} maskId={comparing||dual?'':previewMaskId} componentId={component?.id} sample={point=>w.whiteBalance({mode:'sample',x:point.x,y:point.y,size:sampleSize})} repair={{source:spotSource,selectingSource,selectedId:spotId,guides:spotGuides,pick:repairPick,select:selectSpot}} brushSize={brushSize} overlay={overlay} busy={w.busy||comparison.busy} edit={w.edit} commit={w.commit} open={choose} drop={w.openPaths} viewport={comparing?comparison.viewport:w.viewport} comparisonControl={<><select aria-label="前后对比视图" title="Q 切换对比视图 · Shift+Q 反向切换" disabled={!a||w.opening} value={comparison.layout} onChange={e=>{if(comparing)compare(false);comparison.setLayout(e.target.value as typeof comparison.layout);}}>{comparisonLayouts.map(v=><option key={v} value={v}>{comparisonNames[v]}</option>)}</select><button aria-label="保存前状态" title="将当前设置保存为前状态 · Option/Alt+P" disabled={!w.active?.opened||w.busy||comparing} onClick={()=>w.comparisonState('capture')}><Copy size={14}/></button><button aria-label="交换前后设置" title="交换前后设置 · 保持当前构图 · 可撤销" disabled={!w.active?.opened||w.busy||comparing} onClick={()=>w.comparisonState('swap')}><ArrowLeftRight size={14}/></button><button aria-label="还原打开时状态" title="将对比前状态还原为打开照片时的设置" disabled={!w.active?.before||w.busy||comparing} onClick={()=>w.comparisonState('reset')}><RotateCcw size={14}/></button></>}/>
      {(w.error||comparison.error)&&<div className="error-banner" role="alert"><span>{(w.error||comparison.error).replace('Error: ','')}</span>{w.active&&<button onClick={()=>w.switchDocument(w.active!.image.id,true)}>重新载入当前编辑</button>}<button title="关闭错误" onClick={()=>{w.setError('');comparison.setLayout('off');setComparing(false);}}><X size={15}/></button></div>}
      {tool==='color'&&a&&<div className="sample-actions"><Pipette size={14}/><span>{w.sampling?'正在读取照片颜色…':'单击或框选取代表色 · Shift 添加 · Option 点击样本删除'}</span><button onClick={()=>setTool('hand')}>完成取样</button></div>}
      {tool==='luminance'&&a&&<div className="sample-actions"><Pipette size={14}/><span>{w.sampling?'正在读取照片亮度…':'单击取样 5 × 5 像素，或拖动选择区域'}</span><button onClick={()=>setTool('hand')}>完成取样</button></div>}
      {tool==='white-balance'&&a&&<div className="sample-actions"><Pipette size={14}/><span>白平衡取样</span><select aria-label="取样大小" value={sampleSize} onChange={e=>setSampleSize(Number(e.target.value))}>{[5,11,25].map(n=><option key={n} value={n}>{n} × {n} 像素</option>)}</select><button onClick={()=>setTool('hand')}>完成取样</button></div>}
    <div className="filmstrip-toolbar"><span>{selectedDocuments.length} / {w.documents.length} 张已选</span><button disabled={!w.documents.length||w.opening} onClick={()=>setSelectedPaths(w.documents.map(d=>d.image.path))}>选择全部</button><button className="sync-trigger" disabled={selectedDocuments.length<2||w.busy||comparing} onClick={w.openSynchronize} title="同步设置 · Option+S">同步设置…</button><button disabled={!selectedDocuments.length||w.busy||comparing} onClick={()=>void w.saveSelected(selectedPaths)} title="将所选照片保存为 XMP 编辑文件">保存所选…</button><small>⌘ 单击增减 · Shift 连选 · 调节当前照片后同步</small></div>
    <footer className="filmstrip"><button className="add-images" disabled={w.opening} title="添加照片" onClick={choose}><FolderOpen size={20}/><span>添加照片</span></button><div className="filmstrip-items">{w.documents.map(d=><div key={d.image.id} className={`film-item ${selectedPaths.includes(d.image.path)?'selected':''} ${d.image.id===w.active?.image.id?'active':''}`}><button className="film-open" aria-pressed={selectedPaths.includes(d.image.path)} aria-current={d.image.id===w.active?.image.id?'true':undefined} disabled={w.opening} onClick={e=>selectDocument(d.image.path,e)} title={d.image.path}>{d.thumbnail?<img src={d.thumbnail} data-frame={d.thumbnailFrame} alt={d.image.name}/>:<ImageIcon size={25} strokeWidth={1}/>}<span>{d.image.name}</span>{d.dirty&&<i className="dirty-dot"/>}</button><button className="film-close" aria-label={`关闭 ${d.image.name}`} title="关闭文件" disabled={w.opening} onClick={()=>w.closeDocument(d.image.id)}><X size={13}/></button></div>)}{!w.documents.length&&<div className="filmstrip-empty"><span>当前会话</span><small>打开的照片会显示在这里</small></div>}</div><div className="image-count">{w.documents.length.toString().padStart(2,'0')}<small>张照片</small></div></footer>
    </main>
    <aside className="inspector"><Histogram frame={comparing?comparison.frame:w.frame} image={w.active?.image}/><div className="profile-line"><b>{tab==='mask'?'蒙版':tab==='repair'?'修复':tab==='presets'?'预设':'编辑'}</b><span title={tab==='mask'?'局部调整':tab==='repair'?'取样修复与仿制':profileName}>{tab==='mask'?'局部调整':tab==='repair'?'取样修复与仿制':profileName}</span></div><Tabs.Root value={tab} onValueChange={value=>{setTab(value);setTool(value==='mask'?maskTool(geometry?.type):value==='repair'?'repair':'hand');}}><Tabs.List className="inspector-tabs"><Tabs.Trigger value="adjust"><SlidersHorizontal size={15}/>调节</Tabs.Trigger><Tabs.Trigger value="mask"><Circle size={15}/>蒙版{a?.masks.length?<span>{a.masks.length}</span>:null}</Tabs.Trigger><Tabs.Trigger value="repair">修复</Tabs.Trigger><Tabs.Trigger value="presets">预设</Tabs.Trigger></Tabs.List><div className="inspector-content">{!!w.active?.image.xmpWarnings?.length&&<details className="xmp-notice"><summary>XMP 导入说明 · 部分参数支持</summary>{w.active.image.xmpWarnings.map(message=><p key={message}>{message}</p>)}</details>}{a?<><Tabs.Content value="adjust"><AdjustmentsPanel histogram={w.frame?.sessionId===w.active?.image.id?w.frame?.curveHistogram:null} value={a} edit={w.edit} commit={w.commit} image={w.active!.image} whiteBalance={w.whiteBalance} picker={()=>activate('white-balance')} pickerActive={tool==='white-balance'} disabled={w.busy}/></Tabs.Content><Tabs.Content value="mask">{object.active?<ObjectSelectionPanel selection={object}/>:<><div className="panel-section"><button className="object-create" disabled={w.busy||comparing} onClick={startObject}>选择对象</button></div><MaskPanel luminanceMap={luminanceMap} setLuminanceMap={setLuminanceMap} sampleRange={()=>setTool(tool===geometry?.type?'hand':maskTool(geometry?.type))} samplingActive={tool===geometry?.type} removeColor={removeColor} masks={a.masks} selected={selected} componentId={component?.id} addComponent={addComponent} onComponent={id=>{setComponentId(id);const c=selected?.components?.find(c=>c.id===id);if(c)setTool(maskTool(c.type));}} onSelect={id=>{setSelectedId(id);setComponentId('');const mask=a.masks.find(m=>m.id===id);if(mask)setTool(maskTool(mask.components?.[0]?.type||mask.type));}} add={addMask} edit={w.edit} commit={w.commit} brushSize={brushSize} setBrushSize={setBrushSize} overlay={overlay} setOverlay={setOverlay}/></>}</Tabs.Content><Tabs.Content value="presets"><PresetsPanel workbench={w}/></Tabs.Content><Tabs.Content value="repair"><RepairPanel spots={a.spots||[]} selected={selectedSpot} settings={spotSettings} select={selectSpot} update={updateSpot} commit={w.commit} remove={removeSpot} enable={id=>w.edit(a=>({...a,spots:a.spots?.map(s=>s.id===id?{...s,enabled:!s.enabled}:s)}))} rename={name=>w.edit(a=>({...a,spots:a.spots?.map(s=>s.id===spotId?{...s,name}:s)}),true)} move={moveSpot} pickSource={()=>{setTool('repair');setSpotId('');setSelectingSource(true);}} newSpot={()=>{setTool('repair');setSpotId('');setSelectingSource(!spotSource);}} selectingSource={selectingSource} guides={spotGuides} setGuides={setSpotGuides}/></Tabs.Content></>:<div className="inspector-placeholder"><SlidersHorizontal size={27} strokeWidth={1}/><p>打开照片，开始调整</p><span>光线、色彩与局部细节</span></div>}</div></Tabs.Root><div className="inspector-footer"><span className="profile-badge" title="预览色彩空间">sRGB</span><span>无损编辑</span><button disabled={!a} title="重置全部编辑" onClick={w.reset}><RotateCcw size={13}/>重置</button></div></aside><aside className="tools" aria-label="工具"><button aria-label="编辑" title="编辑" className={tab==='adjust'&&tool!=='crop'?'selected':''} onClick={()=>{setTab('adjust');setTool('hand');}}><SlidersHorizontal size={20}/></button><button aria-label="裁切 C" title="裁切 C" className={tool==='crop'?'selected':''} disabled={!a} onClick={()=>activate('crop')}><Crop size={20}/></button><button aria-label="修复 B" title="修复 B" className={tab==='repair'?'selected':''} disabled={!a} onClick={()=>activate('repair')}><Eraser size={20}/></button><button aria-label="蒙版 M" title="蒙版 M" className={tab==='mask'?'selected':''} disabled={!a} onClick={()=>{setTab('mask');setTool(maskTool(geometry?.type));}}><Circle size={20}/></button><button aria-label="预设" title="预设" disabled={!a} className={tab==='presets'?'selected':''} onClick={()=>{setTab('presets');setTool('hand');}}><Blend size={20}/></button>{tab==='mask'&&<><div className="tool-divider"/><button aria-label="画笔蒙版 K" title="画笔 K" onClick={()=>activate('brush')}><Brush size={19}/></button><button aria-label="蒙版橡皮擦" title="橡皮擦 · 按住 Option 临时擦除" disabled={geometry?.type!=='brush'} onClick={()=>activate('eraser')}><Eraser size={19}/></button></>}<div className="tool-divider"/><button aria-label="白平衡 I" title="白平衡 I" disabled={!a||w.busy} className={tool==='white-balance'?'selected':''} onClick={()=>activate('white-balance')}><Pipette size={19}/></button><button aria-label="平移 H" title="平移 H" onClick={()=>setTool('hand')}><Hand size={19}/></button><button aria-label="顺时针旋转 90 度" title="旋转 90°" disabled={!a} onClick={()=>w.edit(a=>({...a,rotation:(a.rotation+90)%360}))}><RotateCw size={19}/></button></aside></div>

    <div className="statusbar"><span><i className={w.busy?'status-dot busy':'status-dot'}/>{w.busy?'正在处理照片…':w.status}</span><span className="status-actions"><button disabled={!w.active||w.opening} onClick={()=>w.closeDocument(w.active!.image.id)}>关闭文件</button><button disabled={!w.active||w.opening} onClick={w.finish}>完成</button><span>输出：{OUTPUT_COLOR_SPACES[outputColorSpace]} · SDR</span></span></div>
    {w.saveOpen&&<BatchSaveDialog busy={w.saveBusy} progress={w.saveProgress} result={w.saveResult} error={w.saveError} cancel={()=>void w.cancelSave()} close={w.closeSave}/>}
    {w.presetBusy&&<PresetProgress cancel={()=>void w.cancelPreset()}/>}
    {w.syncOpen&&w.active&&<SynchronizeDialog approximateWB={!!w.active.adjustments.wbApproximate} source={w.active.image.name} targets={selectedDocuments.filter(d=>d.image.path!==w.active!.image.path).map(d=>d.image.name)} busy={w.syncBusy} progress={w.syncProgress} error={w.syncError} apply={groups=>void w.synchronize(selectedPaths,groups)} cancel={()=>void w.cancelSynchronize()}/>}
    {w.job&&<div className={`job-toast ${w.job.state}`} role="status"><div><ArrowDownToLine size={17}/><span>{w.job.message}</span>{w.job.state==='running'?<button onClick={()=>window.captraw.cancel()}>取消</button>:<button aria-label="关闭导出结果" onClick={w.dismissJob}><X size={14}/></button>}</div>{w.job.state==='running'&&<progress max={1} value={w.job.progress}/>} {!!w.job.results?.length&&<details className="export-results"><summary>查看文件与错误（{w.job.results.length}）</summary><ul>{w.job.results.map(r=><li key={r.source} className={r.error?'failed':''}><strong>{r.source.split('/').at(-1)}</strong><span>{r.output||r.error}</span></li>)}</ul></details>}</div>}
  </div>;
}
