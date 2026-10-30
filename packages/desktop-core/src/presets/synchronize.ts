import {join,basename,resolve,relative,isAbsolute} from 'node:path';
import {mkdir,rm,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativeEngine} from '../engine/engine.js';
import {prepareSourceIdentities,verifySourceIdentity} from '../engine/source-identity.js';
import {autoTone,validateWhiteBalanceTarget,sourceFrameOpenSnapshot,type EffectiveGeometry,type PerspectiveSettings} from '@captraw/contracts';
import {applyEditCommand,validateEditCommand,synchronizedAdjustments,type SyncRequest,type SyncResult} from '@captraw/contracts/synchronize';

// One isolated processor prepares the whole transaction; the renderer commits only on success.
export class Synchronizer {
 private worker?:NativeEngine;private cancelled=false;private active=false;private directory='';
 readonly previews=new Map<string,string>();
 constructor(private binary:string,private resources:string,private cache:string,private progress:(message:string)=>void){}
 get running(){return this.active;}
 cancel(){this.cancelled=true;this.worker?.terminate();}
 async run(request:SyncRequest):Promise<SyncResult[]|null>{
  if(this.active)throw new Error('已有同步任务正在运行。');
  request=structuredClone(request);
  if(!request?.source?.image?.path||!Array.isArray(request.targets)||!request.targets.length||new Set(request.targets.map(d=>d.image.path)).size!==request.targets.length)throw new Error('请选择要同步的照片。');
  if(request.targets.some(doc=>doc.image.path===request.source.image.path))throw new Error('来源照片不能同时作为同步目标。');
  if(request.commands&&(!Array.isArray(request.commands)||request.commands.length!==request.targets.length||new Set(request.commands.map(c=>c.path)).size!==request.targets.length||request.commands.some(c=>!request.targets.some(d=>d.image.path===c.path))))throw new Error('逐图编辑目标与照片快照不一致。');
  if(request.recompute&&!['whiteBalance','autoTone','autoPerspective'].includes(request.recompute.type))throw new Error('逐图计算方式无效。');
  const commandFor=(doc:SyncRequest['source'])=>request.command||request.commands?.find(c=>c.path===doc.image.path);
  const needsFill=(doc:SyncRequest['source'])=>!!commandFor(doc)?.merge?.perspective?.manualModel&&!doc.adjustments.perspective?.manualModel;
  const geometry=new Map<string,Pick<EffectiveGeometry,'effectiveFill'>>();
  const perspective=new Map<string,PerspectiveSettings>();
  // Validate every determinable range before source IO or worker creation.
  for(const doc of request.targets){const command=commandFor(doc);if(command){validateWhiteBalanceTarget(command.set,doc.image.inputKind);validateEditCommand(doc.adjustments,command);}}
  const adjustments=(source:SyncRequest['source'],doc:SyncRequest['source'])=>{const command=commandFor(doc),base=perspective.has(doc.image.path)?{...doc.adjustments,perspective:perspective.get(doc.image.path)!}:doc.adjustments;return command?needsFill(doc)&&!geometry.has(doc.image.path)?structuredClone(doc.adjustments):applyEditCommand(base,command,geometry.get(doc.image.path)):request.recompute?structuredClone(doc.adjustments):synchronizedAdjustments(source,doc,request.groups);};
  let targets=request.targets.map(doc=>({...doc,adjustments:adjustments(request.source,doc)}))
   .filter((doc,i)=>needsFill(request.targets[i])||!!request.recompute||JSON.stringify(doc.adjustments)!==JSON.stringify(request.targets[i].adjustments));
  const bindMasks=!request.command&&!request.commands&&!request.recompute&&request.groups.includes('masks')&&request.source.adjustments.masks.length>0;
  if(!targets.length&&!bindMasks)return [];
  this.active=true;this.cancelled=false;const results:SyncResult[]=[];let completed=false;
  try{
   this.previews.clear();if(this.directory)await rm(this.directory,{recursive:true,force:true});
   this.directory=join(this.cache,`sync-${randomUUID()}`);await mkdir(this.directory,{recursive:true});
   const identities=await prepareSourceIdentities([
    ...(bindMasks?[{path:request.source.image.path,sourceIdentity:request.source.image.sourceIdentity}]:[]),
    ...request.targets.map(target=>({path:target.image.path,sourceIdentity:target.image.sourceIdentity}))
   ],()=>this.cancelled);
   if(this.cancelled)return null;
   for(const identity of identities.values())if(identity instanceof Error)throw identity;
   const worker=new NativeEngine(this.binary,this.resources,join(this.directory,'engine'));this.worker=worker;
   try{await worker.ready;}catch(error){if(this.cancelled)return null;throw error;}
   if(this.cancelled)return null;
   for(const doc of request.targets.filter(needsFill)){
    let checked;try{checked=await worker.call('validate',{artProfile:doc.profile,adjustments:doc.adjustments});}catch(error){if(this.cancelled)return null;throw error;}
    if(this.cancelled)return null;
    if(typeof checked.geometry?.effectiveFill!=='boolean')throw new Error(`${doc.image.name}：无法读取旧透视填满配置（自动填充）；本次联动未应用，请先明确升级或单张调整。`);
    geometry.set(doc.image.path,{effectiveFill:checked.geometry.effectiveFill});
    perspective.set(doc.image.path,checked.perspective);
   }
   let source=request.source;
   if(bindMasks){
    let checked;try{checked=await worker.call('validate',{artProfile:source.profile,adjustments:source.adjustments,sourceFrame:source.image.sourceFrame,sourcePath:source.image.path,sourceIdentity:identities.get(source.image.path),bindSourceFrame:true});}
    catch(error){if(this.cancelled)return null;throw error;}
    if(this.cancelled)return null;
    source={...source,adjustments:{...source.adjustments,masks:checked.masks}};
   }
   targets=request.targets.map(doc=>({...doc,adjustments:adjustments(source,doc)}))
    .filter((doc,i)=>!!request.recompute||JSON.stringify(doc.adjustments)!==JSON.stringify(request.targets[i].adjustments));
   for(const [i,target] of targets.entries()){
    this.progress(`正在同步 ${i+1}/${targets.length} · ${target.image.name}`);
    try{
     const identity=identities.get(target.image.path)!;
     if(identity instanceof Error)throw identity;
     await verifySourceIdentity(target.image.path,identity);
     if(this.cancelled)return null;
     const sessionId=randomUUID(),image=await worker.call('open',{path:target.image.path,sessionId,...sourceFrameOpenSnapshot(target.adjustments,target.profile,target.image.sourceFrame)});
     const command=request.command||request.commands?.find(c=>c.path===target.image.path);
     if(bindMasks||command?.set.masks!==undefined){
      const checked=await worker.call('validate',{artProfile:target.profile,adjustments:target.adjustments,sourceFrame:image.sourceFrame,sourcePath:target.image.path,sourceIdentity:identity,bindSourceFrame:true});
      target.adjustments={...target.adjustments,masks:checked.masks};
     }
     const render=async(revision:number,profile:string)=>{
      let listener:(message:any)=>void=()=>{},timeout:ReturnType<typeof setTimeout>|undefined;
      const preview=new Promise<any>((accept,reject)=>{listener=message=>{if(message.event==='preview'&&message.frame.sessionId===sessionId&&message.frame.revision===revision&&message.frame.kind==='fit')accept(message.frame);else if(message.event==='error')reject(new Error(message.message));};worker.on('engine-event',listener);timeout=setTimeout(()=>reject(new Error('照片预览超时，请重试。')),120000);});
      try{return await Promise.all([worker.call('update',{revision,adjustments:target.adjustments,artProfile:profile}),preview]);}finally{worker.off('engine-event',listener);clearTimeout(timeout);}
     };
     let [result,frame]=await render(1,target.profile);
     const recompute=request.recompute;
     if(recompute){
      if(recompute.type==='whiteBalance'){
       const intent=structuredClone(recompute.request);
       if(intent.mode==='profile')intent.colorProfile=target.adjustments.colorProfile!;
       if(intent.mode==='preset'){
        const preset=image.whiteBalancePresets?.find((p:{name:string})=>p.name===recompute.presetName);
        if(!preset)throw new Error('此相机没有所选白平衡预设。');intent.preset=preset.id;
       }
       target.adjustments={...target.adjustments,...await worker.call('whiteBalance',intent)};
      }else if(recompute.type==='autoTone')target.adjustments=autoTone(target.adjustments,frame.histogram);
      else target.adjustments={...target.adjustments,perspective:await worker.call('autoPerspective',{sessionId,revision:1,direction:recompute.direction})};
      if(this.cancelled)return null;
      [result,frame]=await render(2,result.artProfile);
     }
     if(this.cancelled)return null;
     await verifySourceIdentity(target.image.path,identity);
     if(request.recompute&&JSON.stringify(target.adjustments)===JSON.stringify(request.targets.find(d=>d.image.path===target.image.path)!.adjustments))continue;
     const previewPath=relative(join(this.directory,'engine'),resolve(frame.file));
     if(isAbsolute(previewPath)||previewPath==='..'||previewPath.startsWith('../')||previewPath.startsWith('..\\'))throw new Error('无效的同步预览。');
     const key=`sync/${randomUUID()}.png`,file=join(this.directory,basename(key));await copyFile(frame.file,file);this.previews.set(key,file);
     const preview=`captraw://preview/${key}`;
     const {file:_file,...metadata}=frame;
     results.push({path:target.image.path,adjustments:target.adjustments,profile:result.artProfile,preview,frame:{...metadata,url:preview}});
    }catch(error){if(this.cancelled)return null;throw new Error(`${target.image.name}：${error instanceof Error?error.message:String(error)}`);}
   }
   for(const target of targets){
    if(this.cancelled)return null;
    const identity=identities.get(target.image.path)!;if(identity instanceof Error)throw identity;
    await verifySourceIdentity(target.image.path,identity);
   }
   if(this.cancelled)return null;
   if(bindMasks){const identity=identities.get(request.source.image.path)!;if(identity instanceof Error)throw identity;await verifySourceIdentity(request.source.image.path,identity);}
   completed=true;return results;
  }finally{
   const worker=this.worker;
   if(worker){const stopped=worker.child.exitCode!==null||worker.child.signalCode!==null||!worker.child.pid?Promise.resolve():new Promise<void>(accept=>worker.child.once('exit',()=>accept()));worker.terminate();await stopped;}
   this.worker=undefined;
   try{await rm(join(this.directory,'engine'),{recursive:true,force:true});if(this.cancelled||!completed){this.previews.clear();await rm(this.directory,{recursive:true,force:true});}}finally{this.active=false;}
  }
 }
}
