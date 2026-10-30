import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';

const out=resolve(process.env.CAPTRAW_CLIPPING_OUT||'artifacts/histogram-clipping-gui');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const source=resolve('build/samples/luminance-range.png'),before=createHash('sha256').update(readFileSync(source)).digest('hex');
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[];
let app,page,failure;
const pass=message=>{checks.push(message);console.log('PASS',message);};

async function idle(){
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__frames.filter(frame=>frame.kind!=='detail').at(-1)?.url);
}
const canvasImage=()=>page.locator('canvas').evaluate(canvas=>canvas.toDataURL());

try{
  app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
  page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(String(error)));
  await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__frames.push(event.frame);});});
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.locator('canvas')).toBeVisible();await idle();
  const original=await canvasImage(),shadow=page.getByRole('button',{name:'显示阴影裁剪'}),highlight=page.getByRole('button',{name:'显示高光裁剪'});
  await expect(shadow).toBeInViewport();await expect(highlight).toBeInViewport();
  await shadow.click();await expect(shadow).toHaveAttribute('aria-pressed','true');await expect(page.locator('canvas')).toHaveAttribute('data-clipping','shadows');expect(await canvasImage()).not.toBe(original);
  await page.screenshot({path:join(out,'shadow-clipping.png')});
  const shadowImage=await canvasImage();
  pass('shadow clipping control visibly overlays clipped pixels and reports active state');

  await highlight.click();await expect(highlight).toHaveAttribute('aria-pressed','true');await expect(shadow).toHaveAttribute('aria-pressed','false');await expect(page.locator('canvas')).toHaveAttribute('data-clipping','highlights');expect(await canvasImage()).not.toBe(shadowImage);
  await page.getByRole('button',{name:'1:1',exact:true}).click();
  await page.waitForFunction(()=>window.__frames.some(event=>event.kind==='detail'));
  await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.detail===window.__frames.filter(frame=>frame.kind==='detail').at(-1)?.url);
  await expect(page.locator('canvas')).toHaveAttribute('data-clipping','highlights');
  await page.screenshot({path:join(out,'highlight-1to1.png')});
  pass('highlight clipping remains aligned when the full-resolution 1:1 detail region is displayed');

  await page.getByRole('button',{name:'适屏',exact:true}).click();await idle();
  await highlight.click();await expect(highlight).toHaveAttribute('aria-pressed','false');await expect(page.locator('canvas')).toHaveAttribute('data-clipping','');
  const withoutOverlay=await canvasImage();
  await highlight.click();await expect(page.locator('canvas')).toHaveAttribute('data-clipping','highlights');const withOverlay=await canvasImage();expect(withOverlay).not.toBe(withoutOverlay);
  await highlight.click();await expect.poll(canvasImage).toBe(withoutOverlay);
  pass('turning clipping off restores the corresponding unmodified preview after 1:1');

  const compare=page.getByRole('button',{name:'按住对比',exact:true});await shadow.click();await compare.hover();await page.mouse.down();
  await expect(shadow).toBeDisabled();await expect(highlight).toBeDisabled();await expect(page.locator('canvas')).toHaveAttribute('data-clipping','');
  await page.mouse.up();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));
  await expect(shadow).toBeInViewport();await expect(highlight).toBeInViewport();
  pass('clipping controls are disabled during comparison and remain reachable in the minimum window');

  expect(errors).toEqual([]);expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(before);
  pass('no renderer errors occur and the source file remains byte-identical');
}catch(error){
  failure=error;
  if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});
}finally{
  const diagnostics=app?electronDiagnostics(app):undefined;
  if(app)await closeElectron(app).catch(error=>{failure??=error;});
  writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors,sourceUnchanged:createHash('sha256').update(readFileSync(source)).digest('hex')===before,failure:failure?String(failure):null,diagnostics},null,2)+'\n');
}
if(failure)throw failure;
