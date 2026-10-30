import {useRef,useState,type Dispatch,type MutableRefObject,type SetStateAction} from 'react';
import type {BatchSaveResult,PreviewFrame} from '@captraw/contracts';
import {copy,type DocumentState} from './model';

interface Options {
  docs:MutableRefObject<DocumentState[]>;
  setDocuments:(change:DocumentState[]|((previous:DocumentState[])=>DocumentState[]))=>void;
  idRef:MutableRefObject<string>;
  sessionId:MutableRefObject<string>;
  targetsRef:MutableRefObject<string[]>;
  targetDocuments:(paths?:string[])=>DocumentState[];
  loading:MutableRefObject<boolean>;
  setOpening:Dispatch<SetStateAction<boolean>>;
  setBusy:Dispatch<SetStateAction<boolean>>;
  setError:Dispatch<SetStateAction<string>>;
  setStatus:Dispatch<SetStateAction<string>>;
  canvasInProgress:()=>boolean;
  commitGlobal:()=>Promise<boolean>;
  commit:()=>void;
  endSession:()=>Promise<void>;
  clearPending:()=>void;
}

export function usePersistence(options:Options){
  const {docs,setDocuments,idRef,sessionId,targetsRef,targetDocuments,loading,setOpening,setBusy,setError,setStatus,canvasInProgress,commitGlobal,commit,endSession,clearPending}=options;
  const [saveOpen,setSaveOpen]=useState(false),[saveBusy,setSaveBusy]=useState(false),[saveProgress,setSaveProgress]=useState(''),[saveResult,setSaveResult]=useState<BatchSaveResult|null>(null),[saveError,setSaveError]=useState('');
  const saveContext=useRef<{documents:DocumentState[];finish:boolean}>({documents:[],finish:false});
  const documentSnapshot=(document:DocumentState)=>({path:document.image.path,sourceIdentity:copy(document.image.sourceIdentity),width:document.image.width,height:document.image.height,artProfile:document.profile,adjustments:copy(document.adjustments),xmpPacket:document.xmpPacket??document.image.recipe?.xmpPacket,nativePacket:document.nativePacket??document.image.recipe?.nativePacket,rating:document.rating,label:document.label});
  async function saveTargets(paths:string[],finish=false,saveAs=false){
    if(loading.current||canvasInProgress())return false;
    if(await commitGlobal()===false)return false;
    if(finish)paths=docs.current.filter(document=>document.dirty).map(document=>document.image.path);
    commit();const selected=copy(targetDocuments(paths));
    if(!selected.length){if(finish)await endSession();return finish;}
    saveContext.current={documents:selected,finish};
    clearPending();loading.current=true;setOpening(true);setSaveBusy(true);setSaveResult(null);setSaveError('');setSaveProgress('准备保存原片旁的 CaptRAW 编辑…');
    if(selected.length>1||finish||saveAs)setSaveOpen(true);
    try{
      const request={sessionId:sessionId.current,documents:selected.map(documentSnapshot)};
      const result=await (saveAs?window.captraw.saveSessionAs(request):window.captraw.saveSession(request));
      if(!result){setSaveOpen(false);return false;}
      setSaveResult(result);
      const updated=docs.current.map(document=>{
        const saved=selected.find(item=>item.image.path===document.image.path);
        if(!saved||!result.results.some(item=>item.source===document.image.path&&item.output))return document;
        const resultItem=result.results.find(item=>item.source===document.image.path);
        return {...document,xmpPacket:resultItem?.xmpPacket??document.xmpPacket,nativePacket:resultItem?.nativePacket??document.nativePacket,needsNativeSave:false,saved:copy(saved.adjustments),savedProfileId:saved.profileId,savedRating:saved.rating,savedLabel:saved.label,dirty:document.profileId!==saved.profileId||JSON.stringify(document.adjustments)!==JSON.stringify(saved.adjustments)||document.rating!==saved.rating||document.label!==saved.label};
      });docs.current=updated;setDocuments(updated);
      const success=!result.cancelled&&result.results.length===selected.length&&result.results.every(item=>!!item.output);
      if(!success)setSaveOpen(true);
      else if(finish&&!updated.some(document=>document.dirty))await endSession();
      else if(selected.length===1)setSaveOpen(false);
      setStatus(`已保存 ${result.results.filter(item=>item.output).length}/${selected.length} 张照片的编辑文件${result.cancelled?' · 已停止后续保存':''}`);
      return success;
    }catch(error){setSaveError(error instanceof Error?error.message:String(error));setSaveOpen(true);return false;}
    finally{loading.current=false;setOpening(false);setSaveBusy(false);}
  }
  const save=()=>{const current=docs.current.find(document=>document.image.id===idRef.current);return current?saveTargets([current.image.path]):false;};
  const saveSelected=(paths:string[])=>saveTargets(paths);
  async function retrySave(path?:string){
    const context=saveContext.current,paths=context.documents.filter(document=>!saveResult?.results.some(item=>item.source===document.image.path&&item.output)).map(document=>document.image.path);
    const success=await saveTargets(path?[path]:paths,context.finish,!!path);
    if(!success&&context.finish)saveContext.current={documents:docs.current.filter(document=>document.dirty),finish:true};
    if(success&&context.finish){const remaining=docs.current.filter(document=>document.dirty).map(document=>document.image.path);if(remaining.length)await saveTargets(remaining,true);else await endSession();}
  }
  async function cancelSave(){setSaveProgress('正在完成当前文件，随后停止…');await window.captraw.cancelSave();}
  const finish=()=>saveTargets(docs.current.filter(document=>document.dirty).map(document=>document.image.path),true);
  return {saveOpen,setSaveOpen,saveBusy,saveProgress,setSaveProgress,saveResult,saveError,saveTargets,save,saveSelected,retrySave,cancelSave,finish,documentSnapshot};
}
