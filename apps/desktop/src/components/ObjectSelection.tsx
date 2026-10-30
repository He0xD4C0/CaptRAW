import {useEffect,useRef,useState} from 'react';
import type {ObjectMaskResult,ObjectCandidateResult,ObjectPrompt,Point,ObjectBox,PersonPart,PersonPartsResult,SemanticMaskPart,SemanticMasksResult,SkyMaskResult} from '@captraw/contracts';
import type {DocumentState} from '../hooks/workbench/model';
export function useObjectSelection(prepare:()=>Promise<{doc:DocumentState;profile:string}|undefined>,commit:(mask:ObjectMaskResult)=>void){
 const [active,setActive]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [prompts,setPrompts]=useState<ObjectPrompt[]>([]),[result,setResult]=useState<ObjectCandidateResult>(),[selected,setSelected]=useState(0);
 const [parts,setParts]=useState<PersonPartsResult>(),[selectedPart,setSelectedPart]=useState<PersonPart>('faceSkin');
 const [semantic,setSemantic]=useState<SemanticMasksResult>(),[selectedSemantic,setSelectedSemantic]=useState<SemanticMaskPart>('subject');
 const [sky,setSky]=useState<SkyMaskResult>();
 const [mode,setMode]=useState<'point'|'box'>('point'),[box,setBox]=useState<ObjectBox>(),[ready,setReady]=useState(false);
 const history=useRef<{prompts:ObjectPrompt[];box?:ObjectBox}[]>([]),latest=useRef<DocumentState|undefined>(undefined);
 const epoch=useRef(0),request=useRef(0),id=useRef<string|undefined>(undefined),snapshot=useRef<{session:string;adjustments:string;profileId:number}|undefined>(undefined);
 const cancel=()=>{++epoch.current;++request.current;const current=id.current;id.current=undefined;snapshot.current=undefined;setActive(false);setPending(false);setReady(false);setBox(undefined);history.current=[];setResult(undefined);setParts(undefined);setSemantic(undefined);setSky(undefined);setPrompts([]);void window.captraw.cancelObject(current).catch(()=>{});};
 useEffect(()=>window.captraw.onEvent(e=>{if(e.event==='object-progress'&&e.id===id.current)setMessage(e.message);}),[]);
 async function start(){
  const token=++epoch.current;setActive(true);setPending(true);setReady(false);setBox(undefined);history.current=[];setMode('point');setResult(undefined);setParts(undefined);setSemantic(undefined);setSky(undefined);setPrompts([]);setError('');setMessage('正在准备完整照片…');
  const current=latest.current;snapshot.current=current?{session:current.image.id,adjustments:JSON.stringify(current.adjustments),profileId:current.profileId}:undefined;
  try{const prepared=await prepare();if(token!==epoch.current)return;if(!prepared||latest.current?.image.id!==prepared.doc.image.id||latest.current.profileId!==prepared.doc.profileId||JSON.stringify(latest.current.adjustments)!==JSON.stringify(prepared.doc.adjustments))throw new Error('照片或编辑已变化，请重新选择对象。');const {doc,profile}=prepared;
   const input=await window.captraw.beginObject(doc.image.id,doc.adjustments,profile);
   if(token!==epoch.current){await window.captraw.cancelObject(input.id);return;}id.current=input.id;setReady(true);setMessage('点击对象添加选中点，按住 Option 点击排除。');
  }catch(e){if(token===epoch.current)setError(String(e));}finally{if(token===epoch.current)setPending(false);}
 }
 async function predict(next:ObjectPrompt[],nextBox?:ObjectBox,remember=true){
  if(!id.current)return;const token=epoch.current,revision=++request.current;
  if(remember)history.current.push(structuredClone({prompts,box}));
  setPrompts(next);setBox(nextBox);setResult(undefined);setParts(undefined);setSemantic(undefined);setSky(undefined);setError('');
  if(!next.length&&!nextBox){setPending(false);setMessage('点击或框选对象。');return;}
  setPending(true);setMessage('正在计算选区…');
  try{const value=await window.captraw.predictObject(id.current,next,nextBox);if(token!==epoch.current||revision!==request.current)return;setResult(value);setSelected(value.selected);setMessage('检查候选边界，必要时继续添加或排除。');}
  catch(e){if(token===epoch.current&&revision===request.current)setError(String(e));}finally{if(token===epoch.current&&revision===request.current)setPending(false);}
 }
 function pick(point:Point,exclude:boolean){if(!id.current)return;if(prompts.length+(box?2:0)>=64){setError('最多 64 个提示，请撤回或重新选择。');return;}if(!box&&!prompts.length&&exclude){setError('请先框选对象或添加选中点。');return;}void predict([...prompts,{point,exclude}],box);}
 function pickBox(start:Point,end:Point){if(!id.current)return;setMode('point');void predict([],{start:{x:Math.min(start.x,end.x),y:Math.min(start.y,end.y)},end:{x:Math.max(start.x,end.x),y:Math.max(start.y,end.y)}});}
 async function predictParts(part:PersonPart){
  if(!id.current)return;if(parts){setSelectedPart(part);setMessage('选择人物部位后创建蒙版。');return;}const token=epoch.current,revision=++request.current;setSelectedPart(part);setPending(true);setError('');setResult(undefined);setSemantic(undefined);setSky(undefined);setPrompts([]);setBox(undefined);setMessage('正在分析人物部位…');
  try{const value=await window.captraw.predictPersonParts(id.current);if(token!==epoch.current||revision!==request.current)return;setParts(value);setMessage('选择头发、皮肤、衣物或附件部位后创建蒙版。');}
  catch(e){if(token===epoch.current&&revision===request.current)setError(String(e));}
  finally{if(token===epoch.current&&revision===request.current)setPending(false);}
 }
 async function predictSemantic(part:SemanticMaskPart){
  if(!id.current)return;if(semantic){setSelectedSemantic(part);setSky(undefined);setMessage('选择主体或背景后创建蒙版。');return;}const token=epoch.current,revision=++request.current;setSelectedSemantic(part);setPending(true);setError('');setResult(undefined);setParts(undefined);setSky(undefined);setPrompts([]);setBox(undefined);setMessage('正在识别主体…');
  try{const value=await window.captraw.predictSemanticMasks(id.current);if(token!==epoch.current||revision!==request.current)return;setSemantic(value);setMessage('选择主体或背景后创建蒙版。');}
  catch(e){if(token===epoch.current&&revision===request.current)setError(String(e));}
  finally{if(token===epoch.current&&revision===request.current)setPending(false);}
 }
 async function predictSky(){
  if(!id.current)return;if(sky){setMessage('创建蒙版可在上方局部调整天空。');return;}const token=epoch.current,revision=++request.current;setPending(true);setError('');setResult(undefined);setParts(undefined);setSemantic(undefined);setSky(undefined);setPrompts([]);setBox(undefined);setMessage('正在识别天空…');
  try{const value=await window.captraw.predictSkyMask(id.current);if(token!==epoch.current||revision!==request.current)return;setSky(value);setMessage('检查天空边界，创建后可用画笔修正。');}
  catch(e){if(token===epoch.current&&revision===request.current)setError(String(e));}
  finally{if(token===epoch.current&&revision===request.current)setPending(false);}
 }
 function undo(){const previous=history.current.pop();if(previous)void predict(previous.prompts,previous.box,false);}
 async function apply(){if((!result&&!parts&&!semantic&&!sky)||pending)return;const token=epoch.current;setPending(true);setError('');
  try{const raster=sky?await window.captraw.commitSkyMask(sky.id,sky.revision):semantic?await window.captraw.commitSemanticMask(semantic.id,semantic.revision,selectedSemantic):parts?await window.captraw.commitPersonPart(parts.id,parts.revision,selectedPart):await window.captraw.commitObject(result!.id,result!.revision,selected);if(token!==epoch.current)return;id.current=undefined;snapshot.current=undefined;setActive(false);setResult(undefined);setParts(undefined);setSemantic(undefined);setSky(undefined);setPrompts([]);commit(raster);}
  catch(e){if(token===epoch.current)setError(String(e));}finally{if(token===epoch.current)setPending(false);}
 }
 const selectedPartResult=parts?.parts.find(item=>item.part===selectedPart),selectedSemanticResult=semantic?.parts.find(item=>item.part===selectedSemantic);
 return {mode,setMode,box,ready,pickBox,canUndo:history.current.length>0,active,pending,message,error,prompts,result,parts,semantic,sky,selected,selectedPart,selectedSemantic,chooseSemanticPart:setSelectedSemantic,predictParts,predictSemantic,predictSky,start,cancel,pick,apply,select:setSelected,undo,url:result?.candidates.find(c=>c.index===selected)?.url??selectedPartResult?.url??selectedSemanticResult?.url??sky?.url,partUrl:selectedPartResult?.url,semanticUrl:selectedSemanticResult?.url,skyUrl:sky?.url,canApply:sky?sky.pixels>0:semantic?!!selectedSemanticResult?.pixels:parts?!!selectedPartResult?.pixels:!!result?.candidates.find(c=>c.index===selected)?.pixels,check:(doc?:DocumentState)=>{latest.current=doc;const s=snapshot.current;if(active&&!doc){cancel();return;}if(s&&(!doc||doc.image.id!==s.session||doc.profileId!==s.profileId||JSON.stringify(doc.adjustments)!==s.adjustments))cancel();}};
}
export function ObjectSelectionPanel({selection:s}:{selection:ReturnType<typeof useObjectSelection>}){
 return <section className="panel-section object-selection" aria-label="对象选择"><div className="section-heading"><span>选择对象</span><button onClick={s.cancel}>取消</button></div>
  <div className="mask-management" role="group" aria-label="对象选择方式"><button aria-pressed={s.mode==='point'} disabled={!s.ready} onClick={()=>s.setMode('point')}>点选</button><button aria-pressed={s.mode==='box'} disabled={!s.ready} onClick={()=>s.setMode('box')}>框选</button></div>
  <div className="semantic-masks" role="group" aria-label="自动语义蒙版"><button disabled={!s.ready||s.pending} aria-pressed={!s.sky&&s.selectedSemantic==='subject'} onClick={()=>void s.predictSemantic('subject')}>自动主体</button><button disabled={!s.ready||s.pending} aria-pressed={!s.sky&&s.selectedSemantic==='background'} onClick={()=>void s.predictSemantic('background')}>自动背景</button><button disabled={!s.ready||s.pending} aria-pressed={!!s.sky} onClick={()=>void s.predictSky()}>自动天空</button></div>
  <div className="person-parts" role="group" aria-label="人物部位"><button disabled={!s.ready||s.pending} aria-pressed={s.selectedPart==='faceSkin'} onClick={()=>void s.predictParts('faceSkin')}>面部皮肤</button><button disabled={!s.ready||s.pending} aria-pressed={s.selectedPart==='bodySkin'} onClick={()=>void s.predictParts('bodySkin')}>身体皮肤</button><button disabled={!s.ready||s.pending} aria-pressed={s.selectedPart==='hair'} onClick={()=>void s.predictParts('hair')}>头发</button><button disabled={!s.ready||s.pending} aria-pressed={s.selectedPart==='clothes'} onClick={()=>void s.predictParts('clothes')}>衣物</button><button disabled={!s.ready||s.pending} aria-pressed={s.selectedPart==='accessories'} onClick={()=>void s.predictParts('accessories')}>附件</button></div>
  <p role="status">{s.message}</p><p className="hint">{s.mode==='box'?'拖动框住对象；松开后可用点提示修正。':'单击添加 · Option 单击排除 · 空格平移'}</p>
  <div className="object-candidates">{s.result?.candidates.map(c=><button key={c.index} aria-label={`候选 ${c.index+1}`} aria-pressed={s.selected===c.index} disabled={s.pending||!c.pixels} onClick={()=>s.select(c.index)}><img src={c.url} alt=""/>候选 {c.index+1}{!c.pixels?'（空）':''}</button>)}</div>
  {s.partUrl&&<div className="person-part-preview"><img src={s.partUrl} alt={`${s.selectedPart} 蒙版预览`}/><span>{s.parts?.parts.find(item=>item.part===s.selectedPart)?.pixels.toLocaleString()} 像素</span></div>}
  {s.semanticUrl&&<div className="person-part-preview"><img src={s.semanticUrl} alt={`${s.selectedSemantic??'subject'} 蒙版预览`}/><span>{s.semantic?.parts.find(item=>item.part===s.selectedSemantic)?.pixels.toLocaleString()} 像素</span></div>}
  {s.skyUrl&&<div className="person-part-preview"><img src={s.skyUrl} alt="天空蒙版预览"/><span>{s.sky?.pixels.toLocaleString()} 像素</span></div>}
  <div className="mask-management"><button disabled={!s.canUndo||s.pending} onClick={s.undo}>撤回提示</button><button className="primary" disabled={s.pending||!s.canApply} onClick={()=>void s.apply()}>创建蒙版</button></div>
  {s.error&&<p role="alert">{s.error}</p>}
 </section>;
}
