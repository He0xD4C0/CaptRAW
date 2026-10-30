import type {Dialog,IpcMain} from 'electron';
import type {MainRuntime} from './context.js';

export function registerPresetIpc(ipc:IpcMain,dialog:Dialog,runtime:MainRuntime){
  ipc.handle('profiles:list',()=>runtime.session?runtime.inputProfiles.listFor(runtime.session.profileCamera||runtime.session.camera,runtime.session.inputKind!=='rendered'):runtime.inputProfiles.list());
  ipc.handle('profiles:inspect',(_,reference)=>runtime.inputProfiles.inspect(reference));
  ipc.handle('profiles:import',async(_,id)=>{
    const current=runtime.requireSession(id);
    const result=await dialog.showOpenDialog(runtime.win,{title:'导入输入配置文件 / Look',properties:['openFile'],filters:[{name:'DCP / ICC / Look XMP',extensions:['dcp','icc','icm','xmp']}]});
    if(result.canceled||!result.filePaths.length)return null;runtime.requireSession(id);
    return runtime.inputProfiles.importFile(result.filePaths[0],current.profileCamera||current.camera,current.inputKind!=='rendered');
  });
  ipc.handle('presets:list',()=>runtime.presets.list());
  ipc.handle('presets:create',(_,input)=>runtime.presets.create({...input,sourceFrame:runtime.session?.sourceFrame,sourcePath:runtime.session?.path,sourceIdentity:runtime.session?.sourceIdentity}));
  ipc.handle('presets:update',(_,p)=>runtime.presets.update(p.id,{...p.input,sourceFrame:runtime.session?.sourceFrame,sourcePath:runtime.session?.path,sourceIdentity:runtime.session?.sourceIdentity}));
  ipc.handle('presets:rename',(_,p)=>runtime.presets.rename(p.id,p.name,p.group));
  ipc.handle('presets:delete',(_,id)=>runtime.presets.remove(id));
  ipc.handle('presets:apply',(_,p)=>{runtime.requireSession(p.target.image.id);return runtime.presets.apply(p.id,p.target,runtime.synchronizer);});
  ipc.handle('presets:apply-many',(_,request)=>runtime.presets.applyMany(request,runtime.synchronizer));
  ipc.handle('presets:create-iso',(_,input)=>runtime.presets.createISO(input));
  ipc.handle('presets:favorite',(_,p)=>runtime.presets.favorite(p.id,p.favorite));
  ipc.handle('presets:duplicate',(_,p)=>runtime.presets.duplicate(p.id,p.name,p.group));
  ipc.handle('presets:packs',()=>runtime.presets.listPacks());
  ipc.handle('presets:preview',(_,request)=>runtime.presetPreview.preview(request));
  ipc.handle('presets:preview-cancel',()=>runtime.presetPreview.cancel());
  ipc.handle('presets:import',async()=>{const result=await dialog.showOpenDialog(runtime.win,{title:'导入预设',properties:['openFile'],filters:[{name:'CaptRAW / Adobe 预设',extensions:['captrawpreset','xmp']}]});return result.canceled||!result.filePaths.length?null:runtime.presets.importFile(result.filePaths[0]);});
  ipc.handle('presets:export',async(_,id)=>{const result=await dialog.showSaveDialog(runtime.win,{title:'导出 CaptRAW 预设',message:'移动预设时请同时保留配套 .assets 文件夹。',defaultPath:'预设.captrawpreset',filters:[{name:'CaptRAW 预设',extensions:['captrawpreset']}]});if(result.canceled||!result.filePath)return null;await runtime.presets.exportFile(id,result.filePath);return result.filePath;});
}
