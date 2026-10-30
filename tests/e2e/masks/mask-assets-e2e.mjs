import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {readDocument} from '../../support/xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron} from '../../support/electron-background.mjs';
import {resolve,join,basename,dirname} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const out=resolve(process.env.CAPTRAW_ASSETS_E2E_OUT||'artifacts/mask-assets-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[],hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let app,page;const clearedCaches=[];
const original=resolve('artifacts/segmentation/tiny/apple-mask.png'),asset=join(out,'临时 蒙版.png'),originalDocument=(await readDocument(join(process.env.CAPTRAW_EXTERNAL_OUT||'artifacts/external-masks','valid.xmp')));
originalDocument.artProfile=originalDocument.artProfile.replace(/^ExternalMaskFilename=.*$/m,'ExternalMaskFilename='+pathToFileURL(asset).href);copyFileSync(original,asset);
const originalDocumentPath=join(out,'外部蒙版.xmp');writeFileSync(originalDocumentPath,await documents.serialize(originalDocument));const sourceHash=hash(originalDocument.source.path),originalDocumentBytes=readFileSync(originalDocumentPath);
const saved=join(out,'已保存.xmp'),moved=join(out,'移动 后'),destination=join(moved,'重命名.xmp');mkdirSync(moved,{recursive:true});rmSync(saved,{force:true});
const pass=s=>{checks.push(s);console.log('PASS',s);};
async function launch(){app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});}
async function settle(action){const count=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,count);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function choose(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await page.getByRole('button',{name:'打开',exact:true}).click();}
async function save(path){await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async (_window,options)=>{if(!options.message.includes('资产文件夹'))throw new Error('Missing asset portability message');return {canceled:false,filePath:path};};},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);}
const pixels=()=>page.locator('canvas').evaluate(c=>c.toDataURL());
async function close(){const frame=await page.evaluate(()=>window.__frames.at(-1));await app.close();if(frame?.file){const cache=dirname(frame.file);console.log('CACHE CLEANUP',cache,existsSync(cache));expect(existsSync(cache)).toBe(false);clearedCaches.push(cache);}}
try{
 await launch();await settle(()=>choose(originalDocumentPath));const before=await pixels();await save(saved);const stored=(await readDocument(saved));expect(stored.engineVersion).toBe(ENGINE_VERSION);expect(stored.maskAssets.files).toHaveLength(1);const sourceAsset=join(out,stored.maskAssets.files[0].path);expect(hash(sourceAsset)).toBe(hash(original));pass('visible save control writes the recipe and verified companion asset');
 await close();copyFileSync(saved,destination);cpSync(saved+'.assets',join(moved,basename(saved)+'.assets'),{recursive:true});rmSync(asset);rmSync(saved);rmSync(saved+'.assets',{recursive:true});
 await launch();await settle(()=>choose(destination));expect(await pixels()).toBe(before);pass('fresh installed process opens moved and renamed recipe after original and temporary assets are deleted');
 const bundled=join(moved,stored.maskAssets.files[0].path),bytes=readFileSync(bundled);rmSync(bundled);
 const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await settle(async()=>{await exposure.fill('0.5');await exposure.press('Tab');});expect(await pixels()).not.toBe(before);pass('editing uses verified private assets and survives source folder removal');
 const second=join(out,'另存.xmp');rmSync(second,{force:true});await save(second);expect((await readDocument(second)).maskAssets.files[0].path).toContain('另存.xmp.assets/');expect(hash(join(out,(await readDocument(second)).maskAssets.files[0].path))).toBe(hash(original));pass('save as copies the live document asset into the new destination');
 await close();await launch();await settle(()=>choose(originalDocument.source.path));const baseline=await pixels();await choose(destination);await expect(page.getByRole('alert')).toContainText('蒙版资产缺失');expect(await pixels()).toBe(baseline);pass('missing saved asset reports an error while retaining current photo');
 writeFileSync(bundled,'corrupt');await choose(destination);await expect(page.getByRole('alert')).toContainText('校验值不符');expect(await pixels()).toBe(baseline);writeFileSync(bundled,bytes);await settle(()=>choose(destination));expect(await pixels()).toBe(before);pass('corrupt asset is rejected; restored asset reopens with identical displayed pixels');
 const exported=join(out,'已恢复.tiff');rmSync(exported,{force:true});await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},exported);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:60000});expect(existsSync(exported)).toBe(true);pass('restored asset participates in actual TIFF export');
 await page.screenshot({path:join(out,'restored.png')});expect(hash(originalDocument.source.path)).toBe(sourceHash);expect(readFileSync(originalDocumentPath)).toEqual(originalDocumentBytes);expect(errors).toEqual([]);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));expect(windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true);expect(readdirSync(out).filter(p=>p.endsWith('.tmp'))).toEqual([]);await close();pass('all windows remain hidden; original photo and original XMP document remain byte-identical; private caches removed');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({checks,errors,packaged:!!executablePath,backgroundWindow:true,source:originalDocument.source.path,sourceSHA256:sourceHash,originalDocumentSHA256:hash(originalDocumentPath),clearedCaches},null,2)+'\n');if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await app.close().catch(()=>{});}}
