import { useEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Blend, ArrowLeftRight, Copy, ArrowDownToLine, Brush, ChevronDown, Circle, Crop, Eraser, FolderOpen, Hand, Layers2, LayoutGrid, Pipette, RotateCcw, RotateCw, Save, SlidersHorizontal, Undo2, Redo2, X, Image as ImageIcon } from 'lucide-react';
import {useAutoPerspective} from './useAutoPerspective';
import {useGuidedPerspective} from './useGuidedPerspective';
import {useComparison,comparisonLayouts,comparisonNames} from './useComparison';
import { useWorkbench } from './useWorkbench';
import {RatingControls,LabelControls,LABELS,matchesRating,matchesLabel,sortPhotos,labelColor,labelText,ratingText,type RatingFilter,type LabelFilter,type PhotoSort} from './RatingControls';
import logo from '/branding/logo.svg?url';
import { Viewport, type Tool } from './Viewport';
import { AdjustmentsPanel, MaskPanel, ControlEditContext } from './Panels';
import {useObjectSelection,ObjectSelectionPanel} from './ObjectSelection';
import {PresetsPanel,PresetProgress} from './PresetsPanel';
import {RepairPanel} from './RepairPanel';
import {automaticRepairSource} from './repairGeometry';
import {CropControls,flipCrop} from './CropControls';
import {DEFAULT_EXPORT_OPTIONS,type ExportOptions} from '@captraw/contracts/export-options';
import {ExportMenu} from './ExportMenu';
import {SynchronizeDialog} from './SynchronizeDialog';
import {BatchSaveDialog} from './BatchSaveDialog';
import {Histogram,setClipping,useClipping} from './Histogram';
import {rotateCrop,type CanvasEditTransaction} from './geometry';
import {OUTPUT_COLOR_SPACES,type EngineEvent,type MaskGeometry,type MaskType,type Point,type SpotSettings,type RepairSpot,type OutputColorSpace,type CurveSampleChannel } from '@captraw/contracts';
const maskTool=(type?:MaskType):Tool=>!type||type==='raster'?'hand':type;
export function App() {
  const w=useWorkbench();
  const comparison=useComparison(w.active,!!w.frame?.linear);const dual=comparison.layout!=='off',comparing=comparison.showBefore,setComparing=comparison.setShowBefore;
  const [selectedPaths,setSelectedPaths]=useState<string[]>([]);
  useEffect(()=>setSelectedPaths(w.active?[w.active.image.path]:[]),[w.active?.image.path]);
  const [ratingFilter,setRatingFilter]=useState<RatingFilter>('all');
  const [labelFilter,setLabelFilter]=useState<LabelFilter>('all'),[photoSort,setPhotoSort]=useState<PhotoSort>('import'),[sortDescending,setSortDescending]=useState(false);
  const visibleDocuments=sortPhotos(w.documents.filter(d=>matchesRating(d.rating,ratingFilter)&&matchesLabel(d.label,labelFilter)),photoSort,sortDescending);
  const selectedDocuments=visibleDocuments.filter(d=>selectedPaths.includes(d.image.path)),selectedVisiblePaths=selectedDocuments.map(d=>d.image.path);
  const canCopy=!!w.active&&selectedVisiblePaths.includes(w.active.image.path)&&!w.opening&&!w.busy&&!w.copyBusy&&!w.syncBusy&&!comparing;
  const canPaste=w.hasClipboard&&selectedDocuments.length>0&&!w.opening&&!w.busy&&!w.copyBusy&&!w.syncBusy&&!comparing;
  const canExport=selectedDocuments.length>0&&!w.opening&&!w.exportPending&&w.job?.state!=='running';
  const canRotate=selectedDocuments.length>0&&!w.opening&&!w.busy&&!w.syncBusy&&!comparing;
  w.setTargets(selectedVisiblePaths);
  function selectDocument(path:string,event:React.MouseEvent){
    if(w.opening||w.syncOpen)return;
    if(curveJob.current)cancelCurvePick();
    if(event.shiftKey&&w.active){const start=visibleDocuments.findIndex(d=>d.image.path===w.active!.image.path),end=visibleDocuments.findIndex(d=>d.image.path===path);setSelectedPaths(start<0?[path]:visibleDocuments.slice(Math.min(start,end),Math.max(start,end)+1).map(d=>d.image.path));}
    else if(event.metaKey||event.ctrlKey){if(path!==w.active?.image.path)setSelectedPaths(old=>old.includes(path)?old.filter(p=>p!==path):[...old,path]);}
    else{setSelectedPaths([path]);const doc=w.documents.find(d=>d.image.path===path);if(doc)void w.switchDocument(doc.image.id);}
  }
  const [tool,setTool]=useState<Tool>('hand'),[tab,setTab]=useState('adjust'),[selectedId,setSelectedId]=useState(''),[componentId,setComponentId]=useState('');
  const [curveTarget,setCurveTarget]=useState<CurveSampleChannel>(),[curvePending,setCurvePending]=useState(false);
  const [curvePicked,setCurvePicked]=useState<{id:string;channel:CurveSampleChannel;x:number}>();
  const curveJob=useRef<{id:string;token:CanvasEditTransaction}|undefined>(undefined);
  const curveView=useRef({target:curveTarget,tool,tab,comparing,dual});curveView.current={target:curveTarget,tool,tab,comparing,dual};
  function cancelCurvePick(){const job=curveJob.current;curveJob.current=undefined;job?.token.release();setCurvePending(false);void window.captraw.cancelCurveSample(job?.id).catch(e=>w.setError(String(e)));}
  useEffect(()=>{
    const job=curveJob.current;
    if(!job||!job.token.valid()||tool!=='curve'||tab!=='adjust'||comparing||dual||w.active?.adjustments.hdrEnabled){cancelCurvePick();if(tool!=='curve'||tab!=='adjust'||comparing||dual||w.active?.adjustments.hdrEnabled)setCurveTarget(undefined);}
  },[w.active?.image.id,w.active?.adjustments,w.active?.profileId,w.frame?.revision,tool,tab,comparing,dual]);
  useEffect(()=>setCurvePicked(undefined),[w.active?.image.id]);
  useEffect(()=>()=>{const job=curveJob.current;job?.token.release();void window.captraw.cancelCurveSample().catch(()=>{});},[]);
  function toggleCurveTarget(channel?:CurveSampleChannel){cancelCurvePick();setCurveTarget(channel);setTab('adjust');setTool(channel?'curve':'hand');}
  async function pickCurve(point:Point){
    const doc=w.active,frame=w.frame,channel=curveTarget;
    if(curveJob.current||!doc||!frame||!channel||w.busy)return;
    const token=w.beginCanvasEdit(doc.image.id,frame.revision,'曲线定点取样');if(!token){w.setError('请等待当前预览完成后再取样。');return;}
    const job={id:crypto.randomUUID(),token};curveJob.current=job;setCurvePending(true);w.setError('');
    try{
      const result=await window.captraw.sampleCurve({id:job.id,sessionId:token.sessionId,revision:token.revision,channel,point});
      const view=curveView.current;
      if(!result||curveJob.current!==job||!token.valid()||result.id!==job.id||result.revision!==token.revision||result.channel!==channel||view.target!==channel||view.tool!=='curve'||view.tab!=='adjust'||view.comparing||view.dual)return;
      const points=doc.adjustments[channel]||[{x:0,y:0},{x:1,y:1}],code=Math.round(result.input*255);
      const existing=points.find(p=>Math.round(p.x*255)===code);
      if(!existing){
        if(points.length>=128)throw new Error('曲线已达到 128 个点，请先删除不需要的点。');
        if(!await token.applyGlobal(a=>{const next={...a,[channel]:[...points,{x:result.input,y:result.output}].sort((a,b)=>a.x-b.x)};if(channel==='curve')delete next.curveName;return next;}))return;
      }
      setCurvePicked({id:result.id,channel,x:existing?.x??result.input});
    }catch(error){if(curveJob.current===job&&token.valid())w.setError(String(error));}
    finally{if(curveJob.current===job){curveJob.current=undefined;token.release();setCurvePending(false);}}
  }
  const autoPerspective=useAutoPerspective({document:w.active,frame:w.frame,enabled:tab==='adjust'&&tool==='hand'&&!comparing&&!dual,busy:w.busy,begin:w.beginCanvasEdit,error:w.setError});
  const guidedPerspective=useGuidedPerspective({document:w.active,frame:w.frame,enabled:tab==='adjust'&&tool==='perspective'&&!comparing&&!dual,busy:w.busy,begin:w.beginCanvasEdit,error:w.setError,done:()=>setTool('hand')});
  const [brushSize,setBrushSize]=useState(.25),[overlay,setOverlay]=useState(true),[exportMenu,setExportMenu]=useState(false);
  const [brush,setBrush]=useState({flow:100,density:100,autoMask:false});
  const [sampleSize,setSampleSize]=useState(11);const [luminanceMap,setLuminanceMap]=useState(false);
  const [gridView,setGridView]=useState(false);
  const clipping=useClipping();
  const [outputOptions,setOutputOptions]=useState<ExportOptions>(()=>structuredClone(DEFAULT_EXPORT_OPTIONS));
  const [outputColorSpace,setOutputColorSpace]=useState<OutputColorSpace>('srgb');
  const viewCommandSequence=useRef(0),[viewCommand,setViewCommand]=useState<{action:'fit'|'actual'|'zoom-in'|'zoom-out';sequence:number}>();
  const [dustEnabled,setDustEnabled]=useState(false),[dustThreshold,setDustThreshold]=useState(50);
  const [spotId,setSpotId]=useState(''),[spotSource,setSpotSource]=useState<Point>(),[selectingSource,setSelectingSource]=useState(false),[spotGuides,setSpotGuides]=useState(true);
  const [spotDefaults,setSpotDefaults]=useState<SpotSettings>({method:'heal',radius:40,feather:50,opacity:100,detail:0,retainTexture:false,sourceMode:'auto'});
  const a=w.active?.adjustments,selected=a?.masks.find(m=>m.id===selectedId)||a?.masks[0];
  const hoverPreview=tab==='presets'&&!comparing&&!dual?w.presetPreview.preview:undefined;
  const visibleAdjustments=hoverPreview?.adjustments||a;
  const visibleCrop=rotateCrop(visibleAdjustments?.crop||null,visibleAdjustments?.rotation||0);
  const selectedSpot=a?.spots?.find(s=>s.id===spotId),spotSettings=selectedSpot||spotDefaults;
  useEffect(()=>{if(selectedSpot)setSpotSource(selectedSpot.source);},[selectedSpot?.source.x,selectedSpot?.source.y]);
  const profileName=w.active?.image.inputProfiles?.find(p=>p.id===(a?.colorProfile?.mode||'auto'))?.name||(a?.colorProfile?.mode==='inherited'?'配方中的配置文件':'ART 默认显影');
  const component=selected?.components?.find(c=>c.id===componentId)||selected?.components?.[0];
  const geometry=selected?.components?(component?{...selected,...component,brush:component.brush,referenceAngle:component.referenceAngle,geometryReference:component.geometryReference,id:selected.id,enabled:selected.enabled&&component.enabled}:undefined):selected;
  const object=useObjectSelection(w.flush,({raster,referenceAngle})=>{
    const id=crypto.randomUUID(),part=crypto.randomUUID(),name=`对象 ${(a?.masks.length||0)+1}`;
    const geometry:MaskGeometry={id:part,name,type:'raster',enabled:true,inverted:false,feather:0,points:[],start:{x:0,y:0},end:{x:1,y:1},raster,referenceAngle};
    w.edit(a=>({...a,masks:[...a.masks,{...geometry,id,brightness:0,contrast:0,saturation:0,raster:undefined,components:[{...geometry,operation:'add'}]}]}));setSelectedId(id);setComponentId(part);setTool('hand');setOverlay(true);
  });
  useEffect(()=>object.check(w.active),[w.active?.image.id,w.active?.profileId,a]);
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
    const next={id,name,type,operation,enabled:true,inverted:false,feather:30,...(type==='linear'?{linearGradientModel:'full-zero-v1' as const,feather:0}:{}),points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},initialized:type==='luminance',...(type==='color'?{colorSamples:[],colorRefine:50}:{}),...(type==='luminance'?{luminanceRange:[0,0,100,100] as [number,number,number,number]}:{})};
    w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected.id?{...m,brush:undefined,linearGradientModel:undefined,components:[...(m.components||[{id:crypto.randomUUID(),name:m.name,type:m.type,enabled:true,inverted:false,feather:m.feather,linearGradientModel:m.linearGradientModel,referenceAngle:m.referenceAngle,geometryReference:m.geometryReference,brush:m.brush,raster:m.raster,points:m.points,start:m.start,end:m.end,luminanceRange:m.luminanceRange,colorSamples:m.colorSamples,colorRefine:m.colorRefine,operation:'add' as const}]),next]}:m)}));
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
  function selectSpot(id:string){setTool('repair');const spot=a?.spots?.find(s=>s.id===id);if(!spot)return;setSpotId(id);setSpotSource(spot.source);setSelectingSource(false);const {id:_id,name:_name,enabled:_enabled,source:_source,target:_target,path:_path,...settings}=spot;setSpotDefaults({...settings,sourceMode:spot.sourceMode||'manual'});}
  async function updateSpot(change:Partial<SpotSettings>,transient=false){
    if(change.sourceMode==='auto')setSelectingSource(false);
    else if(change.sourceMode==='manual'&&!selectedSpot)setSelectingSource(!spotSource);
    if(selectedSpot&&change.sourceMode==='auto'&&change.searchSeed===undefined)change={...change,searchSeed:(selectedSpot.searchSeed||0)+1};
    if(selectedSpot&&change.searchSeed!==undefined&&w.active&&w.frame){
      const current=selectedSpot,frame=w.frame,image=w.active.image;
      const transaction=w.beginCanvasEdit(image.id,frame.revision,'重新搜索修复来源');
      if(!transaction){w.setError('请等待当前修复或照片预览完成。');return;}
      try{
        const source=await automaticRepairSource({sessionId:image.id,revision:frame.revision,path:current.path||[current.target],
          radius:current.radius,feather:current.feather,seed:change.searchSeed,exclude:current.source},transaction.valid);
        if(transaction.apply(a=>({...a,spots:a.spots?.map(s=>s.id===current.id?{...s,source,sourceMode:'auto',searchSeed:change.searchSeed}:s)}))){setSpotSource(source);setSpotDefaults(s=>({...s,sourceMode:'auto',searchSeed:change.searchSeed}));}
      }catch(error){if(transaction.valid())w.setError(String(error));}finally{transaction.release();}
      return;
    }
    setSpotDefaults(s=>({...s,...change}));if(selectedSpot)w.edit(a=>({...a,spots:a.spots?.map(s=>s.id===spotId?{...s,...change}:s)}),transient);
  }
  function removeSpot(id:string){w.edit(a=>({...a,spots:a.spots?.filter(s=>s.id!==id)}));if(id===spotId)setSpotId('');}
  function repairPick(point:Point,source:boolean,transaction:CanvasEditTransaction,path?:Point[],sample?:Point){
    if(!transaction.valid())return;
    if(source||selectingSource||!spotSource&&!sample){
      if(selectedSpot?.path&&source&&selectedSpot.path.some(q=>q.x+point.x-selectedSpot.target.x<0||q.x+point.x-selectedSpot.target.x>1||q.y+point.y-selectedSpot.target.y<0||q.y+point.y-selectedSpot.target.y>1)){w.setError('来源无法覆盖整条修复轨迹，请选择其他位置。');return;}
      if(selectedSpot&&source){transaction.apply(a=>({...a,spots:a.spots?.map(s=>s.id===spotId?{...s,source:point,sourceMode:'manual'}:s)}));}
      else setSpotId('');
      setSpotSource(point);setSpotDefaults(s=>({...s,sourceMode:'manual'}));setSelectingSource(false);return;
    }
    const id=crypto.randomUUID(),spot:RepairSpot={...spotDefaults,id,name:`修复区域 ${(a?.spots?.length||0)+1}`,enabled:true,source:sample||spotSource!,target:point,
      sourceMode:sample?'auto':'manual',path,...(path?{retainTexture:false}:{})};
    if(path?.some(q=>q.x+spot.source.x-point.x<0||q.x+spot.source.x-point.x>1||q.y+spot.source.y-point.y<0||q.y+spot.source.y-point.y>1)){w.setError('来源无法覆盖整条修复轨迹，请选择其他位置。');return;}
    if(transaction.apply(a=>({...a,spots:[...(a.spots||[]),spot]}))){setSpotId(id);setSpotSource(spot.source);}
  }
  function moveSpot(direction:number){w.edit(a=>{const spots=[...(a.spots||[])],i=spots.findIndex(s=>s.id===spotId),j=i+direction;if(i<0||j<0||j>=spots.length)return a;[spots[i],spots[j]]=[spots[j],spots[i]];return {...a,spots};});}
  function activate(next:Tool){
    if(!w.active)return;
    if(next==='brush'||next==='linear'||next==='radial'){
      if(geometry?.type!==next){addMask(next);return;}setTab('mask');
    }
    if(next==='eraser'&&geometry?.type!=='brush')return;
    if(next==='repair')setTab('repair');
    if(next==='crop'||next==='straighten'||next==='white-balance')setTab('adjust');setTool(next);
  }
  function compare(value:boolean){if(w.opening)return;if(dual)comparison.setLayout('off');setComparing(value);}
  useEffect(()=>{
    const textContext=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]');
    const modal=()=>w.syncOpen||!!document.querySelector('dialog[open]');
    const dispatch=(command:Extract<EngineEvent,{event:'command'}>['command'])=>{
      if(modal()||w.opening)return;
      if(command==='export'){if(canExport)setExportMenu(true);return;}
      if(textContext(document.activeElement))return;
      if(command==='copy-all'&&canCopy)void w.copyAll();
      else if(command==='copy-selected'&&canCopy)w.openCopy();
      else if(command==='paste'&&canPaste)void w.pasteAdjustments();
    };
    const unsubscribe=window.captraw.onEvent(event=>{
      if(event.event==='command'&&['export','copy-all','copy-selected','paste'].includes(event.command))dispatch(event.command);
    });
    const down=(e:KeyboardEvent)=>{
      if(e.defaultPrevented||e.isComposing||modal())return;
      const editable=textContext(e.target),command=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
      // File commands remain global; text editing otherwise owns its keys.
      if(command&&!e.altKey&&key==='s'){e.preventDefault();if(!e.repeat){if(e.shiftKey){if(w.active&&!w.opening)void w.save();}else dispatch('export');}return;}
      if(command&&!e.altKey&&!e.shiftKey&&key==='o'){e.preventDefault();if(!e.repeat&&!w.opening)void choose();return;}
      if(command&&!e.altKey&&!e.shiftKey&&key==='w'){e.preventDefault();if(!e.repeat&&w.active&&!w.opening)void w.closeDocument(w.active.image.id);return;}
      if(editable)return;
      if(e.key==='Escape'){if(curveJob.current){e.preventDefault();cancelCurvePick();return;}if(w.cancelEdit()){e.preventDefault();return;}guidedPerspective.cancel();autoPerspective.cancel();setTool(tool==='straighten'?'crop':'hand');setTab('adjust');setExportMenu(false);setGridView(false);setClipping(null);return;}
      if(command&&e.shiftKey&&!e.altKey&&!editable&&w.active&&(e.key==='0'||e.code==='Digit0')&&selectedDocuments.length&&!w.opening&&!comparing){e.preventDefault();void w.setLabel('Purple',selectedVisiblePaths);return;}
      if(command&&w.active&&(e.key==='0'||e.code==='Digit0')){e.preventDefault();setViewCommand({action:e.altKey?'actual':'fit',sequence:++viewCommandSequence.current});return;}
      if(command&&w.active&&(e.key==='+'||e.key==='=')){e.preventDefault();setViewCommand({action:'zoom-in',sequence:++viewCommandSequence.current});return;}
      if(command&&w.active&&e.key==='-'){e.preventDefault();setViewCommand({action:'zoom-out',sequence:++viewCommandSequence.current});return;}
      if(command&&w.active&&!e.altKey&&((e.shiftKey&&e.key.toLowerCase()==='a')||(!e.shiftKey&&e.key.toLowerCase()==='d'))){e.preventDefault();setSelectedPaths([w.active.image.path]);return;}
      if(command&&!e.shiftKey&&key==='c'){e.preventDefault();if(!e.repeat)dispatch(e.altKey?'copy-selected':'copy-all');return;}
      if(command&&!e.shiftKey&&!e.altKey&&key==='v'){e.preventDefault();if(!e.repeat)dispatch('paste');return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();w.undo(e.shiftKey);return;}
      if(!command&&!e.altKey&&!e.shiftKey&&/^[0-5]$/.test(e.key)&&selectedDocuments.length&&!w.opening&&!comparing&&!(tab==='mask'&&(tool==='brush'||tool==='eraser'))){e.preventDefault();w.rate(Number(e.key),selectedVisiblePaths);return;}
      if(!command&&!e.altKey&&!e.shiftKey&&/^[6-9]$/.test(e.key)&&selectedDocuments.length&&!w.opening&&!comparing&&!(tab==='mask'&&(tool==='brush'||tool==='eraser'))){e.preventDefault();void w.setLabel(LABELS[Number(e.key)-6].value,selectedVisiblePaths);return;}
      if(!editable&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='q'&&!e.repeat&&w.active){e.preventDefault();if(comparing)compare(false);comparison.cycle(e.shiftKey);return;}
      if(!e.metaKey&&!e.ctrlKey&&!e.repeat&&w.active&&(e.code==='KeyP'||e.key.toLowerCase()==='p')){
        e.preventDefault();
        if(e.altKey&&!e.shiftKey){if(!w.busy&&!comparing)w.comparisonState('capture');}
        else if(e.shiftKey&&!e.altKey){setTab('presets');setTool('hand');}
        else if(!e.altKey&&!e.shiftKey)compare(!comparing);
        return;
      }
      if(!e.metaKey&&!e.ctrlKey&&e.key.toLowerCase()==='m'){setTab('mask');setTool(maskTool(geometry?.type));return;}
      if(command&&!e.altKey&&!e.shiftKey&&(e.code==='BracketLeft'||e.code==='BracketRight'||key==='['||key===']')){e.preventDefault();if(!e.repeat&&canRotate)void w.rotate(e.code==='BracketLeft'||key==='['?-90:90);return;}
      if(command&&!e.altKey&&!e.shiftKey&&key==='r'){e.preventDefault();if(!e.repeat)void w.reset();return;}
      if(command&&!e.altKey&&!e.shiftKey&&key==='a'){e.preventDefault();setSelectedPaths(visibleDocuments.map(d=>d.image.path));return;}
      if(!command&&e.altKey&&!e.shiftKey&&e.code==='KeyS'&&selectedDocuments.length>1&&!w.busy&&!comparing){e.preventDefault();w.openSynchronize();return;}
      if(e.metaKey||e.ctrlKey)return;
      if(key==='x'&&(tool==='crop'||tool==='straighten')&&w.active){e.preventDefault();w.edit(a=>flipCrop(a,w.active!.image));return;}
      if(e.key==='Enter'&&(tool==='crop'||tool==='straighten')){setTool('hand');return;}
      if(tool==='perspective'&&key==='l'&&e.shiftKey&&!e.altKey&&!e.repeat){e.preventDefault();guidedPerspective.setLoupe(v=>!v);return;}
      if(tool==='perspective'&&(key==='delete'||key==='backspace')){e.preventDefault();guidedPerspective.remove();return;}
      if(tool==='perspective'&&e.key==='Enter'){e.preventDefault();guidedPerspective.finish();return;}
      if(key==='b'){activate('repair');return;}
      if(tab==='repair'&&(key==='delete'||key==='backspace')&&selectedSpot){e.preventDefault();removeSpot(selectedSpot.id);return;}
      if(tab==='repair'&&(e.code==='BracketLeft'||e.code==='BracketRight'||e.key==='['||e.key===']')){e.preventDefault();const delta=e.code==='BracketLeft'||e.key==='['?-5:5;updateSpot(e.shiftKey?{feather:Math.max(0,Math.min(100,spotSettings.feather+delta))}:{radius:Math.max(2,Math.min(200,spotSettings.radius+delta))});return;}
      if(key==='e'){setTab('adjust');setTool('hand');return;}
      if(key==='k'&&!e.repeat){if(e.shiftKey&&selected)addComponent('brush','add');else addMask('brush');return;}
      if(key==='l'&&e.shiftKey&&w.active&&!e.repeat){e.preventDefault();addMask('luminance');return;}
      if((key==='r'||key==='l')&&!e.altKey&&!e.shiftKey){e.preventDefault();if(!e.repeat&&canRotate)void w.rotate(key==='r'?90:-90);return;}
      if(key==='y'){setOverlay(v=>!v);return;}
      if(key==='x'&&tab==='mask'&&selected){w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected.id?{...m,inverted:!m.inverted}:m)}));return;}
      if(tab==='mask'&&geometry?.type!=='luminance'&&(e.code==='BracketLeft'||e.code==='BracketRight'||e.key==='['||e.key===']')){
        e.preventDefault();const delta=e.code==='BracketLeft'||e.key==='['?-1:1;
        if(e.shiftKey&&geometry){if(geometry.type==='linear'&&geometry.linearGradientModel==='full-zero-v1')return;w.edit(a=>({...a,masks:a.masks.map(m=>m.id===selected?.id?(component?{...m,components:m.components?.map(c=>c.id===component.id?{...c,feather:Math.max(0,Math.min(100,c.feather+delta*5))}:c)}:{...m,feather:Math.max(0,Math.min(100,m.feather+delta*5))}):m)}));}
        else setBrushSize(size=>Math.max(.02,Math.min(1.5,size*(delta>0?1.1:1/1.1))));return;
      }
      const shortcuts:Record<string,Tool>={h:'hand',g:'linear',j:'radial',c:'crop',i:'white-balance'};
      if(shortcuts[e.key.toLowerCase()])activate(shortcuts[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown',down);
    return()=>{window.removeEventListener('keydown',down);unsubscribe();};
  },[w.active,selected,component,comparing,tab,tool,selectedSpot,spotDefaults,spotSource,selectingSource,w.syncOpen,w.busy,w.hasClipboard,w.opening,w.copyBusy,w.syncBusy,w.exportPending,w.job?.state,canCopy,canPaste,canExport,canRotate,selectedPaths,w.documents,ratingFilter,labelFilter,photoSort,sortDescending,dual,comparison.layout,guidedPerspective]);
  useEffect(()=>{setSelectedId('');setComponentId('');const restored=w.active?.adjustments.spots?.at(-1);if(restored)selectSpot(restored.id);else{setSpotId('');setSpotSource(undefined);setSelectingSource(false);setSpotDefaults(settings=>({...settings,sourceMode:'auto'}));}setTool('hand');setComparing(false);setClipping(null);},[w.active?.image.id]);
  useEffect(()=>{if(dual||comparing)setClipping(null);},[dual,comparing]);
  useEffect(()=>{if(tab!=='presets'||comparing||dual)void w.presetPreview.cancel();},[tab,comparing,dual]);
  return <ControlEditContext.Provider value={w.cancelEdit}><div className="app">
    <header className="titlebar"><div className="brand"><img src={logo} width={28} height={28} alt="CaptRAW 标志"/><b>Capt<span>RAW</span></b><em>显影工作台</em></div><div className="document-title">{w.active?<>{w.active.image.name}{w.active.dirty&&<i className="dirty-dot"/>}<button className="close-document" aria-label="关闭当前文件" title="关闭当前文件 ⌘W" onClick={()=>w.closeDocument(w.active!.image.id)}><X size={14}/></button></>:<span>每张原片，都值得好好显影。</span>}</div><div className="header-actions"><button className="icon-text" disabled={w.opening} onClick={choose} title="打开照片 ⌘O"><FolderOpen size={15}/>打开</button><button className="icon-text" disabled={!w.active||w.opening} onClick={w.save} title="保存 XMP 编辑 · ⌘⇧S（应用扩展）"><Save size={15}/>保存</button><div className="export-container"><button className="export-button" title="导出设置 ⌘S" disabled={!canExport} onMouseDown={event=>{if(event.button===0&&document.activeElement?.closest('input,textarea,select,[contenteditable]'))event.preventDefault();}} onClick={()=>setExportMenu(!exportMenu)}><ArrowDownToLine size={15}/>导出<ChevronDown size={12}/></button>{exportMenu&&<ExportMenu disabled={w.opening||w.exportPending||w.job?.state==='running'} options={outputOptions} setOptions={setOutputOptions} image={selectedDocuments[0]?.image} adjustments={selectedDocuments[0]?.adjustments} count={selectedDocuments.length} colorSpace={outputColorSpace} change={setOutputColorSpace} close={()=>setExportMenu(false)} run={format=>{if(!canExport)return;setExportMenu(false);void w.exportImage(format,outputColorSpace,selectedVisiblePaths,structuredClone(outputOptions));}}/>}</div></div></header>
    <div className="workbench" inert={w.opening}>
    <main className="stage"><div className="stage-toolbar"><div className="stage-meta">{w.active?<><span className="camera-name">{w.active.image.camera}</span><span>{w.active.image.iso?`ISO ${w.active.image.iso}`:''}</span><span>{w.frame?`${Math.round(w.frame.fullWidth*(visibleCrop?.width??1))} × ${Math.round(w.frame.fullHeight*(visibleCrop?.height??1))}`:''}</span></>:<span>RAW DEVELOPMENT</span>}</div><div className="stage-actions"><button title="撤销 ⌘Z" aria-label="撤销" disabled={!w.canUndo()} onClick={()=>w.undo()}><Undo2 size={15}/></button><button title="重做 ⇧⌘Z" aria-label="重做" disabled={!w.canUndo(true)} onClick={()=>w.undo(true)}><Redo2 size={15}/></button><span className="toolbar-separator"/><button className={comparing?'active':''} disabled={!a||!w.active?.opened||w.opening} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);compare(true);}} onPointerUp={()=>compare(false)} onPointerCancel={()=>compare(false)} title="按住查看前状态；P 切换对比"><Layers2 size={15}/><span>{comparing?comparison.label:'按住对比'}</span></button></div></div>
      {(tool==='crop'||tool==='straighten')&&a&&<CropControls value={a} image={w.active!.image} edit={w.edit} commit={w.commit} done={()=>setTool('hand')} straighten={tool==='straighten'} straightenDisabled={comparing||dual} toggleStraighten={()=>setTool(tool==='straighten'?'crop':'straighten')}/>}
      <Viewport sampleCurve={pickCurve} dustView={{enabled:tab==='repair'&&tool==='repair'&&!comparing&&!dual&&dustEnabled,threshold:dustThreshold}} clipping={clipping} viewCommand={viewCommand} guided={guidedPerspective} straightenDone={()=>setTool('crop')} imageSize={w.active?.image} beginCanvasEdit={w.beginCanvasEdit} beginMaskEdit={w.beginMaskEdit} error={w.setError} sessionId={w.active?.image.id} beforeLabel={comparing?comparison.label:undefined} comparison={dual?comparison:undefined} object={!dual&&object.active?{url:object.url,prompts:object.prompts,pick:object.pick,mode:object.mode,box:object.box,ready:object.ready,pickBox:object.pickBox}:undefined} frame={comparing?comparison.frame:hoverPreview?.frame||w.frame} detailFrame={comparing?comparison.detail:hoverPreview?undefined:w.detailFrame} adjustments={visibleAdjustments} tool={comparing||dual||hoverPreview?'hand':tool} luminanceMap={!dual&&rangeActive&&luminanceMap} cancelSample={w.cancelLuminanceSample} sampleRange={async(start,end,append,transaction)=>{if(selected){if(colorActive)await w.sampleColor(selected.id,component?.id,start,end,append,transaction);else await w.sampleLuminance(selected.id,component?.id,start,end,transaction);}}} removeColor={removeColor} selectedMask={!dual&&!comparing&&!object.active&&tab==='mask'&&geometry?.enabled?geometry:undefined} maskId={comparing||dual?'':previewMaskId} componentId={component?.id} sample={point=>w.whiteBalance({mode:'sample',x:point.x,y:point.y,size:sampleSize})} repair={{source:spotSource,selectingSource,selectedId:spotId,guides:spotGuides,settings:spotDefaults,pick:repairPick,select:selectSpot}} brushSize={brushSize} brush={brush} overlay={overlay} busy={w.busy||!!hoverPreview||w.presetPreview.pending||comparison.busy||!!w.active&&!selectedVisiblePaths.includes(w.active.image.path)} edit={w.edit} commit={w.commit} open={choose} drop={w.openPaths} viewport={comparing?comparison.viewport:w.viewport} comparisonControl={<><select aria-label="前后对比视图" title="Q 切换对比视图 · Shift+Q 反向切换" disabled={!a||w.opening} value={comparison.layout} onChange={e=>{if(comparing)compare(false);comparison.setLayout(e.target.value as typeof comparison.layout);}}>{comparisonLayouts.map(v=><option key={v} value={v}>{comparisonNames[v]}</option>)}</select><button aria-label="保存前状态" title="将当前设置保存为前状态 · Option/Alt+P" disabled={!w.active?.opened||w.busy||comparing} onClick={()=>w.comparisonState('capture')}><Copy size={14}/></button><button aria-label="交换前后设置" title="交换前后设置 · 保持当前构图 · 可撤销" disabled={!w.active?.opened||w.busy||comparing} onClick={()=>w.comparisonState('swap')}><ArrowLeftRight size={14}/></button><button aria-label="还原打开时状态" title="将对比前状态还原为打开照片时的设置" disabled={!w.active?.before||w.busy||comparing} onClick={()=>w.comparisonState('reset')}><RotateCcw size={14}/></button></>}/>
      {(w.error||comparison.error)&&<div className="error-banner" role="alert"><span>{(w.error||comparison.error).replace('Error: ','')}</span>{w.active&&<button onClick={()=>w.switchDocument(w.active!.image.id,true)}>重新载入当前编辑</button>}<button title="关闭错误" onClick={()=>{w.setError('');comparison.setLayout('off');setComparing(false);}}><X size={15}/></button></div>}
      {tool==='color'&&a&&<div className="sample-actions"><Pipette size={14}/><span>{w.sampling?'正在读取照片颜色…':'单击或框选取代表色 · Shift 添加 · Option 点击样本删除'}</span><button onClick={()=>setTool('hand')}>完成取样</button></div>}
      {tool==='luminance'&&a&&<div className="sample-actions"><Pipette size={14}/><span>{w.sampling?'正在读取照片亮度…':'单击取样 5 × 5 像素，或拖动选择区域'}</span><button onClick={()=>setTool('hand')}>完成取样</button></div>}
      {tool==='white-balance'&&a&&<div className="sample-actions"><Pipette size={14}/><span>白平衡取样</span><select aria-label="取样大小" value={sampleSize} onChange={e=>setSampleSize(Number(e.target.value))}>{[5,11,25].map(n=><option key={n} value={n}>{n} × {n} 像素</option>)}</select><button onClick={()=>setTool('hand')}>完成取样</button></div>}
    <RatingControls ratings={selectedDocuments.map(d=>d.rating)} rate={value=>w.rate(value,selectedVisiblePaths)} disabled={!selectedDocuments.length||w.opening||comparing} filter={ratingFilter} setFilter={setRatingFilter} visible={visibleDocuments.length} total={w.documents.length} activeHidden={!!w.active&&!visibleDocuments.some(d=>d.image.path===w.active!.image.path)} filtered={labelFilter!=='all'} clearFilters={()=>setLabelFilter('all')}>
      <LabelControls labels={selectedDocuments.map(d=>d.label)} change={label=>void w.setLabel(label,selectedVisiblePaths)} disabled={!selectedDocuments.length||w.opening||comparing}/>
      <label className="rating-filter">色标<select aria-label="色标筛选" value={labelFilter} onChange={e=>setLabelFilter(e.target.value as LabelFilter)}><option value="all">全部色标</option><option value="none">无色标</option>{LABELS.map(v=><option key={v.value} value={v.value}>{v.name}</option>)}<option value="custom">自定义标签</option></select></label>
      <label className="rating-filter">排序<select aria-label="照片排序" value={photoSort} onChange={e=>{const sort=e.target.value as PhotoSort;setPhotoSort(sort);setSortDescending(sort==='rating');}}><option value="import">导入顺序</option><option value="name">文件名</option><option value="rating">评分</option><option value="label">色标</option><option value="iso">ISO</option></select></label><button className="sort-direction" aria-label="切换排序方向" aria-description={sortDescending?'当前降序':'当前升序'} title={sortDescending?'当前降序，切换为升序':'当前升序，切换为降序'} disabled={photoSort==='import'} onClick={()=>setSortDescending(v=>!v)}>{sortDescending?'↓':'↑'}</button>
    </RatingControls>
    <div className={`filmstrip-toolbar ${gridView?'grid':''}`}><span>{selectedDocuments.length} / {w.documents.length} 张已选</span><button disabled={!w.documents.length||w.opening} onClick={()=>setSelectedPaths(visibleDocuments.map(d=>d.image.path))}>选择全部</button><button disabled={!canCopy} title="复制所选设置 · ⌘⌥C" onClick={w.openCopy}>复制设置…</button><button disabled={!canPaste} title="粘贴设置 · ⌘V" onClick={()=>void w.pasteAdjustments()}>粘贴设置</button><button className="sync-trigger" disabled={selectedDocuments.length<2||w.busy||w.syncBusy||comparing} onClick={w.openSynchronize} title="同步设置 · Option+S">同步设置…</button><button disabled={selectedDocuments.length<2||w.busy||w.syncBusy||comparing} onClick={()=>void w.matchCameraExposure(selectedVisiblePaths)} title="根据 ISO、光圈、快门和曝光补偿，将所选照片匹配到当前照片">匹配曝光</button><button disabled={!selectedDocuments.length||w.busy||w.syncBusy||comparing} onClick={()=>void w.saveSelected(selectedVisiblePaths)} title="将所选照片保存为 XMP 编辑文件">保存所选…</button><button aria-pressed={gridView} onClick={()=>setGridView(v=>!v)} title="切换网格 / 胶片视图"><LayoutGrid size={13}/>{gridView?'收起网格':'网格视图'}</button><small>⌘ 单击增减 · Shift 连选 · 调节联动所选照片</small></div>
    <footer className={`filmstrip ${gridView?'grid':''}`} data-view={gridView?'grid':'filmstrip'}><button className="add-images" disabled={w.opening} title="添加照片" onClick={choose}><FolderOpen size={20}/><span>添加照片</span></button><div className="filmstrip-items">{visibleDocuments.map(d=><div key={d.image.id} className={`film-item ${selectedPaths.includes(d.image.path)?'selected':''} ${d.image.id===w.active?.image.id?'active':''}`}><button className="film-open" aria-pressed={selectedPaths.includes(d.image.path)} aria-current={d.image.id===w.active?.image.id?'true':undefined} disabled={w.opening} onClick={e=>selectDocument(d.image.path,e)} title={d.image.path}>{d.thumbnail?<img src={d.thumbnail} data-frame={d.thumbnailFrame} alt={d.image.name}/>:<ImageIcon size={25} strokeWidth={1}/>}<span>{d.image.name}</span>{d.label&&<i className="film-label" role="img" aria-label={labelText(d.label)} title={labelText(d.label)} data-label={d.label} style={{backgroundColor:labelColor(d.label)?.color??'#aaa'}}/>}<small className={`film-rating ${d.rating===-1?'rejected':''}`} aria-label={`${d.image.name}：${ratingText(d.rating)}`}>{d.rating===-1?'已拒绝':d.rating?`${'★'.repeat(Math.floor(d.rating))}${Number.isInteger(d.rating)?'':` ${d.rating}`}`:'☆☆☆☆☆'}</small>{d.dirty&&<i className="dirty-dot"/>}</button><button className="film-close" aria-label={`关闭 ${d.image.name}`} title="关闭文件" disabled={w.opening} onClick={()=>w.closeDocument(d.image.id)}><X size={13}/></button></div>)}{!!w.documents.length&&!visibleDocuments.length&&<div className="filmstrip-empty"><span>没有符合筛选条件的照片</span><button onClick={()=>{setRatingFilter('all');setLabelFilter('all');}}>显示全部照片</button></div>}{!w.documents.length&&<div className="filmstrip-empty"><span>当前会话</span><small>打开的照片会显示在这里</small></div>}</div><div className="image-count">{w.documents.length.toString().padStart(2,'0')}<small>张照片</small></div></footer>
    </main>
    <aside className="inspector"><Histogram frame={comparing?comparison.frame:hoverPreview?.frame||w.frame} image={w.active?.image}/><div className="profile-line"><b>{tab==='mask'?'蒙版':tab==='repair'?'修复':tab==='presets'?'预设':'编辑'}</b><span title={tab==='mask'?'局部调整':tab==='repair'?'取样修复与仿制':profileName}>{tab==='mask'?'局部调整':tab==='repair'?'取样修复与仿制':profileName}</span></div><Tabs.Root value={tab} onValueChange={value=>{setTab(value);setTool(value==='mask'?maskTool(geometry?.type):value==='repair'?'repair':'hand');}}><Tabs.List className="inspector-tabs"><Tabs.Trigger value="adjust"><SlidersHorizontal size={15}/>调节</Tabs.Trigger><Tabs.Trigger value="mask"><Circle size={15}/>蒙版{a?.masks.length?<span>{a.masks.length}</span>:null}</Tabs.Trigger><Tabs.Trigger value="repair">修复</Tabs.Trigger><Tabs.Trigger value="presets">预设</Tabs.Trigger></Tabs.List><div className="inspector-content" inert={!!w.active&&!selectedVisiblePaths.includes(w.active.image.path)}>{!!w.active?.image.xmpWarnings?.length&&<details className="xmp-notice"><summary>XMP 导入说明 · 部分参数支持</summary>{w.active.image.xmpWarnings.map(message=><p key={message}>{message}</p>)}</details>}{a?<><Tabs.Content value="adjust"><AdjustmentsPanel curvePick={{channel:tool==='curve'?curveTarget:undefined,pending:curvePending,picked:curvePicked,toggle:toggleCurveTarget,cancel:cancelCurvePick}} guided={guidedPerspective} startGuided={()=>setTool('perspective')} autoPerspective={{...autoPerspective,run:async direction=>{await w.autoPerspective(direction);}}} automaticTone={()=>void w.autoTone()} applyCurvePreset={name=>void w.applyCurvePreset(name)} toneHistogram={w.frame?.sessionId===w.active?.image.id?w.frame?.histogram:null} histogram={w.frame?.sessionId===w.active?.image.id?w.frame?.curveHistogram:null} value={a} edit={w.editGlobal} commit={()=>void w.commitGlobal()} image={w.active!.image} whiteBalance={w.whiteBalance} picker={()=>activate('white-balance')} pickerActive={tool==='white-balance'} disabled={w.busy||!selectedVisiblePaths.includes(w.active!.image.path)}/></Tabs.Content><Tabs.Content value="mask">{object.active?<ObjectSelectionPanel selection={object}/>:<><div className="panel-section"><button className="object-create" disabled={w.opening||comparing} onClick={startObject}>选择对象</button></div><MaskPanel luminanceMap={luminanceMap} setLuminanceMap={setLuminanceMap} sampleRange={()=>setTool(tool===geometry?.type?'hand':maskTool(geometry?.type))} samplingActive={tool===geometry?.type} removeColor={removeColor} masks={a.masks} selected={selected} componentId={component?.id} addComponent={addComponent} onComponent={id=>{setComponentId(id);const c=selected?.components?.find(c=>c.id===id);if(c)setTool(maskTool(c.type));}} onSelect={id=>{setSelectedId(id);setComponentId('');const mask=a.masks.find(m=>m.id===id);if(mask)setTool(maskTool(mask.components?.[0]?.type||mask.type));}} add={addMask} edit={w.edit} commit={w.commit} brushSize={brushSize} setBrushSize={setBrushSize} brush={brush} setBrush={setBrush} overlay={overlay} setOverlay={setOverlay}/></>}</Tabs.Content><Tabs.Content value="presets"><PresetsPanel workbench={w}/></Tabs.Content><Tabs.Content value="repair"><RepairPanel dustView={{enabled:dustEnabled,threshold:dustThreshold,setEnabled:setDustEnabled,setThreshold:setDustThreshold}} spots={a.spots||[]} selected={selectedSpot} settings={spotSettings} select={selectSpot} update={updateSpot} commit={w.commit} remove={removeSpot} enable={id=>w.edit(a=>({...a,spots:a.spots?.map(s=>s.id===id?{...s,enabled:!s.enabled}:s)}))} rename={name=>w.edit(a=>({...a,spots:a.spots?.map(s=>s.id===spotId?{...s,name}:s)}),true)} move={moveSpot} pickSource={()=>{setTool('repair');setSelectingSource(true);}} newSpot={()=>{setTool('repair');setSpotId('');setSelectingSource(spotDefaults.sourceMode!=='auto'&&!spotSource);}} selectingSource={selectingSource} guides={spotGuides} setGuides={setSpotGuides}/></Tabs.Content></>:<div className="inspector-placeholder"><SlidersHorizontal size={27} strokeWidth={1}/><p>打开照片，开始调整</p><span>光线、色彩与局部细节</span></div>}</div></Tabs.Root><div className="inspector-footer"><span className="profile-badge" title="预览色彩空间">sRGB</span><span>无损编辑</span><button disabled={!a} title="重置全部编辑" onClick={w.reset}><RotateCcw size={13}/>重置</button></div></aside><aside className="tools" aria-label="工具"><button aria-label="编辑" title="编辑" className={tab==='adjust'&&tool!=='crop'&&tool!=='straighten'?'selected':''} onClick={()=>{setTab('adjust');setTool('hand');}}><SlidersHorizontal size={20}/></button><button aria-label="裁切 C" title="裁切 C" className={tool==='crop'||tool==='straighten'?'selected':''} disabled={!a} onClick={()=>activate('crop')}><Crop size={20}/></button><button aria-label="修复 B" title="修复 B" className={tab==='repair'?'selected':''} disabled={!a} onClick={()=>activate('repair')}><Eraser size={20}/></button><button aria-label="蒙版 M" title="蒙版 M" className={tab==='mask'?'selected':''} disabled={!a} onClick={()=>{setTab('mask');setTool(maskTool(geometry?.type));}}><Circle size={20}/></button><button aria-label="预设" title="预设" disabled={!a} className={tab==='presets'?'selected':''} onClick={()=>{setTab('presets');setTool('hand');}}><Blend size={20}/></button>{tab==='mask'&&<><div className="tool-divider"/><button aria-label="画笔蒙版 K" title="画笔 K" onClick={()=>activate('brush')}><Brush size={19}/></button><button aria-label="蒙版橡皮擦" title="橡皮擦 · 按住 Option 临时擦除" disabled={geometry?.type!=='brush'} onClick={()=>activate('eraser')}><Eraser size={19}/></button></>}<div className="tool-divider"/><button aria-label="白平衡 I" title="白平衡 I" disabled={!a||w.busy} className={tool==='white-balance'?'selected':''} onClick={()=>activate('white-balance')}><Pipette size={19}/></button><button aria-label="平移 H" title="平移 H" onClick={()=>setTool('hand')}><Hand size={19}/></button><button aria-label="顺时针旋转 90 度" title="顺时针旋转 · R / ⌘]" disabled={!canRotate} onClick={()=>void w.rotate(90)}><RotateCw size={19}/></button></aside></div>

    <div className="statusbar"><span><i className={w.busy?'status-dot busy':'status-dot'}/>{w.busy?'正在处理照片…':w.status}</span><span className="status-actions"><button disabled={!w.active||w.opening} onClick={()=>w.closeDocument(w.active!.image.id)}>关闭文件</button><button disabled={!w.documents.length||w.opening} onClick={()=>void w.discardSession()}>取消</button><button disabled={!w.documents.length||w.opening} onClick={()=>void w.finish()}>完成</button><span>输出：{OUTPUT_COLOR_SPACES[outputColorSpace]} · SDR</span></span></div>
    {w.saveOpen&&<BatchSaveDialog busy={w.saveBusy} progress={w.saveProgress} result={w.saveResult} error={w.saveError} cancel={()=>void w.cancelSave()} close={w.closeSave} retry={path=>void w.retrySave(path)}/>}
    {(w.linkedBusy||w.job)&&<div className="job-toasts">
      {w.linkedBusy&&<div className="job-toast running" role="status" aria-label="联动调整"><div><span>{w.syncProgress||'正在处理所选照片…'}</span><button onClick={w.cancelGlobal}>取消联动</button></div></div>}
      {w.job&&<div className={`job-toast ${w.job.state}`} role="status"><div><ArrowDownToLine size={17}/><span>{w.job.message}</span>{w.job.state==='running'?<button disabled={w.exportCancelling} onClick={()=>void w.cancelExport()}>{w.exportCancelling?'正在取消…':'取消'}</button>:<button aria-label="关闭导出结果" onClick={w.dismissJob}><X size={14}/></button>}</div>{w.job.state==='running'&&<progress max={1} value={w.job.progress}/>} {!!w.job.results?.length&&<details className="export-results"><summary>查看文件与错误（{w.job.results.length}）</summary><ul>{w.job.results.map(r=><li key={r.source} className={r.error?'failed':''}><strong>{w.documents.find(d=>d.image.path===r.source)?.image.name||r.source}</strong><span>{r.output||r.error}</span></li>)}</ul></details>}</div>}
    </div>}
    {w.presetBusy&&<PresetProgress cancel={()=>void w.cancelPreset()}/>}
    {w.copyOpen&&w.active&&<SynchronizeDialog purpose="copy" approximateWB={!!w.active.adjustments.wbApproximate} source={w.active.image.name} targets={[]} busy={w.copyBusy} progress="正在复制设置…" error={w.error} apply={groups=>void w.copyAdjustments(groups)} cancel={()=>{if(!w.copyBusy)w.closeCopy();}}/>}
    {w.syncOpen&&w.active&&<SynchronizeDialog approximateWB={!!w.active.adjustments.wbApproximate} source={w.active.image.name} targets={selectedDocuments.filter(d=>d.image.path!==w.active!.image.path).map(d=>d.image.name)} busy={w.syncBusy} progress={w.syncProgress} error={w.syncError} apply={groups=>void w.synchronize(selectedVisiblePaths,groups)} cancel={()=>void w.cancelSynchronize()}/>}
  </div></ControlEditContext.Provider>;
}
