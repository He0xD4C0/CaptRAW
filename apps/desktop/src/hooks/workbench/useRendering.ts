import {useRef,useState,type MutableRefObject} from 'react';
import type {Adjustments,PreviewFrame} from '@captraw/contracts';
import {snapshot,type DocumentState} from './model';

export function useRendering(updateDocument:(id:string,change:(document:DocumentState)=>DocumentState)=>void,idRef:MutableRefObject<string>){
  const [maskId,setMaskPreview]=useState('');const maskRef=useRef(maskId);maskRef.current=maskId;
  const [colorSampling,setColorSampling]=useState(false);const colorRef=useRef(colorSampling);colorRef.current=colorSampling;
  const [luminance,setLuminance]=useState(false),[sampling,setSampling]=useState(false);const luminanceRef=useRef(luminance);luminanceRef.current=luminance;const sampleEpoch=useRef(0),samplingRef=useRef(false);
  const [frame,setFrame]=useState<PreviewFrame>();
  const [detailFrame,setDetailFrame]=useState<PreviewFrame>();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('本地处理 · 原片保持不变');
  const [opening,setOpening]=useState(false),[wbPending,setWbPending]=useState(false);
  const revision=useRef(0),lastApplied=useRef(0);
  const rendered=useRef<{id:string;revision:number;adjustments:Adjustments;profileId:number;maskId:string;luminance:boolean;colorSampling:boolean}|undefined>(undefined);
  const loading=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  async function previewThumbnail(preview:string){
    const image=await new Promise<HTMLImageElement>((accept,reject)=>{const value=new Image();value.crossOrigin='anonymous';value.onload=()=>accept(value);value.onerror=()=>reject(new Error('无法读取照片预览，请重试。'));value.src=preview;});
    const canvas=document.createElement('canvas');canvas.width=180;canvas.height=Math.round(180*image.height/image.width);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.75);
  }
  async function renderDocument(document:DocumentState){
    const rev=++revision.current;setBusy(true);setError('');
    const preview={maskId:maskRef.current,luminance:luminanceRef.current,colorSampling:colorRef.current};
    try{
      const result=await window.captraw.update(document.image.id,rev,document.adjustments,document.profile,preview.maskId,preview.luminance,preview.colorSampling);
      if(idRef.current===document.image.id&&rev>=lastApplied.current){
        rendered.current={id:document.image.id,revision:rev,adjustments:document.adjustments,profileId:document.profileId,...preview};
        lastApplied.current=rev;updateDocument(document.image.id,current=>current.adjustments!==document.adjustments||current.profileId!==document.profileId?current:({...current,profile:result.artProfile,opened:current.opened||snapshot({...current,profile:result.artProfile}),image:{...current.image,lensStatus:result.lensStatus,effectiveGeometry:result.geometry??current.image.effectiveGeometry}}));
      }
      return result.artProfile;
    }catch(error){
      if(idRef.current===document.image.id&&rev===revision.current){setError(String(error));setBusy(false);}throw error;
    }
  }
  return {maskId,setMaskPreview,maskRef,colorSampling,setColorSampling,colorRef,luminance,setLuminance,sampling,setSampling,luminanceRef,sampleEpoch,samplingRef,frame,setFrame,detailFrame,setDetailFrame,busy,setBusy,error,setError,status,setStatus,opening,setOpening,wbPending,setWbPending,revision,lastApplied,rendered,loading,timer,renderDocument,previewThumbnail};
}
