import {useEffect,useRef} from 'react';
import {usePresetPreview} from './usePresetPreview';
import {SYNC_GROUPS,type RecomputedEdit} from '@captraw/contracts/synchronize';
import {OUTPUT_COLOR_SPACES,type EngineEvent,type OutputColorSpace} from '@captraw/contracts';
import {copy,type DocumentState,type EditingState} from './workbench/model';
import {useDocumentState} from './workbench/useDocumentState';
import {useEditing} from './workbench/useEditing';
import {useExport} from './workbench/useExport';
import {usePersistence} from './workbench/usePersistence';
import {usePresetSync} from './workbench/usePresetSync';
import {useRendering} from './workbench/useRendering';

export function useWorkbench(){
  const {documents,setDocuments,docs,activeId,setActiveId,idRef,active,targetsRef,updateDocument,targetDocuments,editEpoch,profileEpoch,historyClock,nextHistorySnapshot:historySnapshot}=useDocumentState();
  const rendering=useRendering(updateDocument,idRef);
  const {maskId,setMaskPreview,maskRef,colorSampling,setColorSampling,colorRef,luminance,setLuminance,sampling,setSampling,luminanceRef,sampleEpoch,samplingRef,frame,setFrame,detailFrame,setDetailFrame,busy,setBusy,error,setError,status,setStatus,opening,setOpening,wbPending,setWbPending,revision,rendered,loading,timer,renderDocument,previewThumbnail,previewOutput:renderOutputPreview}=rendering;
  const presetBusy=false,sessionId=useRef(crypto.randomUUID()),syncProgressDispatch=useRef<(message:string)=>void>(()=>{});
  const editing=useEditing({docs,setDocuments,idRef,targetsRef,targetDocuments,active,loading,editEpoch,profileEpoch,historyClock,historySnapshot,setError,setStatus,setOpening,wbPending,setWbPending,setSampling,samplingRef,sampleEpoch,frame,revision,rendered,maskRef,luminanceRef,colorRef,timer,renderDocument,previewThumbnail,syncProgress:syncProgressDispatch});
  const {linkedBusy,setLinkedBusy,linkedCancelled,canvasEditing,canvasInProgress,edit,editGlobal,commitGlobal,runPrepared,recomputeEdit,applyCurvePreset,cancelGlobal,cancelEdit,commit,rate,setLabel,beginCanvasEdit,beginMaskEdit,undo,comparisonState,addMask,flush,rotate,reset,whiteBalance,sampleColor,sampleLuminance,resetEditing,clearGesture}=editing;
  const presetPreview=usePresetPreview(active);
  const persistence=usePersistence({docs,setDocuments,idRef,sessionId,targetsRef,targetDocuments,loading,setOpening,setBusy,setError,setStatus,canvasInProgress,commitGlobal,commit,endSession,clearPending:()=>clearTimeout(timer.current)});
  const {saveOpen,setSaveOpen,saveBusy,saveProgress,setSaveProgress,saveResult,saveError,saveTargets,save,saveSelected,retrySave,cancelSave,finish,documentSnapshot}=persistence;
  const exportController=useExport({docs,idRef,targetDocuments,loading,canvasInProgress,commitGlobal,commit,documentSnapshot,setError});
  const {job,setJob,exportCancelling,exportPending,exportImage,cancelExport}=exportController;
  const presetSync=usePresetSync({docs,setDocuments,idRef,targetsRef,targetDocuments,loading,busy,samplingRef,wbPending,canvasInProgress,commitGlobal,commit,editEpoch,profileEpoch,revision,historySnapshot,linkedCancelled,setLinkedBusy,setOpening,clearPending:()=>clearTimeout(timer.current),renderDocument,runPrepared,flush,presetPreview,setError,setStatus,previewThumbnail});
  const {presetWarnings,copyOpen,setCopyOpen,hasClipboard,copyBusy,syncOpen,syncBusy,syncProgress,setSyncProgress,syncError,syncStatusRevision,syncOpenRef,openSynchronize,cancelSynchronize,synchronize,matchCameraExposure,beginPresetAmount,cancelPresetAmount,applyPreset,copyAdjustments,pasteAdjustments}=presetSync;
  syncProgressDispatch.current=setSyncProgress;

  useEffect(()=>{void window.captraw.setDirty(documents.filter(document=>document.dirty||document.image.id===canvasEditing).map(document=>document.image.path));},[documents,canvasEditing]);
  useEffect(() => window.captraw.onEvent((event:EngineEvent) => {
    if(event.event==='preview'&&event.frame.sessionId===idRef.current&&event.frame.revision>=revision.current){
      if(event.frame.kind==='detail')setDetailFrame(event.frame);
      else{
        setFrame(event.frame);setDetailFrame(current=>current?.sessionId===event.frame.sessionId&&current.revision===event.frame.revision?current:undefined);setBusy(false);if(event.frame.revision>syncStatusRevision.current)setStatus(`${Math.round(event.frame.elapsedMs)} ms · ${event.frame.linear?.outputProfile?`${OUTPUT_COLOR_SPACES[event.frame.linear.outputProfile]} 目标预览` :event.frame.linear?.colorSpace==='display-p3'?'Display P3 · 浮点 SDR':event.frame.linear?'扩展范围 · 线性 Rec.709':'sRGB'}`);
        updateDocument(event.frame.sessionId,current=>({...current,previewToken:event.frame.url}));
        const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=180;canvas.height=Math.round(180*image.height/image.width);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);updateDocument(event.frame.sessionId,current=>current.previewToken===event.frame.url?{...current,thumbnail:canvas.toDataURL('image/jpeg',.75),thumbnailFrame:event.frame.url}:current);};image.src=event.frame.url;
      }
    }else if(event.event==='save-progress')setSaveProgress(event.message);
    else if(event.event==='synchronize-progress')setSyncProgress(event.message);
    else if(event.event==='command'){
      if(syncOpenRef.current||loading.current||document.querySelector('dialog[open]'))return;
      if(event.command==='close')void closeDocument(idRef.current);
      if(event.command==='save')void save();
      if(event.command==='open')void window.captraw.chooseFiles().then(openPaths);
    }else if(event.event==='job')setJob(event.job);
    else if(event.event==='error'){setError(event.message);setBusy(false);}
  }),[]);
  useEffect(()=>{
    if(!active||loading.current)return;
    clearTimeout(timer.current);
    const alreadyRendered=()=>{const current=rendered.current;return current?.id===active.image.id&&current.revision===revision.current&&current.adjustments===active.adjustments&&current.profileId===active.profileId&&current.maskId===maskRef.current&&current.luminance===luminanceRef.current&&current.colorSampling===colorRef.current;};
    if(alreadyRendered())return;
    timer.current=setTimeout(()=>{if(!alreadyRendered())void renderDocument(active).catch(()=>{});},90);
    return ()=>clearTimeout(timer.current);
  },[activeId,active?.adjustments,active?.profileId,maskId,luminance,colorSampling,opening]);

  async function openPaths(paths:string[]){
    if(!paths.length||loading.current)return;
    if(!await commitGlobal())return;
    const fresh=paths.filter(path=>!docs.current.some(current=>current.image.path===path));
    if(!fresh.length){const existing=docs.current.find(current=>current.image.path===paths[0]);if(existing)await switchDocument(existing.image.id);return;}
    paths=fresh;loading.current=true;setOpening(true);clearTimeout(timer.current);setBusy(true);setError('');
    try{
      for(const path of paths){
        const image=await window.captraw.open(path),label=image.recipe?.label??image.label??'';
        const baseline:EditingState={adjustments:copy(image.initialAdjustments||image.adjustments),profile:image.initialArtProfile||'',profileId:0,rating:image.rating,label};
        const imported=!!image.importedFromAdobe,migration=!!image.needsNativeSave&&!imported;
        const entry:DocumentState={image,xmpPacket:image.recipe?.xmpPacket,nativePacket:image.recipe?.nativePacket,needsNativeSave:migration,rating:image.rating,savedRating:image.rating,label,savedLabel:label,adjustments:copy(image.adjustments),initial:copy(baseline.adjustments),profile:image.recipe?.artProfile||'',profileId:imported?++profileEpoch.current:0,savedProfileId:0,dirty:imported||migration,saved:copy(imported?baseline.adjustments:image.adjustments),past:imported?[historySnapshot(baseline)]:[],future:[],...(imported?{opened:baseline}:{})};
        setDocuments(old=>old.some(current=>current.image.path===image.path)?old.map(current=>current.image.path===image.path?entry:current):[...old,entry]);
        setActiveId(image.id);idRef.current=image.id;setFrame(undefined);await renderDocument(entry);
      }
    }catch(error){setError(String(error));setBusy(false);}
    finally{loading.current=false;setOpening(false);}
  }
  async function switchDocument(id:string,force=false){
    if((id===idRef.current&&!force)||loading.current)return;
    if(!await commitGlobal())return;
    const entry=docs.current.find(current=>current.image.id===id);if(!entry)return;
    loading.current=true;setOpening(true);clearTimeout(timer.current);setBusy(true);setError('');
    try{
      const reopened=await window.captraw.open(entry.image.path,entry.image.sourceIdentity);
      const updated={...entry,image:{...reopened,sourceIdentity:entry.image.sourceIdentity,adjustments:entry.adjustments}};
      setDocuments(old=>old.map(current=>current.image.id===id?updated:current));
      idRef.current=reopened.id;setActiveId(reopened.id);setFrame(undefined);await renderDocument(updated);return updated;
    }catch(error){setError(String(error));setBusy(false);}
    finally{loading.current=false;setOpening(false);}
  }
  async function endSession(){
    clearTimeout(timer.current);++revision.current;resetEditing();
    await window.captraw.close();await window.captraw.forgetSession(sessionId.current);docs.current=[];setDocuments([]);idRef.current='';setActiveId('');setFrame(undefined);setDetailFrame(undefined);setBusy(false);setSaveOpen(false);sessionId.current=crypto.randomUUID();
    setStatus('会话已结束 · 原片保持不变');
  }
  async function closeDocument(id:string,saved=false){
    if(loading.current||canvasInProgress())return;
    if(!await commitGlobal())return;
    commit();const target=docs.current.find(current=>current.image.id===id);if(!target)return;
    if(target.dirty&&!saved){
      const decision=await window.captraw.confirmClose(target.image.name);
      if(decision==='cancel')return;
      if(decision==='save'&&!await saveTargets([target.image.path]))return;
    }
    const remaining=docs.current.filter(current=>current.image.path!==target.image.path),index=docs.current.indexOf(target),isActive=idRef.current===target.image.id;
    if(isActive){clearTimeout(timer.current);clearGesture();++revision.current;loading.current=true;setOpening(true);try{await window.captraw.close();}catch(error){setError(String(error));return;}finally{loading.current=false;setOpening(false);}setFrame(undefined);setDetailFrame(undefined);idRef.current='';setActiveId('');setBusy(false);setError('');}
    docs.current=remaining;setDocuments(remaining);
    if(isActive&&remaining.length)await switchDocument(remaining[Math.min(Math.max(0,index),remaining.length-1)].image.id);
    if(!remaining.length){await window.captraw.forgetSession(sessionId.current);sessionId.current=crypto.randomUUID();}
  }
  async function discardSession(){
    if(loading.current||canvasInProgress())return;
    if(!await window.captraw.confirmDiscardSession(docs.current.filter(current=>current.dirty).map(current=>current.image.name)))return;
    loading.current=true;setOpening(true);
    try{await endSession();}catch(error){setError(String(error));}finally{loading.current=false;setOpening(false);}
  }
  function cancelPreset(){cancelGlobal();}
  async function viewport(x:number,y:number,width:number,height:number){
    if(loading.current)return;
    const current=docs.current.find(item=>item.image.id===idRef.current);if(!current)return;
    const requestedRevision=revision.current;
    try{await window.captraw.viewport(current.image.id,requestedRevision,x,y,width,height);}
    catch(error){if(!loading.current&&idRef.current===current.image.id&&revision.current===requestedRevision)setError(String(error));}
  }
  async function previewOutput(colorSpace:OutputColorSpace|null){
    const current=docs.current.find(document=>document.image.id===idRef.current);
    if(!current)return;
    await renderOutputPreview(current,colorSpace);
  }
  return {applyCurvePreset,cancelEdit,cancelExport,exportCancelling,rotate,copyAll:()=>copyAdjustments(SYNC_GROUPS.map(group=>group.id)),setLabel,canUndo:(redo=false)=>docs.current.some(current=>targetsRef.current.includes(current.image.path)&&(redo?current.future:current.past).length>0),beginPresetAmount,cancelPresetAmount,presetPreview,copyBusy,copyOpen,hasClipboard,openCopy:()=>{if(!loading.current&&!canvasInProgress())setCopyOpen(true);},closeCopy:()=>setCopyOpen(false),copyAdjustments,pasteAdjustments,getSelectedDocuments:()=>copy(targetDocuments()),editGlobal,commitGlobal,cancelGlobal,linkedBusy,autoTone:()=>recomputeEdit({type:'autoTone'}),autoPerspective:(direction:Extract<RecomputedEdit,{type:'autoPerspective'}>['direction'])=>recomputeEdit({type:'autoPerspective',direction}),setTargets:(paths:string[])=>{targetsRef.current=paths;},discardSession,retrySave,rate,beginCanvasEdit,beginMaskEdit,saveSelected,cancelSave,saveOpen,saveBusy,saveProgress,saveResult,saveError,closeSave:()=>setSaveOpen(false),applyPreset,cancelPreset,presetBusy,presetWarnings,flush,exportPending,dismissJob:()=>setJob(undefined),syncOpen,syncBusy,syncProgress,syncError,openSynchronize,cancelSynchronize,synchronize,matchCameraExposure,documents,active,frame,detailFrame,busy:busy||opening||wbPending||sampling,opening,wbPending,sampling,error,status,job,revision,setError,setMaskPreview,setLuminance,setColorSampling,sampleColor,sampleLuminance,cancelLuminanceSample:()=>{++sampleEpoch.current;samplingRef.current=false;setSampling(false);},openPaths,switchDocument,closeDocument,finish,whiteBalance,edit,commit,undo,addMask,save,exportImage,comparisonState,viewport,previewOutput,reset};
}
