import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {readDocument} from './xmp-test.mjs';
import {mkdirSync,rmSync,copyFileSync,readFileSync,writeFileSync,renameSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
const out=resolve(process.env.CAPTRAW_BATCH_SAVE_GUI_OUT||'artifacts/batch-save-gui');mkdirSync(out,{recursive:true});
const input=join(out,'inputs'),output=join(out,'编辑 输出');rmSync(input,{recursive:true,force:true});rmSync(output,{recursive:true,force:true});mkdirSync(input);mkdirSync(output);
const files=[resolve('build/samples/nikon-d850.NEF'),...['中间 照片.png','末尾 照片.png','未选 照片.png'].map(n=>join(input,n))];for(const p of files.slice(1))copyFileSync('build/samples/embedded-srgb.png',p);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),before=files.map(hash),checks=[],errors=[];
const app=await electron.launch(),page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
const pass=s=>{checks.push(s);console.log('PASS',s);},photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
async function idle(){await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await idle();}
async function select(i){if(await photo(i).locator('.film-open').getAttribute('aria-current')==='true')await photo(i).locator('.film-open').click();else await settle(()=>photo(i).locator('.film-open').click());}
async function exposure(value){await settle(async()=>{const c=page.getByRole('spinbutton',{name:'曝光',exact:true});await c.fill(String(value));await c.press('Tab');});}
async function choose(directory=output){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>path?({canceled:false,filePaths:[path]}):({canceled:true,filePaths:[]});},directory);}
const d=()=>page.getByRole('dialog',{name:'保存所选照片',exact:true});
const save=()=>page.getByRole('button',{name:'保存所选…',exact:true}).click();
async function finish(){await d().getByRole('button',{name:'完成',exact:true}).click();await expect(d()).toHaveCount(0);}
try{
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},files);
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(4);await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();await idle();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));
 for(let i=0;i<4;i++){await select(i);await exposure(.4+i*.2);}
 await select(0);const pixels=await page.locator('canvas').evaluate(c=>c.toDataURL());await photo(2).locator('.film-open').click({modifiers:['Shift']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(3);
 await expect(page.getByRole('button',{name:'保存所选…',exact:true})).toBeInViewport();
 await choose(null);await save();await expect(d()).toHaveCount(0);await expect(page.locator('.film-item .dirty-dot')).toHaveCount(4);expect(readdirSync(output)).toEqual([]);pass('visible save-selected action respects selection and cancelling the folder chooser preserves all unsaved edits');
 const sentinel=join(output,'nikon-d850.xmp');writeFileSync(sentinel,'keep existing XMP');
 renameSync(files[1],files[1]+'.away');
 try{
  await choose();await save();await expect(d().getByRole('status')).toContainText('成功 2 张');await expect(d().getByRole('status')).toContainText('失败 1 张');
  await expect(d().locator('.save-results')).toContainText('中间 照片.png');await expect(d().locator('.save-results')).toContainText('恢复原片');await expect(d().getByRole('button',{name:'完成',exact:true})).toBeInViewport();await page.screenshot({path:join(out,'partial-save.png')});await finish();
 }finally{renameSync(files[1]+'.away',files[1]);}
 await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);await expect(photo(2).locator('.dirty-dot')).toHaveCount(0);await expect(photo(1).locator('.dirty-dot')).toHaveCount(1);await expect(photo(3).locator('.dirty-dot')).toHaveCount(1);
 expect(readFileSync(sentinel,'utf8')).toBe('keep existing XMP');expect(existsSync(join(output,'未选 照片.xmp'))).toBe(false);
 const rawSaved=join(output,'nikon-d850_1.xmp'),pngSaved=join(output,'末尾 照片.xmp');expect((await readDocument(rawSaved)).adjustments.exposure).toBe(.4);expect((await readDocument(pngSaved)).adjustments.exposure).toBe(.8);
 pass('partial failure reports the specific photo, preserves same-name XMP, saves only selected snapshots and clears only successful dirty markers');
 await select(1);await choose();await save();await expect(d().getByRole('status')).toContainText('成功 1 张');await finish();await expect(photo(1).locator('.dirty-dot')).toHaveCount(0);pass('failed photo can be selected and retried without resaving successful or unselected photos');
 await select(0);await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(photo(0).locator('.dirty-dot')).toHaveCount(1);await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);pass('batch saving preserves undo history and dirty tracking against each saved snapshot');
 const filmOrder=await page.locator('.film-open').evaluateAll(elements=>elements.map(e=>e.title));
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},rawSaved);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());expect(await page.locator('canvas').evaluate(c=>c.toDataURL())).toBe(pixels);
 expect(await page.locator('.film-open').evaluateAll(elements=>elements.map(e=>e.title))).toEqual(filmOrder);pass('reopening a saved recipe retains filmstrip order and Shift selection anchors');
 const tiff=join(out,'desktop.tiff');rmSync(tiff,{force:true});await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},tiff);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});await page.getByRole('button',{name:'关闭导出结果',exact:true}).click();pass('saved Nikon XMP reopens with identical visible pixels and exports TIFF16 through the installed workflow');
 for(let i=0;i<3;i++){await select(i);await exposure(1.5+i*.2);}
 await select(0);await photo(2).locator('.film-open').click({modifiers:['Shift']});const cancelled=join(out,'取消 后');rmSync(cancelled,{recursive:true,force:true});mkdirSync(cancelled);await choose(cancelled);await save();
 await expect(d().getByRole('status')).toContainText('正在保存 1/3');await d().getByRole('button',{name:'完成当前文件后停止',exact:true}).click();await expect(d().getByRole('status')).toContainText('已停止后续保存');await expect(d().getByRole('status')).toContainText('成功 1 张');await finish();
 await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);await expect(photo(1).locator('.dirty-dot')).toHaveCount(1);await expect(photo(2).locator('.dirty-dot')).toHaveCount(1);expect(readdirSync(cancelled).filter(n=>n.endsWith('.xmp'))).toHaveLength(1);pass('visible stop button completes the current RAW document and keeps later edits unsaved');
 await exposure(2);await choose(cancelled);await save();await expect(d().getByRole('status')).toContainText('正在保存 1/3');
 await app.evaluate(({app})=>app.quit());await expect(d().getByRole('status')).toContainText('已停止后续保存');await expect(d().getByRole('status')).toContainText('成功 1 张');await finish();
 await expect(page.getByRole('button',{name:'保存所选…',exact:true})).toBeEnabled();await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);await expect(photo(1).locator('.dirty-dot')).toHaveCount(1);pass('quit during an active save waits for the current file and leaves the application available for remaining unsaved edits');
 for(const [i,p] of files.entries())expect(hash(p)).toBe(before[i]);expect(errors).toEqual([]);pass('all source images are unchanged and the hidden-window run has no page errors');
}catch(error){await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({packaged:!!process.env.CAPTRAW_APP,backgroundWindow:true,checks,errors,rawSaved:join(output,'nikon-d850_1.xmp')},null,2)+'\n');await closeElectron(app);}
