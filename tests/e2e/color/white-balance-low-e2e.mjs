import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
const scratch=await mkdtemp(join(tmpdir(),'captraw-wb-low-e2e-'));
const source=resolve('build/samples/synthetic.dng'),original=await readFile(source),photo=join(scratch,'低温 白平衡.dng'),sidecar=join(scratch,'低温 白平衡.xmp');await copyFile(source,photo);
let app,page,passed=false,failure;const errors=[];
try{
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(scratch,'user-data'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog},filePath)=>{
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});
  dialog.showMessageBox=async(_,options)=>{if(options.message==='确认保存这些 XMP 旁车？')return {response:1};throw new Error('Unexpected native dialog: '+options.message);};
 },photo);
 await page.evaluate(()=>{window.__lowWBFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__lowWBFrames.push(e.frame);});});
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(1);
 const temperature=page.getByRole('spinbutton',{name:'色温',exact:true});
 async function idle(){
  await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>{const frame=window.__lowWBFrames.filter(f=>f.kind==='fit').at(-1);return frame&&document.querySelector('canvas')?.dataset.frame===frame.url;});
 }
 await idle();await expect(temperature).toBeVisible();await expect(temperature).toHaveAttribute('min','1500');
 const documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp')));
 for(const value of [1500,1750,1999,2000]){
  await temperature.fill(String(value));await temperature.press('Tab');await idle();await expect(temperature).toHaveValue(String(value));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'保存',exact:true}).click();await idle();await expect(page.locator('.film-item .dirty-dot')).toHaveCount(0);
  assert.equal((await documents.read(sidecar)).adjustments.temperature,value);
  console.log('PASS visible temperature control renders and saves',value);
 }
 const state=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));
 assert(state.length&&state.every(w=>!w.visible&&!w.focused&&!w.focusable));assert.deepEqual(errors,[]);
 assert.deepEqual(await readFile(source),original);assert.deepEqual(await readFile(photo),original);passed=true;
}catch(error){failure=error;}
finally{
 if(failure){if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});await writeFile(join(scratch,'failure.json'),JSON.stringify({error:failure.stack||String(failure),errors,diagnostics:app?electronDiagnostics(app):failure.electronDiagnostics},null,2));}
 if(app)try{await closeElectron(app);}catch(error){passed=false;failure??=error;await writeFile(join(scratch,'shutdown-failure.txt'),String(error));}
 if(passed){await rm(scratch,{recursive:true,force:true});console.log('PASS hidden low-temperature GUI; scratch removed');}else console.error('Retained failure:',scratch);
}
if(failure)throw failure;
