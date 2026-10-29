import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {XMP,encodeAdjustments} from '@captraw/desktop-core/xmp';
import {SYNC_GROUPS} from '@captraw/contracts/synchronize';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Production keyboard/focus regression. No renderer business methods are replaced.
// Hidden Chromium key injection and native menu callbacks are separate evidence;
// neither claims a physical macOS accelerator test with a focused OS window.
const scratch=await mkdtemp(join(tmpdir(),'captraw-shortcuts-app-'));
const files=['A','B','C'].map(id=>join(scratch,id+'.png')),facts=[],conflicts=[],errors=[],originals=new Map();
const xmp=new XMP(resolve('build/xmp/captraw-xmp'));let app,page,passed=false,failure;
const button=name=>page.getByRole('button',{name,exact:true});
const curve=()=>page.getByLabel('多点色调曲线',{exact:true});
const selected=()=>page.locator('.film-open[aria-pressed="true"]').count();
const exposure=()=>page.getByRole('spinbutton',{name:'曝光',exact:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function record(name,data,conflict=false){facts.push({name,data,conflict});if(conflict)conflicts.push(name);console.log(JSON.stringify(facts.at(-1)));}
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await expect(page.getByRole('alert')).toHaveCount(0);}
async function body(){await page.locator('.rating-count').click();}
async function key(combo){await page.keyboard.press(combo);await page.waitForTimeout(180);}
async function menuKey(accelerator){
 const found=await app.evaluate(({Menu,BrowserWindow},accelerator)=>{const item=Menu.getApplicationMenu().items.flatMap(i=>i.submenu?.items||[]).find(i=>i.accelerator===accelerator);if(!item)return false;item.click(item,BrowserWindow.getAllWindows()[0],{});return true;},accelerator);
 assert(found,'Missing native menu '+accelerator);await page.waitForTimeout(180);
}
async function selectIndex(index){await page.locator('.film-open').nth(index).click();await idle();}
async function selectA(){await page.locator('.film-open').filter({has:page.getByText('A.png',{exact:true})}).click();await idle();}
async function exportSnapshot(){
 const count=await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='images:export').length);
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});dialog.showSaveDialog=async()=>({canceled:true});});
 await button('导出').click();const run=page.getByRole('dialog',{name:'导出设置'}).getByRole('button',{name:/TIFF · 16 位/});await run.scrollIntoViewIfNeeded();await run.click();
 await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='images:export').length)).toBe(count+1);
 await expect(button('导出')).toBeEnabled();return app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='images:export').at(-1).request);
}
try{
 for(const [i,path]of files.entries()){
  execFileSync(resolve('build/qa-venv/bin/python'),['-c',"from PIL import Image\nimport sys\nImage.new('RGB',(192,128),(110+int(sys.argv[2])*10,100,80)).save(sys.argv[1])",path,String(i)]);
  if(i===0)await writeFile(path.replace('.png','.xmp'),(await xmp.call('write','',encodeAdjustments({incrementalTemperature:0,incrementalTint:0,relativeWBModel:'art-ctl-v1',curve:[{x:0,y:0},{x:64/255,y:64/255},{x:128/255,y:128/255},{x:1,y:1}],perspectiveGuides:[{axis:'vertical',start:{x:.25,y:.2},end:{x:.25,y:.8}}]}))).packet);
  originals.set(path,digest(await readFile(path)));
 }
 app=await electron.launch({env:{CAPTRAW_APP:'',CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__shortcutEvents=[];window.captraw.onEvent(e=>window.__shortcutEvents.push(e));});
 await app.evaluate(async({ipcMain,dialog,Menu,BrowserWindow,clipboard,ClipboardItem})=>{
  globalThis.__shortcutCalls=[];globalThis.__shortcutWindows=[];
  for(const w of BrowserWindow.getAllWindows())for(const event of ['show','focus'])w.on(event,()=>globalThis.__shortcutWindows.push(event));
  for(const channel of ['image:update','session:save','images:synchronize','image:export','images:export']){
   const original=ipcMain._invokeHandlers.get(channel);if(!original)throw new Error('Missing '+channel);ipcMain.removeHandler(channel);
   ipcMain.handle(channel,async(event,request)=>{const row={channel,request:structuredClone(request)};globalThis.__shortcutCalls.push(row);
    if(channel==='images:synchronize'&&globalThis.__holdShortcutSync)await new Promise(resolve=>{globalThis.__releaseShortcutSync=resolve;});
    row.result=await original(event,request);return row.result;});
  }
  globalThis.__shortcutMenu=Menu.getApplicationMenu().items.flatMap(item=>item.submenu?.items.map(child=>({label:child.label,role:child.role,accelerator:child.accelerator}))||[]);
  dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});dialog.showSaveDialog=async()=>({canceled:true});
  dialog.showMessageBox=async(...args)=>{if(args.at(-1).message==='确认保存这些 XMP 旁车？')return {response:0};throw new Error('Unexpected native dialog');};
  // Electron 45 snapshots all formats atomically. Keep payloads exclusively in
  // main memory and do not overwrite a clipboard subsequently changed by its owner.
  const original=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
  globalThis.__shortcutClipboardSafe=true;
  globalThis.__restoreShortcutClipboard=async()=>{if(globalThis.__shortcutClipboardTouched&&await clipboard.readText()==='native text clipboard'){if(original.length)await clipboard.write(original);else clipboard.clear();}};
 });
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},files);
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(3);await idle();await selectA();
 // Curve selection uses the actual SVG, concurrently with a selected guide.
 await button('编辑').click();await page.locator('details').filter({has:page.getByText('几何',{exact:true})}).locator('summary').click();
 const guided=button('引导透视');await guided.scrollIntoViewIfNeeded();await guided.click();await expect(button('1 · 垂直')).toBeVisible();await button('1 · 垂直').click();
 await curve().scrollIntoViewIfNeeded();await expect(curve().locator('circle')).toHaveCount(4);await curve().focus();
 const updates=await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:update').length);
 for(const combo of ['+','Control+Tab','Control+Shift+Tab','-','+','d'])await page.keyboard.press(combo);
 await expect(page.getByRole('spinbutton',{name:'曲线输入',exact:true})).toBeDisabled();
 await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();await expect(button('重做')).toBeDisabled();
 assert.equal(await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:update').length),updates);
 record('curve selection keys do not change recipe/history/dirty',true);
 await page.keyboard.press('+');await page.keyboard.press('+');await expect(page.getByRole('spinbutton',{name:'曲线输入',exact:true})).toHaveValue('64');
 await page.keyboard.press('Delete');await expect(curve().locator('circle')).toHaveCount(3);
 await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:update').at(-1).request.adjustments.curve.length)).toBe(3);await idle();
 await expect(button('1 · 垂直')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('viewport')).toHaveClass(/tool-perspective/);
 const updated=await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:update').at(-1).request.adjustments);
 assert.equal(updated.perspectiveGuides.length,1);assert.equal(updated.curve.length,3);
 record('curve Delete consumes event, preserves selected guide and perspective tool',true);
 await button('撤销').click();await expect(curve().locator('circle')).toHaveCount(4);
 await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:update').at(-1).request.adjustments.curve.length)).toBe(4);await idle();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 await curve().focus();await page.keyboard.press('d');await page.keyboard.press('+');await page.keyboard.press('+');await page.keyboard.press('Backspace');await expect(curve().locator('circle')).toHaveCount(3);
 await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:update').at(-1).request.adjustments.curve.length)).toBe(3);await idle();await expect(button('1 · 垂直')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('viewport')).toHaveClass(/tool-perspective/);
 record('curve Backspace also preserves guide and tool',true);await button('撤销').click();await expect(curve().locator('circle')).toHaveCount(4);
 await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:update').at(-1).request.adjustments.curve.length)).toBe(4);await idle();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 await curve().focus();await page.keyboard.press('d');await page.keyboard.press('-');const last=await page.getByRole('spinbutton',{name:'曲线输入',exact:true}).inputValue();await page.keyboard.press('+');
 record('curve endpoint wrap observed, ACR wrap remains unverified',{last,next:await page.getByRole('spinbutton',{name:'曲线输入',exact:true}).inputValue()});
 await button('引导透视').scrollIntoViewIfNeeded();await button('引导透视').click();await button('编辑').click();
 const exportMenu=()=>page.getByRole('dialog',{name:'导出设置'}),copy=page.getByRole('dialog',{name:'复制编辑设置'});
 // Opening export options changes no recipe, history, save or export job.
 await body();await key('Meta+s');await expect(exportMenu()).toBeVisible();
 assert.equal(await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='session:save'||c.channel==='image:export'||c.channel==='images:export').length),0);
 await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();await page.keyboard.press('Escape');await expect(exportMenu()).toHaveCount(0);
 await menuKey('CommandOrControl+S');await expect(exportMenu()).toBeVisible();await page.keyboard.press('Escape');await expect(exportMenu()).toHaveCount(0);
 await body();await key('Meta+Shift+s');await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='session:save').length)).toBe(1);await idle();
 await menuKey('CommandOrControl+Shift+S');await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='session:save').length)).toBe(2);await idle();
 await expect(button('保存')).toHaveAttribute('title',/⌘⇧S/);record('keyboard/native CmdS open options only; CmdShiftS is explicit XMP extension',true);
 await body();await key('Meta+c');await expect(button('粘贴设置')).toBeEnabled();await expect(copy).toHaveCount(0);await idle();
 await menuKey('CommandOrControl+C');await idle();await expect(copy).toHaveCount(0);
 await body();await key('Meta+Alt+c');await expect(copy).toBeVisible();await copy.getByRole('button',{name:'取消',exact:true}).click();
 await body();await menuKey('CommandOrControl+Alt+C');await expect(copy).toBeVisible();await copy.getByRole('button',{name:'取消',exact:true}).click();
 const syncCount=()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='images:synchronize').length);
 let n=await syncCount();await button('选择全部').click();await body();await key('Meta+v');await expect.poll(syncCount).toBe(n+1);await idle();
 let pasted=await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='images:synchronize').at(-1).request);
 assert.deepEqual(pasted.groups.slice().sort(),SYNC_GROUPS.map(g=>g.id).sort());assert.deepEqual(pasted.targets.map(t=>t.image.path),files);
 n=await syncCount();await body();await menuKey('CommandOrControl+V');await expect.poll(syncCount).toBe(n+1);await idle();record('keyboard/native copy-all, subset dialog and paste use full groups and visible ordered targets',true);
 const selection=await selected();n=await syncCount();await exposure().focus();await key('Meta+Shift+a');assert.equal(await selected(),selection);
 await key('Meta+Shift+c');await expect(copy).toHaveCount(0);await key('Meta+Shift+v');assert.equal(await syncCount(),n);
 const filter=page.getByRole('combobox',{name:'评分筛选',exact:true});await filter.focus();await key('Meta+Shift+a');assert.equal(await selected(),selection);await key('Meta+Shift+c');await expect(copy).toHaveCount(0);
 record('input/select focus blocks image selection and settings copy/paste aliases',true);
 // A real pending multi-photo blur commit must keep options visible and disabled.
 for(const [trigger,value]of [['keyboard',.75],['header',.8]]){
  await body();await app.evaluate(()=>{globalThis.__holdShortcutSync=true;globalThis.__releaseShortcutSync=undefined;});
  await exposure().fill(String(value));if(trigger==='keyboard')await page.keyboard.press('Meta+s');else await button('导出').click();await expect(exportMenu()).toBeVisible();
  await expect.poll(()=>app.evaluate(()=>!!globalThis.__releaseShortcutSync)).toBe(true);
  const format=exportMenu().getByRole('button',{name:/TIFF · 16 位/});await format.scrollIntoViewIfNeeded();await expect(format).toBeDisabled();
  const exports=await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:export'||c.channel==='images:export').length);
  await format.click({force:true});await expect(exportMenu()).toBeVisible();assert.equal(await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='image:export'||c.channel==='images:export').length),exports);
  await app.evaluate(()=>{globalThis.__holdShortcutSync=false;globalThis.__releaseShortcutSync();});await expect(format).toBeEnabled();await idle();
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await format.click();await expect(exportMenu()).toHaveCount(0);
  await expect.poll(()=>app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='images:export').length)).toBe(exports+1);
  pasted=await app.evaluate(()=>globalThis.__shortcutCalls.filter(c=>c.channel==='images:export').at(-1).request);assert(pasted.documents.every(d=>d.adjustments.exposure===value));
  record(trigger+' export during numeric draft keeps disabled options until multi-edit is ready, then accepts format',true);
 }
 await selectA();await body();await key('Meta+a');assert.equal(await selected(),3);record('non-text CmdA selects visible images',true);
 await selectA();await body();await key('k');await expect(page.getByRole('spinbutton',{name:'画笔大小',exact:true})).toBeVisible();await idle();
 const rating=await page.getByRole('status',{name:'所选评分',exact:true}).textContent(),label=await page.getByRole('status',{name:'所选色标',exact:true}).textContent();
 await body();await key('3');await key('8');assert.equal(await page.getByRole('status',{name:'所选评分',exact:true}).textContent(),rating);assert.equal(await page.getByRole('status',{name:'所选色标',exact:true}).textContent(),label);
 record('brush digit priority leaves ratings and labels unchanged',true);
 const name=page.getByRole('textbox',{name:'蒙版名称',exact:true});
 if(await app.evaluate(()=>globalThis.__shortcutClipboardSafe)){
  await name.fill('native text clipboard');await name.press('Meta+a');await app.evaluate(()=>{globalThis.__shortcutClipboardTouched=true;});await menuKey('CommandOrControl+C');
  assert.equal(await app.evaluate(async({clipboard})=>await clipboard.readText()==='native text clipboard'),true);
  await name.fill('');n=await syncCount();await menuKey('CommandOrControl+V');await expect(name).toHaveValue('native text clipboard');assert.equal(await syncCount(),n);
  await name.press('Tab');await idle();record('native copy/paste menu really edits the focused text field without image settings paste',true);
 }else record('native text clipboard roundtrip deferred because host clipboard contains unsupported formats',false);
 const size=page.getByRole('spinbutton',{name:'画笔大小',exact:true}),beforeSize=await size.inputValue();await body();await key('Meta+]');await idle();
 await expect.poll(()=>page.evaluate(()=>window.__shortcutEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.fullWidth)).toBe(128);await expect(size).toHaveValue(beforeSize);
 await key('Meta+[');await idle();await expect.poll(()=>page.evaluate(()=>window.__shortcutEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.fullWidth)).toBe(192);record('Cmd brackets rotate while brush tool is active without resizing it',true);
 await button('编辑').click();await selectIndex(1);await body();await key('r');await idle();await selectIndex(2);await body();await key('r');await idle();await key('r');await idle();
 await selectA();await button('选择全部').click();await body();await key('r');await idle();
 let rotation=await exportSnapshot();assert.deepEqual(rotation.documents.map(d=>d.adjustments.rotation),[90,180,270]);
 await button('撤销').click();await idle();rotation=await exportSnapshot();assert.deepEqual(rotation.documents.map(d=>d.adjustments.rotation),[0,90,180]);
 await button('重做').click();await idle();rotation=await exportSnapshot();assert.deepEqual(rotation.documents.map(d=>d.adjustments.rotation),[90,180,270]);
 await body();await key('l');await idle();rotation=await exportSnapshot();assert.deepEqual(rotation.documents.map(d=>d.adjustments.rotation),[0,90,180]);
 record('R/L rotate per-photo relative angles over visible targets with one shared Undo/Redo step',true);
 await exposure().fill('0.5');await exposure().press('Tab');await idle();const global=await exportSnapshot();assert(global.documents.every(d=>d.adjustments.exposure===.5));record('existing global exposure comparison',global.documents.map(d=>d.adjustments.exposure));
 await selectA();await button('评为 3 星').click();await body();await key('Meta+z');await expect(page.getByRole('status',{name:'所选评分',exact:true})).toHaveText('未评分');record('non-text CmdZ reaches application history',true);
 assert.deepEqual(errors,[]);for(const [path,hash]of originals)assert.equal(digest(await readFile(path)),hash);
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>({events:globalThis.__shortcutWindows,hidden:BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable())})),{events:[],hidden:true});
 assert.deepEqual(conflicts,[]);passed=true;console.log(JSON.stringify({passed,facts,scope:'hidden production keyboard/menu callback regression; physical foreground accelerators remain separate'}));
}catch(error){failure=error;}
finally{
 if(app){await app.evaluate(async()=>{globalThis.__releaseShortcutSync?.();await globalThis.__restoreShortcutClipboard?.();}).catch(()=>{});if(failure){if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});await writeFile(join(scratch,'audit.json'),JSON.stringify({failure:failure.stack||String(failure),facts,conflicts,errors,diagnostics:electronDiagnostics(app)},null,2));}await closeElectron(app);}
 if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Shortcut audit retained:',scratch);
}
if(failure)throw failure;
