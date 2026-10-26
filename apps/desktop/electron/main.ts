import { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } from 'electron';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { readFile, writeFile, stat, rename, mkdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync,rmSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { NativeEngine } from './engine';
import type { ImageSession, RecipeV1, EngineEvent, ColorProfileSettings } from '../../../packages/contracts';
import {ENGINE_VERSION} from '../../../packages/contracts';
protocol.registerSchemesAsPrivileged([{ scheme: 'captraw', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let win: BrowserWindow;
let engine: NativeEngine | undefined;
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
      send({ event: 'preview', frame: { ...frame, mask, url: `captraw://preview/${token}` } });
      const entries = [...frames.entries()];
      for (const [key, old] of entries.slice(0, -12)) { frames.delete(key); await rm(old, { force: true }).catch(() => {}); }
    } else if (message.event === 'error' && !quitting) send(message);
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
async function openImage(path: string, requestedBaseline?:2|3) {
  if(requestedBaseline!==undefined&&requestedBaseline!==2&&requestedBaseline!==3)throw new Error('不支持的初始显影版本。');
  path = resolve(path);const explicitRecipe=path.endsWith('.captraw.json');
  let recipe: RecipeV1 | undefined,restoredColorProfile:ColorProfileSettings|undefined;
  const recipeFile = path.endsWith('.captraw.json') ? path : `${path}.captraw.json`;
  if (existsSync(recipeFile)) {
    recipe = JSON.parse(await readFile(recipeFile, 'utf8'));
    if (recipe?.schemaVersion !== 1 || typeof recipe.artProfile !== 'string' || !recipe.source?.path || !recipe.adjustments) throw new Error('无法读取此编辑配方：格式或版本不受支持。原文件未修改。');
    if (![ENGINE_VERSION,'CaptRAW-3_ART-1.26.10_LibRaw-3b20539','CaptRAW-2_ART-1.26.10_LibRaw-3b20539','ART-1.26.10-1e0e12c'].includes(recipe.engineVersion)) throw new Error('此配方使用不同的显影核心版本，当前版本无法保证还原。原文件未修改。');
    if(recipe.baselineVersion!==undefined&&recipe.baselineVersion!==2&&recipe.baselineVersion!==3)throw new Error('配方的初始显影版本不受支持。原文件未修改。');
    const associated = resolve(dirname(recipeFile), recipe.source.path);
    if (path.endsWith('.captraw.json')) path = associated;
    if ((await stat(path)).size !== recipe.source.size || await hashFile(path) !== recipe.source.sha256) throw new Error('配方关联的原始图片已改变，已停止加载编辑。');
  }
  if(explicitRecipe&&dirtyPaths.has(path))throw new Error('这张照片还有未保存编辑。请先保存或关闭照片，再打开其他编辑配方。');
  if(recipe){try{restoredColorProfile=(await native().call('validate',{artProfile:recipe.artProfile,adjustments:recipe.adjustments})).colorProfile;}catch{throw new Error('此配方包含无效的显影参数。原文件未修改。');}}
  const baselineVersion=requestedBaseline??(recipe?([ENGINE_VERSION,'CaptRAW-3_ART-1.26.10_LibRaw-3b20539'].includes(recipe.engineVersion)?recipe.baselineVersion||3:2):3);
  const image = await native().call('open', { path, sessionId: randomUUID(),baselineVersion });
  session = { ...image, initialAdjustments: image.adjustments, recipe };
  if (recipe) session!.adjustments = {...image.adjustments,...recipe.adjustments,...(restoredColorProfile?{colorProfile:restoredColorProfile}:{})};
  return session;
}
function registerIPC() {
  ipcMain.handle('documents:dirty',(_,paths:string[])=>{dirtyPaths.clear();for(const path of paths)dirtyPaths.add(resolve(path));dirtyCount=dirtyPaths.size;});
  ipcMain.handle('document:confirm-close',async(_,name:string)=>{
    const {response}=await dialog.showMessageBox(win,{type:'question',message:`保存“${name}”的更改？`,detail:'保存会写入独立的编辑配方。放弃更改不会修改原片。',buttons:['保存','放弃更改','取消'],defaultId:0,cancelId:2,noLink:true});
    return ['save','discard','cancel'][response];
  });
  ipcMain.handle('files:choose', async () => (await dialog.showOpenDialog(win, { title: '打开 RAW 或编辑配方', properties: ['openFile', 'multiSelections'], filters: [{ name: '照片与配方', extensions: ['nef','cr3','cr2','arw','raf','dng','orf','rw2','pef','tif','tiff','jpg','jpeg','png','json'] }] })).filePaths);
  ipcMain.handle('image:open', async (_, path: string,baselineVersion?:2|3) => {
    if(openingImage)throw new Error('正在载入照片，请稍候。');
    openingImage=true;
    try{return await openImage(path,baselineVersion);}finally{openingImage=false;}
  });
  ipcMain.handle('image:update', async (_, p) => { requireSession(p.sessionId); return native().call('update', p); });
  ipcMain.handle('image:viewport', async (_, p) => { requireSession(p.sessionId); await native().call('viewport', p); });
  ipcMain.handle('image:white-balance',async(_,p)=>{requireSession(p.sessionId);return native().call('whiteBalance',p.request);});
  ipcMain.handle('image:before', async (_, p) => { requireSession(p.sessionId); await native().call('before', p); });
  ipcMain.handle('image:close', async () => { await engine?.call('close'); session = undefined; });
  ipcMain.handle('recipe:save', async (_, { session: supplied, artProfile }: { session: ImageSession; artProfile: string }) => {
    const current = requireSession(supplied.id);
    const result = await dialog.showSaveDialog(win, { title: '保存无损编辑配方', defaultPath: `${current.path}.captraw.json`, filters: [{ name: 'CaptRAW 编辑配方', extensions: ['captraw.json'] }] });
    if (result.canceled || !result.filePath) return '';
    if (resolve(result.filePath) === current.path || !result.filePath.endsWith('.captraw.json')) throw new Error('请使用 .captraw.json 保存配方。');
    const source = await stat(current.path);
    const recipe: RecipeV1 = { schemaVersion: 1, engineVersion: ENGINE_VERSION, source: { path: current.path, size: source.size, sha256: await hashFile(current.path) }, artProfile, adjustments: supplied.adjustments,baselineVersion:current.baselineVersion||3 };
    const temp = `${result.filePath}.${randomUUID()}.tmp`;
    try{await writeFile(temp, JSON.stringify(recipe, null, 2) + '\n'); await rename(temp, result.filePath);}
    finally{await rm(temp,{force:true});}
    return result.filePath;
  });
  ipcMain.handle('image:export', async (_, { sessionId, artProfile, format }) => {
    const current = requireSession(sessionId);
    if (exporter) throw new Error('已有导出任务正在运行。');
    if (!['jpeg','tiff'].includes(format)) throw new Error('不支持的导出格式。');
    const extension = format === 'jpeg' ? 'jpg' : 'tiff';
    const result = await dialog.showSaveDialog(win, { title: '导出照片', defaultPath: join(dirname(current.path), `${basename(current.path, extname(current.path))}_CaptRAW.${extension}`), filters: [{ name: format === 'jpeg' ? 'JPEG · sRGB' : 'TIFF · 16 位 · sRGB', extensions: [extension] }] });
    if (result.canceled || !result.filePath) return null;
    if(!(format==='jpeg'?/\.(jpg|jpeg)$/i:/\.(tif|tiff)$/i).test(result.filePath))throw new Error('请选择与导出格式对应的 JPEG 或 TIFF 文件名。');
    if (resolve(result.filePath) === current.path || /\.(nef|cr3|cr2|arw|raf|dng|xmp|arp)$/i.test(result.filePath)) throw new Error('不能覆盖原始照片或编辑资产。');
    const job = randomUUID(), temp = `${result.filePath}.${job}.tmp`;
    exportTemp=temp;
    exportCancelled = false;
    const worker = new NativeEngine(binary, resources, join(cache, `export-${job}`)); exporter = worker;
    worker.on('engine-event', m => { if (m.event === 'progress') send({ event: 'job', job: { id: job, state: 'running', progress: m.progress, message: '正在导出全分辨率照片…' } }); });
    send({ event: 'job', job: { id: job, state: 'running', progress: 0, message: '正在导出全分辨率照片…' } });
    try {
      await worker.call('export', { path: current.path, artProfile, output: temp, format });
      if (exportCancelled) throw new Error('已取消导出');
      await rename(temp, result.filePath);
      send({ event: 'job', job: { id: job, state: 'done', progress: 1, message: `已导出 ${basename(result.filePath)}` } });
      return result.filePath;
    } catch (error) {
      send({ event: 'job', job: { id: job, state: exportCancelled ? 'cancelled' : 'error', progress: 0, message: exportCancelled ? '已取消导出' : String(error) } });
      if (!exportCancelled) throw error; return null;
    } finally { worker.terminate(); exporter = undefined;exportTemp=undefined; await rm(temp, { force: true }); await rm(join(cache, `export-${job}`), { recursive: true, force: true }); }
  });
  ipcMain.handle('job:cancel', async () => { if (exporter) { exportCancelled = true; exporter.terminate(); } else await engine?.call('cancel'); });
}
app.whenReady().then(async () => {
  const root = app.isPackaged ? join(process.resourcesPath, 'native') : resolve(__dirname, '../../build/native');
  binary = join(root, 'captraw-engine'); resources = join(root, 'resources');
  cache = join(app.getPath('userData'), 'preview-cache', randomUUID()); await mkdir(cache, { recursive: true });
  protocol.handle('captraw', async request => {
    const url = new URL(request.url);
    if (url.host === 'preview') {
      const file = frames.get(decodeURIComponent(url.pathname.slice(1)));
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
  win = new BrowserWindow({ width: 1480, height: 960, minWidth: 1080, minHeight: 720, backgroundColor: '#17191b', title: 'CaptRAW', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 17 }, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close',event=>{if(dirtyCount&&!quitting){event.preventDefault();void confirmQuit();}});
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
app.on('before-quit', event => {if(dirtyCount&&!quitting){event.preventDefault();void confirmQuit();return;} quitting = true; engine?.terminate(); exporter?.terminate();if(exportTemp)rmSync(exportTemp,{force:true}); if (cache) void rm(cache, { recursive: true, force: true }); });
