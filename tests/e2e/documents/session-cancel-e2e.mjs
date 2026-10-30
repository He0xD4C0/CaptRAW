import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const scratch=await mkdtemp(join(tmpdir(),'captraw-session-cancel-')),checks=[],errors=[];
const inputs=['nikon-d850.NEF','canon-r5.CR3'].map(name=>resolve('build/samples',name));
const files=['尼康 照片.NEF','佳能 照片.CR3'].map(name=>join(scratch,name));
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex'),original=await Promise.all(inputs.map(hash));
for(const [i,path] of files.entries())await copyFile(inputs[i],path);
let app,page,passed=false;
const photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])}),exposure=()=>page.getByRole('spinbutton',{name:'曝光',exact:true}),pixels=async()=>createHash('sha256').update(await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL())).digest('hex');
async function idle(){await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);}
const pass=message=>{checks.push(message);console.log('PASS',message);};
try{
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(String(error)));
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});dialog.showMessageBox=async()=>({response:1});},files);
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(2);await idle();
 await photo(0).locator('.film-open').click();await expect(photo(0).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();
 const before=await pixels();await photo(1).locator('.film-open').click({modifiers:['Shift']});
 await exposure().fill('1.1');await exposure().press('Tab');const progress=page.getByRole('status',{name:'联动调整',exact:true});await expect(progress).toContainText('正在同步');
 await progress.getByRole('button',{name:'取消联动',exact:true}).click();await expect(progress).toHaveCount(0);await idle();await expect(exposure()).toHaveValue('0');expect(await pixels()).toBe(before);await expect(page.locator('.film-item .dirty-dot')).toHaveCount(0);
 pass('cancelling an actual RAW worker after progress restores all draft edits and the active pixels without adding history');
 await photo(1).locator('.film-open').click();await expect(photo(1).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();await expect(exposure()).toHaveValue('0');
 const frameCount=await page.evaluate(()=>window.__frames.length);await exposure().fill('.6');await exposure().press('Tab');await expect(exposure()).toHaveValue('0.6');await page.waitForFunction(n=>window.__frames.length>n,frameCount);await idle();const edited=await pixels();
 const killed=await app.evaluate(()=>{
  const children=process._getActiveHandles().filter(h=>h.constructor?.name==='ChildProcess'&&h.spawnargs?.[0]?.endsWith('captraw-engine')&&h.pid&&!h.killed);
  for(const child of children)child.kill('SIGKILL');return children.map(child=>child.pid);
 });expect(killed.length).toBeGreaterThan(0);await expect(page.getByRole('alert')).toContainText('已退出');
 await page.getByRole('button',{name:'重新载入当前编辑',exact:true}).click();await idle();await expect(exposure()).toHaveValue('0.6');expect(await pixels()).toBe(edited);await expect(photo(1).locator('.dirty-dot')).toHaveCount(1);
 pass('a preview-process crash can reload the current immutable edit without losing its parameters or pixels');
 await app.evaluate(()=>{for(const child of process._getActiveHandles())if(child.constructor?.name==='ChildProcess'&&child.spawnargs?.[0]?.endsWith('captraw-engine')&&child.pid&&!child.killed)child.kill('SIGKILL');});
 await expect(page.getByRole('alert')).toContainText('已退出');await page.locator('.status-actions').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);
 pass('session discard also succeeds when its preview process has already exited');
 for(const [i,path] of files.entries()){expect(await hash(path)).toBe(original[i]);expect(await hash(inputs[i])).toBe(original[i]);}expect(errors).toEqual([]);passed=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});await writeFile(join(scratch,'failure.json'),JSON.stringify({error:String(error),checks,diagnostics:app?electronDiagnostics(app):null},null,2));throw error;}
finally{if(app)await closeElectron(app);console.log(JSON.stringify({checks,errors,passed,packaged:!!process.env.CAPTRAW_APP}));if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained failure:',scratch);}
