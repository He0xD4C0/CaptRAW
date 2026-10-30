import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';

const work=await mkdtemp(join(tmpdir(),'captraw-source-color-')),source=join(work,'源空间未声明.tiff'),checks=[],errors=[];
execFileSync('build/qa-venv/bin/python',['-c',"import sys,numpy as np,tifffile\nx=np.empty((96,128,3),dtype=np.uint8);x[:]=[24,210,72];tifffile.imwrite(sys.argv[1],x,photometric='rgb')",source]);
const original=await readFile(source),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let app,page,passed=false,stage='launch';
const button=name=>page.getByRole('button',{name,exact:true}),canvas=()=>page.getByRole('img',{name:'显影预览',exact:true}),pass=message=>{checks.push(message);console.log('PASS',message);};
async function rendered(previous=''){
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(previous=>{const frame=window.__sourceFrames.filter(frame=>frame.kind==='fit').at(-1),canvas=document.querySelector('canvas[aria-label="显影预览"]');return frame&&frame.url!==previous&&canvas?.dataset.frame===frame.url;},previous,{timeout:120000});
 await expect(canvas()).toBeVisible();
}
async function open(){
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(1);await rendered();
}
try{
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'user-data')}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(String(error)));
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 await page.evaluate(()=>{window.__sourceFrames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__sourceFrames.push(event.frame);});});
 stage='open-default';await open();
 const popup=page.locator('.source-color-dialog'),select=popup.getByRole('combobox',{name:'源色彩空间',exact:true});
 await expect(popup).toBeVisible();await expect(select.locator('option')).toHaveCount(5);assert.match(await select.inputValue(),/RTv4_sRGB\.icc$/);
 const srgbPixels=await canvas().evaluate(canvas=>canvas.toDataURL()),beforeFrame=await canvas().getAttribute('data-frame');
 pass('an unprofiled rendered file opens with an explicit sRGB interpretation and a visible source-space choice');
 stage='choose-p3';await select.selectOption({label:'Display P3'});await popup.getByRole('button',{name:'使用所选空间',exact:true}).click();await expect(popup).toHaveCount(0);await rendered(beforeFrame);
 const p3Pixels=await canvas().evaluate(canvas=>canvas.toDataURL());assert.notEqual(p3Pixels,srgbPixels);await expect(page.locator('.linear-display-status')).toContainText('Display P3');
 pass('choosing Display P3 changes the actual managed preview and records a selectable source interpretation');
 stage='save';await button('保存').click();await expect.poll(async()=>{try{return JSON.parse(await readFile(source+'.captraw','utf8')).kind;}catch{return '';}}).toBe('edit');
 const packet=JSON.parse(await readFile(source+'.captraw','utf8')),profile=packet.payload.adjustments.colorProfile,asset=packet.payload.inputProfileAsset;
 assert.equal(profile.mode,'inherited');assert.match(profile.reference,/^captraw-profile:/);assert.match(asset.path,/\.icc$/);assert.equal(hash(await readFile(source)),hash(original));
 pass('native save snapshots the selected profile as a content asset and leaves the unprofiled source bytes unchanged');
 stage='reopen';await button('关闭当前文件').click();await expect(page.locator('.film-item')).toHaveCount(0);await open();
 await expect(page.locator('.source-color-dialog')).toHaveCount(0);assert.equal(await canvas().evaluate(canvas=>canvas.toDataURL()),p3Pixels);
 pass('reopening the native sidecar restores the selected interpretation without showing the unprofiled-source prompt');
 assert.deepEqual(errors,[]);passed=true;
}catch(error){
 if(page&&!page.isClosed()){await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});await page.locator('body').ariaSnapshot().then(text=>import('node:fs/promises').then(fs=>fs.writeFile(join(work,'ui.txt'),text))).catch(()=>{});}
 await import('node:fs/promises').then(fs=>fs.writeFile(join(work,'failure.json'),JSON.stringify({error:String(error.stack||error),stage,checks,errors,diagnostics:app?electronDiagnostics(app):undefined},null,2))).catch(()=>{});
 throw error;
}finally{
 if(app)await closeElectron(app);console.log(JSON.stringify({passed,stage,checks,sourceSHA256:hash(original),backgroundWindow:true}));
 if(passed)await rm(work,{recursive:true,force:true});else console.error('Retained source-color GUI failure:',work);
}
