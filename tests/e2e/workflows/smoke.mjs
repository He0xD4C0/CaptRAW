import {expect as playwrightExpect} from '@playwright/test';
import {electron,electronDiagnostics,closeElectron} from '../../support/electron-background.mjs';
import {resolve,join,dirname} from 'node:path';
import {mkdirSync,existsSync,writeFileSync,rmSync,copyFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
const expect=playwrightExpect.configure({timeout:60000});
const root=process.cwd(),out=resolve(process.env.CAPTRAW_E2E_OUT||'artifacts/monorepo/e2e');mkdirSync(out,{recursive:true});
const fixtureDirectory=mkdtempSync(join(tmpdir(),'captraw-smoke-'));
const source=join(fixtureDirectory,'nikon-d850.NEF'),recipe=source+'.captraw',output=join(fixtureDirectory,'gui-export.tiff');
copyFileSync(resolve('build/samples/nikon-d850.NEF'),source);
const executablePath=process.env.CAPTRAW_APP;
const errors=[],consoleErrors=[],diagnosticErrors=[],startedAt=new Date().toISOString();
const performanceBudgetMs=process.env.CAPTRAW_E2E_PERF_BUDGET_MS==='5000'?5000:null;
let app,page,firstVisibleMs,failure,diagnostics,events=[],stage='launch',backgroundWindow=false;
const describeError=error=>({name:error.name||'Error',message:error.message||String(error),stack:error.stack});
try{
  for(const file of ['e2e-failure.png','ui.txt','stdout.log','stderr.log','e2e-report.json'])rmSync(join(out,file),{force:true});
  app=await electron.launch({executablePath,args:executablePath?[]:[root],timeout:60000,env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
  backgroundWindow=true;page=await app.firstWindow({timeout:60000});
  page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'){consoleErrors.push(m.text());console.log('CONSOLE',m.text());}});
  stage='welcome';
  await expect(page.getByRole('heading',{name:'从光线，开始。'})).toBeVisible();
  await page.screenshot({path:join(out,'welcome.png')});
  await page.evaluate(()=>{window.__events=[];window.captraw.onEvent(e=>window.__events.push(e));});
  stage='open-raw';
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
  const firstStart=performance.now();
  await page.getByRole('button',{name:'打开',exact:true}).click();
  await expect(page.locator('.camera-name')).toContainText('D850');
  await expect(page.locator('.film-item img')).toBeVisible();
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.url);
  firstVisibleMs=performance.now()-firstStart;if(performanceBudgetMs!==null)expect(firstVisibleMs).toBeLessThan(performanceBudgetMs);
  await page.screenshot({path:join(out,'raw-open.png')});
  stage='exposure';
  const before=await page.locator('canvas').evaluate(c=>c.toDataURL());
  await page.getByRole('spinbutton',{name:'曝光',exact:true}).fill('1');
  await page.getByRole('spinbutton',{name:'曝光',exact:true}).press('Tab');
  await page.waitForFunction(()=>window.__events.filter(e=>e.event==='preview').length>=2);
  await page.locator('.rendering').waitFor({state:'hidden'});
  await expect.poll(async()=>page.locator('canvas').evaluate(c=>c.toDataURL())).not.toBe(before);
  stage='radial-mask';
  await page.getByRole('button',{name:'蒙版 M',exact:true}).click();
  const beforeMaskRevision=await page.evaluate(()=>window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.revision||0);
  await page.getByRole('button',{name:'径向',exact:true}).click();
  await page.waitForFunction(rev=>{const f=window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame;return f&&f.revision>rev&&document.querySelector('canvas').dataset.frame===f.url;},beforeMaskRevision);
  await page.locator('.rendering').waitFor({state:'hidden'});
  const beforeStrokeRevision=await page.evaluate(()=>window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1).frame.revision);
  const bounds=await page.getByTestId('viewport').boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height*.3);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.65,bounds.y+bounds.height*.7,{steps:10});await page.mouse.up();
  await page.locator('.mask-gesture-status').waitFor({state:'hidden'});
  await page.waitForFunction(rev=>{const f=window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame;return f&&f.revision>rev&&document.querySelector('canvas').dataset.frame===f.url;},beforeStrokeRevision);
  await expect(page.getByTestId('mask-mapped-guide')).toBeVisible();
  const maskBefore=await page.locator('canvas').evaluate(c=>c.toDataURL());
  await page.getByRole('spinbutton',{name:'局部亮度',exact:true}).fill('1.2');
  await page.getByRole('spinbutton',{name:'局部亮度',exact:true}).press('Tab');
  await expect.poll(()=>page.locator('canvas').evaluate(c=>c.toDataURL())).not.toBe(maskBefore);
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.url);
  await page.screenshot({path:join(out,'mask-edit.png')});
  stage='save-captraw';
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showMessageBox=async()=>({response:1});},recipe);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(()=>existsSync(recipe)).toBe(true);
  stage='export-tiff';
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
  await page.getByRole('button',{name:'导出',exact:true}).click();
  await page.getByRole('button',{name:'TIFF · 16 位'}).click();
  await expect(page.locator('.job-toast.done')).toBeVisible({timeout:60000});
  await expect.poll(()=>existsSync(output)).toBe(true);
  stage='detail-1to1';
  await page.getByRole('button',{name:'1:1',exact:true}).click();
  await page.waitForFunction(()=>window.__events.some(e=>e.event==='preview'&&e.frame.kind==='detail'));
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.detail===window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='detail').at(-1)?.frame.url);
  await page.screenshot({path:join(out,'detail-1to1.png')});
  stage='restore-captraw';
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},recipe);
  await page.getByRole('button',{name:'打开',exact:true}).click();
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('1');
  await page.getByRole('button',{name:'蒙版 M',exact:true}).click();
  await expect(page.locator('.mask-row')).toHaveCount(1);
  await expect(page.getByRole('spinbutton',{name:'局部亮度',exact:true})).toHaveValue('1.2');
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__events.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.url);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:join(out,'recipe-restored.png')});
  events=await page.evaluate(()=>window.__events);
  expect(errors).toEqual([]);
  stage='complete';
  console.log('E2E complete',executablePath||'production build',events.filter(e=>e.event==='preview').map(e=>({revision:e.frame.revision,kind:e.frame.kind,ms:e.frame.elapsedMs})));
}catch(error){
  failure=error;diagnostics=error.electronDiagnostics;
  if(error.electronScreenshot)writeFileSync(join(out,'e2e-failure.png'),error.electronScreenshot);
  console.error('E2E failed during',stage,error);
}finally{
  if(page&&!page.isClosed()){
    events=await page.evaluate(()=>window.__events||[]).catch(error=>{diagnosticErrors.push(String(error));return events;});
    if(failure){
      await page.screenshot({path:join(out,'e2e-failure.png'),timeout:5000}).catch(error=>diagnosticErrors.push(String(error)));
      const body=await page.locator('body').innerText({timeout:2000}).catch(error=>{diagnosticErrors.push(String(error));return '';});
      writeFileSync(join(out,'ui.txt'),body);
    }
  }
  // Snapshot while the app still owns its cache; before-quit deletes native logs.
  if(app)diagnostics=electronDiagnostics(app);
  for(const [name,body]of Object.entries(diagnostics?.nativeLogs||{})){
    const path=join(out,'native-logs',name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);
  }
  if(app){
    await closeElectron(app).catch(error=>{diagnosticErrors.push(String(error));if(!failure){failure=error;stage='shutdown';}});
    diagnostics=electronDiagnostics(app);
  }
  writeFileSync(join(out,'stdout.log'),diagnostics?.stdout||'');
  writeFileSync(join(out,'stderr.log'),diagnostics?.stderr||'');
  writeFileSync(join(out,'e2e-report.json'),JSON.stringify({status:failure?'failed':'passed',stage,startedAt,finishedAt:new Date().toISOString(),backgroundWindow,packaged:!!executablePath,firstVisibleMs,performanceBudgetMs,errors,consoleErrors,events,error:failure?describeError(failure):null,diagnostics,diagnosticErrors},null,2)+'\n');
  if(!failure)rmSync(fixtureDirectory,{recursive:true,force:true});
}
if(failure)throw failure;
