import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';

const work=await mkdtemp(join(tmpdir(),'captraw-closeout-workflow-')),source=resolve('build/samples/nikon-d850.NEF');
const photos=[join(work,'收尾 一.NEF'),join(work,'收尾 二.NEF')],sidecars=photos.map(path=>path+'.captraw');
await Promise.all(photos.map(async path=>{execFileSync('cp',[source,path]);}));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),originals=new Map(await Promise.all(photos.map(async path=>[path,hash(await readFile(path))])));
const checks=[],errors=[];let app,page,passed=false,stage='launch';
const button=name=>page.getByRole('button',{name,exact:true}),canvas=()=>page.getByRole('img',{name:'显影预览',exact:true});
const pass=message=>{checks.push(message);console.log('PASS',message);};
async function rendered(previous=''){
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(previous=>{const frame=window.__closeoutFrames.filter(item=>item.kind==='fit').at(-1),canvas=document.querySelector('canvas[aria-label="显影预览"]');return frame&&frame.url!==previous&&canvas?.dataset.frame===frame.url&&canvas?.dataset.colorSpace==='display-p3';},previous,{timeout:120000});
 await expect(canvas()).toBeVisible();
}
async function settle(action){
 const previous=await page.evaluate(()=>window.__closeoutFrames.length);await action();
 await page.waitForFunction(previous=>window.__closeoutFrames.length>previous,previous,{timeout:120000});await rendered();
}
async function open(paths){
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},paths);
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(paths.length);await rendered();
}
try{
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'user-data'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(String(error)));
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 await page.evaluate(()=>{window.__closeoutFrames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__closeoutFrames.push(event.frame);});});
 stage='import';await open(photos);await button('选择全部').click();
 await expect(page.getByRole('button',{name:'设为绿色色标',exact:true})).toBeVisible();await button('设为绿色色标').click();
 await button('评为 3 星').click();
 for(const label of await page.locator('.film-label').all())await expect(label).toHaveAttribute('data-label','Green');
 pass('two real RAW files enter one visible session with linked selection, color label and rating');
 stage='edit';const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});const beforeEdit=await canvas().evaluate(element=>element.toDataURL());
 await exposure.fill('.5');await exposure.press('Tab');await page.waitForFunction(previous=>document.querySelector('canvas[aria-label="显影预览"]')?.toDataURL()!==previous,beforeEdit,{timeout:120000});await rendered();await expect(exposure).toHaveValue('0.5');
 pass('a linked exposure edit updates the visible selected session without redirecting to a hidden document');
 stage='mask';await button('蒙版 M').click();const beforeMask=await page.evaluate(()=>window.__closeoutFrames.filter(item=>item.kind==='fit').at(-1)?.revision);await button('径向').click();
 await page.waitForFunction(revision=>window.__closeoutFrames.filter(item=>item.kind==='fit').at(-1)?.revision>revision,beforeMask,{timeout:120000});
 const bounds=await page.getByTestId('viewport').boundingBox();assert(bounds);await page.mouse.move(bounds.x+bounds.width*.34,bounds.y+bounds.height*.33);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.68,bounds.y+bounds.height*.7,{steps:10});await page.mouse.up();
 await page.locator('.mask-gesture-status').waitFor({state:'hidden'});await page.getByRole('spinbutton',{name:'局部亮度',exact:true}).fill('1');await page.getByRole('spinbutton',{name:'局部亮度',exact:true}).press('Tab');await rendered();
 await expect(page.locator('.mask-row')).toHaveCount(1);
 pass('the existing radial mask and local adjustment complete through the visible canvas and one edit history');
 stage='save';await button('保存所选…').click();await expect.poll(async()=>Promise.all(sidecars.map(path=>stat(path).then(()=>true,()=>false)))).toEqual([true,true]);
 const savedDialog=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await expect(savedDialog.getByRole('button',{name:'返回编辑',exact:true})).toBeVisible({timeout:120000});await savedDialog.getByRole('button',{name:'返回编辑',exact:true}).click();
 const packets=await Promise.all(sidecars.map(async path=>JSON.parse(await readFile(path,'utf8'))));
 for(const packet of packets){assert.equal(packet.kind,'edit');assert.equal(packet.payload.label,'Green');assert.equal(packet.payload.rating,3);}
 assert.deepEqual(packets.map(packet=>packet.payload.adjustments.exposure).sort((a,b)=>a-b),[0.5,0.5]);
 assert(packets.some(packet=>packet.payload.adjustments.masks.length===1));
 pass('one visible batch save writes native documents with rating, label, global and mask snapshots');
 stage='restart';await button('完成').click();await expect(page.locator('.film-item')).toHaveCount(0);await open(sidecars);
 await button('编辑').click();await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.5');await button('蒙版 M').click();await expect(page.locator('.mask-row')).toHaveCount(1);
 pass('fresh native sidecars restore the global edit, mask, rating and label workflow');
 stage='cancel';await button('完成').click();await expect(page.locator('.film-item')).toHaveCount(0);await open([sidecars[0]]);await button('编辑').click();const cancelExposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await cancelExposure.fill('1.1');await cancelExposure.press('Tab');await rendered();await button('取消').click();await expect(page.locator('.film-item')).toHaveCount(0);
 assert.equal(JSON.parse(await readFile(sidecars[0],'utf8')).payload.adjustments.exposure,0.5);for(const path of photos)assert.equal(hash(await readFile(path)),originals.get(path));assert.deepEqual(errors,[]);
 pass('whole-session Cancel discards unsaved work while previously saved edits and both RAW sources remain unchanged');
 passed=true;
}catch(error){
 if(page&&!page.isClosed()){await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});await page.locator('body').ariaSnapshot().then(text=>import('node:fs/promises').then(fs=>fs.writeFile(join(work,'ui.txt'),text))).catch(()=>{});}
 await import('node:fs/promises').then(fs=>fs.writeFile(join(work,'failure.json'),JSON.stringify({error:String(error.stack||error),stage,checks,errors,diagnostics:app?electronDiagnostics(app):undefined},null,2))).catch(()=>{});
 throw error;
}finally{
 if(app)await closeElectron(app);console.log(JSON.stringify({passed,stage,checks,backgroundWindow:true,packaged:!!process.env.CAPTRAW_APP}));
 if(passed)await rm(work,{recursive:true,force:true});else console.error('Retained closeout workflow failure:',work);
}
