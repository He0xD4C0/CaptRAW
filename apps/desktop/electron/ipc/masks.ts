import type {IpcMain} from 'electron';
import {verifySourceIdentity} from '@captraw/desktop-core/engine';
import type {BrushPrepareRequest} from '@captraw/contracts';
import type {MainRuntime} from './context.js';

export function registerMasksIpc(ipc:IpcMain,runtime:MainRuntime){
  ipc.handle('object:begin',(_,p)=>runtime.objects.begin(runtime.requireSession(p.sessionId),p.adjustments,p.artProfile));
  ipc.handle('object:predict',(_,p)=>runtime.objects.predict(p.id,p.prompts,p.box));
  ipc.handle('object:parts',(_,id)=>runtime.objects.predictPersonParts(id));
  ipc.handle('object:semantic',(_,id)=>runtime.objects.predictSemanticMasks(id));
  ipc.handle('object:sky',(_,id)=>runtime.objects.predictSkyMask(id));
  ipc.handle('object:commit',(_,p)=>runtime.objects.commit(p.id,p.revision,p.index));
  ipc.handle('object:commit-part',(_,p)=>runtime.objects.commitPersonPart(p.id,p.revision,p.part));
  ipc.handle('object:commit-semantic',(_,p)=>runtime.objects.commitSemanticMask(p.id,p.revision,p.part));
  ipc.handle('object:commit-sky',(_,p)=>runtime.objects.commitSkyMask(p.id,p.revision));
  ipc.handle('object:cancel',(_,id)=>runtime.objects.cancel(id));
  ipc.handle('brush:prepare',async(_,request:BrushPrepareRequest)=>{
    const image=runtime.requireSession(request.sessionId),snapshot=runtime.brushSnapshot;
    if(!snapshot||snapshot.sessionId!==image.id||snapshot.revision!==request.revision)throw new Error('照片已更新，请重新绘制画笔。');
    const check=async()=>{runtime.requireSession(image.id);if(runtime.brushSnapshot!==snapshot)throw new Error('照片已更新，请重新绘制画笔。');};
    await verifySourceIdentity(image.path,image.sourceIdentity);await check();
    return runtime.brushes.prepare(image,request,snapshot.adjustments,snapshot.artProfile,check,async()=>{await verifySourceIdentity(image.path,image.sourceIdentity);await check();});
  });
  ipc.handle('brush:cancel',(_,id)=>runtime.brushes.cancel(id));
}
