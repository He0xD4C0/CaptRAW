import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {NativeEngine} from './engine.js';
import {Segmenter,type SegmentationResult,type PersonPartsSegmentationResult,type SemanticMasksSegmentationResult,type SkyMaskSegmentationResult} from './segmentation.js';
import type {Adjustments,ImageSession,ObjectMaskResult,ObjectCandidateResult,ObjectPrompt,ObjectBox,PersonPart,PersonPartsResult,SemanticMaskPart,SemanticMasksResult,SkyMaskResult} from '@captraw/contracts';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const aborted=()=>new Error('对象选择已取消，请重新选择。');
type Selection={id:string;sessionId:string;key:string;directory:string;rotation:number;referenceAngle:number;worker?:NativeEngine;closed?:Promise<void>;input?:{path:string;imageSha256:string;width:number;height:number};result?:SegmentationResult;parts?:PersonPartsSegmentationResult;semantic?:SemanticMasksSegmentationResult;sky?:SkyMaskSegmentationResult;revision:number;pending:boolean};
const selectionKey=(adjustments:Adjustments,artProfile:string)=>JSON.stringify([adjustments,artProfile]);
export class ObjectSelection {
 private generation=0;private starting=false;private current?:Selection;private sequence=0;private closing:Promise<unknown>=Promise.resolve();
 readonly previews=new Map<string,string>();
 private segmenter:Segmenter;
 constructor(private binary:string,private resources:string,segmentBinary:string,models:string,private cache:string,private progress:(id:string,message:string)=>void){
  this.segmenter=new Segmenter(segmentBinary,models,join(cache,'segmenter'),s=>{const c=this.current;if(c&&s.sessionId===c.id)this.progress(c.id,{prepare:'正在准备图像…',encode:'正在分析照片…',decode:'正在计算选区…',write:'正在生成候选…'}[s.stage]);});
 }
 invalidate(sessionId:string,adjustments:Adjustments,artProfile:string){const c=this.current;if(c&&(c.sessionId!==sessionId||c.key!==selectionKey(adjustments,artProfile)))void this.cancel(c.id);}
 async begin(image:ImageSession,adjustments:Adjustments,artProfile:string){
  if(this.starting)throw new Error('上一对象快照正在退出，请稍后重试。');this.starting=true;
  try{const cancelled=this.cancel(),generation=this.generation;await cancelled;await this.closing;if(generation!==this.generation)throw aborted();}catch(error){this.starting=false;throw error;}
  const c:Selection={id:randomUUID(),sessionId:image.id,key:selectionKey(adjustments,artProfile),directory:'',rotation:adjustments.rotation,referenceAngle:0,revision:0,pending:true};this.current=c;
  const check=()=>{if(this.current!==c)throw aborted();};
  try{
   await mkdir(join(this.cache,'objects'),{recursive:true});check();c.directory=await mkdtemp(join(this.cache,'objects','selection-'));check();
   const worker=new NativeEngine(this.binary,this.resources,join(c.directory,'render'));c.worker=worker;c.closed=new Promise<void>(done=>worker.child.once('close',()=>done()));
   this.progress(c.id,'正在准备完整照片…');await worker.call('open',{path:image.path,sessionId:c.id});check();
   let listener:(message:any)=>void=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
   const preview=new Promise<any>((accept,reject)=>{listener=m=>{if(m.event==='preview'&&m.frame.sessionId===c.id&&m.frame.revision===1&&m.frame.kind==='fit')accept(m.frame);else if(m.event==='error')reject(new Error(m.message));};worker.on('engine-event',listener);timer=setTimeout(()=>reject(new Error('对象选择的显影快照超时。')),120000);});
   let frame,applied;try{[applied,frame]=await Promise.all([worker.call('update',{revision:1,adjustments:{...structuredClone(adjustments),crop:null},artProfile}),preview]);}finally{worker.off('engine-event',listener);clearTimeout(timer);}
   if(!applied.geometry||applied.geometry.rotation!==c.rotation||!Number.isFinite(applied.geometry.angle)||Math.abs(applied.geometry.angle)>45)
    throw new Error('无法确认对象快照的几何参数，请重新准备照片。');
   c.referenceAngle=applied.geometry.angle;
   check();if(!resolve(frame.file).startsWith(join(c.directory,'render')+'/'))throw new Error('无效的对象选择快照。');
   const bytes=await readFile(frame.file),path=join(c.directory,'input.png');await writeFile(path,bytes,{flag:'wx'});check();
   c.input={path,imageSha256:sha(bytes),width:frame.width,height:frame.height};c.pending=false;
   return {id:c.id,width:frame.width,height:frame.height};
  }catch(error){if(this.current===c)await this.cancel(c.id);throw error;}
  finally{c.worker?.terminate();await c.closed;if(c.directory)await rm(this.current===c?join(c.directory,'render'):c.directory,{recursive:true,force:true});this.starting=false;}
 }
 private selection(id:string){const c=this.current;if(!c||c.id!==id||!c.input)throw aborted();return c;}
 async predict(id:string,prompts:ObjectPrompt[],box?:ObjectBox):Promise<ObjectCandidateResult>{
  const c=this.selection(id),validPoint=(p:unknown):p is {x:number;y:number}=>!!p&&typeof p==='object'&&['x','y'].every(k=>{const n=(p as Record<string,unknown>)[k];return typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;});
  if(!Array.isArray(prompts)||prompts.length+(box?2:0)>64)throw new Error('最多 64 个提示，框选占两个。');
  for(const p of prompts)if(!p||typeof p.exclude!=='boolean'||!validPoint(p.point))throw new Error('对象选择提示无效。');
  if(!box&&!prompts.some(p=>!p.exclude))throw new Error('请先框选对象或添加选中点。');
  const oriented=(p:{x:number;y:number})=>c.rotation===90?{x:1-p.y,y:p.x}:c.rotation===180?{x:1-p.x,y:1-p.y}:c.rotation===270?{x:p.y,y:1-p.x}:p;
  const pixel=(p:{x:number;y:number}):[number,number]=>[Math.max(0,Math.min(c.input!.width-1,p.x*c.input!.width-.5)),Math.max(0,Math.min(c.input!.height-1,p.y*c.input!.height-.5))];
  const points:[number,number][]=[],labels:number[]=[];
  if(box){
   if(!validPoint(box.start)||!validPoint(box.end))throw new Error('对象框选范围无效。');
   const first=oriented(box.start),last=oriented(box.end);
   const start=pixel({x:Math.min(first.x,last.x),y:Math.min(first.y,last.y)}),end=pixel({x:Math.max(first.x,last.x),y:Math.max(first.y,last.y)});
   if(end[0]-start[0]<1||end[1]-start[1]<1)throw new Error('框选范围太小，请拖出一个完整对象。');
   points.push(start,end);labels.push(2,3);
  }
  for(const p of prompts){points.push(pixel(oriented(p.point)));labels.push(p.exclude?0:1);}
  const revision=++this.sequence;c.revision=revision;c.pending=true;this.previews.clear();
  try{
   c.parts=undefined;c.semantic=undefined;c.sky=undefined;
   const result=await this.segmenter.request({sessionId:id,revision,...c.input!,points,labels,outputRotation:c.rotation});
   if(this.current!==c||c.revision!==revision)throw aborted();c.result=result;
   return {id,revision,selected:result.selected,candidates:result.candidates.map(item=>{const key=`object/${id}/${revision}-${item.index}.png`;this.previews.set(key,item.file);return {index:item.index,pixels:item.pixels,url:`captraw://preview/${key}`};})};
  }finally{if(c.revision===revision)c.pending=false;}
 }
 async predictPersonParts(id:string):Promise<PersonPartsResult>{
  const c=this.selection(id),revision=++this.sequence;c.revision=revision;c.pending=true;c.result=undefined;c.parts=undefined;c.semantic=undefined;c.sky=undefined;this.previews.clear();
  try{
   const result=await this.segmenter.requestParts({sessionId:id,revision,...c.input!,outputRotation:c.rotation});
   if(this.current!==c||c.revision!==revision)throw aborted();c.parts=result;
   return {id,revision,parts:result.parts.map(item=>{const key=`person/${id}/${revision}-${item.part}.png`;this.previews.set(key,item.file);return {part:item.part,classIndex:item.classIndex,pixels:item.pixels,url:`captraw://preview/${key}`};})};
  }finally{if(c.revision===revision)c.pending=false;}
 }
 async predictSemanticMasks(id:string):Promise<SemanticMasksResult>{
  const c=this.selection(id),revision=++this.sequence;c.revision=revision;c.pending=true;c.result=undefined;c.parts=undefined;c.semantic=undefined;c.sky=undefined;this.previews.clear();
  try{
   const result=await this.segmenter.requestSemanticMasks({sessionId:id,revision,...c.input!,outputRotation:c.rotation});
   if(this.current!==c||c.revision!==revision)throw aborted();c.semantic=result;
   return {id,revision,parts:result.parts.map(item=>{const key=`semantic/${id}/${revision}-${item.part}.png`;this.previews.set(key,item.file);return {part:item.part,classIndex:item.classIndex,pixels:item.pixels,url:`captraw://preview/${key}`};})};
  }finally{if(c.revision===revision)c.pending=false;}
 }
 async predictSkyMask(id:string):Promise<SkyMaskResult>{
  const c=this.selection(id),revision=++this.sequence;c.revision=revision;c.pending=true;c.result=undefined;c.parts=undefined;c.semantic=undefined;c.sky=undefined;this.previews.clear();
  try{
   const result=await this.segmenter.requestSky({sessionId:id,revision,...c.input!,outputRotation:c.rotation});
   if(this.current!==c||c.revision!==revision)throw aborted();c.sky=result;
   const key=`sky/${id}/${revision}.png`;this.previews.set(key,result.file);
   return {id,revision,pixels:result.pixels,url:`captraw://preview/${key}`};
  }finally{if(c.revision===revision)c.pending=false;}
 }
 async commit(id:string,revision:number,index:number):Promise<ObjectMaskResult>{
  const c=this.selection(id),r=c.result;if(c.pending||!r||r.revision!==revision)throw new Error('请等待最新选区计算完成。');
  const candidate=r.candidates.find(item=>item.index===index);if(!candidate||!candidate.pixels)throw new Error('选区为空，请重新选择对象。');
  const bytes=await readFile(candidate.file);if(sha(bytes)!==candidate.sha256)throw new Error('对象选区文件已改变，请重新计算。');
  if(this.current!==c||c.revision!==revision)throw aborted();
  const directory=join(this.cache,'document-assets');await mkdir(directory,{recursive:true});const path=join(directory,`${candidate.sha256}.png`);
  // Never overwrite an existing document asset, even on a failed commit.
  try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||sha(await readFile(path))!==candidate.sha256)throw error;}
  if(this.current!==c||c.revision!==revision)throw aborted();
  const raster={path,sha256:candidate.sha256,width:r.maskWidth,height:r.maskHeight};
  const result={raster,referenceAngle:c.referenceAngle};await this.cancel(id);return result;
 }
 async commitSemanticMask(id:string,revision:number,part:SemanticMaskPart):Promise<ObjectMaskResult>{
  const c=this.selection(id),r=c.semantic;if(c.pending||!r||r.revision!==revision)throw new Error('请等待最新自动主体蒙版计算完成。');
  const candidate=r.parts.find(item=>item.part===part);if(!candidate||!candidate.pixels)throw new Error('自动主体蒙版为空，请选择另一个结果。');
  const bytes=await readFile(candidate.file);if(sha(bytes)!==candidate.sha256)throw new Error('自动主体蒙版文件已改变，请重新计算。');
  if(this.current!==c||c.revision!==revision)throw aborted();
  const directory=join(this.cache,'document-assets');await mkdir(directory,{recursive:true});const path=join(directory,`${candidate.sha256}.png`);
  try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||sha(await readFile(path))!==candidate.sha256)throw error;}
  if(this.current!==c||c.revision!==revision)throw aborted();
  const raster={path,sha256:candidate.sha256,width:r.maskWidth,height:r.maskHeight};
  const result={raster,referenceAngle:c.referenceAngle};await this.cancel(id);return result;
 }
 async commitPersonPart(id:string,revision:number,part:PersonPart):Promise<ObjectMaskResult>{
  const c=this.selection(id),r=c.parts;if(c.pending||!r||r.revision!==revision)throw new Error('请等待最新人物部位计算完成。');
  const candidate=r.parts.find(item=>item.part===part);if(!candidate||!candidate.pixels)throw new Error('人物部位为空，请换用其他部位。');
  const bytes=await readFile(candidate.file);if(sha(bytes)!==candidate.sha256)throw new Error('人物部位文件已改变，请重新计算。');
  if(this.current!==c||c.revision!==revision)throw aborted();
  const directory=join(this.cache,'document-assets');await mkdir(directory,{recursive:true});const path=join(directory,`${candidate.sha256}.png`);
  try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||sha(await readFile(path))!==candidate.sha256)throw error;}
  if(this.current!==c||c.revision!==revision)throw aborted();
  const raster={path,sha256:candidate.sha256,width:r.maskWidth,height:r.maskHeight};
  const result={raster,referenceAngle:c.referenceAngle};await this.cancel(id);return result;
 }
 async commitSkyMask(id:string,revision:number):Promise<ObjectMaskResult>{
  const c=this.selection(id),r=c.sky;if(c.pending||!r||r.revision!==revision)throw new Error('请等待最新自动天空计算完成。');
  if(!r.pixels)throw new Error('自动天空蒙版为空，请改用点选或框选。');
  const bytes=await readFile(r.file);if(sha(bytes)!==r.sha256)throw new Error('自动天空蒙版文件已改变，请重新计算。');
  if(this.current!==c||c.revision!==revision)throw aborted();
  const directory=join(this.cache,'document-assets');await mkdir(directory,{recursive:true});const path=join(directory,`${r.sha256}.png`);
  try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||sha(await readFile(path))!==r.sha256)throw error;}
  if(this.current!==c||c.revision!==revision)throw aborted();
  const raster={path,sha256:r.sha256,width:r.maskWidth,height:r.maskHeight};
  const result={raster,referenceAngle:c.referenceAngle};await this.cancel(id);return result;
 }
 cancel(id?:string):Promise<void>{
  if(id&&this.current?.id!==id)return Promise.resolve();
  ++this.generation;const c=this.current;this.current=undefined;this.previews.clear();c?.worker?.terminate();
  const previous=this.closing;
  const task=(async()=>{await previous;await this.segmenter.cancel();await c?.closed;if(c?.directory)await rm(c.directory,{recursive:true,force:true});})();this.closing=task.catch(()=>{});return task;
 }
 shutdown(){++this.generation;this.current?.worker?.terminate();this.current=undefined;void this.segmenter.dispose();}
}
