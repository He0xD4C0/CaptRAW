import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rm,access} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'captraw-relative-wb-gui-')),checks=[],errors=[];
const hash=b=>createHash('sha256').update(b).digest('hex'),pass=s=>{checks.push(s);console.log('PASS',s);};
execFileSync(process.env.CAPTRAW_PYTHON||resolve('build/qa-venv/bin/python'),['tests/fixtures/generators/relative-wb-fixtures.py',root]);
const files=['照片 一.jpg','照片 二.tif','照片 三.jpg'].map(n=>join(root,n));
for(const [i,source] of ['neutral.jpg','neutral.tif','warm.jpg'].entries())await copyFile(join(root,source),files[i]);
const originals=await Promise.all(files.map(async f=>hash(await readFile(f)))),sidecar=i=>files[i].replace(/\.[^.]+$/,'.xmp');
let app,page,success=false;
const input=name=>page.getByRole('spinbutton',{name,exact:true}),photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
const pixels=()=>page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL());
const imagePixels=()=>page.locator('canvas[aria-label="显影预览"]').evaluate(async c=>{const i=new Image();i.crossOrigin='anonymous';i.src=c.dataset.frame;await i.decode();const target=document.createElement('canvas');target.width=i.naturalWidth;target.height=i.naturalHeight;target.getContext('2d',{colorSpace:'srgb'}).drawImage(i,0,0);return target.toDataURL();});
const visibleInterior=()=>page.locator('canvas[aria-label="显影预览"]').evaluate(c=>Array.from(c.getContext('2d').getImageData(Math.floor(c.width/4),Math.floor(c.height/4),Math.floor(c.width/2),Math.floor(c.height/2)).data));
const neutralPixel=async()=>{const rgb=await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>Array.from(c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data).slice(0,3));expect(Math.max(...rgb)-Math.min(...rgb)).toBeLessThanOrEqual(4);};
const frame=()=>page.locator('canvas[aria-label="显影预览"]').getAttribute('data-frame');
async function idle(){await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const f=window.__frames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});}
async function changed(previous){await page.waitForFunction(p=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame!==p,previous);await idle();}
async function value(name,v){const old=await input(name).inputValue(),previous=await page.locator('canvas[aria-label="显影预览"]').getAttribute('data-frame');await input(name).fill(String(v));await input(name).press('Tab');if(Number(old)!==v)await changed(previous);else await idle();}
async function select(i){const active=await photo(i).locator('.film-open').getAttribute('aria-current'),previous=await frame();await photo(i).locator('.film-open').click();await expect(photo(i).locator('.film-open')).toHaveAttribute('aria-current','true');if(active!=='true')await changed(previous);else await idle();}
async function color(){await page.getByRole('button',{name:'编辑',exact:true}).click();await input('色温').scrollIntoViewIfNeeded();await expect(input('色温')).toBeVisible();await expect(input('色温')).toBeInViewport();}
async function launch(paths){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'user-data')}});page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});dialog.showMessageBox=async()=>({response:1});},paths);
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await page.getByRole('button',{name:'打开',exact:true}).click();await idle();
}
try{
 await launch(files);await select(0);await color();
 for(const name of ['色温','色调']){await expect(input(name)).toHaveAttribute('min','-100');await expect(input(name)).toHaveAttribute('max','100');await expect(input(name)).toHaveValue('0');}
 const initial=await pixels();await value('色温',25);const shifted=await pixels();expect(shifted).not.toBe(initial);
 let previous=await frame();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(input('色温')).toHaveValue('0');await changed(previous);expect(await pixels()).toBe(initial);
 previous=await frame();await page.getByRole('button',{name:'重做',exact:true}).click();await expect(input('色温')).toHaveValue('25');await changed(previous);expect(await pixels()).toBe(shifted);
 await input('色温').fill('12');await input('色温').press('Escape');await idle();await expect(input('色温')).toHaveValue('25');expect(await pixels()).toBe(shifted);
 pass('visible JPEG relative controls have zero-centred units, real pixels, one-step history and Escape');
 await select(1);await color();await value('色温',-20);await value('色调',15);await expect(input('色温')).toHaveValue('-20');
 pass('TIFF has independent relative controls and real parameter feedback');
 await select(2);await color();const mode=page.getByRole('combobox',{name:'白平衡',exact:true});await expect(mode).toBeEnabled();previous=await frame();await mode.selectOption('auto');await expect(mode).toHaveValue('auto');await changed(previous);
 // The authored 25/-15 becomes 28/-15 after this JPEG's actual encoding.
 expect(Math.abs(Number(await input('色温').inputValue())-28)).toBeLessThanOrEqual(1);expect(Math.abs(Number(await input('色调').inputValue())+15)).toBeLessThanOrEqual(1);await neutralPixel();
 await value('色温',0);await value('色调',0);await page.getByRole('button',{name:'白平衡吸管 I',exact:true}).click();const box=await page.locator('canvas[aria-label="显影预览"]').boundingBox();
 previous=await frame();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await expect(mode).toHaveValue('sample');await changed(previous);expect(Math.abs(Number(await input('色温').inputValue())-28)).toBeLessThanOrEqual(1);await neutralPixel();await page.keyboard.press('Escape');
 pass('enabled auto and visible eyedropper solve relative values through the actual GUI');
 await select(0);await photo(1).locator('.film-open').click({modifiers:['Meta']});await value('色调',-15);
 await page.getByRole('button',{name:'保存所选…',exact:true}).click();const save=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await save.getByRole('button',{name:'返回编辑',exact:true}).click();await idle();
 for(const i of [0,1])await expect.poll(()=>access(sidecar(i)).then(()=>true,()=>false)).toBe(true);
 const first=await readDocument(sidecar(0)),second=await readDocument(sidecar(1));expect(first.adjustments.incrementalTemperature).toBe(25);expect(second.adjustments.incrementalTemperature).toBe(-20);expect(first.adjustments.incrementalTint).toBe(-15);expect(second.adjustments.incrementalTint).toBe(-15);
 for(const i of [0,1]){const packet=await readFile(sidecar(i),'utf8');expect(packet).toContain('IncrementalTemperature');expect(packet).not.toMatch(/crs:Temperature[=>]/);}
 await page.getByRole('button',{name:'预设',exact:true}).click();await expect(page.getByRole('button',{name:'创建 ISO 自适应…',exact:true})).toBeDisabled();
 pass('sparse multi-image WB retains each temperature, standard XMP saves both and rendered images cannot create ISO anchors');
 await select(0);await color();const savedPixels=await imagePixels(),savedInterior=await visibleInterior();await closeElectron(app);app=undefined;await launch([sidecar(0)]);await color();await expect(input('色温')).toHaveValue('25');await expect(input('色调')).toHaveValue('-15');expect(await imagePixels()).toBe(savedPixels);expect(await visibleInterior()).toEqual(savedInterior);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));expect(windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true);
 for(const [i,file] of files.entries())expect(hash(await readFile(file))).toBe(originals[i]);expect(errors).toEqual([]);pass('fresh app restores matching pixels; inputs stay unchanged and all E2E windows stay hidden/unfocused');success=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error),checks,diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
finally{if(app)await closeElectron(app);console.log(JSON.stringify({success,checks,errors}));if(success)await rm(root,{recursive:true,force:true});else console.error('Retained relative WB GUI failure:',root);}
