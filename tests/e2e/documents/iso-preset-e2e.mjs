import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';

const root=await mkdtemp(join(tmpdir(),'captraw-iso-gui-')),checks=[],errors=[];
const sources=['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF'].map(name=>resolve('build/samples',name));
const files=sources.map((path,i)=>join(root,`${i+1} ISO 照片 ${basename(path)}`));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=await Promise.all(sources.map(async path=>hash(await readFile(path))));
for(const [i,path] of files.entries())await copyFile(sources[i],path);
const artifactPaths=['build/native/captraw-engine','apps/desktop/dist/electron/main.cjs','apps/desktop/dist/renderer/index.html'];
const cohort=Object.fromEntries(await Promise.all(artifactPaths.map(async path=>[path,hash(await readFile(path))])));
let app,page,passed=false;
const button=name=>page.getByRole('button',{name,exact:true});
const input=name=>page.getByRole('spinbutton',{name,exact:true});
const photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])}).locator('.film-open');
const sidecar=i=>files[i]+'.captraw';
const pixels=async()=>hash(await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL()));
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const frame=window.__isoFrames.filter(f=>f.kind==='fit').at(-1);return frame&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===frame.url;});}
async function choose(paths=files){await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},paths);await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(paths.length);await idle();}
async function select(i,modifiers=[]){await photo(i).scrollIntoViewIfNeeded();await expect(photo(i)).toBeInViewport();await photo(i).click({modifiers});await expect(photo(i)).toHaveAttribute(modifiers.length?'aria-pressed':'aria-current','true');await idle();if(!modifiers.length)await expect(page.locator('.exposure-meta')).toContainText(`ISO ${[64,100,160][i]}`);}
async function value(name,value){const control=input(name);await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport();await expect(control).toBeEnabled();await control.fill(String(value));await control.press('Tab');await idle();await expect(control).toHaveValue(String(value));}
async function launch(){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'user-data'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_,options)=>{if(options.message==='确认保存这些 CaptRAW 编辑文件？')return {response:1};throw new Error('Unexpected dialog: '+options.message);};});
 await page.evaluate(()=>{window.__isoFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__isoFrames.push(e.frame);});});
}
function pass(message){checks.push(message);console.log('PASS',message);}
try{
 await launch();await choose();
 await select(0);await button('编辑').click();await value('颗粒',25);await value('颗粒大小',20);await value('颗粒粗糙度',20);
 await select(2);await value('颗粒',25);await value('颗粒大小',80);await value('颗粒粗糙度',90);
 await select(0);await select(2,['Meta']);await expect(photo(0)).toHaveAttribute('aria-pressed','true');await expect(photo(1)).toHaveAttribute('aria-pressed','false');await expect(photo(2)).toHaveAttribute('aria-pressed','true');
 await button('预设').click();await button('创建 ISO 自适应…').scrollIntoViewIfNeeded();await expect(button('创建 ISO 自适应…')).toBeInViewport();await button('创建 ISO 自适应…').click();
 const dialog=page.getByRole('dialog',{name:'创建 ISO 自适应预设',exact:true});await dialog.getByLabel('预设名称',{exact:true}).fill('ISO 颗粒往返');await dialog.getByLabel('预设分组',{exact:true}).fill('工作流 验证');
 await dialog.getByRole('button',{name:'全不选',exact:true}).click();await dialog.getByRole('checkbox',{name:'纹理、清晰度与效果',exact:true}).check();await dialog.getByRole('button',{name:'保存预设',exact:true}).click();await expect(dialog).toHaveCount(0);
 pass('actual ISO 64 NEF and ISO 160 RAF create an effects-only adaptive preset through visible controls');
 await select(1);await button('编辑').click();await expect(input('颗粒')).toHaveValue('0');const before=await pixels();
 await button('预设').click();const preset=page.getByRole('button',{name:'ISO 颗粒往返 · ISO',exact:true});await preset.scrollIntoViewIfNeeded();await expect(preset).toBeInViewport();await preset.click();await page.getByRole('searchbox',{name:'搜索预设',exact:true}).hover();await idle();
 await button('编辑').click();
 const t=Math.log2(100/64)/Math.log2(160/64),size=Math.round(20+60*t),roughness=Math.round(20+70*t);
 await expect(input('颗粒')).toHaveValue('25');await expect(input('颗粒大小')).toHaveValue(String(size));await expect(input('颗粒粗糙度')).toHaveValue(String(roughness));const after=await pixels();assert.notEqual(after,before);
 pass(`actual ISO 100 CR3 receives log2-interpolated grain size ${size} and roughness ${roughness}, with changed canvas pixels`);
 await button('撤销').click();await expect(input('颗粒')).toHaveValue('0');await expect.poll(pixels,{timeout:15000}).toBe(before);await idle();
 await button('重做').click();await expect(input('颗粒大小')).toHaveValue(String(size));await expect.poll(pixels,{timeout:15000}).toBe(after);await idle();
 pass('one undo restores the original CR3 pixels; one redo restores the complete adaptive edit');
 await button('保存').click();await idle();await expect(page.locator('.film-item').filter({hasText:basename(files[1])}).locator('.dirty-dot')).toHaveCount(0);
 const saved=await readDocument(sidecar(1));assert.equal(saved.adjustments.grain,25);assert.equal(saved.adjustments.grainSize,size);assert.equal(saved.adjustments.grainRoughness,roughness);
 await closeElectron(app);app=undefined;await launch();await choose([files[1]]);await button('编辑').click();
 await expect(input('颗粒大小')).toHaveValue(String(size));await expect(input('颗粒粗糙度')).toHaveValue(String(roughness));assert.equal(await pixels(),after);
 await button('预设').click();await expect(page.getByRole('button',{name:'ISO 颗粒往返 · ISO',exact:true})).toBeVisible();
 pass('fresh app process restores native saved parameters, exact canvas pixels and the user ISO preset');
 for(const [i,path] of sources.entries()){assert.equal(hash(await readFile(path)),original[i]);assert.equal(hash(await readFile(files[i])),original[i]);}
 for(const [path,expected] of Object.entries(cohort))assert.equal(hash(await readFile(path)),expected);
 assert.deepEqual(errors,[]);passed=true;
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});await writeFile(join(root,'failure-ui.txt'),await page.locator('body').ariaSnapshot()).catch(()=>{});}await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,errors,cohort,diagnostics:app?electronDiagnostics(app):null},null,2));throw error;}
finally{if(app)await closeElectron(app);console.log(JSON.stringify({passed,checks,cohort,packaged:!!process.env.CAPTRAW_APP}));if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained ISO GUI failure:',root);}
