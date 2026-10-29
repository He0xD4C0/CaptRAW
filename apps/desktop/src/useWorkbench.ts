import type {ExportOptions,ExportFormat} from '@captraw/contracts/export-options';
import { useEffect, useRef, useState } from 'react';
import type {MaskEditTransaction} from './useMaskGesture';
import {usePresetPreview} from './usePresetPreview';
import {rotatePoint,type CanvasEditTransaction} from './geometry';
import {adjustmentCommand,matchExposureByCameraSettings,SYNC_GROUPS,type SyncGroup,type RecomputedEdit,type SyncResult,type SyncDocument} from '@captraw/contracts/synchronize';
import type { Adjustments, EngineEvent, ImageSession, JobStatus, LocalMask, MaskType, PreviewFrame, WhiteBalanceRequest, OutputColorSpace, Point, BatchSaveResult } from '@captraw/contracts';
import {POINT_CURVE_PRESETS,type PointCurvePresetName} from '@captraw/contracts';
export interface EditingState {adjustments:Adjustments;profile:string;profileId:number;rating?:number;label?:string}
type HistoryState=EditingState&{before?:EditingState|null;operationId?:string;sequence?:number};
export interface DocumentState extends EditingState { xmpPacket?:string;image: ImageSession; initial: Adjustments; dirty: boolean; saved:Adjustments;savedProfileId:number;savedRating?:number;savedLabel?:string;opened?:EditingState;before?:EditingState; past: HistoryState[]; future: HistoryState[]; thumbnail?: string;previewToken?:string;thumbnailFrame?:string; }
const copy = <T,>(value: T): T => structuredClone(value);
const snapshot=(d:EditingState):EditingState=>copy({adjustments:d.adjustments,profile:d.profile,profileId:d.profileId,rating:d.rating,label:d.label});
const dirty=(d:DocumentState,a:Adjustments=d.adjustments,profileId=d.profileId,rating=d.rating,label=d.label)=>profileId!==d.savedProfileId||JSON.stringify(a)!==JSON.stringify(d.saved)||rating!==d.savedRating||label!==d.savedLabel;
export function useWorkbench() {
  const [documents, setDocumentState] = useState<DocumentState[]>([]);
  const [activeId, setActiveId] = useState('');
  const [maskId,setMaskPreview]=useState('');const maskRef=useRef(maskId);maskRef.current=maskId;
  const [colorSampling,setColorSampling]=useState(false);const colorRef=useRef(colorSampling);colorRef.current=colorSampling;
  const [luminance,setLuminance]=useState(false),[sampling,setSampling]=useState(false);const luminanceRef=useRef(luminance);luminanceRef.current=luminance;const sampleEpoch=useRef(0),samplingRef=useRef(false);
  const [frame, setFrame] = useState<PreviewFrame>();
  const [detailFrame, setDetailFrame] = useState<PreviewFrame>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('本地处理 · 原片保持不变');
  const [opening,setOpening]=useState(false),[wbPending,setWbPending]=useState(false);
  const [job, setJob] = useState<JobStatus>();
  const [exportCancelling,setExportCancelling]=useState(false);
  useEffect(()=>{if(job?.state!=='running')setExportCancelling(false);},[job?.id,job?.state]);
  const [saveOpen,setSaveOpen]=useState(false),[saveBusy,setSaveBusy]=useState(false),[saveProgress,setSaveProgress]=useState(''),[saveResult,setSaveResult]=useState<BatchSaveResult|null>(null),[saveError,setSaveError]=useState('');
  const [presetWarnings,setPresetWarnings]=useState<string[]>([]);const presetBusy=false;
  const [copyOpen,setCopyOpen]=useState(false),[hasClipboard,setHasClipboard]=useState(false),clipboard=useRef<{source:SyncDocument;groups:SyncGroup[]}|undefined>(undefined);
  const [copyBusy,setCopyBusy]=useState(false);
  const [syncOpen,setSyncOpen]=useState(false),[syncBusy,setSyncBusy]=useState(false),[syncProgress,setSyncProgress]=useState(''),[syncError,setSyncError]=useState('');
  const syncStatusRevision=useRef(-1);const syncCancelled=useRef(false);const syncOpenRef=useRef(syncOpen);syncOpenRef.current=syncOpen;
  const targetsRef=useRef<string[]>([]),sessionId=useRef(crypto.randomUUID());
  const globalGesture=useRef<{source:DocumentState;targets:DocumentState[];draft:Adjustments;operationId:string}|undefined>(undefined);
  const saveContext=useRef<{documents:DocumentState[];finish:boolean}>({documents:[],finish:false});
  const presetGesture=useRef<{source:DocumentState;targets:DocumentState[];epoch:number}|undefined>(undefined);
  const [linkedBusy,setLinkedBusy]=useState(false),linkedCancelled=useRef(false);
  const docs = useRef(documents); docs.current = documents;
  function setDocuments(change:DocumentState[]|((previous:DocumentState[])=>DocumentState[])){
    const next=typeof change==='function'?change(docs.current):change;docs.current=next;setDocumentState(next);
  }
  const idRef = useRef(activeId); idRef.current = activeId;
  const editEpoch=useRef(0),profileEpoch=useRef(0);
  const historyClock=useRef(0);
  const historySnapshot=(d:EditingState,operationId:string=crypto.randomUUID()):HistoryState=>({...snapshot(d),operationId,sequence:++historyClock.current});
  const revision = useRef(0), lastApplied = useRef(0), gesture = useRef<DocumentState | undefined>(undefined);
  const rendered=useRef<{id:string;revision:number;adjustments:Adjustments;profileId:number;maskId:string;luminance:boolean;colorSampling:boolean}|undefined>(undefined);
  const loading = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const canvasEdit=useRef<{sessionId:string;label:string}|undefined>(undefined),[canvasEditing,setCanvasEditing]=useState('');
  const active = documents.find(d => d.image.id === activeId);
  const presetPreview=usePresetPreview(active);
  const updateDocument = (id: string, change: (d: DocumentState) => DocumentState) => setDocuments(old => old.map(d => d.image.id === id ? change(d) : d));
  function targetDocuments(paths=targetsRef.current){
    const byPath=new Map(docs.current.map(d=>[d.image.path,d]));
    return paths.flatMap(path=>{const d=byPath.get(path);return d?[d]:[];});
  }
  useEffect(()=>{void window.captraw.setDirty(documents.filter(d=>d.dirty||d.image.id===canvasEditing).map(d=>d.image.path));},[documents,canvasEditing]);
  function canvasInProgress(){
    if(!canvasEdit.current)return false;
    setError(`${canvasEdit.current.label}尚未完成，请松开鼠标并等待处理完成后重试。Esc 可取消当前操作。`);return true;
  }
  async function renderDocument(doc: DocumentState) {
    const rev = ++revision.current; setBusy(true);setError('');
    const preview={maskId:maskRef.current,luminance:luminanceRef.current,colorSampling:colorRef.current};
    try {
      const result = await window.captraw.update(doc.image.id, rev, doc.adjustments, doc.profile,preview.maskId,preview.luminance,preview.colorSampling);
      if (idRef.current === doc.image.id && rev >= lastApplied.current) {
        rendered.current={id:doc.image.id,revision:rev,adjustments:doc.adjustments,profileId:doc.profileId,...preview};
        lastApplied.current = rev; updateDocument(doc.image.id, d => d.adjustments!==doc.adjustments||d.profileId!==doc.profileId?d:({ ...d, profile: result.artProfile,opened:d.opened||snapshot({...d,profile:result.artProfile}),image:{...d.image,lensStatus:result.lensStatus,effectiveGeometry:result.geometry??d.image.effectiveGeometry} }));
      }
      return result.artProfile;
    } catch (e) {
      if(idRef.current===doc.image.id&&rev===revision.current){setError(String(e));setBusy(false);}throw e;
    }
  }
  useEffect(() => window.captraw.onEvent((event: EngineEvent) => {
    if (event.event === 'preview' && event.frame.sessionId === idRef.current && event.frame.revision >= revision.current) {
      if (event.frame.kind === 'detail') setDetailFrame(event.frame);
      else {
        setFrame(event.frame); setDetailFrame(d=>d?.sessionId===event.frame.sessionId&&d.revision===event.frame.revision?d:undefined); setBusy(false); if(event.frame.revision>syncStatusRevision.current)setStatus(`${Math.round(event.frame.elapsedMs)} ms · ${event.frame.linear?'扩展范围 · 线性 Rec.709':'sRGB'}`);
        updateDocument(event.frame.sessionId,d=>({...d,previewToken:event.frame.url}));
        const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{const c=document.createElement('canvas');c.width=180;c.height=Math.round(180*image.height/image.width);c.getContext('2d')!.drawImage(image,0,0,c.width,c.height);updateDocument(event.frame.sessionId,d=>d.previewToken===event.frame.url?{...d,thumbnail:c.toDataURL('image/jpeg',.75),thumbnailFrame:event.frame.url}:d);};image.src=event.frame.url;
      }
    } else if(event.event==='save-progress'){setSaveProgress(event.message);
    } else if(event.event==='synchronize-progress'){setSyncProgress(event.message);
    } else if(event.event==='command'){
      if(syncOpenRef.current||loading.current||document.querySelector('dialog[open]'))return;
      if(event.command==='close')void closeDocument(idRef.current);
      if(event.command==='save')void save();
      if(event.command==='open')void window.captraw.chooseFiles().then(openPaths);
    } else if (event.event === 'job') setJob(event.job);
    else if (event.event === 'error') { setError(event.message); setBusy(false); }
  }), []);
  useEffect(() => {
    if (!active || loading.current) return;
    clearTimeout(timer.current);
    // Opening/switching already renders explicitly. A later React effect must
    // not schedule the same state again beneath an accepted canvas gesture.
    const alreadyRendered=()=>{const r=rendered.current;return r?.id===active.image.id&&r.revision===revision.current&&r.adjustments===active.adjustments&&r.profileId===active.profileId&&r.maskId===maskRef.current&&r.luminance===luminanceRef.current&&r.colorSampling===colorRef.current;};
    if(alreadyRendered())return;
    timer.current = setTimeout(() => { if(!alreadyRendered())void renderDocument(active).catch(() => {}); }, 90);
    return () => clearTimeout(timer.current);
  }, [activeId, active?.adjustments,active?.profileId,maskId,luminance,colorSampling,opening]);
  async function openPaths(paths: string[]) {
    if (!paths.length || loading.current) return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    const fresh=paths.filter(path=>!docs.current.some(d=>d.image.path===path));
    if(!fresh.length){const existing=docs.current.find(d=>d.image.path===paths[0]);if(existing)await switchDocument(existing.image.id);return;}
    paths=fresh;
    loading.current = true;setOpening(true); clearTimeout(timer.current); setBusy(true); setError('');
    try {
      // Each file is decoded to establish its own defaults and source identity.
      for (const path of paths) {
        const image = await window.captraw.open(path);
        const label=image.recipe?.label??image.label??'';
        const entry: DocumentState = { image,xmpPacket:image.recipe?.xmpPacket,rating:image.rating,savedRating:image.rating,label,savedLabel:label, adjustments: copy(image.adjustments), initial: copy(image.initialAdjustments || image.adjustments), profile: image.recipe?.artProfile || '',profileId:0,savedProfileId:0, dirty: false, saved:copy(image.adjustments), past: [], future: [] };
        setDocuments(old => old.some(d=>d.image.path===image.path)?old.map(d=>d.image.path===image.path?entry:d):[...old,entry]);
        setActiveId(image.id); idRef.current = image.id; setFrame(undefined);
        await renderDocument(entry);
      }
    } catch (e) { setError(String(e)); setBusy(false); }
    finally { loading.current = false;setOpening(false); }
  }
  async function switchDocument(id: string, force=false) {
    if ((id === idRef.current && !force) || loading.current) return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    const entry = docs.current.find(d => d.image.id === id); if (!entry) return;
    loading.current = true;setOpening(true); clearTimeout(timer.current); setBusy(true);setError('');
    try {
      const reopened = await window.captraw.open(entry.image.path,entry.image.sourceIdentity);
      const updated = { ...entry, image: { ...reopened,sourceIdentity:entry.image.sourceIdentity, adjustments: entry.adjustments } };
      setDocuments(old => old.map(d => d.image.id === id ? updated : d));
      idRef.current = reopened.id; setActiveId(reopened.id);setFrame(undefined);await renderDocument(updated);return updated;
    } catch (e) { setError(String(e));setBusy(false); } finally { loading.current = false;setOpening(false); }
  }
  function edit(change: (a: Adjustments) => Adjustments, transient = false) {
    if(loading.current)return;
    ++editEpoch.current;const id = idRef.current;
    const current = docs.current.find(d => d.image.id === id); if (!current||!targetsRef.current.includes(current.image.path)) return;
    const next=change(copy(current.adjustments));if(JSON.stringify(next)===JSON.stringify(current.adjustments))return;
    if (transient && !gesture.current) gesture.current = copy(current);
    updateDocument(id, d => ({ ...d, adjustments:next, dirty: dirty(d,next), past: transient ? d.past : [...d.past, historySnapshot(d)], future: transient ? d.future : [] }));
  }
  function editGlobal(change:(a:Adjustments)=>Adjustments,transient=false){
    if(loading.current)return;
    const source=docs.current.find(d=>d.image.id===idRef.current);
    if(!source||!targetsRef.current.includes(source.image.path)){setError('请先在可见照片中选择当前照片，再进行调节。');return;}
    if(!globalGesture.current)globalGesture.current={source:copy(source),targets:copy(targetDocuments()),draft:copy(source.adjustments),operationId:crypto.randomUUID()};
    const pending=globalGesture.current;pending.draft=change(copy(pending.draft));++editEpoch.current;
    updateDocument(source.image.id,d=>({...d,adjustments:pending.draft,dirty:dirty(d,pending.draft)}));
    if(!transient)void commitGlobal();
  }
  async function commitGlobal(recompute?:RecomputedEdit){
    if(loading.current)return false;const pending=globalGesture.current;if(!pending)return true;
    globalGesture.current=undefined;
    const {source,targets,draft,operationId}=pending,command=adjustmentCommand(source.adjustments,draft,operationId);
    if(!recompute&&!Object.keys(command.set).length&&!command.unset.length&&!command.merge)return true;
    if(!recompute&&targets.length===1){
      updateDocument(source.image.id,d=>({...d,adjustments:draft,past:[...d.past,historySnapshot(source,operationId)],future:[],dirty:dirty(d,draft)}));return true;
    }
    return runPrepared(source,targets,operationId,()=>window.captraw.synchronize({source:{image:{...source.image,path:`captraw-edit:${operationId}`},adjustments:source.adjustments,profile:source.profile},targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),groups:[],command,recompute}),recompute?'已逐张计算':'已联动');
  }
  async function runPrepared(source:DocumentState,targets:DocumentState[],operationId:string,prepare:()=>Promise<SyncResult[]|null>,label:string){
    clearTimeout(timer.current);loading.current=true;setOpening(true);setLinkedBusy(true);linkedCancelled.current=false;setError('');setSyncProgress('正在准备所选照片…');
    const epoch=editEpoch.current;
    try{
      const results=await prepare();
      if(results===null||linkedCancelled.current)throw new Error('已取消联动，所选照片未提交修改');
      const thumbnails=new Map<string,string>();for(const result of results)thumbnails.set(result.path,await previewThumbnail(result.preview));
      if(linkedCancelled.current||epoch!==editEpoch.current)throw new Error('已取消联动，所选照片未提交修改');
      const updated=docs.current.map(d=>{
        const result=results.find(r=>r.path===d.image.path),before=targets.find(t=>t.image.path===d.image.path);
        if(!before)return d;
        if(!result)return d.image.path===source.image.path?{...d,...snapshot(source),dirty:dirty(d,source.adjustments,source.profileId)}:d;
        const profileId=++profileEpoch.current;
        return {...d,adjustments:result.adjustments,profile:result.profile,profileId,dirty:dirty(d,result.adjustments,profileId),past:[...d.past,historySnapshot(before,operationId)],future:[],thumbnail:thumbnails.get(result.path),thumbnailFrame:result.preview,previewToken:result.preview};
      });
      const active=updated.find(d=>d.image.id===idRef.current);if(active)await renderDocument(active);
      if(linkedCancelled.current)throw new Error('已取消联动，所选照片未提交修改');
      docs.current=updated;setDocuments(updated);
      setStatus(results.length?`${label} ${results.length} 张照片 · 可分别或共同撤销`:'所选设置未变化');return true;
    }catch(error){
      // Restore the uncommitted draft; late preview revisions cannot replace this render.
      const restored={...source};
      setDocuments(old=>old.map(d=>d.image.path===source.image.path?restored:d));
      try{await renderDocument(restored);}catch{}
      setError(error instanceof Error?error.message:String(error));return false;
    }finally{loading.current=false;setOpening(false);setLinkedBusy(false);}
  }
  async function recomputeEdit(recompute:RecomputedEdit){
    if(loading.current||canvasInProgress())return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    const source=docs.current.find(d=>d.image.id===idRef.current);
    if(!source||!targetsRef.current.includes(source.image.path)){setError('请先选择当前照片。');return;}
    const draft=recompute.type==='whiteBalance'&&recompute.request.mode==='profile'?{...copy(source.adjustments),colorProfile:copy(recompute.request.colorProfile)}:copy(source.adjustments);
    globalGesture.current={source:copy(source),targets:copy(targetDocuments()),draft,operationId:crypto.randomUUID()};
    ++editEpoch.current;await commitGlobal(recompute);
  }
  async function applyCurvePreset(name:PointCurvePresetName){
    if(loading.current||canvasInProgress()||!Object.hasOwn(POINT_CURVE_PRESETS,name))return false;
    if(globalGesture.current&&await commitGlobal()===false)return false;
    commit();
    const source=docs.current.find(d=>d.image.id===idRef.current),targets=copy(targetDocuments());
    if(!source||!targets.length||!targetsRef.current.includes(source.image.path))return false;
    const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({
      source:{image:{...source.image,path:`captraw-curve:${operationId}`},adjustments:source.adjustments,profile:source.profile},
      targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),groups:[],
      command:{operationId,set:{curve:copy([...POINT_CURVE_PRESETS[name]]),curveName:name},unset:[]},
    }),'已应用点曲线到');
  }
  function cancelGlobal(){
    if(linkedBusy){linkedCancelled.current=true;void window.captraw.cancelSynchronize();return true;}
    const pending=globalGesture.current;if(!pending)return false;
    globalGesture.current=undefined;clearTimeout(timer.current);++editEpoch.current;++revision.current;
    updateDocument(pending.source.image.id,()=>copy(pending.source));
    return true;
  }
  function cancelEdit():boolean {
    if(cancelGlobal())return true;
    const previous=gesture.current;if(!previous)return false;
    gesture.current=undefined;clearTimeout(timer.current);++editEpoch.current;++revision.current;
    updateDocument(previous.image.id,()=>copy(previous));
    return true;
  }
  function commit() {
    if (!gesture.current) return;
    const previous = gesture.current;gesture.current = undefined;
    updateDocument(previous.image.id, d => JSON.stringify(d.adjustments)===JSON.stringify(previous.adjustments)?copy(previous):({ ...d, past: [...previous.past, historySnapshot(previous)], future: [], dirty: dirty(d) }));
  }
  async function editMetadata(paths:string[],change:Pick<EditingState,'rating'|'label'>){
    if(loading.current||canvasInProgress())return;
    const targets=new Set(paths.filter(path=>targetsRef.current.includes(path)));
    if(!targets.size)return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    commit();
    const operationId=crypto.randomUUID();++editEpoch.current;
    setDocuments(old=>old.map(d=>{
      if(!targets.has(d.image.path)||Object.entries(change).every(([key,value])=>d[key as 'rating'|'label']===value))return d;
      const next={...d,...change};return {...next,dirty:dirty(next),past:[...d.past,historySnapshot(d,operationId)],future:[]};
    }));return true;
  }
  async function rate(rating:number,paths:string[]){
    if(!await editMetadata(paths,{rating}))return;
    setStatus(rating===-1?'已标记拒绝 · 保存 XMP 后保留，不删除原片':rating===0?'已清除评分 · 尚未保存':`已评为 ${rating} 星 · 尚未保存`);
  }
  async function setLabel(label:string,paths:string[]){
    if(await editMetadata(paths,{label}))setStatus(label?`已设置色标“${label}” · 尚未保存`:'已清除色标 · 尚未保存');
  }
  function beginCanvasEdit(sessionId:string,frameRevision:number,label:string):CanvasEditTransaction|null {
    if(canvasEdit.current)return null;
    const doc=docs.current.find(d=>d.image.id===sessionId),applied=rendered.current,epoch=editEpoch.current;
    const participants=targetDocuments(),targets=copy(participants),operationId=crypto.randomUUID();
    let phase:'sampling'|'committing'|'committed'|'cancelled'='sampling',operationEpoch=epoch;
    const unchanged=()=>participants.every(before=>docs.current.some(d=>d.image.id===before.image.id&&d.adjustments===before.adjustments&&d.profileId===before.profileId&&d.rating===before.rating&&d.label===before.label));
    const valid=()=>phase==='committing'||phase==='committed'?
      canvasEdit.current===pending&&idRef.current===sessionId&&editEpoch.current===operationEpoch&&!linkedCancelled.current:
      phase==='sampling'&&!loading.current&&!!doc&&unchanged()&&targetsRef.current.includes(doc.image.path)&&idRef.current===sessionId&&revision.current===frameRevision&&editEpoch.current===epoch&&
      applied?.maskId===maskRef.current&&applied.luminance===luminanceRef.current&&applied.colorSampling===colorRef.current&&
      docs.current.some(d=>d.image.id===sessionId&&d.adjustments===doc?.adjustments&&d.profileId===doc?.profileId);
    if(!doc||!valid()||applied?.id!==sessionId||applied.revision!==frameRevision||applied.adjustments!==doc.adjustments||applied.profileId!==doc.profileId)return null;
    // The current preview already contains these exact settings. A redundant
    // pending refresh must not change the revision beneath an accepted gesture.
    clearTimeout(timer.current);
    const pending={sessionId,label};canvasEdit.current=pending;setCanvasEditing(sessionId);
    return {sessionId,revision:frameRevision,valid,release(){
      if(phase==='committing'){phase='cancelled';linkedCancelled.current=true;void window.captraw.cancelSynchronize();}
      if(canvasEdit.current===pending){canvasEdit.current=undefined;setCanvasEditing('');}
    },apply(change){
      if(phase!=='sampling'||!valid())return false;
      const next=change(copy(doc.adjustments));
      if(JSON.stringify(next)!==JSON.stringify(doc.adjustments))edit(()=>next);
      return true;
    },async applyGlobal(change){
      if(phase!=='sampling'||!valid())return false;
      const next=change(copy(doc.adjustments)),command=adjustmentCommand(doc.adjustments,next,operationId);
      if(!Object.keys(command.set).length&&!command.unset.length&&!command.merge)return true;
      phase='committing';operationEpoch=++editEpoch.current;
      const result=await runPrepared(copy(doc),targets,operationId,()=>window.captraw.synchronize({
        source:{image:{...doc.image,path:`captraw-canvas:${operationId}`},adjustments:doc.adjustments,profile:doc.profile},
        targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),groups:[],command,
      }),'已应用曲线到');
      if(result)phase='committed';else phase='cancelled';return result;
    }};
  }
  function beginMaskEdit(sessionId:string,frameRevision:number,maskId:string,componentId?:string):MaskEditTransaction|null {
    const doc=docs.current.find(d=>d.image.id===sessionId),mask=doc?.adjustments.masks.find(m=>m.id===maskId),leaf=mask?.components?mask.components.find(c=>c.id===componentId):mask;
    if(!leaf)return null;
    const transaction=beginCanvasEdit(sessionId,frameRevision,'蒙版笔画');if(!transaction)return null;
    return {...transaction,apply(next){
      if(!transaction.valid())return false;
      const values={points:next.points,brush:next.brush,start:next.start,end:next.end,referenceAngle:next.referenceAngle,geometryReference:next.geometryReference,initialized:true};
      if(JSON.stringify(values)===JSON.stringify({points:leaf.points,brush:leaf.brush,start:leaf.start,end:leaf.end,referenceAngle:leaf.referenceAngle,geometryReference:leaf.geometryReference,initialized:leaf.initialized!==false}))return true;
      return transaction.apply(a=>({...a,masks:a.masks.map(m=>{
        if(m.id!==maskId)return m;
        return m.components?{...m,components:m.components.map(c=>c.id===componentId?{...c,...values}:c)}:{...m,...values};
      })}));
    }};
  }
  function undo(redo = false) {
    if(loading.current)return;
    if(globalGesture.current){cancelGlobal();return;}
    const candidates=docs.current.filter(d=>targetsRef.current.includes(d.image.path)&&(redo?d.future:d.past).length);
    const selected=candidates.sort((a,b)=>((redo?b.future:b.past).at(-1)?.sequence??0)-((redo?a.future:a.past).at(-1)?.sequence??0))[0];
    if(!selected)return;
    ++editEpoch.current;gesture.current = undefined;
    const operationId=(redo?selected.future:selected.past).at(-1)?.operationId;
    setDocuments(old=>old.map(d => {
      if(!targetsRef.current.includes(d.image.path)||(operationId?(redo?d.future:d.past).at(-1)?.operationId!==operationId:d.image.path!==selected.image.path))return d;
      const stack = redo ? d.future : d.past;if (!stack.length) return d;
      const target=stack.at(-1)!,inverse:HistoryState={...historySnapshot(d,target.operationId),...('before' in target?{before:d.before?copy(d.before):null}:{})};
      const restored=snapshot(target);if(JSON.stringify(restored.adjustments)===JSON.stringify(d.adjustments))restored.adjustments=d.adjustments;
      return { ...d,...restored,...('before' in target?{before:target.before?copy(target.before):undefined}:{}),past: redo ? [...d.past,inverse] : d.past.slice(0,-1), future: redo ? d.future.slice(0,-1) : [...d.future,inverse], dirty: dirty({...d,rating:target.rating,label:target.label},target.adjustments,target.profileId) };
    }));
  }
  async function comparisonState(action:'capture'|'reset'|'swap'){
    if(loading.current)return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    commit();if(action==='swap')++editEpoch.current;
    updateDocument(idRef.current,d=>{
      if(action==='capture')return {...d,before:snapshot(d)};
      if(action==='reset')return {...d,before:undefined};
      const before=d.before||d.opened;if(!before)return d;
      const {rotation,flipHorizontal,flipVertical,fineRotation,perspective,perspectiveGuides,crop,cropAspect,lensCorrections,lensProfile,lensManualDistortion}=d.adjustments;
      const next={...snapshot(before),rating:d.rating,label:d.label,adjustments:{...copy(before.adjustments),rotation,flipHorizontal,flipVertical,fineRotation,perspective:copy(perspective),perspectiveGuides:copy(perspectiveGuides),crop:copy(crop),cropAspect,lensCorrections:copy(lensCorrections),lensProfile:copy(lensProfile),lensManualDistortion}};
      if(next.profileId===d.profileId&&JSON.stringify(next.adjustments)===JSON.stringify(d.adjustments))return d;
      return {...d,...next,before:snapshot(d),past:[...d.past,{...historySnapshot(d),before:d.before?copy(d.before):null}],future:[],dirty:dirty(d,next.adjustments,next.profileId)};
    });
    setStatus(action==='capture'?'已保存对比前状态 · 仅当前会话':action==='reset'?'已还原打开时的对比状态':'已交换前后设置 · 可撤销');
  }
  function addMask(type: Exclude<MaskType,'raster'>) {
    const name=`${type === 'brush' ? '画笔' : type === 'linear' ? '线性渐变' : type === 'luminance' ? '亮度范围' : type==='color'?'颜色范围':'径向蒙版'} ${(active?.adjustments.masks.length || 0) + 1}`;
    const mask: LocalMask = { id: crypto.randomUUID(), name, type, enabled: true, inverted: false, feather: 30, brightness: type==='luminance'||type==='color'?0:0.5, contrast: 0, saturation: 0, points: [], start: { x: .5, y: .5 }, end: { x: .5, y: .5 },components:[{id:crypto.randomUUID(),name,type,enabled:true,inverted:false,feather:30,...(type==='linear'?{linearGradientModel:'full-zero-v1' as const,feather:0}:{}),points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},operation:'add',initialized:type==='luminance',...(type==='color'?{colorSamples:[],colorRefine:50}:{}),...(type==='luminance'?{luminanceRange:[0,0,100,100] as [number,number,number,number]}:{})}] };
    edit(a => ({ ...a, masks: [...a.masks, mask] })); return mask.id;
  }
  async function flush() {
    if(loading.current||canvasInProgress())return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    clearTimeout(timer.current); const d = docs.current.find(d => d.image.id === idRef.current);if (!d) return;
    const profile = await renderDocument(d); return { doc: d, profile };
  }
  function documentSnapshot(d:DocumentState){return {path:d.image.path,sourceIdentity:copy(d.image.sourceIdentity),width:d.image.width,height:d.image.height,artProfile:d.profile,adjustments:copy(d.adjustments),xmpPacket:d.xmpPacket??d.image.recipe?.xmpPacket,rating:d.rating,label:d.label};}
  async function endSession(){
    clearTimeout(timer.current);++revision.current;gesture.current=undefined;globalGesture.current=undefined;
    await window.captraw.close();await window.captraw.forgetSession(sessionId.current);docs.current=[];setDocuments([]);idRef.current='';setActiveId('');setFrame(undefined);setDetailFrame(undefined);setBusy(false);setSaveOpen(false);sessionId.current=crypto.randomUUID();
    setStatus('会话已结束 · 原片保持不变');
  }
  async function saveTargets(paths:string[],finish=false,saveAs=false){
    if(loading.current||canvasInProgress())return false;
    if(globalGesture.current&&await commitGlobal()===false)return false;
    if(finish)paths=docs.current.filter(d=>d.dirty).map(d=>d.image.path);
    commit();const selected=copy(targetDocuments(paths));
    if(!selected.length){if(finish)await endSession();return finish;}
    saveContext.current={documents:selected,finish};
    clearTimeout(timer.current);loading.current=true;setOpening(true);setSaveBusy(true);setSaveResult(null);setSaveError('');setSaveProgress('准备保存原片旁的 XMP…');
    if(selected.length>1||finish||saveAs)setSaveOpen(true);
    try{
      const request={sessionId:sessionId.current,documents:selected.map(documentSnapshot)};
      const result=await (saveAs?window.captraw.saveSessionAs(request):window.captraw.saveSession(request));
      if(!result){setSaveOpen(false);return false;}
      setSaveResult(result);
      const updated=docs.current.map(d=>{
        const saved=selected.find(s=>s.image.path===d.image.path);
        if(!saved||!result.results.some(r=>r.source===d.image.path&&r.output))return d;
        return {...d,xmpPacket:result.results.find(r=>r.source===d.image.path)?.xmpPacket??d.xmpPacket,saved:copy(saved.adjustments),savedProfileId:saved.profileId,savedRating:saved.rating,savedLabel:saved.label,dirty:d.profileId!==saved.profileId||JSON.stringify(d.adjustments)!==JSON.stringify(saved.adjustments)||d.rating!==saved.rating||d.label!==saved.label};
      });docs.current=updated;setDocuments(updated);
      const success=!result.cancelled&&result.results.length===selected.length&&result.results.every(r=>!!r.output);
      if(!success)setSaveOpen(true);
      else if(finish&&!updated.some(d=>d.dirty))await endSession();
      else if(selected.length===1)setSaveOpen(false);
      setStatus(`已保存 ${result.results.filter(r=>r.output).length}/${selected.length} 张照片的 XMP${result.cancelled?' · 已停止后续保存':''}`);
      return success;
    }catch(error){setSaveError(error instanceof Error?error.message:String(error));setSaveOpen(true);return false;}
    finally{loading.current=false;setOpening(false);setSaveBusy(false);}
  }
  async function save(){const current=docs.current.find(d=>d.image.id===idRef.current);return current?saveTargets([current.image.path]):false;}
  async function saveSelected(paths:string[]){return saveTargets(paths);}
  async function retrySave(path?:string){
    const context=saveContext.current,paths=context.documents.filter(d=>!saveResult?.results.some(r=>r.source===d.image.path&&r.output)).map(d=>d.image.path);
    const success=await saveTargets(path?[path]:paths,context.finish,!!path);
    if(!success&&context.finish)saveContext.current={documents:docs.current.filter(d=>d.dirty),finish:true};
    if(success&&context.finish){const remaining=docs.current.filter(d=>d.dirty).map(d=>d.image.path);if(remaining.length)await saveTargets(remaining,true);else await endSession();}
  }
  async function cancelSave(){setSaveProgress('正在完成当前文件，随后停止…');await window.captraw.cancelSave();}
  async function closeDocument(id:string,saved=false){
    if(loading.current||canvasInProgress())return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    commit();const target=docs.current.find(d=>d.image.id===id);if(!target)return;
    if(target.dirty&&!saved){
      const decision=await window.captraw.confirmClose(target.image.name);
      if(decision==='cancel')return;
      if(decision==='save'&&!await saveTargets([target.image.path]))return;
    }
    const remaining=docs.current.filter(d=>d.image.path!==target.image.path),index=docs.current.indexOf(target);
    const isActive=idRef.current===target.image.id;
    if(isActive){clearTimeout(timer.current);gesture.current=undefined;++revision.current;loading.current=true;setOpening(true);try{await window.captraw.close();}catch(error){setError(String(error));return;}finally{loading.current=false;setOpening(false);}setFrame(undefined);setDetailFrame(undefined);idRef.current='';setActiveId('');setBusy(false);setError('');}
    docs.current=remaining;setDocuments(remaining);
    if(isActive&&remaining.length)await switchDocument(remaining[Math.min(Math.max(0,index),remaining.length-1)].image.id);
    if(!remaining.length){await window.captraw.forgetSession(sessionId.current);sessionId.current=crypto.randomUUID();}
  }
  async function finish(){return saveTargets(docs.current.filter(d=>d.dirty).map(d=>d.image.path),true);}
  async function discardSession(){
    if(loading.current||canvasInProgress())return;
    if(!await window.captraw.confirmDiscardSession(docs.current.filter(d=>d.dirty).map(d=>d.image.name)))return;
    loading.current=true;setOpening(true);
    try{await endSession();}catch(error){setError(String(error));}finally{loading.current=false;setOpening(false);}
  }
  function openSynchronize(){if(loading.current||samplingRef.current||busy||wbPending||canvasInProgress())return;commit();setSyncError('');setSyncOpen(true);}
  async function cancelSynchronize(){if(loading.current){syncCancelled.current=true;setSyncProgress('正在取消同步…');await window.captraw.cancelSynchronize();}else setSyncOpen(false);}
  async function previewThumbnail(preview:string){
    const image=await new Promise<HTMLImageElement>((accept,reject)=>{const value=new Image();value.crossOrigin='anonymous';value.onload=()=>accept(value);value.onerror=()=>reject(new Error('无法读取照片预览，请重试。'));value.src=preview;});
    const canvas=document.createElement('canvas');canvas.width=180;canvas.height=Math.round(180*image.height/image.width);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.75);
  }
  async function synchronize(paths:string[],groups:SyncGroup[]){
    if(loading.current)return;
    const source=docs.current.find(d=>d.image.id===idRef.current),targets=targetDocuments(paths).filter(d=>d.image.id!==idRef.current);
    if(!source||!targets.length||!paths.includes(source.image.path))return;
    clearTimeout(timer.current);loading.current=true;syncCancelled.current=false;setSyncBusy(true);setSyncError('');setSyncProgress('');const epoch=editEpoch.current;
    try{
      const profile=await renderDocument(source);
      if(syncCancelled.current){setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus('已取消同步，照片编辑未改变');return;}
      const results=await window.captraw.synchronize({source:{image:source.image,adjustments:copy(source.adjustments),profile},targets:targets.map(d=>({image:d.image,adjustments:copy(d.adjustments),profile:d.profile})),groups});
      if(results===null||syncCancelled.current){setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus('已取消同步，照片编辑未改变');return;}
      const thumbnails=new Map<string,string>();
      for(const result of results)thumbnails.set(result.path,await previewThumbnail(result.preview));
      if(syncCancelled.current){setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus('已取消同步，照片编辑未改变');return;}
      if(epoch!==editEpoch.current)throw new Error('编辑已变化，请重新同步。');
      const profileIds=new Map(results.map(r=>[r.path,++profileEpoch.current])),operationId=crypto.randomUUID();
      setDocuments(old=>old.map(d=>{const result=results.find(r=>r.path===d.image.path);return result?{...d,adjustments:result.adjustments,profile:result.profile,profileId:profileIds.get(result.path)!,dirty:true,past:[...d.past,historySnapshot(d,operationId)],future:[],thumbnail:thumbnails.get(result.path),thumbnailFrame:result.preview,previewToken:result.preview}:d;}));
      setSyncOpen(false);syncStatusRevision.current=revision.current;setStatus(results.length?`已同步 ${results.length} 张照片 · 可分别撤销和保存`:'所选调整已相同，无需同步');
    }catch(error){setSyncError(error instanceof Error?error.message:String(error));}
    finally{loading.current=false;setSyncBusy(false);}
  }
  async function matchCameraExposure(paths:string[]){
    if(loading.current||busy||samplingRef.current||wbPending||canvasInProgress())return false;
    const source=docs.current.find(d=>d.image.id===idRef.current),targets=targetDocuments(paths).filter(d=>d.image.id!==idRef.current);
    if(!source||!targets.length||!paths.includes(source.image.path)){setError('请选中当前照片和至少一张其他照片，再匹配曝光。');return false;}
    commit();setError('');
    try{
      const matches=matchExposureByCameraSettings(
        {image:source.image,adjustments:copy(source.adjustments),profile:source.profile},
        targets.map(d=>({image:d.image,adjustments:copy(d.adjustments),profile:d.profile})),
      );
      const changed=matches.filter(match=>match.exposure!==match.target.adjustments.exposure);
      if(!changed.length){setStatus('相机曝光已经匹配，无需修改');return true;}
      loading.current=true;setOpening(true);setLinkedBusy(true);linkedCancelled.current=false;setSyncProgress('正在逐张匹配相机曝光…');
      const operationId=crypto.randomUUID();
      const results=await window.captraw.synchronize({
        source:{image:source.image,adjustments:source.adjustments,profile:source.profile},
        targets:changed.map(match=>match.target),groups:[],
        commands:changed.map(match=>({path:match.target.image.path,operationId,set:{exposure:match.exposure},unset:[]})),
      });
      if(results===null||linkedCancelled.current)throw new Error('曝光匹配已取消，照片编辑未改变。');
      const completed=[];
      for(const result of results)completed.push({...result,exposure:result.adjustments.exposure,thumbnail:await previewThumbnail(result.preview),profileId:++profileEpoch.current});
      if(linkedCancelled.current)throw new Error('曝光匹配已取消，照片编辑未改变。');
      const byPath=new Map(completed.map(result=>[result.path,result]));
      setDocuments(old=>old.map(d=>{
        const result=byPath.get(d.image.path);if(!result)return d;
        const adjustments={...result.adjustments,exposure:result.exposure};
        return {...d,adjustments,profile:result.profile,profileId:result.profileId,dirty:dirty(d,adjustments,result.profileId),past:[...d.past,historySnapshot(d,operationId)],future:[],thumbnail:result.thumbnail,thumbnailFrame:result.preview,previewToken:result.preview};
      }));
      setStatus(`已按相机设置匹配 ${changed.length} 张照片曝光`);
      return true;
    }catch(error){setError(error instanceof Error?error.message:String(error));return false;}
    finally{loading.current=false;setOpening(false);setLinkedBusy(false);setSyncProgress('');}
  }
  const exporting=useRef(false);const [exportPending,setExportPending]=useState(false);
  function beginPresetAmount(){
    if(presetGesture.current||loading.current)return;
    const source=docs.current.find(d=>d.image.id===idRef.current);if(!source)return;
    presetGesture.current={source:copy(source),targets:copy(targetDocuments()),epoch:editEpoch.current};
  }
  function cancelPresetAmount(){presetGesture.current=undefined;void presetPreview.cancel();}
  async function applyPreset(id:string,amount=100,strengthGesture=false){
    if(loading.current||canvasInProgress())return false;
    if(globalGesture.current&&await commitGlobal()===false)return false;
    const pending=strengthGesture?presetGesture.current:undefined;presetGesture.current=undefined;
    if(pending&&(pending.source.image.id!==idRef.current||pending.epoch!==editEpoch.current)){setError('预设强度调整期间照片已变化，请重试。');return false;}
    const source=pending?.source||docs.current.find(d=>d.image.id===idRef.current),targets=pending?.targets||copy(targetDocuments());
    if(!source||!targets.length||!targetsRef.current.includes(source.image.path))return false;
    await presetPreview.cancel();const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,async()=>{
      const result=await window.captraw.applyPresets({id,targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),operationId,amount});
      setPresetWarnings(result?.warnings||[]);return result?.results??null;
    },'已应用预设到');
  }
  async function cancelPreset(){cancelGlobal();}
  async function copyAdjustments(groups:SyncGroup[]){
    const active=docs.current.find(d=>d.image.id===idRef.current);
    if(copyBusy||!active||!targetsRef.current.includes(active.image.path))return;setCopyBusy(true);setError('');
    try{
      const prepared=await flush();if(!prepared)return;
      clipboard.current=copy({source:{image:prepared.doc.image,adjustments:prepared.doc.adjustments,profile:prepared.profile},groups});setHasClipboard(true);setCopyOpen(false);setStatus('已复制所选编辑设置 · 原片及历史未改变');
    }catch(error){setError(String(error));}finally{setCopyBusy(false);}
  }
  async function pasteAdjustments(){
    if(loading.current||canvasInProgress()||!clipboard.current)return false;
    const paths=[...targetsRef.current],copied=copy(clipboard.current);
    if(globalGesture.current&&await commitGlobal()===false)return false;
    const source=docs.current.find(d=>d.image.id===idRef.current),targets=copy(targetDocuments(paths));
    if(!source||!targets.length)return false;
    const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({source:{...copied.source,image:{...copied.source.image,path:`captraw-clipboard:${operationId}`}},targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),groups:copied.groups}),'已粘贴设置到');
  }
  async function rotate(degrees:90|-90){
    if(loading.current||canvasInProgress())return false;
    const paths=[...targetsRef.current];
    if(globalGesture.current&&await commitGlobal()===false)return false;
    commit();
    const source=docs.current.find(d=>d.image.id===idRef.current),targets=copy(targetDocuments(paths));
    if(!source||!targets.length)return false;
    if(targets.length===1&&targets[0].image.id===source.image.id){edit(a=>({...a,rotation:(a.rotation+degrees+360)%360}));return true;}
    const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({
      source:{image:{...source.image,path:`captraw-rotate:${operationId}`},adjustments:source.adjustments,profile:source.profile},
      targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),groups:[],
      commands:targets.map(d=>({path:d.image.path,operationId,set:{rotation:(d.adjustments.rotation+degrees+360)%360},unset:[]})),
    }),'已旋转');
  }
  async function reset(){
    if(loading.current||canvasInProgress())return false;
    cancelGlobal();
    const source=docs.current.find(d=>d.image.id===idRef.current),targets=copy(targetDocuments());
    if(!source||!targets.length)return false;
    const operationId=crypto.randomUUID();++editEpoch.current;
    return runPrepared(copy(source),targets,operationId,()=>window.captraw.synchronize({source:{image:{...source.image,path:`captraw-reset:${operationId}`},adjustments:source.adjustments,profile:source.profile},targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),groups:[],commands:targets.map(d=>({operationId,path:d.image.path,set:copy(d.initial),unset:(Object.keys(d.adjustments) as (keyof Adjustments)[]).filter(key=>d.initial[key]===undefined)}))}),'已恢复初始设置');
  }
  async function exportImage(format: ExportFormat,colorSpace:OutputColorSpace='srgb',paths:string[]=[],options?:ExportOptions) {
    if(loading.current||exporting.current||canvasInProgress())return;
    if(globalGesture.current&&await commitGlobal()===false)return;
    exporting.current=true;setExportPending(true);commit();if(format==='avif')colorSpace='rec2020';
    try {
      const selected=targetDocuments(paths).map(documentSnapshot);
      if(!selected.length){setError('请选择需要导出的可见照片。');return;}
      const request={format,colorSpace,options:copy(options)};
      if(selected.length>1)await window.captraw.exportBatch({...request,documents:selected});
      else await window.captraw.export({...request,document:selected[0]});
    } catch (e) { setError(String(e)); }finally{exporting.current=false;setExportPending(false);}
  }
  async function cancelExport(){
    if(exportCancelling||job?.state!=='running')return;
    setExportCancelling(true);
    try{await window.captraw.cancel();}catch(error){setExportCancelling(false);setError(String(error));}
  }
  async function whiteBalance(request:WhiteBalanceRequest){
    if(loading.current||wbPending)return;setWbPending(true);setError('');
    try{
      if(request.mode!=='sample'){
        const doc=docs.current.find(d=>d.image.id===idRef.current),presetName=request.mode==='preset'?doc?.image.whiteBalancePresets?.find(p=>p.id===request.preset)?.name:undefined;
        await recomputeEdit({type:'whiteBalance',request,presetName});return;
      }
      const epoch=editEpoch.current,targets=copy(targetDocuments());const f=await flush();if(!f)return;
      const result=await window.captraw.whiteBalance(f.doc.image.id,request);
      const current=docs.current.find(d=>d.image.id===idRef.current);
      if(editEpoch.current!==epoch||current?.image.id!==f.doc.image.id||JSON.stringify(current.adjustments)!==JSON.stringify(f.doc.adjustments)){setStatus('编辑已变化，请重新设置白平衡');return;}
      const operationId=crypto.randomUUID();++editEpoch.current;
      const fixed=result.relativeWBModel?{incrementalTemperature:result.incrementalTemperature,incrementalTint:result.incrementalTint,relativeWBModel:result.relativeWBModel,wbMode:'custom',wbMultipliers:null,wbApproximate:false}:{temperature:result.temperature,tint:result.tint,wbMode:'custom',wbMultipliers:null,wbApproximate:false};
      await runPrepared({...copy(f.doc),profile:f.profile},targets,operationId,()=>window.captraw.synchronize({source:{image:{...f.doc.image,path:`captraw-wb:${operationId}`},adjustments:f.doc.adjustments,profile:f.profile},targets:targets.map(d=>({image:d.image,adjustments:d.adjustments,profile:d.profile})),groups:[],commands:targets.map(d=>({operationId,path:d.image.path,set:d.image.path===f.doc.image.path?result:fixed,unset:[]}))}),'已设置白平衡到');
    }catch(e){setError(String(e));}finally{setWbPending(false);}
  }
  async function sampleColor(maskId:string,componentId:string|undefined,start:Point,end:Point|undefined,append:boolean,transaction:CanvasEditTransaction){
    if(loading.current||samplingRef.current||!transaction.valid())return;
    const current=docs.current.find(d=>d.image.id===idRef.current),mask=current?.adjustments.masks.find(m=>m.id===maskId),part=mask?.components?mask.components.find(c=>c.id===componentId):mask;
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
      transaction.apply(a=>({...a,masks:a.masks.map(m=>{
        if(m.id!==maskId)return m;
        const apply=<T extends LocalMask|NonNullable<LocalMask['components']>[number]>(c:T):T=>({...c,initialized:true,colorSamples:append?[...(c.colorSamples||[]),sample]:[sample]});
        return m.components?{...m,components:m.components.map(c=>c.id===componentId?apply(c):c)}:apply(m);
      })}));setStatus('已更新颜色范围');
    }catch(e){if(token===sampleEpoch.current&&transaction.valid())setError(String(e));}finally{if(token===sampleEpoch.current){samplingRef.current=false;setSampling(false);}}
  }
  async function sampleLuminance(maskId:string,componentId:string|undefined,start:Point,end:Point|undefined,transaction:CanvasEditTransaction){
    if(loading.current||samplingRef.current||!transaction.valid())return;
    samplingRef.current=true;setSampling(true);const token=++sampleEpoch.current;
    try{
      const result=await window.captraw.sampleLuminance(transaction.sessionId,transaction.revision,start,end);
      if(token!==sampleEpoch.current||!transaction.valid()||result.revision!==transaction.revision)return;
      const low=Math.min(99,Math.floor(result.minimum)),high=Math.max(low+1,Math.min(100,Math.ceil(result.maximum)));
      transaction.apply(a=>({...a,masks:a.masks.map(m=>{
        if(m.id!==maskId)return m;
        const apply=<T extends LocalMask|NonNullable<LocalMask['components']>[number]>(part:T):T=>{
          if(part.type!=='luminance')return part;
          const v=part.luminanceRange||[0,0,100,100],initial=v[0]===0&&v[1]===0&&v[2]===100&&v[3]===100;
          return {...part,luminanceRange:[Math.max(0,low-(initial?10:v[1]-v[0])),low,high,Math.min(100,high+(initial?10:v[3]-v[2]))]};
        };
        return m.components?{...m,components:m.components.map(c=>c.id===componentId?apply(c):c)}:apply(m);
      })}));setStatus('已按照片亮度更新范围');
    }catch(e){if(token===sampleEpoch.current&&transaction.valid())setError(String(e));}finally{if(token===sampleEpoch.current){samplingRef.current=false;setSampling(false);}}
  }
  async function viewport(x: number,y: number,width: number,height: number) {
    if(loading.current)return;
    const d = docs.current.find(d => d.image.id === idRef.current);if (!d) return;
    const requestedRevision=revision.current;
    try { await window.captraw.viewport(d.image.id, requestedRevision, x,y,width,height); }
    catch (e) { if(!loading.current&&idRef.current===d.image.id&&revision.current===requestedRevision)setError(String(e)); }
  }
  return {applyCurvePreset,cancelEdit,cancelExport,exportCancelling,rotate,copyAll:()=>copyAdjustments(SYNC_GROUPS.map(g=>g.id)),setLabel,canUndo:(redo=false)=>docs.current.some(d=>targetsRef.current.includes(d.image.path)&&(redo?d.future:d.past).length>0),beginPresetAmount,cancelPresetAmount,presetPreview,copyBusy,copyOpen,hasClipboard,openCopy:()=>{if(!loading.current&&!canvasInProgress())setCopyOpen(true);},closeCopy:()=>setCopyOpen(false),copyAdjustments,pasteAdjustments,getSelectedDocuments:()=>copy(targetDocuments()),editGlobal,commitGlobal,cancelGlobal,linkedBusy,autoTone:()=>recomputeEdit({type:'autoTone'}),autoPerspective:(direction:Extract<RecomputedEdit,{type:'autoPerspective'}>['direction'])=>recomputeEdit({type:'autoPerspective',direction}),setTargets:(paths:string[])=>{targetsRef.current=paths;},discardSession,retrySave,rate,beginCanvasEdit,beginMaskEdit,saveSelected,cancelSave,saveOpen,saveBusy,saveProgress,saveResult,saveError,closeSave:()=>setSaveOpen(false), applyPreset,cancelPreset,presetBusy,presetWarnings,flush,exportPending,dismissJob:()=>setJob(undefined),syncOpen,syncBusy,syncProgress,syncError,openSynchronize,cancelSynchronize,synchronize,matchCameraExposure,documents, active, frame, detailFrame, busy:busy||opening||wbPending||sampling,opening,wbPending,sampling,error,status,job,revision, setError,setMaskPreview,setLuminance,setColorSampling,sampleColor,sampleLuminance,cancelLuminanceSample:()=>{++sampleEpoch.current;samplingRef.current=false;setSampling(false);},openPaths,switchDocument,closeDocument,finish,whiteBalance,edit,commit,undo,addMask,save,exportImage,comparisonState,viewport,
    reset };
}
