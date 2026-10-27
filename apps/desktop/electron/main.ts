import { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } from 'electron';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { readdir, stat, rename, mkdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync,rmSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { NativeEngine } from '@captraw/desktop-core/engine';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ObjectSelection} from '@captraw/desktop-core/object-selection';
import {Presets} from '@captraw/desktop-core/presets';
import {XMP} from '@captraw/desktop-core/xmp';
import {Documents,BatchDocumentSaver,validateBatchSave} from '@captraw/desktop-core/documents';
import {InputProfiles} from '@captraw/desktop-core/input-profiles';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {validateExportOptions} from '@captraw/contracts/export-options';
import {BatchExporter,validateBatch} from '@captraw/desktop-core/batch-export';
import type { ImageSession, EditDocument, EngineEvent } from '@captraw/contracts';
import {ENGINE_VERSION,OUTPUT_COLOR_SPACES,type OutputColorSpace} from '@captraw/contracts';
protocol.registerSchemesAsPrivileged([{ scheme: 'captraw', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const backgroundTest=process.env.CAPTRAW_E2E_BACKGROUND==='1';
if(backgroundTest&&process.env.CAPTRAW_E2E_USER_DATA)app.setPath('userData',resolve(process.env.CAPTRAW_E2E_USER_DATA));
if(backgroundTest&&process.platform==='darwin')app.setActivationPolicy('accessory');
let presets:Presets;
let documents:Documents;
let batchSaver:BatchDocumentSaver;
let savePending=false;
let inputProfiles:InputProfiles;
let objects:ObjectSelection;
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
  e.on('engine-event', async message => {
    if (message.event === 'preview') {
      const frame = message.frame;
      if (frame.sessionId !== session?.id) return;
      const token = `${frame.sessionId}/${basename(frame.file)}`;
      const file = resolve(frame.file);
      if (!file.startsWith(cache + '/')) return;
      frames.set(token, file);
      let mask=null;
      if(frame.mask?.file&&resolve(frame.mask.file).startsWith(cache+'/')){
        const maskToken=`${frame.sessionId}/${basename(frame.mask.file)}`;frames.delete(maskToken);frames.set(maskToken,resolve(frame.mask.file));
        mask={...frame.mask,url:`captraw://preview/${maskToken}`};
      }
      let luminance=null;
      if(frame.luminance?.file&&resolve(frame.luminance.file).startsWith(cache+'/')){
        const lightToken=`${frame.sessionId}/${basename(frame.luminance.file)}`;frames.delete(lightToken);frames.set(lightToken,resolve(frame.luminance.file));
        luminance={...frame.luminance,url:`captraw://preview/${lightToken}`};
      }
      send({ event: 'preview', frame: { ...frame, mask, luminance, url: `captraw://preview/${token}` } });
      const entries = [...frames.entries()];
      for (const [key, old] of entries.slice(0, -12)) { frames.delete(key); await rm(old, { force: true }).catch(() => {}); }
    } else if (message.event === 'error' && e===engine && !quitting) send(message);
  });
  return e;
}
function native() {
  if (!engine?.alive) engine = createEngine();
  return engine;
}
async function hashFile(path: string) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
function requireSession(id: string) {
  if (openingImage || !session || session.id !== id) throw new Error('当前图片正在切换，请等待载入完成后重试。'); return session;
}
async function openImage(path: string) {
  path=resolve(path);const explicitRecipe=/\.xmp$/i.test(path);
  if(/\.json$/i.test(path))throw new Error('仅支持 XMP 编辑文件；旧 JSON 格式已移除。');
  const recipeFile=explicitRecipe?path:join(dirname(path),basename(path,extname(path))+'.xmp');
  let loaded:Awaited<ReturnType<Documents['read']>>|undefined;
  if(existsSync(recipeFile)){
    loaded=await documents.read(recipeFile);
    if(explicitRecipe){
      if(loaded.source)path=resolve(dirname(recipeFile),loaded.source.path);
      else{
        const stem=basename(recipeFile,extname(recipeFile)).toLowerCase();
        const candidates=(await readdir(dirname(recipeFile))).filter(name=>basename(name,extname(name)).toLowerCase()===stem&&/\.(nef|cr3|cr2|arw|raf|dng|orf|rw2|pef|tiff?|jpe?g|png)$/i.test(name));
        if(candidates.length!==1)throw new Error('XMP 旁边未找到唯一同名原片。请将 XMP 与对应原片放在同一目录后重试。');
        path=join(dirname(recipeFile),candidates[0]);
      }
    }
    if(loaded.source&&((await stat(path)).size!==loaded.source.size||await hashFile(path)!==loaded.source.sha256))throw new Error('XMP 关联的原始图片已改变，停止加载编辑。');
  }
  if(explicitRecipe&&dirtyPaths.has(path))throw new Error('这张照片还有未保存编辑。请先保存或关闭照片，再打开其他编辑文件。');
  const candidate=createEngine();openingEngine=candidate;
  try{
  const image=await candidate.call('open',{path,sessionId:randomUUID()});
  let recipe:EditDocument|undefined;
  if(loaded){
    let adjustments={...image.adjustments,...loaded.adjustments};
    if(!loaded.engineVersion&&(loaded.adjustments.temperature!==undefined||loaded.adjustments.tint!==undefined))adjustments={...adjustments,wbMode:'custom',wbMultipliers:null,wbApproximate:false};
    recipe={...loaded,source:loaded.source||{path,size:(await stat(path)).size,sha256:await hashFile(path)},adjustments};
    recipe=await restoreRecipeMasks(candidate,recipeFile,recipe,cache);
    const checked=await candidate.call('validate',{artProfile:recipe.artProfile,adjustments:recipe.adjustments});
    if(checked.colorProfile?.mode==='inherited'&&checked.colorProfile.reference!=='(none)')inputProfiles.assertCompatible(await candidate.call('inspectInputProfile',{path:checked.colorProfile.reference.replace(/^file:/,'')}),image.profileCamera||image.camera,/\.(nef|cr3|cr2|arw|raf|dng|orf|rw2|pef)$/i.test(path));
    for(const key of ['colorProfile','blackWhite','colorGrading'] as const)if(checked[key])recipe.adjustments[key]=checked[key];
  }
  if(quitting)throw new Error('应用正在退出。');
  stopComparison();const previous=engine;engine=candidate;previous?.terminate();
  session={...image,initialAdjustments:image.adjustments,recipe,xmpWarnings:loaded?.warnings};
  if(recipe)session!.adjustments=recipe.adjustments;
  return session;
  }catch(error){candidate.terminate();throw error;}finally{if(openingEngine===candidate)openingEngine=undefined;}
}
function registerIPC() {
  ipcMain.handle('comparison:update',async(_,p)=>{
    const current=requireSession(p.sessionId);stopComparison();if(!p.settings)return;
    const sequence=comparisonSequence,directory=join(cache,'comparison-'+randomUUID()),worker=new NativeEngine(binary,resources,directory);comparisonEngine=worker;
    worker.child.once('close',()=>{void rm(directory,{recursive:true,force:true}).catch(()=>{});});
    worker.on('engine-event',message=>{
      if(worker!==comparisonEngine||current.id!==session?.id)return;
      if(message.event==='preview'){
        const frame=message.frame,file=resolve(frame.file);if(!file.startsWith(cache+'/'))return;
        const key=`comparison/${sequence}/${basename(file)}`;comparisonFrames.set(key,file);
        send({event:'comparison-preview',frame:{...frame,url:`captraw://preview/${key}`}});
        for(const [key,path] of [...comparisonFrames].slice(0,-4)){comparisonFrames.delete(key);void rm(path,{force:true}).catch(()=>{});}
      }else if(message.event==='error')send({event:'comparison-error',sessionId:current.id,revision:p.revision,message:message.message});
    });
    try{
      await worker.call('open',{path:current.path,sessionId:current.id});
      if(worker!==comparisonEngine)return;
      const {rotation,crop,lensCorrections,lensProfile}=p.settings.geometry;
      await worker.call('update',{revision:p.revision,artProfile:p.settings.artProfile,adjustments:{...p.settings.adjustments,rotation,crop,lensCorrections,lensProfile}});
    }catch(error){if(worker===comparisonEngine){stopComparison();throw error;}}
  });
  ipcMain.handle('comparison:viewport',async(_,p)=>{requireSession(p.sessionId);const worker=comparisonEngine;if(worker)await worker.call('viewport',p);});

  ipcMain.handle('profiles:list',()=>inputProfiles.list());
  ipcMain.handle('profiles:inspect',(_,reference)=>inputProfiles.inspect(reference));
  ipcMain.handle('profiles:import',async(_,id)=>{
    const current=requireSession(id);
    const r=await dialog.showOpenDialog(win,{title:'导入输入配置文件',properties:['openFile'],filters:[{name:'DCP / ICC 配置文件',extensions:['dcp','icc','icm']}]});
    if(r.canceled||!r.filePaths.length)return null;requireSession(id);
    return inputProfiles.importFile(r.filePaths[0],current.profileCamera||current.camera,/\.(nef|cr3|cr2|arw|raf|dng|orf|rw2|pef)$/i.test(current.path));
  });
  ipcMain.handle('presets:list',()=>presets.list());
  ipcMain.handle('presets:create',(_,input)=>presets.create(input));
  ipcMain.handle('presets:update',(_,p)=>presets.update(p.id,p.input));
  ipcMain.handle('presets:rename',(_,p)=>presets.rename(p.id,p.name,p.group));
  ipcMain.handle('presets:delete',(_,id)=>presets.remove(id));
  ipcMain.handle('presets:apply',(_,p)=>{requireSession(p.target.image.id);return presets.apply(p.id,p.target,synchronizer);});
  ipcMain.handle('presets:import',async()=>{const r=await dialog.showOpenDialog(win,{title:'导入 XMP 预设',properties:['openFile'],filters:[{name:'XMP 预设',extensions:['xmp']}]});return r.canceled||!r.filePaths.length?null:presets.importFile(r.filePaths[0]);});
  ipcMain.handle('presets:export',async(_,id)=>{const r=await dialog.showSaveDialog(win,{title:'导出 XMP 预设',message:'移动预设时请同时保留配套 .assets 文件夹。',defaultPath:'预设.xmp',filters:[{name:'XMP 预设',extensions:['xmp']}]});if(r.canceled||!r.filePath)return null;await presets.exportFile(id,r.filePath);return r.filePath;});
  ipcMain.handle('object:begin',(_,p)=>objects.begin(requireSession(p.sessionId),p.adjustments,p.artProfile));
  ipcMain.handle('object:predict',(_,p)=>objects.predict(p.id,p.prompts,p.box));
  ipcMain.handle('object:commit',(_,p)=>objects.commit(p.id,p.revision,p.index));
  ipcMain.handle('object:cancel',(_,id)=>objects.cancel(id));
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
  ipcMain.handle('image:open', async (_, path: string) => {
    if(openingImage)throw new Error('正在载入照片，请稍候。');
    openingImage=true;
    try{await objects.cancel();return await openImage(path);}finally{openingImage=false;}
  });
  ipcMain.handle('image:update', async (_, p) => { requireSession(p.sessionId);objects.invalidate(p.sessionId,p.adjustments); return native().call('update', p); });
  ipcMain.handle('image:viewport', async (_, p) => { requireSession(p.sessionId); await native().call('viewport', p); });
  ipcMain.handle('image:color-sample',async(_,p)=>{requireSession(p.sessionId);return native().call('sampleColor',p);});
  ipcMain.handle('image:luminance-sample',async(_,p)=>{requireSession(p.sessionId);return native().call('sampleLuminance',p);});
  ipcMain.handle('image:white-balance',async(_,p)=>{requireSession(p.sessionId);return native().call('whiteBalance',p.request);});
  ipcMain.handle('image:close', async () => { stopComparison();await objects.cancel();await engine?.call('close'); session = undefined; });
  ipcMain.handle('recipes:save',async(_,request)=>{
    if(savePending)throw new Error('已有批量保存任务正在运行。');
    validateBatchSave(request);savePending=true;
    try{
      const result=await dialog.showOpenDialog(win,{title:`保存 ${request.documents.length} 张照片的 XMP：选择文件夹`,message:'每张照片生成独立 XMP，包含蒙版和配置文件资产。同名文件保留，新文件自动编号。',properties:['openDirectory','createDirectory']});
      if(result.canceled||!result.filePaths.length)return null;
      return await batchSaver.run(request,result.filePaths[0]);
    }finally{savePending=false;}
  });
  ipcMain.handle('recipes:cancel',()=>batchSaver.cancel());
  ipcMain.handle('recipe:save', async (_, { session: supplied, artProfile }: { session: ImageSession; artProfile: string }) => {
    const current = requireSession(supplied.id);
    const result = await dialog.showSaveDialog(win, { title: '保存无损编辑配方', message: '含外部蒙版或输入配置文件时会同时保存资产文件夹；移动配方时请保留配套文件夹。', defaultPath: join(dirname(current.path),basename(current.path,extname(current.path))+'.xmp'), filters: [{ name: 'XMP 编辑文件', extensions: ['xmp'] }] });
    if (result.canceled || !result.filePath) return '';
    if (resolve(result.filePath) === current.path || !/\.xmp$/i.test(result.filePath)) throw new Error('请使用 .xmp 保存编辑。');
    await native().call('validate',{artProfile,adjustments:supplied.adjustments});
    const source = await stat(current.path);
    const recipe: EditDocument = { xmpPacket: existsSync(result.filePath)?(await documents.xmp.read(result.filePath)).packet:current.recipe?.xmpPacket, engineVersion: ENGINE_VERSION, source: { path: current.path, size: source.size, sha256: await hashFile(current.path) }, artProfile, adjustments: supplied.adjustments,baselineVersion:4 };
    await saveRecipeWithMasks(native(),result.filePath,recipe,value=>documents.serialize(value));
    current.recipe={...recipe,xmpPacket:(await documents.xmp.read(result.filePath)).packet};
    return result.filePath;
  });
  ipcMain.handle('image:export', async (_, { sessionId, artProfile, format, colorSpace='srgb', options }) => {
    const current = requireSession(sessionId);
    if (exportPending) throw new Error('已有导出任务正在运行。');
    if (!['jpeg','tiff'].includes(format)) throw new Error('不支持的导出格式。');
    if(typeof colorSpace!=='string'||!Object.hasOwn(OUTPUT_COLOR_SPACES,colorSpace))throw new Error('不支持的输出色彩空间。');
    validateExportOptions(options);
    exportPending=true;
    try{
    const colorName=OUTPUT_COLOR_SPACES[colorSpace as OutputColorSpace];
    const extension = format === 'jpeg' ? 'jpg' : 'tiff';
    const result = await dialog.showSaveDialog(win, { title: '导出照片', defaultPath: join(dirname(current.path), `${basename(current.path, extname(current.path))}_CaptRAW.${extension}`), filters: [{ name: `${format === 'jpeg' ? 'JPEG' : 'TIFF · 16 位'} · ${colorName}`, extensions: [extension] }] });
    if (result.canceled || !result.filePath) return null;
    if(!(format==='jpeg'?/\.(jpg|jpeg)$/i:/\.(tif|tiff)$/i).test(result.filePath))throw new Error('请选择与导出格式对应的 JPEG 或 TIFF 文件名。');
    if (resolve(result.filePath) === current.path || /\.(nef|cr3|cr2|arw|raf|dng|xmp|arp)$/i.test(result.filePath)) throw new Error('不能覆盖原始照片或编辑资产。');
    const job = randomUUID(), temp = `${result.filePath}.${job}.tmp`;
    exportTemp=temp;
    exportCancelled = false;
    const worker = new NativeEngine(binary, resources, join(cache, `export-${job}`)); exporter = worker;
    worker.on('engine-event', m => { if (m.event === 'progress') send({ event: 'job', job: { id: job, state: 'running', progress: m.progress, message: '正在处理并导出照片…' } }); });
    send({ event: 'job', job: { id: job, state: 'running', progress: 0, message: '正在处理并导出照片…' } });
    try {
      await worker.call('export', { path: current.path, artProfile, output: temp, format, colorSpace, options });
      if (exportCancelled) throw new Error('已取消导出');
      await rename(temp, result.filePath);
      send({ event: 'job', job: { id: job, state: 'done', progress: 1, message: `已导出 ${basename(result.filePath)}` } });
      return result.filePath;
    } catch (error) {
      send({ event: 'job', job: { id: job, state: exportCancelled ? 'cancelled' : 'error', progress: 0, message: exportCancelled ? '已取消导出' : String(error) } });
      if (!exportCancelled) throw error; return null;
    } finally { worker.terminate(); exporter = undefined;exportTemp=undefined; await rm(temp, { force: true }); await rm(join(cache, `export-${job}`), { recursive: true, force: true }); }
    }finally{exportPending=false;}
  });
  ipcMain.handle('job:cancel', async () => { if(batchExporter.active)batchExporter.cancel();else if (exporter) { exportCancelled = true; exporter.terminate(); } else await engine?.call('cancel'); });
}
app.whenReady().then(async () => {
  const root = app.isPackaged ? join(process.resourcesPath, 'native') : resolve(__dirname, '../../../../build/native');
  binary = join(root, 'captraw-engine'); resources = join(root, 'resources');
  cache = join(app.getPath('userData'), 'preview-cache', randomUUID()); await mkdir(cache, { recursive: true });
  const segmentation=app.isPackaged?join(process.resourcesPath,'segmentation'):resolve(__dirname,'../../../../build/segmentation');
  objects=new ObjectSelection(binary,resources,join(segmentation,'captraw-segment'),join(segmentation,'models/small'),cache,(id,message)=>send({event:'object-progress',id,message}));
  synchronizer=new Synchronizer(binary,resources,cache,message=>send({event:'synchronize-progress',message}));
  const xmp=new XMP(app.isPackaged?join(root,'captraw-xmp'):resolve(__dirname,'../../../../build/xmp/captraw-xmp'));
  documents=new Documents(xmp);
  batchSaver=new BatchDocumentSaver(binary,resources,cache,documents,message=>send({event:'save-progress',message}));
  inputProfiles=new InputProfiles(join(app.getPath('userData'),'input-profiles'),{call:(method,params)=>native().call(method,params)});
  presets=new Presets(join(app.getPath('userData'),'xmp-presets'),{call:(method,params)=>native().call(method,params)},cache,xmp);
  batchExporter=new BatchExporter(binary,resources,cache,job=>send({event:'job',job}));
  protocol.handle('captraw', async request => {
    const url = new URL(request.url);
    if (url.host === 'preview') {
      const key=decodeURIComponent(url.pathname.slice(1));const file = frames.get(key)||comparisonFrames.get(key)||synchronizer.previews.get(key)||objects.previews.get(key);
      if(!file)return new Response('Expired preview', { status: 404 });
      const response=await net.fetch(pathToFileURL(file).href);
      const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');
      return new Response(response.body,{status:response.status,headers});
    }
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const base = resolve(__dirname, '../renderer');
    const file = resolve(base, '.' + decodeURIComponent(url.pathname));
    return file.startsWith(base + '/') ? net.fetch(pathToFileURL(file).href) : new Response('Not found', { status: 404 });
  });
  registerIPC();
  win = new BrowserWindow({ show: !backgroundTest, focusable: !backgroundTest, width: 1480, height: 960, minWidth: 1080, minHeight: 720, backgroundColor: '#17191b', title: 'CaptRAW', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 17 }, webPreferences: { backgroundThrottling: !backgroundTest, preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close',event=>{if(batchSaver.active){event.preventDefault();batchSaver.cancel();send({event:'save-progress',message:'正在完成当前文件；保存结束后可退出。'});}else if(dirtyCount&&!quitting){event.preventDefault();void confirmQuit();}});
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('captraw://app/') && !url.startsWith('http://127.0.0.1:5173')) event.preventDefault(); });
  const command=(command:'open'|'save'|'close')=>send({event:'command',command});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'CaptRAW', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },{label:'文件',submenu:[{label:'打开…',accelerator:'CommandOrControl+O',click:()=>command('open')},{label:'保存编辑…',accelerator:'CommandOrControl+S',click:()=>command('save')},{label:'关闭文件',accelerator:'CommandOrControl+W',click:()=>command('close')}]}, { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }, { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }]));
  if (process.env.CAPTRAW_DEV_URL) await win.loadURL(process.env.CAPTRAW_DEV_URL); else await win.loadURL('captraw://app/index.html');
});
app.on('window-all-closed', () => app.quit());
async function confirmQuit(){
  if(checkingQuit)return;checkingQuit=true;
  try{const {response}=await dialog.showMessageBox(win,{type:'warning',message:`还有 ${dirtyCount} 张照片的编辑未保存`,detail:'返回工作台可保存编辑。放弃并退出不会修改原始照片或已保存的配方。',buttons:['继续编辑','放弃并退出'],defaultId:0,cancelId:0,noLink:true});if(response===1){quitting=true;app.quit();}}
  finally{checkingQuit=false;}
}
app.on('before-quit', event => {if(batchSaver?.active){event.preventDefault();batchSaver.cancel();send({event:'save-progress',message:'正在完成当前文件；保存结束后可退出。'});return;}if(dirtyCount&&!quitting){event.preventDefault();void confirmQuit();return;} quitting = true;stopComparison(); objects?.shutdown();synchronizer?.cancel();batchExporter?.shutdown();engine?.terminate();openingEngine?.terminate(); exporter?.terminate();if(exportTemp)rmSync(exportTemp,{force:true}); if (cache) rmSync(cache, { recursive: true, force: true }); });
