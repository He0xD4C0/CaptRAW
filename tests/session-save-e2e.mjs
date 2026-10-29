import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {readDocument} from './xmp-test.mjs';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const scratch=await mkdtemp(join(tmpdir(),'captraw-session-save-e2e-'));
const photos=join(scratch,'中文 空格目录');await mkdir(photos);
const source=resolve('build/samples/synthetic.dng'),original=await readFile(source);
const files=['首张 编辑.dng','第二张 编辑.dng','失败 待另存.dng'].map(name=>join(photos,name));
for(const file of files)await copyFile(source,file);
const sidecar=i=>files[i].replace(/\.dng$/,'.xmp');
const checks=[],errors=[],artifacts={};let app,page,passed=false,failure;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const name of ['apps/desktop/dist/electron/main.cjs','apps/desktop/dist/electron/preload.cjs','apps/desktop/dist/renderer/index.html'])artifacts[name]={sha256:hash(await readFile(name)),mtime:(await stat(name)).mtime.toISOString()};
console.log('Testing existing dist without building:',JSON.stringify(artifacts));
const button=name=>page.getByRole('button',{name,exact:true});
const photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
const modal=()=>page.getByRole('dialog',{name:'保存照片编辑',exact:true});
async function hidden(){
 const state=await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})),events:globalThis.__saveWindows}));
 assert(state.windows.length&&state.windows.every(w=>!w.visible&&!w.focused&&!w.focusable),JSON.stringify(state));assert.deepEqual(state.events,[]);
}
async function pass(message){await hidden();checks.push(message);console.log('PASS',message);}
async function idle(){
 await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 await page.locator('.rendering').waitFor({state:'hidden'});
 if(await page.locator('.film-item').count())await page.waitForFunction(()=>{const f=window.__saveFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url;});
}
async function open(paths=files,count=paths.length){
 await app.evaluate(({dialog},filePaths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths});},paths);
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(count);await idle();
}
async function select(i){await idle();await photo(i).locator('.film-open').click();await expect(photo(i).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();}
async function exposure(value){
 await idle();const input=page.getByRole('spinbutton',{name:'曝光',exact:true});await expect(input).toBeVisible();
 await input.fill(String(value));await input.press('Tab');await idle();await expect(input).toHaveValue(String(value));
}
async function settings(patch){await app.evaluate((_,patch)=>Object.assign(globalThis.__saveDialogs,patch),patch);}
async function promptCount(){return app.evaluate(()=>globalThis.__saveDialogs.prompts.length);}
async function dirty(i,value){await expect(photo(i).locator('.dirty-dot')).toHaveCount(value?1:0);}
async function installWorkerGate(){
 await app.evaluate(({ipcMain})=>{
  const cp=process.getBuiltinModule('child_process');
  const spawn=cp.spawn,cancel=ipcMain._invokeHandlers.get('recipes:cancel');
  const probe=globalThis.__saveWorker={workers:[],held:false,cancelCalls:0,release:null};
  cp.spawn=function(binary,args,options){
   const child=spawn.call(this,binary,args,options);
   if(!args?.some(arg=>typeof arg==='string'&&arg.includes('/session-save-')))return child;
   const record={pid:child.pid,binary,cache:args.at(-1),compose:false,reply:false,exited:false};probe.workers.push(record);
   const write=child.stdin.write,emit=child.stdout.emit;let armed=false,held=[],pending='';
   child.stdin.write=function(chunk,...rest){
    try{const request=JSON.parse(String(chunk));if(request.method==='compose'){record.compose=true;record.source=request.params.path;armed=true;}}catch{}
    return write.call(this,chunk,...rest);
   };
   child.stdout.emit=function(event,...args){
    if(event==='data'&&armed){
     held.push(args);pending+=args[0].toString();
     for(const line of pending.split('\n').slice(0,-1)){
      const reply=JSON.parse(line);if(reply.result?.artProfile){record.reply=true;probe.held=true;}
     }
     probe.release=()=>{armed=false;for(const data of held)emit.call(child.stdout,'data',...data);held=[];};
     return true;
    }
    return emit.call(this,event,...args);
   };
   child.once('exit',()=>record.exited=true);return child;
  };
  ipcMain.removeHandler('recipes:cancel');ipcMain.handle('recipes:cancel',async(...args)=>{probe.cancelCalls++;return cancel(...args);});
  probe.restore=()=>{probe.release?.();cp.spawn=spawn;ipcMain.removeHandler('recipes:cancel');ipcMain.handle('recipes:cancel',cancel);};
 });
}
const unknown=label=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:c="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:u="urn:session-save-gui"><u:Opaque rdf:parseType="Resource"><u:Nested>${label}</u:Nested></u:Opaque><u:Qualified rdf:parseType="Resource"><rdf:value>unknown-value</rdf:value><u:Qualifier>保留 限定符</u:Qualifier></u:Qualified><c:Exposure2012 rdf:parseType="Resource"><rdf:value>0.25</rdf:value><u:Origin>外部 曝光限定符</u:Origin></c:Exposure2012></rdf:Description></rdf:RDF></x:xmpmeta>`;
try{
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(scratch,'user-data'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(String(error)));
 await app.evaluate(({app,BrowserWindow,dialog,ipcMain})=>{
  globalThis.__saveWindows=[];
  const watch=w=>{for(const event of ['show','focus'])w.on(event,()=>globalThis.__saveWindows.push({id:w.id,event}));};
  BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
  const state=globalThis.__saveDialogs={save:1,close:2,discard:0,prompts:[],closePrompts:[],saveAs:[],saveAsPath:null,results:[]};
  const save=ipcMain._invokeHandlers.get('session:save');
  ipcMain.removeHandler('session:save');ipcMain.handle('session:save',async(...args)=>{const result=await save(...args);state.results.push(result);return result;});
  dialog.showMessageBox=async(_,options)=>{
   if(options.message==='确认保存这些 XMP 旁车？'){state.prompts.push(options);return {response:state.save};}
   if(options.message.startsWith('保存“')){state.closePrompts.push(options);return {response:state.close};}
   if(options.message.startsWith('放弃 '))return {response:state.discard};
   throw new Error('Unexpected native dialog: '+options.message);
  };
  dialog.showSaveDialog=async(_,options)=>{state.saveAs.push(options);if(!state.saveAsPath)throw new Error('SaveAs requires an explicit test path');return {canceled:false,filePath:state.saveAsPath};};
 });
 await page.evaluate(()=>{window.__saveFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__saveFrames.push(e.frame);});});
 await open();await select(0);await exposure(.3);await settings({save:0});await button('保存').click();await idle();await dirty(0,true);await assert.rejects(readFile(sidecar(0)),{code:'ENOENT'});
 const first=await app.evaluate(()=>globalThis.__saveDialogs.prompts[0]);assert(first.detail.includes(sidecar(0))&&first.detail.includes('新建'));
 await pass('first default sidecar confirmation lists the Chinese/space target; Cancel retains dirty state and creates no XMP');
 await settings({save:1});await button('保存').click();await idle();await dirty(0,false);expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.3);
 const confirmed=await promptCount();await exposure(.4);await button('保存').click();await idle();await dirty(0,false);expect(await promptCount()).toBe(confirmed);
 expect(await app.evaluate(()=>globalThis.__saveDialogs.saveAs.length)).toBe(0);
 await pass('accepted sidecar save uses real XMP; ordinary subsequent Save updates it without SaveAs or another confirmation');
 const external=unknown('第一次 外部更新');await writeFile(sidecar(0),external);await exposure(.8);await settings({save:0});await button('保存').click();await idle();await dirty(0,true);
 expect(await readFile(sidecar(0),'utf8')).toBe(external);expect(await promptCount()).toBe(confirmed+1);
 const changed=await app.evaluate(()=>globalThis.__saveDialogs.prompts.at(-1));assert(changed.detail.includes('已存在，将替换')&&changed.detail.includes('目标已变化'));
 // A second external version between attempts must be the version retained on acceptance.
 await writeFile(sidecar(0),unknown('第二次 外部更新'));await settings({save:1});await button('保存').click();await idle();await dirty(0,false);
 const preserved=await readFile(sidecar(0),'utf8');
 const returned=await app.evaluate(()=>globalThis.__saveDialogs.results.at(-1).results[0]);expect(returned.xmpPacket).toBe(preserved);
 for(const text of ['第二次 外部更新','unknown-value','保留 限定符','外部 曝光限定符'])assert(preserved.includes(text),text);
 expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.8);
 await pass('external RDF/qualifier updates trigger replacement confirmation; decline retains bytes/dirty, acceptance merges the latest unknown metadata');
 await exposure(1.1);await settings({close:2});await photo(0).getByRole('button',{name:`关闭 ${basename(files[0])}`,exact:true}).click();await idle();await expect(page.locator('.film-item')).toHaveCount(3);await dirty(0,true);
 expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.8);
 await settings({close:1});await photo(0).getByRole('button',{name:`关闭 ${basename(files[0])}`,exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(2);await idle();expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.8);
 await open([files[0]],3);await select(0);await exposure(.95);await settings({close:0});await button('关闭当前文件').click();await expect(page.locator('.film-item')).toHaveCount(2);await idle();expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.95);
 expect(await app.evaluate(()=>globalThis.__saveDialogs.closePrompts.length)).toBe(3);
 await pass('single-document Close supports Cancel, Discard and Save using visible close controls and native decision dialogs');
 await select(1);await exposure(.5);await select(2);await exposure(-.2);await mkdir(sidecar(2));await page.locator('.status-actions').getByRole('button',{name:'完成',exact:true}).click();
 await expect(modal()).toBeVisible();await expect(modal()).toContainText('失败 1 张');await expect(modal().getByRole('button',{name:'重试未保存项',exact:true})).toBeVisible();await expect(page.locator('.film-item')).toHaveCount(2);
 await dirty(1,false);await dirty(2,true);expect((await readDocument(sidecar(1))).adjustments.exposure).toBe(.5);
 const alternate=join(photos,'明确 另存目标.xmp');await settings({saveAsPath:alternate});await modal().getByRole('button',{name:'另存此项…',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);await expect(modal()).toHaveCount(0);
 expect((await readDocument(alternate)).adjustments.exposure).toBe(-.2);assert((await stat(sidecar(2))).isDirectory());
 const saveAs=await app.evaluate(()=>globalThis.__saveDialogs.saveAs);expect(saveAs.length).toBe(1);expect(saveAs[0].defaultPath).toBe(sidecar(2));
 await pass('partially failed Done preserves the session and successful sidecar; native SaveAs retries only the failed item, then ends the clean session');
 await rm(sidecar(2),{recursive:true});await open();for(let i=0;i<3;i++){await select(i);await exposure([.15,.25,.35][i]);}
 const beforeCancel=await Promise.all([sidecar(0),sidecar(1),sidecar(2)].map(path=>readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
 await select(0);await photo(2).locator('.film-open').click({modifiers:['Shift']});await idle();await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(3);
 await installWorkerGate();await button('保存所选…').click();await expect(modal()).toBeVisible();
 await expect.poll(()=>app.evaluate(()=>globalThis.__saveWorker.held)).toBe(true);
 const live=await app.evaluate(()=>{const w=globalThis.__saveWorker.workers[0];process.kill(w.pid,0);return w;});assert(live.compose&&live.reply&&live.pid>0);expect(live.source).toBe(files[0]);
 await modal().getByRole('button',{name:'完成当前文件后停止',exact:true}).click();
 await expect.poll(()=>app.evaluate(()=>globalThis.__saveWorker.cancelCalls)).toBe(1);
 await app.evaluate(()=>globalThis.__saveWorker.release());await expect(modal()).toContainText('已停止后续保存');await expect(modal()).toContainText('成功 1 张');
 await dirty(0,false);await dirty(1,true);await dirty(2,true);expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.15);
 expect(await readFile(sidecar(1))).toEqual(beforeCancel[1]);await assert.rejects(readFile(sidecar(2)),{code:'ENOENT'});
 await expect.poll(()=>app.evaluate(()=>globalThis.__saveWorker.workers.every(w=>w.exited))).toBe(true);
 const workers=await app.evaluate(()=>{const p=globalThis.__saveWorker;p.restore();return p.workers;});expect(workers.length).toBe(1);
 console.log('Real native cancellation evidence:',JSON.stringify(workers));
 await modal().getByRole('button',{name:'返回编辑',exact:true}).click();await idle();await expect(page.locator('.film-item')).toHaveCount(3);
 await pass('visible Stop calls the real saver during a live native compose: current XMP completes, worker exits and subsequent dirty files remain untouched');
 await settings({discard:0});await page.locator('.status-actions').getByRole('button',{name:'取消',exact:true}).click();await idle();await expect(page.locator('.film-item')).toHaveCount(3);await dirty(1,true);
 await settings({discard:1});await page.locator('.status-actions').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);
 expect(await readFile(sidecar(1))).toEqual(beforeCancel[1]);expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.15);
 await pass('whole-session Cancel asks before discarding dirty edits and preserves previously published sidecars');
 for(const file of files)expect(await readFile(file)).toEqual(original);expect(await readFile(source)).toEqual(original);expect(errors).toEqual([]);
 for(const [name,info] of Object.entries(artifacts))expect(hash(await readFile(name)),`dist changed during run: ${name}`).toBe(info.sha256);
 await pass('all app windows stayed hidden/unfocused; original RAW bytes and the existing dist snapshot stayed unchanged');
 passed=true;
}catch(error){failure=error;}
finally{
 if(app){
  await app.evaluate(()=>globalThis.__saveWorker?.restore?.()).catch(()=>{});
  if(failure){
   if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});
   await writeFile(join(scratch,'failure.json'),JSON.stringify({error:failure.stack||String(failure),checks,errors,artifacts,diagnostics:electronDiagnostics(app)},null,2));
  }
  try{await closeElectron(app);}catch(error){failure??=error;passed=false;await writeFile(join(scratch,'shutdown-failure.txt'),error.stack||String(error));}
 }else if(failure)await writeFile(join(scratch,'failure.json'),JSON.stringify({error:failure.stack||String(failure),diagnostics:failure.electronDiagnostics},null,2));
 console.log(JSON.stringify({passed,checks,errors,artifacts,sourceSha256:hash(original),backgroundWindow:true}));
 if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained failure:',scratch);
}
if(failure)throw failure;
