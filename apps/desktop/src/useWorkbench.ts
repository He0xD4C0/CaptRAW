import { useEffect, useRef, useState } from 'react';
import type { Adjustments, EngineEvent, ImageSession, JobStatus, LocalMask, MaskType, PreviewFrame, WhiteBalanceRequest } from '../../../packages/contracts';
export interface DocumentState { image: ImageSession; adjustments: Adjustments; initial: Adjustments; profile: string; dirty: boolean; saved:Adjustments; past: Adjustments[]; future: Adjustments[]; thumbnail?: string;previewToken?:string;thumbnailFrame?:string; }
const copy = <T,>(value: T): T => structuredClone(value);
export function useWorkbench() {
  const [documents, setDocuments] = useState<DocumentState[]>([]);
  const [activeId, setActiveId] = useState('');
  const [maskId,setMaskPreview]=useState('');const maskRef=useRef(maskId);maskRef.current=maskId;
  const [frame, setFrame] = useState<PreviewFrame>();
  const [detailFrame, setDetailFrame] = useState<PreviewFrame>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('本地处理 · 原片保持不变');
  const [opening,setOpening]=useState(false),[wbPending,setWbPending]=useState(false);
  const [job, setJob] = useState<JobStatus>();
  const docs = useRef(documents); docs.current = documents;
  const idRef = useRef(activeId); idRef.current = activeId;
  const editEpoch=useRef(0);
  const revision = useRef(0), lastApplied = useRef(0), gesture = useRef<Adjustments | undefined>(undefined);
  const loading = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = documents.find(d => d.image.id === activeId);
  const updateDocument = (id: string, change: (d: DocumentState) => DocumentState) => setDocuments(old => old.map(d => d.image.id === id ? change(d) : d));
  useEffect(()=>{void window.captraw.setDirty(documents.filter(d=>d.dirty).map(d=>d.image.path));},[documents]);
  async function renderDocument(doc: DocumentState) {
    const rev = ++revision.current; setBusy(true);
    try {
      const result = await window.captraw.update(doc.image.id, rev, doc.adjustments, doc.profile,maskRef.current);
      if (idRef.current === doc.image.id && rev >= lastApplied.current) {
        lastApplied.current = rev; updateDocument(doc.image.id, d => ({ ...d, profile: result.artProfile }));
      }
      return result.artProfile;
    } catch (e) { setError(String(e)); setBusy(false); throw e; }
  }
  useEffect(() => window.captraw.onEvent((event: EngineEvent) => {
    if (event.event === 'preview' && event.frame.sessionId === idRef.current && event.frame.revision >= revision.current) {
      if (event.frame.kind === 'detail') setDetailFrame(event.frame);
      else {
        setFrame(event.frame); setDetailFrame(undefined); setBusy(false); setStatus(`${Math.round(event.frame.elapsedMs)} ms · sRGB`);
        updateDocument(event.frame.sessionId,d=>({...d,previewToken:event.frame.url}));
        const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{const c=document.createElement('canvas');c.width=180;c.height=Math.round(180*image.height/image.width);c.getContext('2d')!.drawImage(image,0,0,c.width,c.height);updateDocument(event.frame.sessionId,d=>d.previewToken===event.frame.url?{...d,thumbnail:c.toDataURL('image/jpeg',.75),thumbnailFrame:event.frame.url}:d);};image.src=event.frame.url;
      }
    } else if(event.event==='command'){
      if(event.command==='close')void closeDocument(idRef.current);
      if(event.command==='save')void save();
      if(event.command==='open')void window.captraw.chooseFiles().then(openPaths);
    } else if (event.event === 'job') setJob(event.job);
    else if (event.event === 'error') { setError(event.message); setBusy(false); }
  }), []);
  useEffect(() => {
    if (!active || loading.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void renderDocument(active).catch(() => {}); }, 90);
    return () => clearTimeout(timer.current);
  }, [activeId, active?.adjustments,maskId]);
  async function openPaths(paths: string[]) {
    if (!paths.length || loading.current) return;
    const fresh=paths.filter(path=>!docs.current.some(d=>d.image.path===path));
    if(!fresh.length){const existing=docs.current.find(d=>d.image.path===paths[0]);if(existing)await switchDocument(existing.image.id);return;}
    paths=fresh;
    loading.current = true;setOpening(true); clearTimeout(timer.current); setBusy(true); setError('');
    try {
      // Each file is decoded to establish its own defaults and source identity.
      for (const path of paths) {
        const image = await window.captraw.open(path);
        const entry: DocumentState = { image, adjustments: copy(image.adjustments), initial: copy(image.initialAdjustments || image.adjustments), profile: image.recipe?.artProfile || '', dirty: false, saved:copy(image.adjustments), past: [], future: [] };
        setDocuments(old => [...old.filter(d => d.image.path !== image.path), entry]);
        setActiveId(image.id); idRef.current = image.id; setFrame(undefined);
        await renderDocument(entry);
      }
    } catch (e) { setError(String(e)); setBusy(false); }
    finally { loading.current = false;setOpening(false); }
  }
  async function switchDocument(id: string, force=false) {
    if ((id === idRef.current && !force) || loading.current) return;
    const entry = docs.current.find(d => d.image.id === id); if (!entry) return;
    loading.current = true;setOpening(true); clearTimeout(timer.current); setBusy(true);setError('');
    try {
      const reopened = await window.captraw.open(entry.image.path,entry.image.baselineVersion);
      const updated = { ...entry, image: { ...reopened, adjustments: entry.adjustments } };
      setDocuments(old => old.map(d => d.image.id === id ? updated : d));
      idRef.current = reopened.id; setActiveId(reopened.id);setFrame(undefined);await renderDocument(updated);return updated;
    } catch (e) { setError(String(e));setBusy(false); } finally { loading.current = false;setOpening(false); }
  }
  function edit(change: (a: Adjustments) => Adjustments, transient = false) {
    if(loading.current)return;
    ++editEpoch.current;const id = idRef.current;
    const current = docs.current.find(d => d.image.id === id); if (!current) return;
    if (transient && !gesture.current) gesture.current = copy(current.adjustments);
    updateDocument(id, d => {const next=change(copy(d.adjustments));return { ...d, adjustments:next, dirty: JSON.stringify(next)!==JSON.stringify(d.saved), past: transient ? d.past : [...d.past, copy(d.adjustments)], future: [] };});
  }
  function commit() {
    if (!gesture.current) return;
    const previous = gesture.current;gesture.current = undefined;
    updateDocument(idRef.current, d => JSON.stringify(d.adjustments)===JSON.stringify(previous)?d:({ ...d, past: [...d.past, previous], future: [], dirty: JSON.stringify(d.adjustments)!==JSON.stringify(d.saved) }));
  }
  function undo(redo = false) {
    if(loading.current)return;
    ++editEpoch.current;gesture.current = undefined;
    updateDocument(idRef.current, d => {
      const stack = redo ? d.future : d.past;if (!stack.length) return d;
      return { ...d, adjustments: copy(stack.at(-1)!), past: redo ? [...d.past, d.adjustments] : d.past.slice(0,-1), future: redo ? d.future.slice(0,-1) : [...d.future,d.adjustments], dirty: JSON.stringify(stack.at(-1))!==JSON.stringify(d.saved) };
    });
  }
  function addMask(type: MaskType) {
    const name=`${type === 'brush' ? '画笔' : type === 'linear' ? '线性渐变' : '径向蒙版'} ${(active?.adjustments.masks.length || 0) + 1}`;
    const mask: LocalMask = { id: crypto.randomUUID(), name, type, enabled: true, inverted: false, feather: 30, brightness: 0.5, contrast: 0, saturation: 0, points: [], start: { x: .5, y: .5 }, end: { x: .5, y: .5 },components:[{id:crypto.randomUUID(),name,type,enabled:true,inverted:false,feather:30,points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},operation:'add',initialized:false}] };
    edit(a => ({ ...a, masks: [...a.masks, mask] })); return mask.id;
  }
  async function flush() {
    if(loading.current)return;
    clearTimeout(timer.current); const d = docs.current.find(d => d.image.id === idRef.current);if (!d) return;
    const profile = await renderDocument(d); return { doc: d, profile };
  }
  async function save() {
    try { const f = await flush();if (!f) return false;const path = await window.captraw.save({ ...f.doc.image, adjustments: f.doc.adjustments }, f.profile);if (path) { updateDocument(f.doc.image.id, d => ({ ...d, saved:copy(f.doc.adjustments), dirty: JSON.stringify(d.adjustments)!==JSON.stringify(f.doc.adjustments) })); setStatus('编辑配方已保存');return true; } } catch (e) { setError(String(e)); }return false;
  }
  async function closeDocument(id:string,saved=false){
    if(loading.current)return;const target=docs.current.find(d=>d.image.id===id);if(!target)return;
    if(target.dirty&&!saved){
      const decision=await window.captraw.confirmClose(target.image.name);
      if(decision==='cancel')return;
      if(decision==='save'){
        try{
          const current=id===idRef.current?target:await switchDocument(id);if(!current)return;
          clearTimeout(timer.current);const profile=await renderDocument(current);
          if(!await window.captraw.save({...current.image,adjustments:current.adjustments},profile))return;
        }catch(e){setError(String(e));return;}
      }
    }
    const remaining=docs.current.filter(d=>d.image.path!==target.image.path);
    const isActive=docs.current.find(d=>d.image.id===idRef.current)?.image.path===target.image.path;
    if(isActive){clearTimeout(timer.current);gesture.current=undefined;++revision.current;try{await window.captraw.close();}catch{}setFrame(undefined);setDetailFrame(undefined);idRef.current='';setActiveId('');setBusy(false);setError('');}
    setDocuments(remaining);
    if(isActive&&remaining.length)await switchDocument(remaining[Math.min(Math.max(0,docs.current.indexOf(target)),remaining.length-1)].image.id);
  }
  async function finish(){
    const doc=docs.current.find(d=>d.image.id===idRef.current);if(!doc)return;
    if(!await save())return;
    const current=docs.current.find(d=>d.image.path===doc.image.path);
    if(current&&JSON.stringify(current.adjustments)===JSON.stringify(doc.adjustments))await closeDocument(current.image.id,true);
  }
  async function exportImage(format: 'jpeg' | 'tiff') {
    try { const f = await flush();if (f) await window.captraw.export(f.doc.image.id, f.profile, format); } catch (e) { setError(String(e)); }
  }
  async function whiteBalance(request:WhiteBalanceRequest){
    if(loading.current||wbPending)return;setWbPending(true);setError('');
    try{
      const epoch=editEpoch.current;const f=await flush();if(!f)return;
      const result=await window.captraw.whiteBalance(f.doc.image.id,request);
      const current=docs.current.find(d=>d.image.id===idRef.current);
      if(editEpoch.current!==epoch||current?.image.id!==f.doc.image.id||JSON.stringify(current.adjustments)!==JSON.stringify(f.doc.adjustments)){setStatus('编辑已变化，请重新设置白平衡');return;}
      edit(a=>({...a,...result}));setStatus('白平衡已更新');
    }catch(e){setError(String(e));}finally{setWbPending(false);}
  }
  async function compare(before: boolean) {
    if(loading.current)return;
    const d = docs.current.find(d => d.image.id === idRef.current);if (!d) return;
    clearTimeout(timer.current);setBusy(true);
    try { if (before) await window.captraw.before(d.image.id, ++revision.current);else await renderDocument(d); } catch (e) { setError(String(e)); }
  }
  async function viewport(x: number,y: number,width: number,height: number) {
    if(loading.current)return;
    const d = docs.current.find(d => d.image.id === idRef.current);if (!d) return;
    try { await window.captraw.viewport(d.image.id, revision.current, x,y,width,height); } catch (e) { setError(String(e)); }
  }
  return { documents, active, frame, detailFrame, busy:busy||opening||wbPending,opening,wbPending,error,status,job,revision, setError,setMaskPreview,openPaths,switchDocument,closeDocument,finish,whiteBalance,edit,commit,undo,addMask,save,exportImage,compare,viewport,
    reset: () => { if (active) edit(() => copy(active.initial)); } };
}
