import type {IpcMain} from 'electron';
import {basename,join,resolve} from 'node:path';
import {rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativeEngine,isContainedFile,verifySourceIdentity} from '@captraw/desktop-core/engine';
import {sourceFrameOpenSnapshot} from '@captraw/contracts';
import type {MainRuntime} from './context.js';

export function registerComparisonIpc(ipc:IpcMain,runtime:MainRuntime){
  ipc.handle('comparison:update',async(_,p)=>{
    const current=runtime.requireSession(p.sessionId);runtime.stopComparison();if(!p.settings)return;
    const sequence=runtime.comparisonSequence,directory=join(runtime.cache,'comparison-'+randomUUID()),worker=new NativeEngine(runtime.binary,runtime.resources,directory),displayed=new Map<string,string[]>();runtime.comparisonEngine=worker;
    worker.child.once('close',()=>{void rm(directory,{recursive:true,force:true}).catch(()=>{});});
    worker.on('engine-event',async message=>{
      if(worker!==runtime.comparisonEngine||current.id!==runtime.session?.id)return;
      if(message.event==='preview'){
        try{await verifySourceIdentity(current.path,current.sourceIdentity);}
        catch(error){
          if(worker===runtime.comparisonEngine&&current.id===runtime.session?.id){runtime.stopComparison();runtime.send({event:'comparison-error',sessionId:current.id,revision:p.revision,message:error instanceof Error?error.message:String(error)});}
          return;
        }
        if(worker!==runtime.comparisonEngine||current.id!==runtime.session?.id)return;
        const frame=message.frame,file=resolve(frame.file);if(!isContainedFile(runtime.cache,file))return;
        const key=`comparison/${sequence}/${basename(file)}`;runtime.comparisonFrames.set(key,file);
        const registered=[key];
        let linear=null;
        if(frame.linear?.file&&isContainedFile(directory,resolve(frame.linear.file))){
          const linearKey=`comparison/${sequence}/${basename(frame.linear.file)}`;runtime.comparisonFrames.set(linearKey,resolve(frame.linear.file));linear={...frame.linear,url:`captraw://preview/${linearKey}`};
          registered.push(linearKey);
        }
        runtime.send({event:'comparison-preview',frame:{...frame,linear,url:`captraw://preview/${key}`}});
        displayed.set(frame.kind,registered);const pinned=new Set([...displayed.values()].flat());
        for(const [key,path] of [...runtime.comparisonFrames].slice(0,linear?-8:-4))if(!pinned.has(key)){runtime.comparisonFrames.delete(key);void rm(path,{force:true}).catch(()=>{});}
      }else if(message.event==='error')runtime.send({event:'comparison-error',sessionId:current.id,revision:p.revision,message:message.message});
    });
    try{
      await worker.ready;
      await verifySourceIdentity(current.path,current.sourceIdentity);
      if(worker!==runtime.comparisonEngine||current.id!==runtime.session?.id)return;
      await worker.call('open',{path:current.path,sessionId:current.id,...sourceFrameOpenSnapshot(p.settings.adjustments,p.settings.artProfile,current.sourceFrame)});
      await verifySourceIdentity(current.path,current.sourceIdentity);
      if(worker!==runtime.comparisonEngine||current.id!==runtime.session?.id)return;
      const {rotation,flipHorizontal,flipVertical,fineRotation,perspective,crop,lensCorrections,lensProfile,lensManualDistortion}=p.settings.geometry;
      await worker.call('update',{revision:p.revision,artProfile:p.settings.artProfile,linearPreview:!!p.linearPreview,monitorPreview:p.monitorSpace??'display-p3',adjustments:{...p.settings.adjustments,rotation,flipHorizontal,flipVertical,fineRotation,perspective,crop,lensCorrections,lensProfile,lensManualDistortion}});
    }catch(error){if(worker===runtime.comparisonEngine){runtime.stopComparison();throw error;}}
  });
  ipc.handle('comparison:viewport',async(_,p)=>{runtime.requireSession(p.sessionId);const worker=runtime.comparisonEngine;if(worker)await worker.call('viewport',p);});
}
