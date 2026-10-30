import type {App,IpcMain} from 'electron';
import {CurveSampling} from '@captraw/desktop-core/editing';
import {verifySourceIdentity} from '@captraw/desktop-core/engine';
import {OUTPUT_COLOR_SPACES} from '@captraw/contracts';
import type {MainRuntime} from './context.js';

export function registerImagesIpc(ipc:IpcMain,app:App,runtime:MainRuntime){
  ipc.handle('images:synchronize',(_,request)=>runtime.synchronizer.run(request));
  ipc.handle('images:synchronize-cancel',()=>{runtime.presets.cancel();runtime.synchronizer.cancel();});
  ipc.handle('curve:parametric',async(_,settings)=>runtime.native().call('parametricCurve',settings));
  ipc.handle('image:update',async(_,p)=>{runtime.requireSession(p.sessionId);runtime.brushSnapshot=undefined;await runtime.curveSampling?.cancel();runtime.brushes.adopt(p.adjustments);await runtime.brushes.invalidate();runtime.objects.invalidate(p.sessionId,p.adjustments,p.artProfile||'');const result=await runtime.native().call('update',{...p,monitorPreview:p.monitorPreview??'display-p3'});runtime.brushSnapshot={sessionId:p.sessionId,revision:p.revision,adjustments:structuredClone(p.adjustments),artProfile:result.artProfile};return result;});
  ipc.handle('image:output-preview',async(_,p)=>{
    runtime.requireSession(p.sessionId);
    if(p.colorSpace!==null&&!Object.hasOwn(OUTPUT_COLOR_SPACES,p.colorSpace))throw new Error('不支持的输出预览色彩空间。');
    const snapshot=runtime.brushSnapshot;
    if(!snapshot||snapshot.sessionId!==p.sessionId)throw new Error('当前预览尚未完成，请稍后选择输出色彩空间。');
    await runtime.native().call('update',{revision:p.revision,adjustments:snapshot.adjustments,artProfile:snapshot.artProfile,monitorPreview:'display-p3',...(p.colorSpace?{outputPreview:p.colorSpace}:{})});
  });
  ipc.handle('image:viewport',async(_,p)=>{runtime.requireSession(p.sessionId);await runtime.native().call('viewport',p);});
  ipc.handle('image:coordinates',async(_,p)=>{runtime.requireSession(p.sessionId);return runtime.native().call('coordinates',p);});
  ipc.handle('image:repair-source',async(_,request)=>{runtime.requireSession(request.sessionId);return runtime.native().call('repairSource',request);});
  ipc.handle('image:auto-perspective',async(_,request)=>{
    const current=runtime.requireSession(request.sessionId);
    await verifySourceIdentity(current.path,current.sourceIdentity);runtime.requireSession(request.sessionId);
    const result=await runtime.autoPerspective.run(current.path,{...request,sourceFrame:current.sourceFrame});
    if(result===null)return null;
    runtime.requireSession(request.sessionId);await verifySourceIdentity(current.path,current.sourceIdentity);runtime.requireSession(request.sessionId);
    return result;
  });
  ipc.handle('image:auto-perspective-cancel',(_,id)=>runtime.autoPerspective.cancel(id));
  ipc.handle('image:straighten',async(_,p)=>{runtime.requireSession(p.sessionId);return runtime.native().call('straighten',p);});
  ipc.handle('image:color-sample',async(_,p)=>{runtime.requireSession(p.sessionId);return runtime.native().call('sampleColor',p);});
  ipc.handle('image:luminance-sample',async(_,p)=>{runtime.requireSession(p.sessionId);return runtime.native().call('sampleLuminance',p);});
  ipc.handle('image:curve-sample',async(_,request)=>{
    const current=runtime.requireSession(request.sessionId),snapshot=runtime.brushSnapshot;
    if(!snapshot||snapshot.sessionId!==current.id||snapshot.revision!==request.revision)throw new Error('照片已更新，请等待预览后重新取样。');
    runtime.curveSampling??=new CurveSampling(runtime.binary,runtime.resources,runtime.cache);
    const valid=()=>!runtime.openingImage&&runtime.session===current&&runtime.brushSnapshot===snapshot;
    return runtime.curveSampling.run(current,request,snapshot,valid);
  });
  ipc.handle('image:curve-sample-cancel',(_,id)=>runtime.curveSampling?.cancel(id));
  app.once('will-quit',()=>{void runtime.curveSampling?.cancel();});
  ipc.handle('image:white-balance',async(_,p)=>{runtime.requireSession(p.sessionId);return runtime.native().call('whiteBalance',p.request);});
  ipc.handle('image:close',async()=>{
    runtime.autoPerspective.cancel();runtime.stopComparison();await runtime.objects.cancel();
    runtime.brushSnapshot=undefined;await runtime.curveSampling?.cancel();await runtime.brushes.invalidate();const closing=runtime.engine;runtime.engine=undefined;runtime.session=undefined;
    if(closing?.alive)await closing.call('close').catch(()=>{});
    closing?.terminate();
  });
}
