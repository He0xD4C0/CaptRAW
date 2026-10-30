import {useRef,useState,type Dispatch,type MutableRefObject,type SetStateAction} from 'react';
import {matchExposureByCameraSettings,type RecomputedEdit,type SyncDocument,type SyncGroup,type SyncResult} from '@captraw/contracts/synchronize';
import {copy,dirty,type DocumentState,type HistoryState} from './model';

interface Options {
  docs:MutableRefObject<DocumentState[]>;
  setDocuments:(change:DocumentState[]|((previous:DocumentState[])=>DocumentState[]))=>void;
  idRef:MutableRefObject<string>;
  targetsRef:MutableRefObject<string[]>;
  targetDocuments:(paths?:string[])=>DocumentState[];
  loading:MutableRefObject<boolean>;
  busy:boolean;
  samplingRef:MutableRefObject<boolean>;
  wbPending:boolean;
  canvasInProgress:()=>boolean;
  commitGlobal:(recompute?:RecomputedEdit)=>Promise<boolean>;
  commit:()=>void;
  editEpoch:MutableRefObject<number>;
  profileEpoch:MutableRefObject<number>;
  revision:MutableRefObject<number>;
  historySnapshot:(document:DocumentState,operationId?:string)=>HistoryState;
  linkedCancelled:MutableRefObject<boolean>;
  setLinkedBusy:Dispatch<SetStateAction<boolean>>;
  setOpening:Dispatch<SetStateAction<boolean>>;
  clearPending:()=>void;
  renderDocument:(document:DocumentState)=>Promise<string>;
  runPrepared:(source:DocumentState,targets:DocumentState[],operationId:string,prepare:()=>Promise<SyncResult[]|null>,label:string)=>Promise<boolean>;
  flush:()=>Promise<{doc:DocumentState;profile:string}|undefined>;
  presetPreview:{cancel():Promise<unknown>};
  setError:Dispatch<SetStateAction<string>>;
  setStatus:Dispatch<SetStateAction<string>>;
  previewThumbnail:(preview:string)=>Promise<string>;
}

export function usePresetSync(options:Options){
  const {docs,setDocuments,idRef,targetsRef,targetDocuments,loading,busy,samplingRef,wbPending,canvasInProgress,commitGlobal,commit,editEpoch,profileEpoch,revision,historySnapshot,linkedCancelled,setLinkedBusy,setOpening,clearPending,renderDocument,runPrepared,flush,presetPreview,setError,setStatus,previewThumbnail}=options;
  const [presetWarnings,setPresetWarnings]=useState<string[]>([]);
  const [copyOpen,setCopyOpen]=useState(false),[hasClipboard,setHasClipboard]=useState(false),clipboard=useRef<{source:SyncDocument;groups:SyncGroup[]}|undefined>(undefined);
  const [copyBusy,setCopyBusy]=useState(false);
  const [syncOpen,setSyncOpen]=useState(false),[syncBusy,setSyncBusy]=useState(false),[syncProgress,setSyncProgress]=useState(''),[syncError,setSyncError]=useState('');
  const syncStatusRevision=useRef(-1),syncCancelled=useRef(false),syncOpenRef=useRef(syncOpen);syncOpenRef.current=syncOpen;
  const presetGesture=useRef<{source:DocumentState;targets:DocumentState[];epoch:number}|undefined>(undefined);
  function openSynchronize(){if(loading.current||samplingRef.current||busy||wbPending||canvasInProgress())return;commit();setSyncError('');setSyncOpen(true);}
  async function cancelSynchronize(){if(loading.current){syncCancelled.current=true;setSyncProgress('正在取消同步…');await window.captraw.cancelSynchronize();}else setSyncOpen(false);}
  async function synchronize(paths:string[],groups:SyncGroup[]){
    if(loading.current)return;
    const source=docs.current.find(document=>document.image.id===idRef.current),targets=targetDocuments(paths).filter(document=>document.image.id!==idRef.current);
    if(!source||!targets.length||!paths.includes(source.image.path))return;
    clearPending();loading.current=true;syncCancelled.current=false;setSyncBusy(true);setSyncError('');setSyncProgress('');const epoch=editEpoch.current;
    try{
      const profile=await renderDocument(source);
      if(syncCancelled.current){setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus('已取消同步，照片编辑未改变');return;}
      const results=await window.captraw.synchronize({source:{image:source.image,adjustments:copy(source.adjustments),profile},targets:targets.map(document=>({image:document.image,adjustments:copy(document.adjustments),profile:document.profile})),groups});
      if(results===null||syncCancelled.current){setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus('已取消同步，照片编辑未改变');return;}
      const thumbnails=new Map<string,string>();
      for(const result of results)thumbnails.set(result.path,await previewThumbnail(result.preview));
      if(syncCancelled.current){setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus('已取消同步，照片编辑未改变');return;}
      if(epoch!==editEpoch.current)throw new Error('编辑已变化，请重新同步。');
      const profileIds=new Map(results.map(result=>[result.path,++profileEpoch.current])),operationId=crypto.randomUUID();
      setDocuments(old=>old.map(document=>{const result=results.find(item=>item.path===document.image.path);return result?{...document,adjustments:result.adjustments,profile:result.profile,profileId:profileIds.get(result.path)!,dirty:true,past:[...document.past,historySnapshot(document,operationId)],future:[],thumbnail:thumbnails.get(result.path),thumbnailFrame:result.preview,previewToken:result.preview}:document;}));
      setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus(results.length?`已同步 ${results.length} 张照片 · 可分别撤销和保存`:'所选调整已相同，无需同步');
    }catch(error){setSyncError(error instanceof Error?error.message:String(error));}
    finally{loading.current=false;setSyncBusy(false);}
  }
  async function matchCameraExposure(paths:string[]){
    if(loading.current||busy||samplingRef.current||wbPending||canvasInProgress())return false;
    const source=docs.current.find(document=>document.image.id===idRef.current),targets=targetDocuments(paths).filter(document=>document.image.id!==idRef.current);
    if(!source||!targets.length||!paths.includes(source.image.path)){setError('请选中当前照片和至少一张其他照片，再匹配曝光。');return false;}
    commit();setError('');
    try{
      const matches=matchExposureByCameraSettings({image:source.image,adjustments:copy(source.adjustments),profile:source.profile},targets.map(document=>({image:document.image,adjustments:copy(document.adjustments),profile:document.profile})));
      const changed=matches.filter(match=>match.exposure!==match.target.adjustments.exposure);
      if(!changed.length){setStatus('相机曝光已经匹配，无需修改');return true;}
      loading.current=true;setOpening(true);setLinkedBusy(true);linkedCancelled.current=false;setSyncProgress('正在逐张匹配相机曝光…');const operationId=crypto.randomUUID();
      const results=await window.captraw.synchronize({source:{image:source.image,adjustments:source.adjustments,profile:source.profile},targets:changed.map(match=>match.target),groups:[],commands:changed.map(match=>({path:match.target.image.path,operationId,set:{exposure:match.exposure},unset:[]}))});
      if(results===null||linkedCancelled.current)throw new Error('曝光匹配已取消，照片编辑未改变。');
      const completed=[];for(const result of results)completed.push({...result,exposure:result.adjustments.exposure,thumbnail:await previewThumbnail(result.preview),profileId:++profileEpoch.current});
      if(linkedCancelled.current)throw new Error('曝光匹配已取消，照片编辑未改变。');
      const byPath=new Map(completed.map(result=>[result.path,result]));
      setDocuments(old=>old.map(document=>{const result=byPath.get(document.image.path);if(!result)return document;const adjustments={...result.adjustments,exposure:result.exposure};return {...document,adjustments,profile:result.profile,profileId:result.profileId,dirty:dirty(document,adjustments,result.profileId),past:[...document.past,historySnapshot(document,operationId)],future:[],thumbnail:result.thumbnail,thumbnailFrame:result.preview,previewToken:result.preview};}));
      setStatus(`已按相机设置匹配 ${changed.length} 张照片曝光`);return true;
    }catch(error){setError(error instanceof Error?error.message:String(error));return false;}
    finally{loading.current=false;setOpening(false);setLinkedBusy(false);setSyncProgress('');}
  }
  function beginPresetAmount(){if(presetGesture.current||loading.current)return;const source=docs.current.find(document=>document.image.id===idRef.current);if(!source)return;presetGesture.current={source:copy(source),targets:copy(targetDocuments()),epoch:editEpoch.current};}
  function cancelPresetAmount(){presetGesture.current=undefined;void presetPreview.cancel();}
  async function applyPreset(id:string,amount=100,strengthGesture=false){
    if(loading.current||canvasInProgress())return false;if(await commitGlobal()===false)return false;
    const pending=strengthGesture?presetGesture.current:undefined;presetGesture.current=undefined;
    if(pending&&(pending.source.image.id!==idRef.current||pending.epoch!==editEpoch.current)){setError('预设强度调整期间照片已变化，请重试。');return false;}
    const source=pending?.source||docs.current.find(document=>document.image.id===idRef.current),targets=pending?.targets||copy(targetDocuments());
    if(!source||!targets.length||!targetsRef.current.includes(source.image.path))return false;
    await presetPreview.cancel();const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,async()=>{const result=await window.captraw.applyPresets({id,targets:targets.map(document=>({image:document.image,adjustments:document.adjustments,profile:document.profile})),operationId,amount});setPresetWarnings(result?.warnings||[]);return result?.results??null;},'已应用预设到');
  }
  async function copyAdjustments(groups:SyncGroup[]){
    const active=docs.current.find(document=>document.image.id===idRef.current);if(copyBusy||!active||!targetsRef.current.includes(active.image.path))return;setCopyBusy(true);setError('');
    try{const prepared=await flush();if(!prepared)return;clipboard.current=copy({source:{image:prepared.doc.image,adjustments:prepared.doc.adjustments,profile:prepared.profile},groups});setHasClipboard(true);setCopyOpen(false);setStatus('已复制所选编辑设置 · 原片及历史未改变');}
    catch(error){setError(String(error));}finally{setCopyBusy(false);}
  }
  async function pasteAdjustments(){
    if(loading.current||canvasInProgress()||!clipboard.current)return false;const paths=[...targetsRef.current],copied=copy(clipboard.current);
    if(await commitGlobal()===false)return false;const source=docs.current.find(document=>document.image.id===idRef.current),targets=copy(targetDocuments(paths));
    if(!source||!targets.length)return false;const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({source:{...copied.source,image:{...copied.source.image,path:`captraw-clipboard:${operationId}`}},targets:targets.map(document=>({image:document.image,adjustments:document.adjustments,profile:document.profile})),groups:copied.groups}),'已粘贴设置到');
  }
  return {presetWarnings,setPresetWarnings,copyOpen,setCopyOpen,hasClipboard,copyBusy,syncOpen,setSyncOpen,syncBusy,syncProgress,setSyncProgress,syncError,setSyncError,syncStatusRevision,syncCancelled,syncOpenRef,openSynchronize,cancelSynchronize,synchronize,matchCameraExposure,beginPresetAmount,cancelPresetAmount,applyPreset,copyAdjustments,pasteAdjustments};
}
