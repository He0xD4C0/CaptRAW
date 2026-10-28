import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {resolve,join} from 'node:path';
import {copyFileSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const out=resolve(process.env.CAPTRAW_GRID_E2E_OUT||'artifacts/grid-view-gui');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const source=resolve('build/samples/luminance-range.png'),sourceHash=createHash('sha256').update(readFileSync(source)).digest('hex');
const files=Array.from({length:14},(_,index)=>join(out,`照片 ${String(index+1).padStart(2,'0')}.png`));
for(const file of files)copyFileSync(source,file);
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[];
let app,page,failure;

async function idle(){
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__frames.filter(frame=>frame.kind!=='detail').at(-1)?.url);
}
async function settle(action){
  const count=await page.evaluate(()=>window.__frames.length);
  await action();await page.waitForFunction(count=>window.__frames.length>count,count);await idle();
}
const rows=()=>page.locator('.filmstrip .film-item').evaluateAll(items=>new Set(items.map(item=>Math.round(item.getBoundingClientRect().top))).size);
const pass=message=>{checks.push(message);console.log('PASS',message);};

try{
  app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
  page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(String(error)));
  await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__frames.push(event.frame);});});
  await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},files);
  await page.getByRole('button',{name:'打开',exact:true}).click();
  await expect(page.locator('.film-item')).toHaveCount(files.length);await idle();
  const viewport=page.getByTestId('viewport'),compactHeight=(await viewport.boundingBox()).height;
  expect(await rows()).toBe(1);
  await page.getByRole('button',{name:'网格视图',exact:true}).click();
  await expect(page.locator('.filmstrip')).toHaveAttribute('data-view','grid');
  await expect(page.getByRole('button',{name:'收起网格',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await rows()).toBeGreaterThan(1);
  const gridHeight=(await page.getByTestId('viewport').boundingBox()).height;
  expect(gridHeight).toBeLessThan(compactHeight);
  await page.screenshot({path:join(out,'grid-view.png')});
  pass('grid view produces a visible multi-row thumbnail layout and resizes the image stage');

  await page.getByRole('button',{name:/照片 03\.png 照片 03\.png/}).click({modifiers:['Meta']});
  await page.getByRole('button',{name:/照片 07\.png 照片 07\.png/}).click({modifiers:['Meta']});
  await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(3);
  await settle(()=>page.locator('.film-item').filter({hasText:'照片 07.png'}).locator('.film-open').click());
  await expect(page.locator('.document-title')).toContainText('照片 07.png');
  await expect(page.locator('canvas')).toBeVisible();
  pass('grid cards retain multi-selection and activate a different visible image');

  await page.keyboard.press('Escape');
  await expect(page.locator('.filmstrip')).toHaveAttribute('data-view','filmstrip');
  await expect(page.getByRole('button',{name:'网格视图',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(await rows()).toBe(1);
  pass('Escape restores the single-row filmstrip without changing the active image');

  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));
  await page.getByRole('button',{name:'网格视图',exact:true}).click();
  await expect(page.getByRole('button',{name:'收起网格',exact:true})).toBeInViewport();
  await expect(page.locator('.statusbar')).toBeInViewport();
  expect((await viewport.boundingBox()).height).toBeGreaterThan(100);
  await page.screenshot({path:join(out,'grid-minimum-window.png')});
  pass('grid view remains reachable with a usable canvas in the supported minimum window');

  expect(errors).toEqual([]);
  expect(files.every(file=>createHash('sha256').update(readFileSync(file)).digest('hex')===sourceHash)).toBe(true);
  pass('all source files remain byte-identical and no renderer errors occur');
}catch(error){
  failure=error;
  if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});
}finally{
  const diagnostics=app?electronDiagnostics(app):undefined;
  if(app)await closeElectron(app).catch(error=>{failure??=error;});
  writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors,sourceUnchanged:files.every(file=>createHash('sha256').update(readFileSync(file)).digest('hex')===sourceHash),failure:failure?String(failure):null,diagnostics},null,2)+'\n');
}
if(failure)throw failure;
