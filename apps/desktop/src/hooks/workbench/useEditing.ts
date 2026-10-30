import {useRef,useState,type Dispatch,type MutableRefObject,type SetStateAction} from 'react';
import {adjustmentCommand,sourceAdjustmentCommand,type RecomputedEdit,type SyncResult} from '@captraw/contracts/synchronize';
import {POINT_CURVE_PRESETS,type PointCurvePresetName} from '@captraw/contracts';
import type {Adjustments,LocalMask,MaskType,Point,PreviewFrame,WhiteBalanceRequest} from '@captraw/contracts';
import {rotatePoint,type CanvasEditTransaction} from '../../lib/geometry';
import type {MaskEditTransaction} from '../useMaskGesture';
import {undoDocuments} from './history';
import {copy,dirty,snapshot,type DocumentState,type EditingState,type HistoryState} from './model';

interface Options {
  docs:MutableRefObject<DocumentState[]>;
  setDocuments:(change:DocumentState[]|((previous:DocumentState[])=>DocumentState[]))=>void;
  idRef:MutableRefObject<string>;
  targetsRef:MutableRefObject<string[]>;
  targetDocuments:(paths?:string[])=>DocumentState[];
  active:DocumentState|undefined;
  loading:MutableRefObject<boolean>;
  editEpoch:MutableRefObject<number>;
  profileEpoch:MutableRefObject<number>;
  historyClock:MutableRefObject<number>;
  historySnapshot:(document:EditingState,operationId?:string)=>HistoryState;
  setError:Dispatch<SetStateAction<string>>;
  setStatus:Dispatch<SetStateAction<string>>;
  setOpening:Dispatch<SetStateAction<boolean>>;
  wbPending:boolean;
  setWbPending:Dispatch<SetStateAction<boolean>>;
  setSampling:Dispatch<SetStateAction<boolean>>;
  samplingRef:MutableRefObject<boolean>;
  sampleEpoch:MutableRefObject<number>;
  frame:PreviewFrame|undefined;
  revision:MutableRefObject<number>;
  rendered:MutableRefObject<{id:string;revision:number;adjustments:Adjustments;profileId:number;maskId:string;luminance:boolean;colorSampling:boolean}|undefined>;
  maskRef:MutableRefObject<string>;
  luminanceRef:MutableRefObject<boolean>;
  colorRef:MutableRefObject<boolean>;
  timer:MutableRefObject<ReturnType<typeof setTimeout>|undefined>;
  renderDocument:(document:DocumentState)=>Promise<string>;
  previewThumbnail:(preview:string)=>Promise<string>;
  syncProgress:MutableRefObject<(message:string)=>void>;
}

export function useEditing(options:Options){
  const {docs,setDocuments,idRef,targetsRef,targetDocuments,active,loading,editEpoch,profileEpoch,historyClock,historySnapshot,setError,setStatus,setOpening,wbPending,setWbPending,setSampling,samplingRef,sampleEpoch,frame,revision,rendered,maskRef,luminanceRef,colorRef,timer,renderDocument,previewThumbnail,syncProgress}=options;
  const gesture=useRef<DocumentState|undefined>(undefined);
  const globalGesture=useRef<{source:DocumentState;targets:DocumentState[];draft:Adjustments;operationId:string}|undefined>(undefined);
  const [linkedBusy,setLinkedBusy]=useState(false),linkedCancelled=useRef(false);
  const canvasEdit=useRef<{sessionId:string;label:string}|undefined>(undefined),[canvasEditing,setCanvasEditing]=useState('');

  function canvasInProgress(){
    if(!canvasEdit.current)return false;
    setError(`${canvasEdit.current.label}尚未完成，请松开鼠标并等待处理完成后重试。Esc 可取消当前操作。`);return true;
  }
  function edit(change:(adjustments:Adjustments)=>Adjustments,transient=false){
    if(loading.current)return;
    ++editEpoch.current;const id=idRef.current;
    const current=docs.current.find(document=>document.image.id===id);if(!current||!targetsRef.current.includes(current.image.path))return;
    const next=change(copy(current.adjustments));if(JSON.stringify(next)===JSON.stringify(current.adjustments))return;
    if(transient&&!gesture.current)gesture.current=copy(current);
    setDocuments(old=>old.map(document=>document.image.id!==id?document:({...document,adjustments:next,dirty:dirty(document,next),past:transient?document.past:[...document.past,historySnapshot(document)],future:transient?document.future:[]})));
  }
  function editGlobal(change:(adjustments:Adjustments)=>Adjustments,transient=false){
    if(loading.current)return;
    const source=docs.current.find(document=>document.image.id===idRef.current);
    if(!source||!targetsRef.current.includes(source.image.path)){setError('请先在可见照片中选择当前照片，再进行调节。');return;}
    if(!globalGesture.current)globalGesture.current={source:copy(source),targets:copy(targetDocuments()),draft:copy(source.adjustments),operationId:crypto.randomUUID()};
    const pending=globalGesture.current;pending.draft=change(copy(pending.draft));++editEpoch.current;
    setDocuments(old=>old.map(document=>document.image.id===source.image.id?{...document,adjustments:pending.draft,dirty:dirty(document,pending.draft)}:document));
    if(!transient)void commitGlobal();
  }
  async function commitGlobal(recompute?:RecomputedEdit){
    if(loading.current)return false;const pending=globalGesture.current;if(!pending)return true;
    globalGesture.current=undefined;
    const {source,targets,draft,operationId}=pending,command=adjustmentCommand(source.adjustments,draft,operationId,source.image.effectiveGeometry);
    if(!recompute&&!Object.keys(command.set).length&&!command.unset.length&&!command.merge)return true;
    if(!recompute&&targets.length===1){
      setDocuments(old=>old.map(document=>document.image.id!==source.image.id?document:({...document,adjustments:draft,past:[...document.past,historySnapshot(source,operationId)],future:[],dirty:dirty(document,draft)})));return true;
    }
    const own=sourceAdjustmentCommand(source.adjustments,draft,operationId);
    return runPrepared(source,targets,operationId,()=>window.captraw.synchronize({source:{image:{...source.image,path:`captraw-edit:${operationId}`},adjustments:source.adjustments,profile:source.profile},targets:targets.map(document=>({image:document.image,adjustments:document.adjustments,profile:document.profile})),groups:[],...(recompute?{command,recompute}:{commands:targets.map(document=>({...((document.image.path===source.image.path)?own:command),path:document.image.path}))})}),recompute?'已逐张计算':'已联动');
  }
  async function runPrepared(source:DocumentState,targets:DocumentState[],operationId:string,prepare:()=>Promise<SyncResult[]|null>,label:string){
    clearTimeout(timer.current);loading.current=true;setOpening(true);setLinkedBusy(true);linkedCancelled.current=false;setError('');syncProgress.current('正在准备所选照片…');
    const epoch=editEpoch.current;
    try{
      const results=await prepare();
      if(results===null||linkedCancelled.current)throw new Error('已取消联动，所选照片未提交修改');
      const thumbnails=new Map<string,string>();for(const result of results)thumbnails.set(result.path,await previewThumbnail(result.preview));
      if(linkedCancelled.current||epoch!==editEpoch.current)throw new Error('已取消联动，所选照片未提交修改');
      const updated=docs.current.map(document=>{
        const result=results.find(item=>item.path===document.image.path),before=targets.find(item=>item.image.path===document.image.path);
        if(!before)return document;
        if(!result)return document.image.path===source.image.path?{...document,...snapshot(source),dirty:dirty(document,source.adjustments,source.profileId)}:document;
        const profileId=++profileEpoch.current;
        return {...document,adjustments:result.adjustments,profile:result.profile,profileId,dirty:dirty(document,result.adjustments,profileId),past:[...document.past,historySnapshot(before,operationId)],future:[],thumbnail:thumbnails.get(result.path),thumbnailFrame:result.preview,previewToken:result.preview};
      });
      const nextActive=updated.find(document=>document.image.id===idRef.current);if(nextActive)await renderDocument(nextActive);
      if(linkedCancelled.current)throw new Error('已取消联动，所选照片未提交修改');
      setDocuments(updated);
      setStatus(results.length?`${label} ${results.length} 张照片 · 可分别或共同撤销`:'所选设置未变化');return true;
    }catch(error){
      setDocuments(old=>old.map(document=>document.image.path===source.image.path?{...source}:document));
      try{await renderDocument({...source});}catch{}
      setError(error instanceof Error?error.message:String(error));return false;
    }finally{loading.current=false;setOpening(false);setLinkedBusy(false);}
  }
  async function recomputeEdit(recompute:RecomputedEdit){
    if(loading.current||canvasInProgress())return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    const source=docs.current.find(document=>document.image.id===idRef.current);
    if(!source||!targetsRef.current.includes(source.image.path)){setError('请先选择当前照片。');return;}
    const draft=recompute.type==='whiteBalance'&&recompute.request.mode==='profile'?{...copy(source.adjustments),colorProfile:copy(recompute.request.colorProfile)}:copy(source.adjustments);
    globalGesture.current={source:copy(source),targets:copy(targetDocuments()),draft,operationId:crypto.randomUUID()};
    ++editEpoch.current;await commitGlobal(recompute);
  }
  async function applyCurvePreset(name:PointCurvePresetName){
    if(loading.current||canvasInProgress()||!Object.hasOwn(POINT_CURVE_PRESETS,name))return false;
    if(globalGesture.current&&await commitGlobal()===false)return false;
    commit();
    const source=docs.current.find(document=>document.image.id===idRef.current),targets=copy(targetDocuments());
    if(!source||!targets.length||!targetsRef.current.includes(source.image.path))return false;
    const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({
      source:{image:{...source.image,path:`captraw-curve:${operationId}`},adjustments:source.adjustments,profile:source.profile},
      targets:targets.map(document=>({image:document.image,adjustments:document.adjustments,profile:document.profile})),groups:[],
      command:{operationId,set:{curve:copy([...POINT_CURVE_PRESETS[name]]),curveName:name},unset:[]},
    }),'已应用点曲线到');
  }
  function cancelGlobal(){
    if(linkedBusy){linkedCancelled.current=true;void window.captraw.cancelSynchronize();return true;}
    const pending=globalGesture.current;if(!pending)return false;
    globalGesture.current=undefined;clearTimeout(timer.current);++editEpoch.current;++revision.current;
    setDocuments(old=>old.map(document=>document.image.id===pending.source.image.id?copy(pending.source):document));
    return true;
  }
  function cancelEdit():boolean{
    if(cancelGlobal())return true;
    const previous=gesture.current;if(!previous)return false;
    gesture.current=undefined;clearTimeout(timer.current);++editEpoch.current;++revision.current;
    setDocuments(old=>old.map(document=>document.image.id===previous.image.id?copy(previous):document));
    return true;
  }
  function commit(){
    if(!gesture.current)return;
    const previous=gesture.current;gesture.current=undefined;
    setDocuments(old=>old.map(document=>document.image.id!==previous.image.id?document:JSON.stringify(document.adjustments)===JSON.stringify(previous.adjustments)?copy(previous):({...document,past:[...previous.past,historySnapshot(previous)],future:[],dirty:dirty(document)})));
  }
  async function editMetadata(paths:string[],change:Pick<EditingState,'rating'|'label'>){
    if(loading.current||canvasInProgress())return;
    const targets=new Set(paths.filter(path=>targetsRef.current.includes(path)));
    if(!targets.size)return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    commit();
    const operationId=crypto.randomUUID();++editEpoch.current;
    setDocuments(old=>old.map(document=>{
      if(!targets.has(document.image.path)||Object.entries(change).every(([key,value])=>document[key as 'rating'|'label']===value))return document;
      const next={...document,...change};return {...next,dirty:dirty(next),past:[...document.past,historySnapshot(document,operationId)],future:[]};
    }));return true;
  }
  async function rate(rating:number,paths:string[]){
    if(!await editMetadata(paths,{rating}))return;
    setStatus(rating===-1?'已标记拒绝 · 保存 XMP 后保留，不删除原片':rating===0?'已清除评分 · 尚未保存':`已评为 ${rating} 星 · 尚未保存`);
  }
  async function setLabel(label:string,paths:string[]){
    if(await editMetadata(paths,{label}))setStatus(label?`已设置色标“${label}” · 尚未保存`:'已清除色标 · 尚未保存');
  }
  function beginCanvasEdit(sessionId:string,frameRevision:number,label:string):CanvasEditTransaction|null{
    if(canvasEdit.current)return null;
    const document=docs.current.find(item=>item.image.id===sessionId),applied=rendered.current,epoch=editEpoch.current;
    const participants=targetDocuments(),targets=copy(participants),operationId=crypto.randomUUID();
    let phase:'sampling'|'committing'|'committed'|'cancelled'='sampling',operationEpoch=epoch;
    const unchanged=()=>participants.every(before=>docs.current.some(item=>item.image.id===before.image.id&&item.adjustments===before.adjustments&&item.profileId===before.profileId&&item.rating===before.rating&&item.label===before.label));
    const valid=()=>phase==='committing'||phase==='committed'?
      canvasEdit.current===pending&&idRef.current===sessionId&&editEpoch.current===operationEpoch&&!linkedCancelled.current:
      phase==='sampling'&&!loading.current&&!!document&&unchanged()&&targetsRef.current.includes(document.image.path)&&idRef.current===sessionId&&revision.current===frameRevision&&editEpoch.current===epoch&&
      applied?.maskId===maskRef.current&&applied.luminance===luminanceRef.current&&applied.colorSampling===colorRef.current&&
      docs.current.some(item=>item.image.id===sessionId&&item.adjustments===document?.adjustments&&item.profileId===document?.profileId);
    if(!document||!valid()||applied?.id!==sessionId||applied.revision!==frameRevision||applied.adjustments!==document.adjustments||applied.profileId!==document.profileId)return null;
    clearTimeout(timer.current);
    const pending={sessionId,label};canvasEdit.current=pending;setCanvasEditing(sessionId);
    return {sessionId,revision:frameRevision,valid,release(){
      if(phase==='committing'){phase='cancelled';linkedCancelled.current=true;void window.captraw.cancelSynchronize();}
      if(canvasEdit.current===pending){canvasEdit.current=undefined;setCanvasEditing('');}
    },apply(change){
      if(phase!=='sampling'||!valid())return false;
      const next=change(copy(document.adjustments));
      if(JSON.stringify(next)!==JSON.stringify(document.adjustments))edit(()=>next);
      return true;
    },async applyGlobal(change){
      if(phase!=='sampling'||!valid())return false;
      const next=change(copy(document.adjustments)),command=adjustmentCommand(document.adjustments,next,operationId,document.image.effectiveGeometry);
      if(!Object.keys(command.set).length&&!command.unset.length&&!command.merge)return true;
      phase='committing';operationEpoch=++editEpoch.current;
      const result=await runPrepared(copy(document),targets,operationId,()=>window.captraw.synchronize({
        source:{image:{...document.image,path:`captraw-canvas:${operationId}`},adjustments:document.adjustments,profile:document.profile},
        targets:targets.map(item=>({image:item.image,adjustments:item.adjustments,profile:item.profile})),groups:[],commands:targets.map(item=>({...((item.image.path===document.image.path)?sourceAdjustmentCommand(document.adjustments,next,operationId):command),path:item.image.path})),
      }),'已应用曲线到');
      if(result)phase='committed';else phase='cancelled';return result;
    }};
  }
  function beginMaskEdit(sessionId:string,frameRevision:number,maskId:string,componentId?:string):MaskEditTransaction|null{
    const document=docs.current.find(item=>item.image.id===sessionId),mask=document?.adjustments.masks.find(item=>item.id===maskId),leaf=mask?.components?mask.components.find(item=>item.id===componentId):mask;
    if(!leaf)return null;
    const transaction=beginCanvasEdit(sessionId,frameRevision,'蒙版笔画');if(!transaction)return null;
    return {...transaction,apply(next){
      if(!transaction.valid())return false;
      const values={points:next.points,brush:next.brush,start:next.start,end:next.end,referenceAngle:next.referenceAngle,geometryReference:next.geometryReference,initialized:true};
      if(JSON.stringify(values)===JSON.stringify({points:leaf.points,brush:leaf.brush,start:leaf.start,end:leaf.end,referenceAngle:leaf.referenceAngle,geometryReference:leaf.geometryReference,initialized:leaf.initialized!==false}))return true;
      return transaction.apply(adjustments=>({...adjustments,masks:adjustments.masks.map(item=>{
        if(item.id!==maskId)return item;
        return item.components?{...item,components:item.components.map(component=>component.id===componentId?{...component,...values}:component)}:{...item,...values};
      })}));
    }};
  }
  function undo(redo=false){
    if(loading.current)return;
    if(globalGesture.current){cancelGlobal();return;}
    const transition=undoDocuments(docs.current,new Set(targetsRef.current),redo,historyClock.current);
    if(!transition.changed)return;
    ++editEpoch.current;gesture.current=undefined;
    historyClock.current=transition.sequence;
    setDocuments(transition.documents);
  }
  async function comparisonState(action:'capture'|'reset'|'swap'){
    if(loading.current)return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    commit();if(action==='swap')++editEpoch.current;
    setDocuments(old=>old.map(document=>{
      if(document.image.id!==idRef.current)return document;
      if(action==='capture')return {...document,before:snapshot(document)};
      if(action==='reset')return {...document,before:undefined};
      const before=document.before||document.opened;if(!before)return document;
      const {rotation,flipHorizontal,flipVertical,fineRotation,perspective,perspectiveGuides,crop,cropAspect,lensCorrections,lensProfile,lensManualDistortion}=document.adjustments;
      const next={...snapshot(before),rating:document.rating,label:document.label,adjustments:{...copy(before.adjustments),rotation,flipHorizontal,flipVertical,fineRotation,perspective:copy(perspective),perspectiveGuides:copy(perspectiveGuides),crop:copy(crop),cropAspect,lensCorrections:copy(lensCorrections),lensProfile:copy(lensProfile),lensManualDistortion}};
      if(next.profileId===document.profileId&&JSON.stringify(next.adjustments)===JSON.stringify(document.adjustments))return document;
      return {...document,...next,before:snapshot(document),past:[...document.past,{...historySnapshot(document),before:document.before?copy(document.before):null}],future:[],dirty:dirty(document,next.adjustments,next.profileId)};
    }));
    setStatus(action==='capture'?'已保存对比前状态 · 仅当前会话':action==='reset'?'已还原打开时的对比状态':'已交换前后设置 · 可撤销');
  }
  function addMask(type:Exclude<MaskType,'raster'>){
    const name=`${type==='brush'?'画笔':type==='linear'?'线性渐变':type==='luminance'?'亮度范围':type==='color'?'颜色范围':'径向蒙版'} ${(active?.adjustments.masks.length||0)+1}`;
    const mask:LocalMask={id:crypto.randomUUID(),name,type,enabled:true,inverted:false,feather:30,brightness:type==='luminance'||type==='color'?0:0.5,contrast:0,saturation:0,points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},components:[{id:crypto.randomUUID(),name,type,enabled:true,inverted:false,feather:30,...(type==='linear'?{linearGradientModel:'full-zero-v1' as const,feather:0}:{}),points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},operation:'add',initialized:type==='luminance',...(type==='color'?{colorSamples:[],colorRefine:50}:{}),...(type==='luminance'?{luminanceRange:[0,0,100,100] as [number,number,number,number]}:{})}]};
    edit(adjustments=>({...adjustments,masks:[...adjustments.masks,mask]}));return mask.id;
  }
  async function flush(){
    if(loading.current||canvasInProgress())return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    clearTimeout(timer.current);const document=docs.current.find(item=>item.image.id===idRef.current);if(!document)return;
    const profile=await renderDocument(document);return {doc:document,profile};
  }
  async function rotate(degrees:90|-90){
    if(loading.current||canvasInProgress())return false;
    const paths=[...targetsRef.current];
    if(globalGesture.current&&await commitGlobal()===false)return false;
    commit();
    const source=docs.current.find(document=>document.image.id===idRef.current),targets=copy(targetDocuments(paths));
    if(!source||!targets.length)return false;
    if(targets.length===1&&targets[0].image.id===source.image.id){edit(adjustments=>({...adjustments,rotation:(adjustments.rotation+degrees+360)%360}));return true;}
    const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({
      source:{image:{...source.image,path:`captraw-rotate:${operationId}`},adjustments:source.adjustments,profile:source.profile},
      targets:targets.map(document=>({image:document.image,adjustments:document.adjustments,profile:document.profile})),groups:[],
      commands:targets.map(document=>({path:document.image.path,operationId,set:{rotation:(document.adjustments.rotation+degrees+360)%360},unset:[]})),
    }),'已旋转');
  }
  async function reset(){
    if(loading.current||canvasInProgress())return false;
    cancelGlobal();
    const source=docs.current.find(document=>document.image.id===idRef.current),targets=copy(targetDocuments());
    if(!source||!targets.length)return false;
    const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({source:{image:{...source.image,path:`captraw-reset:${operationId}`},adjustments:source.adjustments,profile:source.profile},targets:targets.map(document=>({image:document.image,adjustments:document.adjustments,profile:document.profile})),groups:[],commands:targets.map(document=>({operationId,path:document.image.path,set:copy(document.initial),unset:(Object.keys(document.adjustments) as (keyof Adjustments)[]).filter(key=>document.initial[key]===undefined)}))}),'已恢复初始设置');
  }
  async function whiteBalance(request:WhiteBalanceRequest){
    if(loading.current||wbPending)return;setWbPending(true);setError('');
    try{
      if(request.mode!=='sample'){
        const document=docs.current.find(item=>item.image.id===idRef.current),presetName=request.mode==='preset'?document?.image.whiteBalancePresets?.find(item=>item.id===request.preset)?.name:undefined;
        await recomputeEdit({type:'whiteBalance',request,presetName});return;
      }
      const epoch=editEpoch.current,targets=copy(targetDocuments());const prepared=await flush();if(!prepared)return;
      const result=await window.captraw.whiteBalance(prepared.doc.image.id,request);
      const current=docs.current.find(item=>item.image.id===idRef.current);
      if(editEpoch.current!==epoch||current?.image.id!==prepared.doc.image.id||JSON.stringify(current.adjustments)!==JSON.stringify(prepared.doc.adjustments)){setStatus('编辑已变化，请重新设置白平衡');return;}
      const operationId=crypto.randomUUID();++editEpoch.current;
      const fixed=result.relativeWBModel?{incrementalTemperature:result.incrementalTemperature,incrementalTint:result.incrementalTint,relativeWBModel:result.relativeWBModel,wbMode:'custom',wbMultipliers:null,wbApproximate:false}:{temperature:result.temperature,tint:result.tint,wbMode:'custom',wbMultipliers:null,wbApproximate:false};
      await runPrepared({...copy(prepared.doc),profile:prepared.profile},targets,operationId,()=>window.captraw.synchronize({source:{image:{...prepared.doc.image,path:`captraw-wb:${operationId}`},adjustments:prepared.doc.adjustments,profile:prepared.profile},targets:targets.map(document=>({image:document.image,adjustments:document.adjustments,profile:document.profile})),groups:[],commands:targets.map(document=>({operationId,path:document.image.path,set:document.image.path===prepared.doc.image.path?result:fixed,unset:[]}))}),'已设置白平衡到');
    }catch(error){setError(String(error));}finally{setWbPending(false);}
  }
  async function sampleColor(maskId:string,componentId:string|undefined,start:Point,end:Point|undefined,append:boolean,transaction:CanvasEditTransaction){
    if(loading.current||samplingRef.current||!transaction.valid())return;
    const current=docs.current.find(document=>document.image.id===idRef.current),mask=current?.adjustments.masks.find(item=>item.id===maskId),part=mask?.components?mask.components.find(item=>item.id===componentId):mask;
    if(!part||part.type!=='color')return;
    if(append&&(part.colorSamples?.length||0)>=5){setStatus('最多保留五个颜色样本，请先删除一个');return;}
    samplingRef.current=true;setSampling(true);const token=++sampleEpoch.current;
    try{
      const result=await window.captraw.sampleColor(transaction.sessionId,transaction.revision,start,end);
      if(token!==sampleEpoch.current||!transaction.valid()||result.revision!==transaction.revision)return;
      if(!frame||frame.sessionId!==transaction.sessionId||frame.revision!==transaction.revision)return;
      const center=end?{x:(start.x+end.x)/2,y:(start.y+end.y)/2}:start;
      const at=rotatePoint(center,current!.adjustments.rotation),width=frame.fullWidth,height=frame.fullHeight;
      const mapped=await window.captraw.coordinates(transaction.sessionId,transaction.revision,'display','source',[{x:at.x*(width-1),y:at.y*(height-1)}]);
      if(token!==sampleEpoch.current||!transaction.valid())return;
      const point=mapped.points[0];
      if(!point||mapped.width!==width||mapped.height!==height)throw new Error('无法定位颜色样本，请重新取样。');
      const sourcePoint=rotatePoint({x:point.x/(width-1),y:point.y/(height-1)},-current!.adjustments.rotation);
      const sample={l:result.l,c:result.c,h:result.h,point:start,...(end?{end}:{}),sourcePoint};
      transaction.apply(adjustments=>({...adjustments,masks:adjustments.masks.map(item=>{
        if(item.id!==maskId)return item;
        const apply=<T extends LocalMask|NonNullable<LocalMask['components']>[number]>(component:T):T=>({...component,initialized:true,colorSamples:append?[...(component.colorSamples||[]),sample]:[sample]});
        return item.components?{...item,components:item.components.map(component=>component.id===componentId?apply(component):component)}:apply(item);
      })}));setStatus('已更新颜色范围');
    }catch(error){if(token===sampleEpoch.current&&transaction.valid())setError(String(error));}finally{if(token===sampleEpoch.current){samplingRef.current=false;setSampling(false);}}
  }
  async function sampleLuminance(maskId:string,componentId:string|undefined,start:Point,end:Point|undefined,transaction:CanvasEditTransaction){
    if(loading.current||samplingRef.current||!transaction.valid())return;
    samplingRef.current=true;setSampling(true);const token=++sampleEpoch.current;
    try{
      const result=await window.captraw.sampleLuminance(transaction.sessionId,transaction.revision,start,end);
      if(token!==sampleEpoch.current||!transaction.valid()||result.revision!==transaction.revision)return;
      const low=Math.min(99,Math.floor(result.minimum)),high=Math.max(low+1,Math.min(100,Math.ceil(result.maximum)));
      transaction.apply(adjustments=>({...adjustments,masks:adjustments.masks.map(item=>{
        if(item.id!==maskId)return item;
        const apply=<T extends LocalMask|NonNullable<LocalMask['components']>[number]>(part:T):T=>{
          if(part.type!=='luminance')return part;
          const value=part.luminanceRange||[0,0,100,100],initial=value[0]===0&&value[1]===0&&value[2]===100&&value[3]===100;
          return {...part,luminanceRange:[Math.max(0,low-(initial?10:value[1]-value[0])),low,high,Math.min(100,high+(initial?10:value[3]-value[2]))]};
        };
        return item.components?{...item,components:item.components.map(component=>component.id===componentId?apply(component):component)}:apply(item);
      })}));setStatus('已按照片亮度更新范围');
    }catch(error){if(token===sampleEpoch.current&&transaction.valid())setError(String(error));}finally{if(token===sampleEpoch.current){samplingRef.current=false;setSampling(false);}}
  }
  function resetEditing(){
    gesture.current=undefined;globalGesture.current=undefined;canvasEdit.current=undefined;setCanvasEditing('');linkedCancelled.current=false;setLinkedBusy(false);
  }
  function clearGesture(){gesture.current=undefined;}
  return {linkedBusy,setLinkedBusy,linkedCancelled,canvasEditing,canvasInProgress,edit,editGlobal,commitGlobal,runPrepared,recomputeEdit,applyCurvePreset,cancelGlobal,cancelEdit,commit,rate,setLabel,beginCanvasEdit,beginMaskEdit,undo,comparisonState,addMask,flush,rotate,reset,whiteBalance,sampleColor,sampleLuminance,resetEditing,clearGesture};
}
