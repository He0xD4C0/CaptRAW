import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {readDocument} from '../../support/xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron} from '../../support/electron-background.mjs';
import {resolve,join,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const out=resolve(process.env.CAPTRAW_EXTERNAL_E2E_OUT||'artifacts/external-masks-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[];let app,page,activeAsset;
const original=resolve('artifacts/segmentation/tiny/apple-mask.png'),asset=join(out,'蒙版 资产.png'),recipe=(await readDocument(join(process.env.CAPTRAW_EXTERNAL_OUT||'artifacts/external-masks','valid.xmp')));
recipe.artProfile=recipe.artProfile.replace(/^ExternalMaskFilename=.*$/m,'ExternalMaskFilename='+pathToFileURL(asset).href);
copyFileSync(original,asset);const file=join(out,'有效.xmp');writeFileSync(file,await documents.serialize(recipe));
const missing=join(out,'缺失.xmp');writeFileSync(missing,await documents.serialize({...recipe,artProfile:recipe.artProfile.replace(pathToFileURL(asset).href,pathToFileURL(join(out,'missing.png')).href)}));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(recipe.source.path),pass=s=>{checks.push(s);console.log('PASS',s);};
async function launch(){app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});}
async function settle(action){const count=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,count);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function choose(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await page.getByRole('button',{name:'打开',exact:true}).click();}
const pixels=()=>page.locator('canvas').evaluate(c=>c.toDataURL());
const value=()=>page.getByRole('spinbutton',{name:'曝光',exact:true});
async function savePath(path){await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);}
try{
 await launch();await settle(()=>choose(recipe.source.path));const baseline=await pixels();
 await choose(missing);await expect(page.getByRole('alert')).toContainText('蒙版文件缺失或损坏');expect(await pixels()).toBe(baseline);await expect(value()).toHaveValue('0');pass('opening a broken recipe gives a visible actionable error and retains the current photo');
 await settle(()=>choose(file));const valid=await pixels();expect(valid).not.toBe(baseline);pass('a valid inherited external mask changes actual displayed pixels');
 const saved=join(out,'已保存.xmp');rmSync(saved,{force:true});await savePath(saved);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(saved)).toBe(true);
 const savedBytes=readFileSync(saved);await app.close();await launch();await settle(()=>choose(saved));expect(await pixels()).toBe(valid);
 const metadata=((await readDocument(saved))).maskAssets;activeAsset=metadata?join(dirname(await page.evaluate(()=>window.__frames.at(-1).file)),'document-assets',basename(metadata.files[0].path)):asset;pass('saved recipe reopens in a fresh process with identical displayed pixels');
 rmSync(asset);if(activeAsset!==asset)rmSync(activeAsset);await value().fill('0.7');await value().press('Tab');await expect(page.getByRole('alert')).toContainText('蒙版文件缺失或损坏');await expect(page.locator('.rendering')).toBeHidden();expect(await pixels()).toBe(valid);await expect(value()).toHaveValue('0.7');pass('asset loss during editing preserves the last valid picture and the pending adjustment');
 await savePath(saved);await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('alert')).toContainText('蒙版文件缺失或损坏');expect(readFileSync(saved)).toEqual(savedBytes);pass('save refuses a broken asset and preserves the existing recipe');
 const destination=join(out,'保留.tiff');writeFileSync(destination,'keep existing export');await savePath(destination);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.getByRole('alert')).toContainText('蒙版文件缺失或损坏');expect(readFileSync(destination,'utf8')).toBe('keep existing export');pass('export cannot overwrite an existing destination after asset loss');
 // Check the host boundary separately: a caller cannot bypass the UI flush by invoking save directly.
 await savePath(saved);const rejected=await page.evaluate(async r=>{try{await window.captraw.save({id:window.__frames.at(-1).sessionId,adjustments:r.adjustments},r.artProfile);return '';}catch(e){return String(e);}},recipe);expect(rejected).toContain('蒙版文件缺失或损坏');expect(readFileSync(saved)).toEqual(savedBytes);pass('host save validates assets even when the renderer flush is bypassed');
 copyFileSync(original,asset);if(activeAsset!==asset)copyFileSync(original,activeAsset);await settle(async()=>{await value().fill('0.8');await value().press('Tab');});expect(await pixels()).not.toBe(valid);await expect(page.getByRole('alert')).toHaveCount(0);
 await savePath(saved);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(async()=>(await readDocument(saved)).adjustments.exposure).toBe(.8);
 const exported=join(out,'恢复.tiff');rmSync(exported,{force:true});await savePath(exported);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:60000});expect(existsSync(exported)).toBe(true);pass('restoring the file resumes editing, saving and a real TIFF export');
 await page.screenshot({path:join(out,'recovered.png')});expect(hash(recipe.source.path)).toBe(sourceHash);expect(errors).toEqual([]);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));expect(windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true);pass('all windows stay hidden and unfocused; source bytes and renderer remain intact');
}catch(error){if(page)await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{copyFileSync(original,asset);writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors,source:recipe.source.path,sourceSHA256:sourceHash},null,2)+'\n');if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await app.close().catch(()=>{});}}
