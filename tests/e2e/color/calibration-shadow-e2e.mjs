import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const root=await mkdtemp(join(tmpdir(),'captraw-shadow-gui-')),checks=[],errors=[];
const files=['照片 一.dng','照片 二.dng'].map(n=>join(root,n)),fixture=resolve('build/samples/synthetic.dng');
const sha=b=>createHash('sha256').update(b).digest('hex'),sourceHash=sha(await readFile(fixture));
for(const path of files)await copyFile(fixture,path);
const preset=join(root,'阴影 预设.xmp');await writeFile(preset,`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:ShadowTint="35"><crs:Name><rdf:Alt><rdf:li xml:lang="x-default">阴影 专项</rdf:li></rdf:Alt></crs:Name></rdf:Description></rdf:RDF></x:xmpmeta>`);
let app,page,success=false;
const pass=s=>{checks.push(s);console.log('PASS',s);},input=name=>page.getByRole('spinbutton',{name,exact:true});
const photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
const pixels=async()=>sha(await page.locator('canvas').evaluate(c=>c.toDataURL()));
async function idle(){await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function select(i){await photo(i).locator('.film-open').click();await expect(photo(i).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();}
async function calibration(){await page.getByRole('button',{name:'编辑',exact:true}).click();const section=page.locator('details.adjust-section').filter({has:page.getByText('颜色校准',{exact:true})});if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();await input('阴影色调').scrollIntoViewIfNeeded();await expect(input('阴影色调')).toBeVisible();await expect(input('阴影色调')).toBeInViewport();}
async function nextFrame(previous){await page.waitForFunction(previous=>{const frame=document.querySelector('canvas')?.dataset.frame;return !!frame&&frame!==previous;},previous);await idle();}
async function value(name,v){const previous=await page.locator('canvas').getAttribute('data-frame'),old=await input(name).inputValue();await input(name).fill(String(v));await input(name).press('Tab');if(Number(old)!==v)await nextFrame(previous);else await idle();}
async function history(name){const previous=await page.locator('canvas').getAttribute('data-frame');await page.getByRole('button',{name,exact:true}).click();await nextFrame(previous);}
async function save(){await page.getByRole('button',{name:'保存所选…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await dialog.getByRole('button',{name:'返回编辑',exact:true}).click();await idle();}
const sidecar=i=>files[i].replace(/\.dng$/,'.xmp');
async function launch(paths){
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});dialog.showMessageBox=async()=>({response:1});},paths);
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
}
try{
 await launch(files);
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(2);await idle();await select(0);await calibration();
 await expect(input('阴影色调')).toHaveAttribute('min','-100');await expect(input('阴影色调')).toHaveAttribute('max','100');await expect(input('阴影色调')).toHaveValue('0');
 const before=await pixels();await value('阴影色调',40);const after=await pixels();expect(after).not.toBe(before);
 await history('撤销');await expect(input('阴影色调')).toHaveValue('0');expect(await pixels()).toBe(before);
 await history('重做');await expect(input('阴影色调')).toHaveValue('40');expect(await pixels()).toBe(after);
 pass('visible shadow tint control changes actual canvas pixels and has one undo/redo step');
 await input('阴影色调').fill('20');await input('阴影色调').press('Escape');await idle();await expect(input('阴影色调')).toHaveValue('40');expect(await pixels()).toBe(after);
 await history('撤销');await expect(input('阴影色调')).toHaveValue('0');await history('重做');
 pass('Escape restores the pre-edit value and pixels without leaving another undo entry');
 await value('红色色相',9);await select(1);await calibration();await value('蓝色色相',12);await value('阴影色调',-20);
 await select(0);await photo(1).locator('.film-open').click({modifiers:['Shift']});await calibration();await value('阴影色调',25);await save();
 let first=await readDocument(sidecar(0)),second=await readDocument(sidecar(1));expect(first.adjustments.calibration.shadowTint).toBe(25);expect(second.adjustments.calibration.shadowTint).toBe(25);expect(first.adjustments.calibration.redHue).toBe(9);expect(second.adjustments.calibration.blueHue).toBe(12);
 expect(await readFile(sidecar(0),'utf8')).toContain('crs:ShadowTint="25"');
 await history('撤销');await save();first=await readDocument(sidecar(0));second=await readDocument(sidecar(1));expect(first.adjustments.calibration.shadowTint).toBe(40);expect(second.adjustments.calibration.shadowTint).toBe(-20);
 pass('linked edit/save and selected undo preserve each photo’s prior tint and other primary controls');
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},preset);
 await page.getByRole('button',{name:'预设',exact:true}).click();await page.getByRole('button',{name:'导入…',exact:true}).click();const apply=page.getByRole('button',{name:'阴影 专项',exact:true});await expect(apply).toBeVisible();await apply.click();await page.getByRole('searchbox',{name:'搜索预设',exact:true}).hover();await idle();await save();
 first=await readDocument(sidecar(0));second=await readDocument(sidecar(1));for(const doc of [first,second])expect(doc.adjustments.calibration.shadowTint).toBe(35);expect(first.adjustments.calibration.redHue).toBe(9);expect(second.adjustments.calibration.blueHue).toBe(12);
 await select(0);await calibration();const savedPixels=await pixels();await closeElectron(app);app=undefined;await launch([sidecar(0)]);
 await page.getByRole('button',{name:'打开',exact:true}).click();await idle();await calibration();await expect(input('阴影色调')).toHaveValue('35');expect(await pixels()).toBe(savedPixels);
 pass('a sparse standard XMP preset applies to both selected photos; a fresh app restores saved values and identical pixels');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await input('阴影色调').scrollIntoViewIfNeeded();await expect(input('阴影色调')).toBeInViewport();
 for(const file of files)expect(sha(await readFile(file))).toBe(sourceHash);expect(sha(await readFile(fixture))).toBe(sourceHash);expect(errors).toEqual([]);success=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error),checks,diagnostics:app?electronDiagnostics(app):null},null,2));throw error;}
finally{if(app)await closeElectron(app);console.log(JSON.stringify({checks,errors,success}));if(success)await rm(root,{recursive:true,force:true});else console.error('Retained shadow GUI failure:',root);}
