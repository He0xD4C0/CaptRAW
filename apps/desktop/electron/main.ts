import { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu, shell } from 'electron';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { readdir, stat, realpath, rename, mkdir, rm } from 'node:fs/promises';
import { existsSync,rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {AutoPerspective,CurveSampling,ObjectSelection,BrushPreparation} from '@captraw/desktop-core/editing';
import {NativeEngine,executableName,isContainedFile,captureSourceIdentity,verifySourceIdentity} from '@captraw/desktop-core/engine';
import {restoreRecipeMasks,XMP,Documents,BatchDocumentSaver,SessionDocumentSaver,nativeSidecar} from '@captraw/desktop-core/documents';
import {Presets,PresetPreview,Synchronizer} from '@captraw/desktop-core/presets';
import {InputProfiles} from '@captraw/desktop-core/profiles';
import {BatchExporter} from '@captraw/desktop-core/export';
import {registerIpc} from './ipc/index.js';
import type {MainRuntime} from './ipc/context.js';
import {SYNC_GROUPS} from '@captraw/contracts/synchronize';
import type { ImageSession, EditDocument, EngineEvent,SourceIdentity } from '@captraw/contracts';
import {mergeAdjustmentPatch,partialAdjustmentGroups,sourceFrameOpenSnapshot,sourceFramePolicyForDocument} from '@captraw/contracts';
protocol.registerSchemesAsPrivileged([{ scheme: 'captraw', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const backgroundTest=process.env.CAPTRAW_E2E_BACKGROUND==='1';
if(backgroundTest&&process.env.CAPTRAW_E2E_USER_DATA)app.setPath('userData',resolve(process.env.CAPTRAW_E2E_USER_DATA));
if(backgroundTest&&process.platform==='darwin')app.setActivationPolicy('accessory');
let presets:Presets;
let presetPreview:PresetPreview;
let presetPreviewStopping=false;
let presetPreviewSynchronizer:Synchronizer;
let documents:Documents;
let xmp:XMP;
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
type OpenDocument=Awaited<ReturnType<Documents['readForImage']>>;
// Reopening an in-session photo uses the same opening interpretation; the
// renderer then restores its immutable current edit, without another import.
const openingDocuments=new Map<string,{loaded:OpenDocument|undefined;recipeFile:string}>();
async function openImage(path: string,expectedSource?:SourceIdentity) {
  autoPerspective.cancel();path=resolve(path);
  const explicitNative=/\.captraw$/i.test(path),explicitXMP=/\.xmp$/i.test(path),explicitRecipe=explicitNative||explicitXMP;
  if(/\.json$/i.test(path))throw new Error('旧 JSON 编辑格式不受支持，请使用 .captraw 文件。');
  let recipeFile=explicitRecipe?path:nativeSidecar(path),loaded:OpenDocument|undefined;
  const remembered=!explicitRecipe&&expectedSource?openingDocuments.get(path):undefined;
  if(remembered){loaded=structuredClone(remembered.loaded);recipeFile=remembered.recipeFile;}
  else{
    if(!explicitRecipe&&!existsSync(recipeFile))recipeFile=join(dirname(path),basename(path,extname(path))+'.xmp');
    if(existsSync(recipeFile)){
      loaded=await documents.readForImage(recipeFile);
      if(explicitRecipe){
        if(loaded.source)path=resolve(dirname(recipeFile),loaded.source.path);
        else{
          const stem=basename(recipeFile,extname(recipeFile)).toLowerCase();
          const candidates=(await readdir(dirname(recipeFile))).filter(name=>basename(name,extname(name)).toLowerCase()===stem&&/\.(nef|cr3|cr2|arw|raf|dng|orf|rw2|pef|tiff?|jpe?g|png)$/i.test(name));
          if(candidates.length!==1)throw new Error('编辑文件旁未找到唯一对应原片，请打开原片后导入设置。');
          path=join(dirname(recipeFile),candidates[0]);
        }
      }
    }
    if(!loaded&&!explicitRecipe&&/\.(jpe?g|tiff?)$/i.test(path))loaded=await documents.readForImage(path);
  }
  const sourceIdentity=expectedSource===undefined?await captureSourceIdentity(path):expectedSource;
  if(expectedSource!==undefined)await verifySourceIdentity(path,expectedSource);
  if(loaded?.source&&(sourceIdentity.size!==loaded.source.size||sourceIdentity.sha256!==loaded.source.sha256))throw new Error('编辑文件关联的原片已改变，停止加载。');
  if(explicitRecipe&&dirtyPaths.has(path))throw new Error('这张照片还有未保存编辑，请先保存或关闭后再打开其他编辑文件。');
  const activeDocument=!!loaded&&!loaded.metadataOnly&&(loaded.hasDevelopSettings||!!loaded.engineVersion||!!loaded.artProfile||Object.keys(loaded.adjustments).length>0);
  const adobeImport=activeDocument&&loaded!.storageKind==='adobe-xmp';
  const currentDefaults=!activeDocument||adobeImport;
  const candidate=createEngine();openingEngine=candidate;
  try{
    const image=await candidate.call('open',{path,sessionId:randomUUID(),effectsDefaults:currentDefaults?'current':'legacy',whiteBalanceDefaults:currentDefaults?'current':'legacy',sourceFramePolicy:sourceFramePolicyForDocument(activeDocument?loaded:undefined),...sourceFrameOpenSnapshot(activeDocument?loaded!.adjustments:{},activeDocument?loaded!.artProfile:'')});
    let recipe:EditDocument|undefined,importedFromAdobe=false;const skippedImportGroups=new Set<string>();
    if(loaded&&activeDocument){
      const groups=partialAdjustmentGroups(loaded.adjustments);
      const inherited=loaded.artProfile&&groups.length?await candidate.call('adjustmentBase',{artProfile:loaded.artProfile,groups}):{};
      let adjustments=mergeAdjustmentPatch({...image.adjustments,...inherited},loaded.adjustments);
      if(loaded.adjustments.fineRotation===undefined)delete adjustments.fineRotation;
      if(loaded.adjustments.perspective===undefined)delete adjustments.perspective;
      if(!loaded.engineVersion&&(loaded.adjustments.temperature!==undefined||loaded.adjustments.tint!==undefined||loaded.adjustments.incrementalTemperature!==undefined||loaded.adjustments.incrementalTint!==undefined))adjustments={...adjustments,wbMode:'custom',wbMultipliers:null,wbApproximate:false};
      recipe={...loaded,rating:loaded.rating??image.rating,label:loaded.label??image.label,source:loaded.source||{path,size:sourceIdentity.size,sha256:sourceIdentity.sha256},adjustments};
      if(adobeImport){
        // Prepare the two independent asset groups separately. A missing Look
        // must not discard a usable mask, or a missing mask the input profile.
        recipe.artProfile='';
        for(const part of ['profile','masks'] as const){
          const partial={...recipe,adjustments:{...recipe.adjustments,colorProfile:part==='profile'?recipe.adjustments.colorProfile:image.adjustments.colorProfile,masks:part==='masks'?recipe.adjustments.masks:[]},maskAssets:part==='masks'?recipe.maskAssets:undefined,inputProfileAsset:part==='profile'?recipe.inputProfileAsset:undefined};
          try{
            const restored=await restoreRecipeMasks(candidate,recipeFile,partial,cache);
            if(part==='profile')recipe.adjustments.colorProfile=restored.adjustments.colorProfile;
            else recipe.adjustments.masks=restored.adjustments.masks;
          }catch(error){
            loaded.warnings.push(`${part==='profile'?'输入配置文件／Look':'蒙版'}未应用：`+(error instanceof Error?error.message:String(error)));
            if(part==='profile'){skippedImportGroups.add('profile');recipe.adjustments.colorProfile=image.adjustments.colorProfile;delete recipe.inputProfileAsset;}
            else{skippedImportGroups.add('masks');recipe.adjustments.masks=[];delete recipe.maskAssets;}
          }
        }
      }else recipe=await restoreRecipeMasks(candidate,recipeFile,recipe,cache);
      if(recipe.adjustments.colorProfile?.look){
        try{recipe.adjustments.colorProfile=await inputProfiles.resolveSettings(recipe.adjustments.colorProfile,image.profileCamera||image.camera,image.inputKind!=='rendered');}
        catch(error){if(!adobeImport)throw error;loaded.warnings.push('Look未应用：'+(error instanceof Error?error.message:String(error)));recipe.adjustments.colorProfile={...recipe.adjustments.colorProfile,look:null};}
      }

      let checked;
      try{checked=await candidate.call('validate',{artProfile:recipe.artProfile,adjustments:recipe.adjustments});}
      catch(error){
        if(!adobeImport||!recipe.adjustments.colorProfile?.look)throw error;
        loaded.warnings.push('Look未应用：'+(error instanceof Error?error.message:String(error)));
        recipe.adjustments.colorProfile={...recipe.adjustments.colorProfile,look:null};
        checked=await candidate.call('validate',{artProfile:recipe.artProfile,adjustments:recipe.adjustments});
      }
      if(checked.colorProfile?.mode==='inherited'&&checked.colorProfile.reference!=='(none)')inputProfiles.assertCompatible(await candidate.call('inspectInputProfile',{path:checked.colorProfile.reference.replace(/^file:/,'')}),image.profileCamera||image.camera,image.inputKind!=='rendered');
      for(const key of ['colorProfile','blackWhite','colorGrading'] as const)if(checked[key])recipe.adjustments[key]=checked[key];
      recipe.adjustments.masks=checked.masks;recipe.adjustments.fineRotation=checked.fineRotation;recipe.adjustments.perspective=checked.perspective;
      if(adobeImport&&!remembered){
        const fields=SYNC_GROUPS.filter(group=>!skippedImportGroups.has(group.id)&&group.fields.some(key=>Object.hasOwn(loaded!.adjustments,key))).map(group=>group.label).join('、')||'没有可应用的显影参数';
        const {response}=await dialog.showMessageBox(win,{type:'question',message:'导入 Adobe 设置？',detail:`${basename(path)}\nCaptRAW使用自己的显影算法，结果可能与ACR不同。\n可转换的参数项：${fields}\n${loaded.warnings.join('\n')}\n保存将使用 .captraw，源XMP不修改。`,buttons:['使用默认显影','导入 Adobe 设置'],defaultId:0,cancelId:0,noLink:true});
        if(response===1)importedFromAdobe=true;
        else{
          loaded.metadataOnly=true;loaded.hasDevelopSettings=false;loaded.warnings=[];
          recipe={...recipe,artProfile:image.artProfile,adjustments:structuredClone(image.adjustments),maskAssets:undefined,inputProfileAsset:undefined};
        }
      }else importedFromAdobe=adobeImport;
    }else if(loaded)recipe={...loaded,rating:loaded.rating??image.rating,label:loaded.label??image.label,source:loaded.source||{path,size:sourceIdentity.size,sha256:sourceIdentity.sha256},artProfile:image.artProfile||'',adjustments:structuredClone(image.adjustments)};
    if(quitting)throw new Error('应用正在退出。');
    await verifySourceIdentity(path,sourceIdentity);
    if(loaded)loaded.warnings=[...new Set(loaded.warnings)];
    openingDocuments.set(path,{loaded:structuredClone(loaded),recipeFile});
    stopComparison();const previous=engine;engine=candidate;previous?.terminate();
    const next:ImageSession={...image,sourceIdentity,rating:recipe?.rating??image.rating,label:recipe?.label??image.label,initialAdjustments:image.adjustments,initialArtProfile:image.artProfile,recipe,xmpWarnings:loaded?.warnings,importedFromAdobe,needsNativeSave:importedFromAdobe||loaded?.storageKind==='legacy-xmp'};
    if(recipe)next.adjustments=recipe.adjustments;session=next;
    return next;
  }catch(error){candidate.terminate();throw error;}finally{if(openingEngine===candidate)openingEngine=undefined;}
}

function registerIPC() {
  const runtime:MainRuntime={
    get win(){return win;},set win(value){win=value;},
    binary,resources,cache,send,
    get session(){return session;},set session(value){session=value;},
    get engine(){return engine;},set engine(value){engine=value;},
    get openingEngine(){return openingEngine;},set openingEngine(value){openingEngine=value;},
    get comparisonEngine(){return comparisonEngine;},set comparisonEngine(value){comparisonEngine=value;},
    get comparisonSequence(){return comparisonSequence;},set comparisonSequence(value){comparisonSequence=value;},
    comparisonFrames,
    autoPerspective,
    get curveSampling(){return curveSampling;},set curveSampling(value){curveSampling=value;},
    get exporter(){return exporter;},set exporter(value){exporter=value;},
    get exportCancelled(){return exportCancelled;},set exportCancelled(value){exportCancelled=value;},
    get exportTemp(){return exportTemp;},set exportTemp(value){exportTemp=value;},
    get exportPending(){return exportPending;},set exportPending(value){exportPending=value;},
    get savePending(){return savePending;},set savePending(value){savePending=value;},
    get openingImage(){return openingImage;},set openingImage(value){openingImage=value;},
    get quitting(){return quitting;},set quitting(value){quitting=value;},
    get dirtyCount(){return dirtyCount;},set dirtyCount(value){dirtyCount=value;},
    dirtyPaths,
    frames,
    openingDocuments,
    documents,batchSaver,sessionSaver,inputProfiles,presets,presetPreview,synchronizer,objects,brushes,batchExporter,xmp,
    get brushSnapshot(){return brushSnapshot;},set brushSnapshot(value){brushSnapshot=value;},
    native,requireSession,openImage,stopComparison,
  };
  registerIpc(ipcMain,dialog,app,runtime);
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
  xmp=new XMP(app.isPackaged?join(root,executableName('captraw-xmp')):resolve(__dirname,'../../../../build/xmp',executableName('captraw-xmp')));
  documents=new Documents(xmp);
  batchSaver=new BatchDocumentSaver(binary,resources,cache,documents,message=>send({event:'save-progress',message}));
  sessionSaver=new SessionDocumentSaver(binary,resources,cache,documents,async targets=>{
    const {response}=await dialog.showMessageBox(win,{type:'warning',message:'确认保存这些 CaptRAW 编辑文件？',detail:targets.map(target=>`${target.output} · ${target.exists?'已存在，将替换':'新建'}${target.changed?' · 目标已变化，需重新确认':''}`).join('\n')+'\n原片和源XMP不会修改；导入来源资料将随编辑文件保留。',buttons:['取消','保存'],defaultId:0,cancelId:0,noLink:true});
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
  app.setAboutPanelOptions({applicationName:'CaptRAW',applicationVersion:app.getVersion(),version:app.getVersion(),copyright:'Copyright (C) 2026 CaptRAW Contributors',website:'https://github.com/He0xD4C0/CaptRAW'});
  const projectRoot=resolve(__dirname,'../../../..');
  const notices=()=>app.isPackaged?[
    join(process.resourcesPath,'native','licenses','CaptRAW-LICENSE.txt'),
    join(process.resourcesPath,'native','licenses','CaptRAW-COPYRIGHT.txt'),
    join(process.resourcesPath,'native','licenses','README.md'),
  ]:[
    join(projectRoot,'LICENSE'),
    join(projectRoot,'COPYRIGHT'),
    join(projectRoot,'THIRD_PARTY.md'),
  ];
  const showLicenses=async()=>{
    const paths=notices();
    const {response}=await dialog.showMessageBox(win,{type:'info',message:'CaptRAW 许可证与版权',detail:'Copyright (C) 2026 CaptRAW Contributors\nGPL-3.0-or-later，无担保。\n\nCaptRAW 包含 ART、RawTherapee 及其他第三方组件；完整许可证与来源随应用分发。',buttons:['GPL 许可证','版权声明','第三方声明','关闭'],defaultId:0,cancelId:3,noLink:true});
    if(response===3)return;
    const error=await shell.openPath(paths[response]);
    if(error)await dialog.showMessageBox(win,{type:'error',message:'无法打开许可证文件',detail:error,buttons:['关闭'],noLink:true});
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'CaptRAW', submenu: [{ role: 'about' },{label:'许可证与版权…',click:()=>void showLicenses().catch(error=>send({event:'error',message:String(error)}))}, { type: 'separator' }, { role: 'quit' }] },{label:'文件',submenu:[{label:'打开…',accelerator:'CommandOrControl+O',click:()=>command('open')},{label:'导出设置…',accelerator:'CommandOrControl+S',click:()=>command('export')},{label:'保存 CaptRAW 编辑…',accelerator:'CommandOrControl+Shift+S',click:()=>command('save')},{label:'关闭文件',accelerator:'CommandOrControl+W',click:()=>command('close')}]}, { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, {label:'复制',accelerator:'CommandOrControl+C',click:()=>edit('copy-all')},{label:'复制所选设置…',accelerator:'CommandOrControl+Alt+C',click:()=>edit('copy-selected')},{label:'粘贴',accelerator:'CommandOrControl+V',click:()=>edit('paste')}, { role: 'selectAll' }] }, { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }]));
  if (process.env.CAPTRAW_DEV_URL) await win.loadURL(process.env.CAPTRAW_DEV_URL); else await win.loadURL('captraw://app/index.html');
});
app.on('window-all-closed', () => app.quit());
async function confirmQuit(){
  if(checkingQuit)return;checkingQuit=true;
  try{const {response}=await dialog.showMessageBox(win,{type:'warning',message:`还有 ${dirtyCount} 张照片的编辑未保存`,detail:'返回工作台可保存编辑。放弃并退出不会修改原始照片或已保存的配方。',buttons:['继续编辑','放弃并退出'],defaultId:0,cancelId:0,noLink:true});if(response===1){quitting=true;app.quit();}}
  finally{checkingQuit=false;}
}
app.on('before-quit', event => {if(batchSaver?.active||sessionSaver?.active){event.preventDefault();batchSaver?.cancel();sessionSaver?.cancel();send({event:'save-progress',message:'正在完成当前文件；保存结束后可退出。'});return;}if(dirtyCount&&!quitting){event.preventDefault();void confirmQuit();return;} quitting = true;if(presetPreview&&!presetPreviewStopping){event.preventDefault();presetPreviewStopping=true;void presetPreview.shutdown().catch(error=>console.error('Preset preview shutdown failed:',error)).finally(()=>app.quit());return;}autoPerspective?.cancel();void brushes?.cancel();stopComparison(); objects?.shutdown();synchronizer?.cancel();batchExporter?.shutdown();engine?.terminate();openingEngine?.terminate(); exporter?.terminate();if(exportTemp)rmSync(exportTemp,{force:true}); if (cache) rmSync(cache, { recursive: true, force: true }); });
