import type {Dialog,IpcMain} from 'electron';
import {basename,dirname,extname,join,resolve} from 'node:path';
import {nativeSidecar,saveRecipeWithMasks,saveTargetState,validateBatchSave,validateSessionSave} from '@captraw/desktop-core/documents';
import {documentRelativePath,verifySourceIdentity} from '@captraw/desktop-core/engine';
import {ENGINE_VERSION,mergeAdjustmentPatch,type EditDocument,type ImageSession,type SourceIdentity} from '@captraw/contracts';
import type {MainRuntime} from './context.js';

export function registerDocumentIpc(ipc:IpcMain,dialog:Dialog,runtime:MainRuntime){
  ipc.handle('documents:dirty',(_,paths:string[])=>{runtime.dirtyPaths.clear();for(const path of paths)runtime.dirtyPaths.add(resolve(path));runtime.dirtyCount=runtime.dirtyPaths.size;});
  ipc.handle('document:confirm-close',async(_,name:string)=>{
    const {response}=await dialog.showMessageBox(runtime.win,{type:'question',message:`保存“${name}”的更改？`,detail:'保存会写入 .captraw 编辑文件，不会改写原片或源XMP。放弃仅撤销未保存修改。',buttons:['保存','放弃更改','取消'],defaultId:0,cancelId:2,noLink:true});
    return ['save','discard','cancel'][response];
  });
  ipc.handle('files:choose',async()=>(await dialog.showOpenDialog(runtime.win,{title:'打开照片或编辑文件',properties:['openFile','multiSelections'],filters:[{name:'照片与编辑文件',extensions:['nef','cr3','cr2','arw','raf','dng','orf','rw2','pef','tif','tiff','jpg','jpeg','png','captraw','xmp']}]})).filePaths);
  ipc.handle('image:open',async(_,path:string,expectedSource?:SourceIdentity)=>{
    if(runtime.openingImage)throw new Error('正在载入照片，请稍候。');
    runtime.openingImage=true;
    try{runtime.brushSnapshot=undefined;await runtime.curveSampling?.cancel();await runtime.brushes.invalidate();await runtime.objects.cancel();return await runtime.openImage(path,expectedSource);}finally{runtime.openingImage=false;}
  });
  ipc.handle('recipes:save',async(_,request)=>{
    if(runtime.savePending)throw new Error('已有批量保存任务正在运行。');
    validateBatchSave(request);runtime.savePending=true;
    try{
      const result=await dialog.showOpenDialog(runtime.win,{title:`保存 ${request.documents.length} 张照片的编辑：选择文件夹`,message:'每张照片生成独立 .captraw，包含蒙版和配置文件资产。同名文件保留，新文件自动编号。',properties:['openDirectory','createDirectory']});
      if(result.canceled||!result.filePaths.length)return null;
      return await runtime.batchSaver.run(request,result.filePaths[0]);
    }finally{runtime.savePending=false;}
  });
  ipc.handle('session:save',async(_,request)=>{
    if(runtime.savePending)throw new Error('已有保存任务正在运行。');
    validateSessionSave(request);runtime.savePending=true;
    try{return await runtime.sessionSaver.run(request);}finally{runtime.savePending=false;}
  });
  ipc.handle('session:save-as',async(_,request)=>{
    if(runtime.savePending)throw new Error('已有保存任务正在运行。');
    validateSessionSave(request);if(request.documents.length!==1)throw new Error('请仅选择一张失败照片另存。');
    runtime.savePending=true;
    try{
      const source=request.documents[0].path;
      const result=await dialog.showSaveDialog(runtime.win,{title:'将失败的编辑另存为 CaptRAW',defaultPath:nativeSidecar(source),filters:[{name:'CaptRAW 编辑文件',extensions:['captraw']}]});
      if(result.canceled||!result.filePath)return null;
      return await runtime.sessionSaver.run(request,result.filePath);
    }finally{runtime.savePending=false;}
  });
  ipc.handle('session:confirm-discard',async(_,names:string[])=>{
    if(!Array.isArray(names)||names.length>500||names.some(name=>typeof name!=='string'||!name.trim()))throw new Error('放弃更改的照片列表无效。');
    if(!names.length)return true;
    const {response}=await dialog.showMessageBox(runtime.win,{type:'warning',message:`放弃 ${names.length} 张照片的未保存更改？`,detail:names.join('\n'),buttons:['取消','放弃更改'],defaultId:0,cancelId:0,noLink:true});
    return response===1;
  });
  ipc.handle('session:forget',(_,id:string)=>{
    if(typeof id!=='string'||!id.trim())throw new Error('保存会话标识无效。');
    runtime.sessionSaver.forgetSession(id);runtime.openingDocuments.clear();
  });
  ipc.handle('recipes:cancel',()=>{runtime.batchSaver.cancel();runtime.sessionSaver.cancel();});
  ipc.handle('recipe:save', async (_, { session: supplied, artProfile }: { session: ImageSession; artProfile: string }) => {
    const current = runtime.requireSession(supplied.id);
    await verifySourceIdentity(current.path,current.sourceIdentity);
    const result = await dialog.showSaveDialog(runtime.win, { title: '另存 CaptRAW 编辑', message: '含外部蒙版或输入配置文件时会同时保存资产文件夹；移动编辑文件时请保留配套文件夹。', defaultPath: nativeSidecar(current.path), filters: [{ name: 'CaptRAW 编辑文件', extensions: ['captraw'] }] });
    if (result.canceled || !result.filePath) return '';
    if (resolve(result.filePath) === current.path || !/\.captraw$/i.test(result.filePath)) throw new Error('请使用 .captraw 保存编辑。');
    await runtime.native().call('validate',{artProfile,adjustments:supplied.adjustments});
    const snapshotPacket=supplied.recipe?.xmpPacket??current.recipe?.xmpPacket;
    const target=await saveTargetState(result.filePath);
    const recipe: EditDocument = { xmpPacket:snapshotPacket,nativePacket:target.nativePacket??supplied.recipe?.nativePacket??current.recipe?.nativePacket, engineVersion: ENGINE_VERSION, source: { path: documentRelativePath(dirname(result.filePath),current.path), size: current.sourceIdentity.size, sha256: current.sourceIdentity.sha256 }, artProfile, adjustments: supplied.adjustments,rating:supplied.rating,label:supplied.label,baselineVersion:4 };
    await saveRecipeWithMasks(runtime.native(),result.filePath,recipe,value=>runtime.documents.serialize(value,[snapshotPacket,current.recipe?.xmpPacket]),true,async()=>{
      await verifySourceIdentity(current.path,current.sourceIdentity);
      if((await saveTargetState(result.filePath!)).stamp!==target.stamp)throw new Error('编辑文件在保存期间被外部修改，未覆盖原数据。请重试并重新确认目标。');
    });
    const saved=await runtime.documents.read(result.filePath);current.recipe={...recipe,...saved,source:saved.source??recipe.source,adjustments:mergeAdjustmentPatch(recipe.adjustments,saved.adjustments)};
    return result.filePath;
  });
}
