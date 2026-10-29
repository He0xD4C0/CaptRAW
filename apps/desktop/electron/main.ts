import { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } from 'electron';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { readdir, stat, realpath, rename, mkdir, rm } from 'node:fs/promises';
import { existsSync,rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {AutoPerspective} from '@captraw/desktop-core/auto-perspective';
import {CurveSampling} from '@captraw/desktop-core/curve-sampler';
import { NativeEngine } from '@captraw/desktop-core/engine';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ObjectSelection} from '@captraw/desktop-core/object-selection';
import {BrushPreparation} from '@captraw/desktop-core/brush';
import {Presets,PresetPreview} from '@captraw/desktop-core/presets';
import {XMP} from '@captraw/desktop-core/xmp';
import {Documents,BatchDocumentSaver,validateBatchSave} from '@captraw/desktop-core/documents';
import {SessionDocumentSaver,validateSessionSave,saveTargetState} from '@captraw/desktop-core/session-save';
import {InputProfiles} from '@captraw/desktop-core/input-profiles';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {BatchExporter,validateBatch} from '@captraw/desktop-core/batch-export';
import {finishOutputMetadata} from '@captraw/desktop-core/output-metadata';
import {executableName,isContainedFile,documentRelativePath} from '@captraw/desktop-core/runtime';
import {captureSourceIdentity,verifySourceIdentity} from '@captraw/desktop-core/source-identity';
import type { ImageSession, EditDocument, EngineEvent, ExportRequest,SourceIdentity } from '@captraw/contracts';
import {ENGINE_VERSION,OUTPUT_COLOR_SPACES,mergeAdjustmentPatch,partialAdjustmentGroups,sourceFrameOpenSnapshot,sourceFramePolicyForDocument} from '@captraw/contracts';
protocol.registerSchemesAsPrivileged([{ scheme: 'captraw', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const backgroundTest=process.env.CAPTRAW_E2E_BACKGROUND==='1';
if(backgroundTest&&process.env.CAPTRAW_E2E_USER_DATA)app.setPath('userData',resolve(process.env.CAPTRAW_E2E_USER_DATA));
if(backgroundTest&&process.platform==='darwin')app.setActivationPolicy('accessory');
let presets:Presets;
let presetPreview:PresetPreview;
let presetPreviewStopping=false;
let presetPreviewSynchronizer:Synchronizer;
let documents:Documents;
let batchSaver:BatchDocumentSaver;
let sessionSaver:SessionDocumentSaver;
let savePending=false;
let inputProfiles:InputProfiles;
let objects:ObjectSelection;
let brushes:BrushPreparation;
let brushSnapshot:{sessionId:string;revision:number;adjustments:import('@captraw/contracts').Adjustments;artProfile:string}|undefined;
let synchronizer:Synchronizer;
let batchExporter:BatchExporter;
let exportPending=false;
let win: BrowserWindow;
let engine: NativeEngine | undefined;
let openingEngine:NativeEngine|undefined;
let comparisonEngine:NativeEngine|undefined;
let comparisonSequence=0;
const comparisonFrames=new Map<string,string>();
function stopComparison(){++comparisonSequence;comparisonEngine?.terminate();comparisonEngine=undefined;for(const file of comparisonFrames.values())void rm(file,{force:true}).catch(()=>{});comparisonFrames.clear();}
let autoPerspective:AutoPerspective;
let curveSampling:CurveSampling|undefined;
let exporter: NativeEngine | undefined;
let exportCancelled = false;
let exportTemp:string|undefined;
let session: ImageSession | undefined;
let quitting = false;
let openingImage=false;
let dirtyCount=0,checkingQuit=false;const dirtyPaths=new Set<string>();
const frames = new Map<string, string>();
let cache: string, binary: string, resources: string;
const send = (event: EngineEvent) => { if (win && !win.isDestroyed()) win.webContents.send('engine:event', event); };
function createEngine() {
  const e = new NativeEngine(binary, resources, cache);
  const displayed=new Map<string,string[]>();
  e.on('engine-event', async message => {
    if (message.event === 'preview') {
      const frame = message.frame;
      if (frame.sessionId !== session?.id) return;
      const token = `${frame.sessionId}/${basename(frame.file)}`;
      const file = resolve(frame.file);
      if (!isContainedFile(cache,file)) return;
      frames.set(token, file);
      const registered=[token];
      let mask=null;
      if(frame.mask?.file&&isContainedFile(cache,resolve(frame.mask.file))){
        const maskToken=`${frame.sessionId}/${basename(frame.mask.file)}`;frames.delete(maskToken);frames.set(maskToken,resolve(frame.mask.file));
        registered.push(maskToken);
        mask={...frame.mask,url:`captraw://preview/${maskToken}`};
      }
      let luminance=null;
      if(frame.luminance?.file&&isContainedFile(cache,resolve(frame.luminance.file))){
        const lightToken=`${frame.sessionId}/${basename(frame.luminance.file)}`;frames.delete(lightToken);frames.set(lightToken,resolve(frame.luminance.file));
        registered.push(lightToken);
        luminance={...frame.luminance,url:`captraw://preview/${lightToken}`};
      }
      let linear=null;
      if(frame.linear?.file&&isContainedFile(cache,resolve(frame.linear.file))){
        const linearToken=`${frame.sessionId}/${basename(frame.linear.file)}`;frames.set(linearToken,resolve(frame.linear.file));
        registered.push(linearToken);
        linear={...frame.linear,url:`captraw://preview/${linearToken}`};
      }
      send({ event: 'preview', frame: { ...frame, mask, luminance, linear, url: `captraw://preview/${token}` } });
      displayed.set(frame.kind,registered);const pinned=new Set([...displayed.values()].flat());
      const entries = [...frames.entries()];
      for (const [key, old] of entries.slice(0, -12)) if(!pinned.has(key)){ frames.delete(key); await rm(old, { force: true }).catch(() => {}); }
    } else if (message.event === 'error' && e===engine && !quitting) send(message);
  });
  return e;
}
function native() {
  if (!engine?.alive) engine = createEngine();
  return engine;
}
function requireSession(id: string) {
  if (openingImage || !session || session.id !== id) throw new Error('当前图片正在切换，请等待载入完成后重试。'); return session;
}
async function openImage(path: string,expectedSource?:SourceIdentity) {
  autoPerspective.cancel();
  path=resolve(path);const explicitRecipe=/\.xmp$/i.test(path);
  if(/\.json$/i.test(path))throw new Error('仅支持 XMP 编辑文件；旧 JSON 格式已移除。');
  const recipeFile=explicitRecipe?path:join(dirname(path),basename(path,extname(path))+'.xmp');
  let loaded:Awaited<ReturnType<Documents['readForImage']>>|undefined;
  if(existsSync(recipeFile)){
    loaded=await documents.readForImage(recipeFile);
    if(explicitRecipe){
      if(loaded.source)path=resolve(dirname(recipeFile),loaded.source.path);
      else{
        const stem=basename(recipeFile,extname(recipeFile)).toLowerCase();
        const candidates=(await readdir(dirname(recipeFile))).filter(name=>basename(name,extname(name)).toLowerCase()===stem&&/\.(nef|cr3|cr2|arw|raf|dng|orf|rw2|pef|tiff?|jpe?g|png)$/i.test(name));
        if(candidates.length!==1)throw new Error('XMP 旁边未找到唯一同名原片。请将 XMP 与对应原片放在同一目录后重试。');
        path=join(dirname(recipeFile),candidates[0]);
      }
    }
  }
  const sourceIdentity=expectedSource===undefined?await captureSourceIdentity(path):expectedSource;
  if(expectedSource!==undefined)await verifySourceIdentity(path,expectedSource);
  // An external sidecar owns the edit. Otherwise use the rendered container's
  // complete SDK packet; embedded True/False follows the same opening policy.
  if(!loaded&&!explicitRecipe&&/\.(jpe?g|tiff?)$/i.test(path))loaded=await documents.readForImage(path);
  if(loaded?.source&&(sourceIdentity.size!==loaded.source.size||sourceIdentity.sha256!==loaded.source.sha256))throw new Error('XMP 关联的原始图片已改变，停止加载编辑。');
  if(explicitRecipe&&dirtyPaths.has(path))throw new Error('这张照片还有未保存编辑。请先保存或关闭照片，再打开其他编辑文件。');
  const activeDocument=!!loaded&&!loaded.metadataOnly&&(loaded.openingKind==='legacy-active'||!!loaded.engineVersion||!!loaded.artProfile||Object.keys(loaded.adjustments).length>0);
  const candidate=createEngine();openingEngine=candidate;
  try{
  const image=await candidate.call('open',{path,sessionId:randomUUID(),effectsDefaults:activeDocument?'legacy':'current',whiteBalanceDefaults:activeDocument?'legacy':'current',sourceFramePolicy:sourceFramePolicyForDocument(activeDocument?loaded:undefined),...sourceFrameOpenSnapshot(activeDocument?loaded!.adjustments:{},activeDocument?loaded!.artProfile:'')});
  let recipe:EditDocument|undefined;
  if(loaded&&activeDocument){
    const groups=partialAdjustmentGroups(loaded.adjustments);
    const inherited=loaded.artProfile&&groups.length?await candidate.call('adjustmentBase',{artProfile:loaded.artProfile,groups}):{};
    let adjustments=mergeAdjustmentPatch({...image.adjustments,...inherited},loaded.adjustments);
    if(loaded.adjustments.fineRotation===undefined)delete adjustments.fineRotation;
    if(loaded.adjustments.perspective===undefined)delete adjustments.perspective;
    if(!loaded.engineVersion&&(loaded.adjustments.temperature!==undefined||loaded.adjustments.tint!==undefined||loaded.adjustments.incrementalTemperature!==undefined||loaded.adjustments.incrementalTint!==undefined))adjustments={...adjustments,wbMode:'custom',wbMultipliers:null,wbApproximate:false};
    recipe={...loaded,rating:loaded.rating??image.rating,label:loaded.label??image.label,source:loaded.source||{path,size:sourceIdentity.size,sha256:sourceIdentity.sha256},adjustments};
    recipe=await restoreRecipeMasks(candidate,recipeFile,recipe,cache);
    if(recipe.adjustments.colorProfile?.look)recipe.adjustments.colorProfile=await inputProfiles.resolveSettings(recipe.adjustments.colorProfile,image.profileCamera||image.camera,image.inputKind!=='rendered');
    const checked=await candidate.call('validate',{artProfile:recipe.artProfile,adjustments:recipe.adjustments});
    if(checked.colorProfile?.mode==='inherited'&&checked.colorProfile.reference!=='(none)')inputProfiles.assertCompatible(await candidate.call('inspectInputProfile',{path:checked.colorProfile.reference.replace(/^file:/,'')}),image.profileCamera||image.camera,image.inputKind!=='rendered');
    for(const key of ['colorProfile','blackWhite','colorGrading'] as const)if(checked[key])recipe.adjustments[key]=checked[key];
    recipe.adjustments.masks=checked.masks;recipe.adjustments.fineRotation=checked.fineRotation;recipe.adjustments.perspective=checked.perspective;
  }else if(loaded){
    recipe={...loaded,rating:loaded.rating??image.rating,label:loaded.label??image.label,source:loaded.source||{path,size:sourceIdentity.size,sha256:sourceIdentity.sha256},artProfile:image.artProfile||'',adjustments:structuredClone(image.adjustments)};
  }
  if(quitting)throw new Error('应用正在退出。');
  await verifySourceIdentity(path,sourceIdentity);
  stopComparison();const previous=engine;engine=candidate;previous?.terminate();
  session={...image,sourceIdentity,rating:recipe?.rating??image.rating,label:recipe?.label??image.label,initialAdjustments:image.adjustments,recipe,xmpWarnings:loaded?.warnings};
  if(recipe)session!.adjustments=recipe.adjustments;
  return session;
  }catch(error){candidate.terminate();throw error;}finally{if(openingEngine===candidate)openingEngine=undefined;}
}
function registerIPC() {
  ipcMain.handle('comparison:update',async(_,p)=>{
    const current=requireSession(p.sessionId);stopComparison();if(!p.settings)return;
    const sequence=comparisonSequence,directory=join(cache,'comparison-'+randomUUID()),worker=new NativeEngine(binary,resources,directory),displayed=new Map<string,string[]>();comparisonEngine=worker;
    worker.child.once('close',()=>{void rm(directory,{recursive:true,force:true}).catch(()=>{});});
    worker.on('engine-event',async message=>{
      if(worker!==comparisonEngine||current.id!==session?.id)return;
      if(message.event==='preview'){
        try{await verifySourceIdentity(current.path,current.sourceIdentity);}
        catch(error){
          if(worker===comparisonEngine&&current.id===session?.id){stopComparison();send({event:'comparison-error',sessionId:current.id,revision:p.revision,message:error instanceof Error?error.message:String(error)});}
          return;
        }
        if(worker!==comparisonEngine||current.id!==session?.id)return;
        const frame=message.frame,file=resolve(frame.file);if(!isContainedFile(cache,file))return;
        const key=`comparison/${sequence}/${basename(file)}`;comparisonFrames.set(key,file);
        const registered=[key];
        let linear=null;
        if(frame.linear?.file&&isContainedFile(directory,resolve(frame.linear.file))){
          const linearKey=`comparison/${sequence}/${basename(frame.linear.file)}`;comparisonFrames.set(linearKey,resolve(frame.linear.file));linear={...frame.linear,url:`captraw://preview/${linearKey}`};
          registered.push(linearKey);
        }
        send({event:'comparison-preview',frame:{...frame,linear,url:`captraw://preview/${key}`}});
        displayed.set(frame.kind,registered);const pinned=new Set([...displayed.values()].flat());
        for(const [key,path] of [...comparisonFrames].slice(0,linear?-8:-4))if(!pinned.has(key)){comparisonFrames.delete(key);void rm(path,{force:true}).catch(()=>{});}
      }else if(message.event==='error')send({event:'comparison-error',sessionId:current.id,revision:p.revision,message:message.message});
    });
    try{
      await worker.ready;
      await verifySourceIdentity(current.path,current.sourceIdentity);
      if(worker!==comparisonEngine||current.id!==session?.id)return;
      await worker.call('open',{path:current.path,sessionId:current.id,...sourceFrameOpenSnapshot(p.settings.adjustments,p.settings.artProfile,current.sourceFrame)});
      await verifySourceIdentity(current.path,current.sourceIdentity);
      if(worker!==comparisonEngine||current.id!==session?.id)return;
      const {rotation,flipHorizontal,flipVertical,fineRotation,perspective,crop,lensCorrections,lensProfile,lensManualDistortion}=p.settings.geometry;
      await worker.call('update',{revision:p.revision,artProfile:p.settings.artProfile,linearPreview:!!p.linearPreview,adjustments:{...p.settings.adjustments,rotation,flipHorizontal,flipVertical,fineRotation,perspective,crop,lensCorrections,lensProfile,lensManualDistortion}});
    }catch(error){if(worker===comparisonEngine){stopComparison();throw error;}}
  });
  ipcMain.handle('comparison:viewport',async(_,p)=>{requireSession(p.sessionId);const worker=comparisonEngine;if(worker)await worker.call('viewport',p);});

  ipcMain.handle('profiles:list',()=>session?inputProfiles.listFor(session.profileCamera||session.camera,session.inputKind!=='rendered'):inputProfiles.list());
  ipcMain.handle('profiles:inspect',(_,reference)=>inputProfiles.inspect(reference));
  ipcMain.handle('profiles:import',async(_,id)=>{
    const current=requireSession(id);
    const r=await dialog.showOpenDialog(win,{title:'导入输入配置文件 / Look',properties:['openFile'],filters:[{name:'DCP / ICC / Look XMP',extensions:['dcp','icc','icm','xmp']}]});
    if(r.canceled||!r.filePaths.length)return null;requireSession(id);
    return inputProfiles.importFile(r.filePaths[0],current.profileCamera||current.camera,current.inputKind!=='rendered');
  });
  ipcMain.handle('presets:list',()=>presets.list());
  ipcMain.handle('presets:create',(_,input)=>presets.create({...input,sourceFrame:session?.sourceFrame,sourcePath:session?.path,sourceIdentity:session?.sourceIdentity}));
  ipcMain.handle('presets:update',(_,p)=>presets.update(p.id,{...p.input,sourceFrame:session?.sourceFrame,sourcePath:session?.path,sourceIdentity:session?.sourceIdentity}));
  ipcMain.handle('presets:rename',(_,p)=>presets.rename(p.id,p.name,p.group));
  ipcMain.handle('presets:delete',(_,id)=>presets.remove(id));
  ipcMain.handle('presets:apply',(_,p)=>{requireSession(p.target.image.id);return presets.apply(p.id,p.target,synchronizer);});
  ipcMain.handle('presets:apply-many',(_,request)=>presets.applyMany(request,synchronizer));
  ipcMain.handle('presets:create-iso',(_,input)=>presets.createISO(input));
  ipcMain.handle('presets:favorite',(_,p)=>presets.favorite(p.id,p.favorite));
  ipcMain.handle('presets:duplicate',(_,p)=>presets.duplicate(p.id,p.name,p.group));
  ipcMain.handle('presets:packs',()=>presets.listPacks());
  ipcMain.handle('presets:preview',(_,request)=>presetPreview.preview(request));
  ipcMain.handle('presets:preview-cancel',()=>presetPreview.cancel());
  ipcMain.handle('presets:import',async()=>{const r=await dialog.showOpenDialog(win,{title:'导入 XMP 预设',properties:['openFile'],filters:[{name:'XMP 预设',extensions:['xmp']}]});return r.canceled||!r.filePaths.length?null:presets.importFile(r.filePaths[0]);});
  ipcMain.handle('presets:export',async(_,id)=>{const r=await dialog.showSaveDialog(win,{title:'导出 XMP 预设',message:'移动预设时请同时保留配套 .assets 文件夹。',defaultPath:'预设.xmp',filters:[{name:'XMP 预设',extensions:['xmp']}]});if(r.canceled||!r.filePath)return null;await presets.exportFile(id,r.filePath);return r.filePath;});
  ipcMain.handle('object:begin',(_,p)=>objects.begin(requireSession(p.sessionId),p.adjustments,p.artProfile));
  ipcMain.handle('object:predict',(_,p)=>objects.predict(p.id,p.prompts,p.box));
  ipcMain.handle('object:parts',(_,id)=>objects.predictPersonParts(id));
  ipcMain.handle('object:semantic',(_,id)=>objects.predictSemanticMasks(id));
  ipcMain.handle('object:sky',(_,id)=>objects.predictSkyMask(id));
  ipcMain.handle('object:commit',(_,p)=>objects.commit(p.id,p.revision,p.index));
  ipcMain.handle('object:commit-part',(_,p)=>objects.commitPersonPart(p.id,p.revision,p.part));
  ipcMain.handle('object:commit-semantic',(_,p)=>objects.commitSemanticMask(p.id,p.revision,p.part));
  ipcMain.handle('object:commit-sky',(_,p)=>objects.commitSkyMask(p.id,p.revision));
  ipcMain.handle('object:cancel',(_,id)=>objects.cancel(id));
  ipcMain.handle('brush:prepare',async(_,request:import('@captraw/contracts').BrushPrepareRequest)=>{
    const image=requireSession(request.sessionId),snapshot=brushSnapshot;
    if(!snapshot||snapshot.sessionId!==image.id||snapshot.revision!==request.revision)throw new Error('照片已更新，请重新绘制画笔。');
    const check=async()=>{requireSession(image.id);if(brushSnapshot!==snapshot)throw new Error('照片已更新，请重新绘制画笔。');};
    await verifySourceIdentity(image.path,image.sourceIdentity);await check();
    return brushes.prepare(image,request,snapshot.adjustments,snapshot.artProfile,check,async()=>{await verifySourceIdentity(image.path,image.sourceIdentity);await check();});
  });
  ipcMain.handle('brush:cancel',(_,id)=>brushes.cancel(id));
  ipcMain.handle('images:export',async(_,request)=>{
    if(exportPending)throw new Error('已有导出任务正在运行。');
    validateBatch(request);exportPending=true;
    try{
      const result=await dialog.showOpenDialog(win,{title:`导出 ${request.documents.length} 张照片：选择文件夹`,properties:['openDirectory','createDirectory']});
      if(result.canceled||!result.filePaths.length)return null;
      return await batchExporter.run(request,result.filePaths[0]);
    }finally{exportPending=false;}
  });
  ipcMain.handle('images:synchronize',(_,request)=>synchronizer.run(request));
  ipcMain.handle('images:synchronize-cancel',()=>{presets.cancel();synchronizer.cancel();});
  ipcMain.handle('curve:parametric',async(_,settings)=>native().call('parametricCurve',settings));
  ipcMain.handle('documents:dirty',(_,paths:string[])=>{dirtyPaths.clear();for(const path of paths)dirtyPaths.add(resolve(path));dirtyCount=dirtyPaths.size;});
  ipcMain.handle('document:confirm-close',async(_,name:string)=>{
    const {response}=await dialog.showMessageBox(win,{type:'question',message:`保存“${name}”的更改？`,detail:'保存会写入独立的编辑配方。放弃更改不会修改原片。',buttons:['保存','放弃更改','取消'],defaultId:0,cancelId:2,noLink:true});
    return ['save','discard','cancel'][response];
  });
  ipcMain.handle('files:choose', async () => (await dialog.showOpenDialog(win, { title: '打开 RAW 或编辑配方', properties: ['openFile', 'multiSelections'], filters: [{ name: '照片与配方', extensions: ['nef','cr3','cr2','arw','raf','dng','orf','rw2','pef','tif','tiff','jpg','jpeg','png','xmp'] }] })).filePaths);
  ipcMain.handle('image:open', async (_, path: string,expectedSource?:SourceIdentity) => {
    if(openingImage)throw new Error('正在载入照片，请稍候。');
    openingImage=true;
    try{brushSnapshot=undefined;await brushes.invalidate();await objects.cancel();return await openImage(path,expectedSource);}finally{openingImage=false;}
  });
  ipcMain.handle('image:update', async (_, p) => { requireSession(p.sessionId);brushSnapshot=undefined;brushes.adopt(p.adjustments);await brushes.invalidate();objects.invalidate(p.sessionId,p.adjustments,p.artProfile||'');const result=await native().call('update', p);brushSnapshot={sessionId:p.sessionId,revision:p.revision,adjustments:structuredClone(p.adjustments),artProfile:result.artProfile};return result; });
  ipcMain.handle('image:viewport', async (_, p) => { requireSession(p.sessionId); await native().call('viewport', p); });
  ipcMain.handle('image:coordinates',async(_,p)=>{requireSession(p.sessionId);return native().call('coordinates',p);});
  ipcMain.handle('image:repair-source',async(_,request)=>{requireSession(request.sessionId);return native().call('repairSource',request);});
  ipcMain.handle('image:auto-perspective',async(_,request)=>{
    const current=requireSession(request.sessionId);
    await verifySourceIdentity(current.path,current.sourceIdentity);requireSession(request.sessionId);
    const result=await autoPerspective.run(current.path,{...request,sourceFrame:current.sourceFrame});
    if(result===null)return null;
    requireSession(request.sessionId);await verifySourceIdentity(current.path,current.sourceIdentity);requireSession(request.sessionId);
    return result;
  });
  ipcMain.handle('image:auto-perspective-cancel',(_,id)=>autoPerspective.cancel(id));
  ipcMain.handle('image:straighten',async(_,p)=>{requireSession(p.sessionId);return native().call('straighten',p);});
  ipcMain.handle('image:color-sample',async(_,p)=>{requireSession(p.sessionId);return native().call('sampleColor',p);});
  ipcMain.handle('image:luminance-sample',async(_,p)=>{requireSession(p.sessionId);return native().call('sampleLuminance',p);});
  ipcMain.handle('image:curve-sample',async(_,request)=>{
    const current=requireSession(request.sessionId),snapshot=brushSnapshot;
    if(!snapshot||snapshot.sessionId!==current.id||snapshot.revision!==request.revision)throw new Error('照片已更新，请等待预览后重新取样。');
    curveSampling??=new CurveSampling(binary,resources,cache);
    const valid=()=>!openingImage&&session===current&&brushSnapshot===snapshot;
    return curveSampling.run(current,request,snapshot,valid);
  });
  ipcMain.handle('image:curve-sample-cancel',(_,id)=>curveSampling?.cancel(id));
  app.once('will-quit',()=>{void curveSampling?.cancel();});
  ipcMain.handle('image:white-balance',async(_,p)=>{requireSession(p.sessionId);return native().call('whiteBalance',p.request);});
  ipcMain.handle('image:close', async () => {
    autoPerspective.cancel();stopComparison();await objects.cancel();
    brushSnapshot=undefined;await brushes.invalidate();const closing=engine;engine=undefined;session=undefined;
    // Discarding a session must also work after its preview process has exited.
    if(closing?.alive)await closing.call('close').catch(()=>{});
    closing?.terminate();
  });
  ipcMain.handle('recipes:save',async(_,request)=>{
    if(savePending)throw new Error('已有批量保存任务正在运行。');
    validateBatchSave(request);savePending=true;
    try{
      const result=await dialog.showOpenDialog(win,{title:`保存 ${request.documents.length} 张照片的 XMP：选择文件夹`,message:'每张照片生成独立 XMP，包含蒙版和配置文件资产。同名文件保留，新文件自动编号。',properties:['openDirectory','createDirectory']});
      if(result.canceled||!result.filePaths.length)return null;
      return await batchSaver.run(request,result.filePaths[0]);
    }finally{savePending=false;}
  });
  ipcMain.handle('session:save',async(_,request)=>{
    if(savePending)throw new Error('已有保存任务正在运行。');
    validateSessionSave(request);savePending=true;
    try{return await sessionSaver.run(request);}finally{savePending=false;}
  });
  ipcMain.handle('session:save-as',async(_,request)=>{
    if(savePending)throw new Error('已有保存任务正在运行。');
    validateSessionSave(request);if(request.documents.length!==1)throw new Error('请仅选择一张失败照片另存。');
    savePending=true;
    try{
      const source=request.documents[0].path;
      const result=await dialog.showSaveDialog(win,{title:'将失败的编辑另存为 XMP',defaultPath:join(dirname(source),basename(source,extname(source))+'.xmp'),filters:[{name:'XMP 编辑文件',extensions:['xmp']}]});
      if(result.canceled||!result.filePath)return null;
      return await sessionSaver.run(request,result.filePath);
    }finally{savePending=false;}
  });
  ipcMain.handle('session:confirm-discard',async(_,names:string[])=>{
    if(!Array.isArray(names)||names.length>500||names.some(name=>typeof name!=='string'||!name.trim()))throw new Error('放弃更改的照片列表无效。');
    if(!names.length)return true;
    const {response}=await dialog.showMessageBox(win,{type:'warning',message:`放弃 ${names.length} 张照片的未保存更改？`,detail:names.join('\n'),buttons:['取消','放弃更改'],defaultId:0,cancelId:0,noLink:true});
    return response===1;
  });
  ipcMain.handle('session:forget',(_,id:string)=>{
    if(typeof id!=='string'||!id.trim())throw new Error('保存会话标识无效。');
    sessionSaver.forgetSession(id);
  });
  ipcMain.handle('recipes:cancel',()=>{batchSaver.cancel();sessionSaver.cancel();});
  ipcMain.handle('recipe:save', async (_, { session: supplied, artProfile }: { session: ImageSession; artProfile: string }) => {
    const current = requireSession(supplied.id);
    await verifySourceIdentity(current.path,current.sourceIdentity);
    const result = await dialog.showSaveDialog(win, { title: '保存无损编辑配方', message: '含外部蒙版或输入配置文件时会同时保存资产文件夹；移动配方时请保留配套文件夹。', defaultPath: join(dirname(current.path),basename(current.path,extname(current.path))+'.xmp'), filters: [{ name: 'XMP 编辑文件', extensions: ['xmp'] }] });
    if (result.canceled || !result.filePath) return '';
    if (resolve(result.filePath) === current.path || !/\.xmp$/i.test(result.filePath)) throw new Error('请使用 .xmp 保存编辑。');
    await native().call('validate',{artProfile,adjustments:supplied.adjustments});
    const snapshotPacket=supplied.recipe?.xmpPacket??current.recipe?.xmpPacket;
    const target=await saveTargetState(result.filePath);
    const recipe: EditDocument = { xmpPacket: target.packet??snapshotPacket, engineVersion: ENGINE_VERSION, source: { path: documentRelativePath(dirname(result.filePath),current.path), size: current.sourceIdentity.size, sha256: current.sourceIdentity.sha256 }, artProfile, adjustments: supplied.adjustments,rating:supplied.rating,label:supplied.label,baselineVersion:4 };
    await saveRecipeWithMasks(native(),result.filePath,recipe,value=>documents.serialize(value,[snapshotPacket,current.recipe?.xmpPacket]),true,async()=>{
      await verifySourceIdentity(current.path,current.sourceIdentity);
      if((await saveTargetState(result.filePath!)).stamp!==target.stamp)throw new Error('XMP 在保存期间被外部修改，未覆盖原数据。请重试并重新确认目标。');
    });
    current.recipe={...recipe,xmpPacket:(await documents.xmp.read(result.filePath)).packet};
    return result.filePath;
  });
  ipcMain.handle('image:export', async (_, input:ExportRequest) => {
    if (exportPending) throw new Error('已有导出任务正在运行。');
    const {document:current,format,colorSpace,options}=structuredClone(input);
    validateBatch({documents:[current],format,colorSpace,options});
    exportPending=true;
    try{
    const sourceIdentity=current.sourceIdentity??await captureSourceIdentity(current.path);
    await verifySourceIdentity(current.path,sourceIdentity);
    const colorName=format==='avif'?'Rec.2020 / PQ HDR':OUTPUT_COLOR_SPACES[colorSpace];
    const extension = format === 'jpeg' ? 'jpg' : format==='avif'?'avif':'tiff';
    const result = await dialog.showSaveDialog(win, { title: '导出照片', defaultPath: join(dirname(current.path), `${basename(current.path, extname(current.path))}_CaptRAW.${extension}`), filters: [{ name: `${format === 'jpeg' ? 'JPEG' : format==='avif'?'AVIF · 12 位':'TIFF · 16 位'} · ${colorName}`, extensions: [extension] }] });
    if (result.canceled || !result.filePath) return null;
    if(!(format==='jpeg'?/\.(jpg|jpeg)$/i:format==='avif'?/\.avif$/i:/\.(tif|tiff)$/i).test(result.filePath))throw new Error('请选择与导出格式对应的 JPEG、TIFF 或 AVIF 文件名。');
    if (resolve(result.filePath) === current.path || /\.(nef|cr3|cr2|arw|raf|dng|xmp|arp)$/i.test(result.filePath)) throw new Error('不能覆盖原始照片或编辑资产。');
    const outputPath=result.filePath;
    const assertOutputNotSource=async()=>{
      const [sourcePath,targetDirectory,source,target]=await Promise.all([
        realpath(current.path),realpath(dirname(outputPath)),stat(current.path,{bigint:true}),
        stat(outputPath,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;})
      ]);
      if(join(targetDirectory,basename(outputPath))===sourcePath||(target&&target.dev===source.dev&&target.ino===source.ino))throw new Error('不能覆盖原始照片或其文件系统别名。');
    };
    await assertOutputNotSource();
    const job = randomUUID(), temp = `${result.filePath}.${job}.tmp`;
    exportTemp=temp;
    exportCancelled = false;
    const worker = new NativeEngine(binary, resources, join(cache, `export-${job}`)); exporter = worker;
    worker.on('engine-event', m => { if (m.event === 'progress') send({ event: 'job', job: { id: job, state: 'running', progress: m.progress, message: '正在处理并导出照片…' } }); });
    send({ event: 'job', job: { id: job, state: 'running', progress: 0, message: '正在处理并导出照片…' } });
    try {
      const {artProfile}=await worker.call('compose',current);
      if (exportCancelled) throw new Error('已取消导出');
      const output=await worker.call('export', { path: current.path, artProfile, output: temp, format, colorSpace, options, rating:current.rating });
      if(!exportCancelled)await finishOutputMetadata(worker,documents.xmp,current,format,options,output);
      if (exportCancelled) throw new Error('已取消导出');
      await verifySourceIdentity(current.path,sourceIdentity);
      await assertOutputNotSource();
      if (exportCancelled) throw new Error('已取消导出');
      await rename(temp, result.filePath);
      send({ event: 'job', job: { id: job, state: 'done', progress: 1, message: `已导出 ${basename(result.filePath)}` } });
      return result.filePath;
    } catch (error) {
      send({ event: 'job', job: { id: job, state: exportCancelled ? 'cancelled' : 'error', progress: 0, message: exportCancelled ? '已取消导出' : String(error) } });
      if (!exportCancelled) throw error; return null;
    } finally {
      const stopped=worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise<void>(done=>worker.child.once('exit',()=>done()));
      worker.terminate();await stopped;exporter = undefined;exportTemp=undefined; await rm(temp, { force: true }); await rm(join(cache, `export-${job}`), { recursive: true, force: true });
    }
    }finally{exportPending=false;}
  });
  ipcMain.handle('job:cancel', async () => { if(batchExporter.active)batchExporter.cancel();else if (exporter) { exportCancelled = true; exporter.terminate(); } else await engine?.call('cancel'); });
}
app.whenReady().then(async () => {
  const root = app.isPackaged ? join(process.resourcesPath, 'native') : resolve(__dirname, '../../../../build/native');
  binary = join(root, executableName('captraw-engine')); resources = join(root, 'resources');
  cache = join(app.getPath('userData'), 'preview-cache', randomUUID()); await mkdir(cache, { recursive: true });
  const segmentation=app.isPackaged?join(process.resourcesPath,'segmentation'):resolve(__dirname,'../../../../build/segmentation');
  objects=new ObjectSelection(binary,resources,join(segmentation,executableName('captraw-segment')),join(segmentation,'models','small'),cache,(id,message)=>send({event:'object-progress',id,message}));
  autoPerspective=new AutoPerspective(binary,resources,cache);
  brushes=new BrushPreparation(binary,resources,cache,()=>native());
  synchronizer=new Synchronizer(binary,resources,cache,message=>send({event:'synchronize-progress',message}));
  const xmp=new XMP(app.isPackaged?join(root,executableName('captraw-xmp')):resolve(__dirname,'../../../../build/xmp',executableName('captraw-xmp')));
  documents=new Documents(xmp);
  batchSaver=new BatchDocumentSaver(binary,resources,cache,documents,message=>send({event:'save-progress',message}));
  sessionSaver=new SessionDocumentSaver(binary,resources,cache,documents,async targets=>{
    const {response}=await dialog.showMessageBox(win,{type:'warning',message:'确认保存这些 XMP 旁车？',detail:targets.map(target=>`${target.output} · ${target.exists?'已存在，将替换':'新建'}${target.changed?' · 目标已变化，需重新确认':''}`).join('\n')+'\n原片不会修改；现有 XMP 的未知字段将保留。',buttons:['取消','保存'],defaultId:0,cancelId:0,noLink:true});
    return response===1;
  },message=>send({event:'save-progress',message}));
  inputProfiles=new InputProfiles(join(app.getPath('userData'),'input-profiles'),{call:(method,params)=>native().call(method,params)},xmp);
  presets=new Presets(join(app.getPath('userData'),'xmp-presets'),{call:(method,params)=>native().call(method,params)},cache,xmp);
  presetPreviewSynchronizer=new Synchronizer(binary,resources,join(cache,'preset-hover'),()=>{});
  presetPreview=new PresetPreview(new Presets(join(app.getPath('userData'),'xmp-presets'),{call:(method,params)=>native().call(method,params)},join(cache,'preset-hover'),xmp),presetPreviewSynchronizer);
  batchExporter=new BatchExporter(binary,resources,cache,job=>send({event:'job',job}),xmp);
  protocol.handle('captraw', async request => {
    const url = new URL(request.url);
    if (url.host === 'preview') {
      const key=decodeURIComponent(url.pathname.slice(1));const file = frames.get(key)||comparisonFrames.get(key)||synchronizer.previews.get(key)||presetPreviewSynchronizer.previews.get(key)||objects.previews.get(key);
      if(!file)return new Response('Expired preview', { status: 404 });
      const response=await net.fetch(pathToFileURL(file).href);
      const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');
      return new Response(response.body,{status:response.status,headers});
    }
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const base = resolve(__dirname, '../renderer');
    const file = resolve(base, '.' + decodeURIComponent(url.pathname));
    return isContainedFile(base,file) ? net.fetch(pathToFileURL(file).href) : new Response('Not found', { status: 404 });
  });
  registerIPC();
  win = new BrowserWindow({ show: !backgroundTest, focusable: !backgroundTest, width: 1480, height: 960, minWidth: 1080, minHeight: 720, backgroundColor: '#17191b', title: 'CaptRAW', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 17 }, webPreferences: { backgroundThrottling: !backgroundTest, preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close',event=>{if(batchSaver.active){event.preventDefault();batchSaver.cancel();send({event:'save-progress',message:'正在完成当前文件；保存结束后可退出。'});}else if(dirtyCount&&!quitting){event.preventDefault();void confirmQuit();}});
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('captraw://app/') && !url.startsWith('http://127.0.0.1:5173')) event.preventDefault(); });
  const command=(command:Extract<EngineEvent,{event:'command'}>['command'])=>send({event:'command',command});
  const editCommand=async(action:'copy-all'|'copy-selected'|'paste')=>{
    const target=win;if(!target||target.isDestroyed())return;
    const text=await target.webContents.executeJavaScript("!!document.activeElement?.closest('input,textarea,select,[contenteditable]')");
    if(target.isDestroyed())return;
    if(text){if(action==='copy-all')target.webContents.copy();else if(action==='paste')target.webContents.paste();return;}
    command(action);
  };
  const edit=(action:'copy-all'|'copy-selected'|'paste')=>{void editCommand(action).catch(error=>send({event:'error',message:String(error)}));};
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'CaptRAW', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },{label:'文件',submenu:[{label:'打开…',accelerator:'CommandOrControl+O',click:()=>command('open')},{label:'导出设置…',accelerator:'CommandOrControl+S',click:()=>command('export')},{label:'保存 XMP 编辑…',accelerator:'CommandOrControl+Shift+S',click:()=>command('save')},{label:'关闭文件',accelerator:'CommandOrControl+W',click:()=>command('close')}]}, { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, {label:'复制',accelerator:'CommandOrControl+C',click:()=>edit('copy-all')},{label:'复制所选设置…',accelerator:'CommandOrControl+Alt+C',click:()=>edit('copy-selected')},{label:'粘贴',accelerator:'CommandOrControl+V',click:()=>edit('paste')}, { role: 'selectAll' }] }, { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }]));
  if (process.env.CAPTRAW_DEV_URL) await win.loadURL(process.env.CAPTRAW_DEV_URL); else await win.loadURL('captraw://app/index.html');
});
app.on('window-all-closed', () => app.quit());
async function confirmQuit(){
  if(checkingQuit)return;checkingQuit=true;
  try{const {response}=await dialog.showMessageBox(win,{type:'warning',message:`还有 ${dirtyCount} 张照片的编辑未保存`,detail:'返回工作台可保存编辑。放弃并退出不会修改原始照片或已保存的配方。',buttons:['继续编辑','放弃并退出'],defaultId:0,cancelId:0,noLink:true});if(response===1){quitting=true;app.quit();}}
  finally{checkingQuit=false;}
}
app.on('before-quit', event => {if(batchSaver?.active||sessionSaver?.active){event.preventDefault();batchSaver?.cancel();sessionSaver?.cancel();send({event:'save-progress',message:'正在完成当前文件；保存结束后可退出。'});return;}if(dirtyCount&&!quitting){event.preventDefault();void confirmQuit();return;} quitting = true;if(presetPreview&&!presetPreviewStopping){event.preventDefault();presetPreviewStopping=true;void presetPreview.shutdown().catch(error=>console.error('Preset preview shutdown failed:',error)).finally(()=>app.quit());return;}autoPerspective?.cancel();void brushes?.cancel();stopComparison(); objects?.shutdown();synchronizer?.cancel();batchExporter?.shutdown();engine?.terminate();openingEngine?.terminate(); exporter?.terminate();if(exportTemp)rmSync(exportTemp,{force:true}); if (cache) rmSync(cache, { recursive: true, force: true }); });
