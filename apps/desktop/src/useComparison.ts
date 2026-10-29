import {useEffect,useRef,useState} from 'react';
import type {ComparisonLayout,PreviewFrame} from '@captraw/contracts';
import type {DocumentState} from './useWorkbench';
export const comparisonLayouts:ComparisonLayout[]=['off','left-right','top-bottom','split-vertical','split-horizontal'];
export const comparisonNames:Record<ComparisonLayout,string>={off:'单图', 'left-right':'左右对比','top-bottom':'上下对比','split-vertical':'左右分割','split-horizontal':'上下分割'};
export function useComparison(active:DocumentState|undefined,linearPreview=false){
 const [layout,setLayout]=useState<ComparisonLayout>('off'),[showBefore,setShowBefore]=useState(false),[frame,setFrame]=useState<PreviewFrame>(),[detail,setDetail]=useState<PreviewFrame>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const token=useRef(0),session=useRef('');
 const a=active?.adjustments,geometry=JSON.stringify(a?{rotation:a.rotation,flipHorizontal:a.flipHorizontal??active?.image.effectiveGeometry?.flipHorizontal,flipVertical:a.flipVertical??active?.image.effectiveGeometry?.flipVertical,fineRotation:a.fineRotation,perspective:a.perspective,crop:a.crop,lensCorrections:a.lensCorrections,lensProfile:a.lensProfile,lensManualDistortion:a.lensManualDistortion}:null);
 const before=active?.before||active?.opened,enabled=layout!=='off'||showBefore;
 useEffect(()=>window.captraw.onEvent(e=>{
  if(e.event==='comparison-preview'&&e.frame.sessionId===session.current&&e.frame.revision===token.current){
   if(e.frame.kind==='detail')setDetail(e.frame);else{setFrame(e.frame);setBusy(false);}
  }else if(e.event==='comparison-error'&&e.sessionId===session.current&&e.revision===token.current){setError(e.message);setBusy(false);}
 }),[]);
 useEffect(()=>{
  const id=active?.image.id;session.current=id||'';const revision=++token.current;
  setFrame(undefined);setDetail(undefined);setError('');setBusy(!!id&&enabled&&!!before);
  if(!id)return;
  void window.captraw.comparison(id,revision,enabled&&before?{adjustments:before.adjustments,artProfile:before.profile,geometry:JSON.parse(geometry)}:null,linearPreview).catch(e=>{if(token.current===revision){setError(String(e));setBusy(false);}});
  return()=>{++token.current;void window.captraw.comparison(id,token.current,null).catch(()=>{});};
 },[active?.image.id,enabled,geometry,before,linearPreview]);
 useEffect(()=>{setLayout('off');setShowBefore(false);},[active?.image.id]);
 async function viewport(x:number,y:number,width:number,height:number){
  if(!frame||!enabled)return;
  const revision=token.current;
  try{await window.captraw.comparisonViewport(session.current,revision,x,y,width,height);}catch(e){if(token.current===revision)setError(String(e));}
 }
 return {layout,setLayout,showBefore,setShowBefore,label:active?.before?'已存前状态':'打开时状态',frame,detail,busy,error,viewport,cycle:(reverse=false)=>setLayout(v=>comparisonLayouts[(comparisonLayouts.indexOf(v)+(reverse?-1:1)+comparisonLayouts.length)%comparisonLayouts.length])};
}
