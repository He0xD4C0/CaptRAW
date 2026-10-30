import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const scratch=await mkdtemp(join(tmpdir(),'captraw-preset-workflow-')),checks=[],errors=[];
const files=['照片 一.dng','照片 二.dng'].map(name=>join(scratch,name));
for(const path of files)await copyFile(resolve('build/samples/synthetic.dng'),path);
let app,page,passed=false;
const pass=s=>{checks.push(s);console.log('PASS',s);},input=name=>page.getByRole('spinbutton',{name,exact:true});
const photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
async function idle(){await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function select(i){await photo(i).locator('.film-open').click();await expect(photo(i).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();}
async function value(name,v){await input(name).fill(String(v));await input(name).press('Tab');await idle();}
async function save(){await page.getByRole('button',{name:'保存所选…',exact:true}).click();const d=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await d.getByRole('button',{name:'返回编辑',exact:true}).click();await idle();}
const sidecar=i=>files[i]+'.captraw',pixels=async()=>createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex');
async function canvasSnapshot(name){const value=await page.locator('canvas').evaluate(c=>({url:c.toDataURL(),width:c.width,height:c.height,data:{...c.dataset}}));await writeFile(join(scratch,name+'.png'),Buffer.from(value.url.split(',')[1],'base64'));return {...value,url:undefined,hash:createHash('sha256').update(value.url).digest('hex')};}
try{
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});dialog.showMessageBox=async()=>({response:1});},files);
 await app.evaluate(({ipcMain})=>{globalThis.__presetWorkflowRPC=[];for(const name of ['image:update','presets:apply-many','presets:preview','presets:preview-cancel']){const original=ipcMain._invokeHandlers.get(name);ipcMain.removeHandler(name);ipcMain.handle(name,async(...args)=>{const record={name,args:structuredClone(args.slice(1))};globalThis.__presetWorkflowRPC.push(record);const result=await original(...args);record.done=true;return result;});}});
 await page.evaluate(()=>{window.__uiTrace=[];document.addEventListener('click',e=>{const button=e.target.closest('button');if(button)window.__uiTrace.push({button:button.textContent,time:performance.now()});},true);window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(2);await idle();
 await value('饱和度',17);await select(0);await value('对比度',24);
 await page.getByRole('button',{name:'复制设置…',exact:true}).click();const copy=page.getByRole('dialog',{name:'复制编辑设置',exact:true});await copy.getByRole('button',{name:'全不选',exact:true}).click();await copy.getByRole('checkbox',{name:'光线',exact:true}).check();await copy.getByRole('button',{name:'复制所选设置',exact:true}).click();await expect(copy).toHaveCount(0);
 await select(1);await page.getByRole('button',{name:'粘贴设置',exact:true}).click();await idle();await expect(input('对比度')).toHaveValue('24');await expect(input('饱和度')).toHaveValue('17');await page.getByRole('button',{name:'撤销',exact:true}).click();await idle();await expect(input('对比度')).toHaveValue('0');
 pass('copy/paste selects an explicit settings subset, preserves unselected fields and forms one undo operation');
 await select(0);await photo(1).locator('.film-open').click({modifiers:['Shift']});
 await page.getByRole('button',{name:'粘贴设置',exact:true}).click();await idle();await page.getByRole('button',{name:'撤销',exact:true}).click();await idle();await save();
 expect((await readDocument(sidecar(0))).adjustments.contrast).toBe(24);expect((await readDocument(sidecar(1))).adjustments.contrast).toBe(0);
 pass('selected undo chooses the latest participating operation even when the active source was unchanged');
 const before=await pixels(),thumb=await photo(1).locator('img').getAttribute('src'),xmpBefore=await readFile(sidecar(0),'utf8');
 await page.getByRole('button',{name:'预设',exact:true}).click();const builtin=page.getByRole('button',{name:'曝光 +0.50 · 内置',exact:true});await expect(builtin).toBeVisible();
 await builtin.hover();await expect(page.getByText('预设预览 · 移开指针恢复，单击应用',{exact:true})).toBeVisible();expect(await pixels()).not.toBe(before);await expect(photo(0).locator('.dirty-dot')).toHaveCount(0);await expect(photo(1).locator('.dirty-dot')).toHaveCount(0);expect(await photo(1).locator('img').getAttribute('src')).toBe(thumb);expect(await readFile(sidecar(0),'utf8')).toBe(xmpBefore);
 await page.getByRole('searchbox',{name:'搜索预设',exact:true}).hover();await expect(page.getByText('预设预览 · 移开指针恢复，单击应用',{exact:true})).toHaveCount(0);await expect.poll(pixels).toBe(before);
 pass('hover displays actual preset pixels only on the active canvas and restores without changing history, dirty state, thumbnails or saved edits');
 await builtin.click();await page.getByRole('searchbox',{name:'搜索预设',exact:true}).hover();await idle();await save();
 for(const i of [0,1])expect((await readDocument(sidecar(i))).adjustments.exposure).toBe(.5);expect((await readDocument(sidecar(1))).adjustments.saturation).toBe(17);
 pass('a preset applies atomically to every selected visible photo while preserving unrelated target controls');
 await value('预设强度',150);await save();for(const i of [0,1])expect((await readDocument(sidecar(i))).adjustments.exposure).toBe(.75);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await idle();await save();for(const i of [0,1])expect((await readDocument(sidecar(i))).adjustments.exposure).toBe(.5);
 pass('preset amount changes produce real parameters and pixels, and one strength gesture can be undone for selected participants');
 const cancelBefore=await canvasSnapshot('cancel-before'),cancelledPixels=cancelBefore.hash;await expect(page.getByRole('button',{name:'重做',exact:true})).toBeEnabled();
 await expect(input('预设强度')).toHaveValue('150');
 await input('预设强度').fill('175');await input('预设强度').press('Escape');await page.waitForTimeout(350);await idle();
 await expect(input('预设强度')).toHaveValue('150');await expect(page.getByRole('button',{name:'重做',exact:true})).toBeEnabled();const cancelAfter=await canvasSnapshot('cancel-after');await writeFile(join(scratch,'cancel-canvases.json'),JSON.stringify({before:cancelBefore,after:cancelAfter},null,2));expect(cancelAfter.hash).toBe(cancelledPixels);
 await save();for(const i of [0,1])expect((await readDocument(sidecar(i))).adjustments.exposure).toBe(.5);
 pass('cancelled preset amount after undo restores exact pixels and selected edits without reapplying the stale amount or clearing redo');
 const amountThumb=page.getByRole('slider',{name:'预设强度滑杆',exact:true});await amountThumb.scrollIntoViewIfNeeded();await expect(amountThumb).toBeInViewport();
 const amountTrack=amountThumb.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," slider ")][1]'),trackBox=await amountTrack.boundingBox(),thumbBox=await amountThumb.boundingBox();expect(trackBox).toBeTruthy();expect(thumbBox).toBeTruthy();
 await page.mouse.move(thumbBox.x+thumbBox.width/2,thumbBox.y+thumbBox.height/2);await page.mouse.down();await page.mouse.move(trackBox.x+trackBox.width*.4,trackBox.y+trackBox.height/2,{steps:8});
 await page.keyboard.press('Escape');await page.mouse.move(trackBox.x+trackBox.width*.9,trackBox.y+trackBox.height/2,{steps:8});await page.mouse.up();await page.waitForTimeout(350);await idle();
 await expect(input('预设强度')).toHaveValue('150');await expect(page.getByRole('button',{name:'重做',exact:true})).toBeEnabled();expect(await pixels()).toBe(cancelledPixels);
 await value('预设强度',125);await save();for(const i of [0,1])expect((await readDocument(sidecar(i))).adjustments.exposure).toBe(.625);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await idle();expect(await pixels()).toBe(cancelledPixels);
 pass('held preset amount drag stays cancelled through pointerup; the next strength edit captures fresh targets and remains one undo step');
 await page.getByRole('button',{name:'收藏 曝光 +0.50',exact:true}).click();await expect(page.getByRole('button',{name:'取消收藏 曝光 +0.50',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('checkbox',{name:'仅收藏',exact:true}).check();await expect(builtin).toBeVisible();
 await page.getByRole('button',{name:'管理 曝光 +0.50',exact:true}).click();await expect(page.getByRole('button',{name:'重命名 / 分组',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'删除预设…',exact:true})).toBeDisabled();await page.getByRole('button',{name:'创建用户副本…',exact:true}).click();const duplicate=page.getByRole('dialog',{name:'创建用户副本',exact:true});await duplicate.getByRole('textbox',{name:'预设名称',exact:true}).fill('可编辑 用户副本');await duplicate.getByRole('button',{name:'保存预设',exact:true}).click();await expect(duplicate).toHaveCount(0);await page.getByRole('checkbox',{name:'仅收藏',exact:true}).uncheck();await expect(page.getByRole('button',{name:'可编辑 用户副本',exact:true})).toBeVisible();
 pass('builtin presets can be favorited and duplicated but cannot be overwritten or deleted by user management');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await expect(page.getByRole('button',{name:'复制设置…',exact:true})).toBeInViewport();await page.getByRole('button',{name:'保存所选…',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'保存所选…',exact:true})).toBeInViewport();
 expect(errors).toEqual([]);passed=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});await writeFile(join(scratch,'failure.json'),JSON.stringify({error:String(error),checks,uiTrace:page?await page.evaluate(()=>window.__uiTrace):[],rpc:app?await app.evaluate(()=>globalThis.__presetWorkflowRPC):[],diagnostics:app?electronDiagnostics(app):null},null,2));throw error;}
finally{if(app)await closeElectron(app);console.log(JSON.stringify({checks,errors,passed,packaged:!!process.env.CAPTRAW_APP}));if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained failure:',scratch);}
