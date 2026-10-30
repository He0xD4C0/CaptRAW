import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const scratch=await mkdtemp(join(tmpdir(),'captraw-session-workflow-'));
const source=resolve('build/samples/synthetic.dng'),original=await readFile(source);
const files=['来源 照片.dng','目标 照片.dng','未选 照片.dng'].map(name=>join(scratch,name));
for(const file of files)await copyFile(source,file);
const sidecar=i=>files[i]+'.captraw',checks=[],errors=[];
let app,page,passed=false;
const pass=message=>{checks.push(message);console.log('PASS',message);};
const photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
const input=name=>page.getByRole('spinbutton',{name,exact:true});
async function idle(){
 await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();
 await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);
}
async function select(i){await idle();await photo(i).locator('.film-open').click();await expect(photo(i).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();}
async function value(name,v){await idle();await input(name).fill(String(v));await input(name).press('Tab');await idle();await expect(input(name)).toHaveValue(String(v));}
async function open(){
 await app.evaluate(({dialog},filePaths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths});},files);
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(files.length);await idle();
}
async function save(){await page.getByRole('button',{name:'保存',exact:true}).click();await idle();await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);}
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex');
async function selected(){await select(0);await photo(1).locator('.film-open').click({modifiers:['Shift']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);}
async function saveSelected(){await page.getByRole('button',{name:'保存所选…',exact:true}).click();const d=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await expect(d.getByRole('button',{name:'返回编辑',exact:true})).toBeVisible();await d.getByRole('button',{name:'返回编辑',exact:true}).click();await idle();}
try{
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog})=>{globalThis.__savePrompts=[];globalThis.__discard=false;dialog.showMessageBox=async(_,options)=>{if(options.message==='确认保存这些 CaptRAW 编辑文件？'){globalThis.__savePrompts.push(options.detail);return {response:1};}if(options.message.startsWith('放弃 '))return {response:globalThis.__discard?1:0};return {response:1};};});
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await open();await select(1);await value('对比度',-20);await value('饱和度',17);await save();
 await select(0);await value('对比度',24);await save();
 const before=await pixels(),third=await photo(2).locator('img').getAttribute('src');
 await selected();await value('曝光',1.2);expect(await pixels()).not.toBe(before);expect(await photo(2).locator('img').getAttribute('src')).toBe(third);await saveSelected();
 let a=await readDocument(sidecar(0)),b=await readDocument(sidecar(1));
 expect(a.adjustments.exposure).toBe(1.2);expect(b.adjustments.exposure).toBe(1.2);expect(a.adjustments.contrast).toBe(24);expect(b.adjustments.contrast).toBe(-20);expect(b.adjustments.saturation).toBe(17);
 pass('linked exposure changes real pixels on the selected visible photos and preserves each target’s other settings');
 const prompts=await app.evaluate(()=>globalThis.__savePrompts);expect(prompts.length).toBe(2);expect(prompts.every(s=>s.includes(scratch))).toBe(true);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await idle();await expect(input('曝光')).toHaveValue('0');await saveSelected();
 expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(0);expect((await readDocument(sidecar(1))).adjustments.exposure).toBe(0);
 await page.getByRole('button',{name:'重做',exact:true}).click();await idle();await expect(input('曝光')).toHaveValue('1.2');await saveSelected();
 expect((await readDocument(sidecar(1))).adjustments.exposure).toBe(1.2);expect(await app.evaluate(()=>globalThis.__savePrompts.length)).toBe(2);
 pass('one linked operation supports selected-participant undo/redo and later sidecar updates reuse the confirmed destinations');
 await select(1);await page.getByRole('button',{name:'撤销',exact:true}).click();await idle();await expect(input('曝光')).toHaveValue('0');await save();
 expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(1.2);expect((await readDocument(sidecar(1))).adjustments.exposure).toBe(0);
 pass('a single selected participant can undo its own linked edit independently');
 await selected();const stable=await pixels();await input('曝光').fill('2');await input('曝光').press('Escape');await idle();await expect(input('曝光')).toHaveValue('1.2');expect(await pixels()).toBe(stable);await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);
 pass('Escape rolls back the active numeric gesture without adding a linked edit or dirty marker');
 await rename(files[1],files[1]+'.moved');await input('曝光').fill('1.7');await input('曝光').press('Tab');await idle();await expect(page.getByRole('alert')).toContainText(basename(files[1]));await expect(input('曝光')).toHaveValue('1.2');expect(await pixels()).toBe(stable);await rename(files[1]+'.moved',files[1]);
 await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);await expect(photo(1).locator('.dirty-dot')).toHaveCount(0);
 pass('a missing target after another target rendered aborts the entire edit and restores the active preview');
 await selected();await value('曝光',.7);await page.getByRole('button',{name:'评为 5 星',exact:true}).click();await page.getByRole('combobox',{name:'评分筛选',exact:true}).selectOption('unrated');await expect(page.locator('.film-item')).toHaveCount(1);
 await expect(page.locator('.inspector-content')).toHaveAttribute('inert','');await expect(page.getByRole('button',{name:'导出',exact:true})).toBeDisabled();
 pass('filtering out the active selection prevents editing and export from silently falling back to a hidden photo');
 await page.getByRole('combobox',{name:'评分筛选',exact:true}).selectOption('all');
 await page.locator('.status-actions').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(3);
 await app.evaluate(()=>globalThis.__discard=true);await page.locator('.status-actions').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);
 expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(1.2);expect((await readDocument(sidecar(1))).adjustments.exposure).toBe(0);
 pass('whole-session Cancel can be declined, then discards unsaved edits while keeping explicitly saved sidecars');
 await open();await select(0);await expect(input('曝光')).toHaveValue('1.2');await value('曝光',.45);await select(1);await expect(input('曝光')).toHaveValue('0');await value('曝光',-.35);
 // An existing directory at the default sidecar destination yields a real, per-file error.
 await select(2);await value('曝光',.2);await mkdir(sidecar(2));await page.locator('.status-actions').getByRole('button',{name:'完成',exact:true}).click();
 const failed=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await expect(failed.getByRole('button',{name:'重试未保存项',exact:true})).toBeVisible();await expect(failed).toContainText('失败 1 张');await expect(page.locator('.film-item')).toHaveCount(3);
 expect((await readDocument(sidecar(0))).adjustments.exposure).toBe(.45);expect((await readDocument(sidecar(1))).adjustments.exposure).toBe(-.35);await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);await expect(photo(1).locator('.dirty-dot')).toHaveCount(0);await expect(photo(2).locator('.dirty-dot')).toHaveCount(1);
 pass('Done saves all dirty documents, retains the whole session on partial failure and marks only successful snapshots clean');
 await rm(sidecar(2),{recursive:true});await failed.getByRole('button',{name:'重试未保存项',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);expect((await readDocument(sidecar(2))).adjustments.exposure).toBe(.2);
 pass('retrying the remaining failure ends the session only after every document is saved');
 for(const file of files)expect(await readFile(file)).toEqual(original);expect(errors).toEqual([]);
 await page.screenshot({path:join(scratch,'session-ended.png')});
 passed=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});await writeFile(join(scratch,'failure.json'),JSON.stringify({error:String(error),checks,diagnostics:app?electronDiagnostics(app):null},null,2));throw error;}
finally{
 if(app)await closeElectron(app);
 const report={checks,errors,backgroundWindow:true,packaged:!!process.env.CAPTRAW_APP,sourceSha256:createHash('sha256').update(original).digest('hex'),passed};
 console.log(JSON.stringify(report));
 if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained failure:',scratch);
}
