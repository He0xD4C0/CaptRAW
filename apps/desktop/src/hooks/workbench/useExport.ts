import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import type {ExportFormat,ExportOptions} from '@captraw/contracts/export-options';
import type {ExportDocumentSnapshot,JobStatus,OutputColorSpace} from '@captraw/contracts';
import {copy,type DocumentState} from './model';

interface Options {
  docs:MutableRefObject<DocumentState[]>;
  idRef:MutableRefObject<string>;
  targetDocuments:(paths?:string[])=>DocumentState[];
  loading:MutableRefObject<boolean>;
  canvasInProgress:()=>boolean;
  commitGlobal:()=>Promise<boolean>;
  commit:()=>void;
  documentSnapshot:(document:DocumentState)=>ExportDocumentSnapshot;
  setError:(message:string)=>void;
}

export function useExport(options:Options){
  const {docs,idRef,targetDocuments,loading,canvasInProgress,commitGlobal,commit,documentSnapshot,setError}=options;
  const [job,setJob]=useState<JobStatus>();
  const [exportCancelling,setExportCancelling]=useState(false);
  const exporting=useRef(false),[exportPending,setExportPending]=useState(false);
  useEffect(()=>{if(job?.state!=='running')setExportCancelling(false);},[job?.id,job?.state]);
  async function exportImage(format:ExportFormat,colorSpace:OutputColorSpace='srgb',paths:string[]=[],exportOptions?:ExportOptions){
    if(loading.current||exporting.current||canvasInProgress())return;
    if(await commitGlobal()===false)return;
    exporting.current=true;setExportPending(true);commit();if(format==='avif')colorSpace='rec2020';
    try{
      const selected=targetDocuments(paths).map(documentSnapshot);
      if(!selected.length){setError('请选择需要导出的可见照片。');return;}
      const request={format,colorSpace,options:copy(exportOptions)};
      if(selected.length>1)await window.captraw.exportBatch({...request,documents:selected});
      else await window.captraw.export({...request,document:selected[0]});
    }catch(error){setError(String(error));}
    finally{exporting.current=false;setExportPending(false);}
  }
  async function cancelExport(){
    if(exportCancelling||job?.state!=='running')return;
    setExportCancelling(true);
    try{await window.captraw.cancel();}catch(error){setExportCancelling(false);setError(String(error));}
  }
  return {job,setJob,exportCancelling,exportPending,exportImage,cancelExport};
}
