import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(process.env.CAPTRAW_SYNC_READY_OUT||'artifacts/synchronize-ready');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),source=resolve('build/samples/luminance-range.png'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source);
const files=['source.png','target.png'].map(n=>join(out,n));for(const path of files)copyFileSync(source,path);
const probeFill=process.argv.includes('--probe-fill'),checks=[];let app,page,failure,observation;
const button=name=>page.getByRole('button',{name,exact:true}),exposure=()=>page.getByRole('spinbutton',{name:'曝光',exact:true});
async function idle(){await expect(button('打开')).toBeEnabled();await page.waitForFunction(()=>{const f=window.__readyFrames?.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});}
try{
 app=await electron.launch({executablePath:process.env.CAPTRAW_APP});page=await app.firstWindow();page.setDefaultTimeout(30000);
 await page.evaluate(()=>{window.__readyFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__readyFrames.push(e.frame);});});
 await app.evaluate(({dialog},filePaths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths});},files);await button('打开').click();await idle();
 await app.evaluate(({ipcMain})=>{const real=ipcMain._invokeHandlers.get('image:update');globalThis.__switchHeld=false;globalThis.__holdSwitch=true;ipcMain.removeHandler('image:update');ipcMain.handle('image:update',async(...args)=>{const result=await real(...args);if(globalThis.__holdSwitch){globalThis.__switchHeld=true;await new Promise(resolve=>{globalThis.__releaseSwitch=resolve;});}return result;});});
 const count=await page.evaluate(()=>window.__readyFrames.length);
 await page.locator('.film-item').filter({hasText:'source.png'}).locator('.film-open').click();
 await expect.poll(()=>app.evaluate(()=>globalThis.__switchHeld)).toBe(true);
 await page.waitForFunction(n=>window.__readyFrames.length>n&&document.querySelector('canvas')?.dataset.frame===window.__readyFrames.filter(f=>f.kind==='fit').at(-1)?.url,count);
 await expect(button('打开')).toBeDisabled();observation={previewVisibleBeforeSwitchReply:true,exposureEnabled:await exposure().isEnabled()};
 if(probeFill){
  await expect(exposure()).toBeEnabled();await expect(page.locator('.workbench')).toHaveAttribute('inert','');await exposure().fill('1.1');await exposure().press('Tab');observation.displayedExposureBeforeReply=await exposure().inputValue();assert.equal(observation.displayedExposureBeforeReply,'0');
 }else{await expect(page.locator('.workbench')).toHaveAttribute('inert','');await assert.rejects(exposure().click({trial:true,timeout:500}),/intercepts pointer events/);}
 await page.screenshot({path:join(out,'pending-switch.png')});
 await app.evaluate(()=>{globalThis.__holdSwitch=false;globalThis.__releaseSwitch();});await idle();
 if(!probeFill){await expect(exposure()).toBeEnabled();await exposure().fill('1.1');await exposure().press('Tab');await expect(exposure()).toHaveValue('1.1');}
 const saved=join(out,'source.xmp');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},saved);await button('保存').click();await expect.poll(()=>existsSync(saved)).toBe(true);const doc=await readDocument(saved);observation.savedExposure=doc.adjustments.exposure;
 assert.equal(doc.adjustments.exposure,probeFill?0:1.1);checks.push(probeFill?'Playwright fill resolves during inert switching without applying the requested edit; document remains unchanged':'inert workbench blocks real pointer action while switching; after actual readiness the edit persists in XMP');
 assert.equal(hash(source),sourceHash);assert(files.every(p=>hash(p)===sourceHash));
}catch(error){failure=error.stack;if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await closeElectron(app);writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure,probeFill,checks,observation,failure,executablePath:process.env.CAPTRAW_APP,sourceHash,backgroundWindow:true},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
