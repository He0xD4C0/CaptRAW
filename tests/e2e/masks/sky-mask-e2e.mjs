import {expect} from '@playwright/test';
import {electron} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const out=resolve(process.env.CAPTRAW_SKY_MASK_E2E_OUT||'artifacts/sky-mask-gui');
const source=resolve(process.env.CAPTRAW_SKY_MASK_IMAGE||'artifacts/segmentation-input/inputs/nikon-d850.NEF.png');
const executablePath=process.env.CAPTRAW_APP;
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceHash=hash(source),checks=[],errors=[];
let app,page;
mkdirSync(out,{recursive:true});
const pass=message=>{checks.push(message);console.log('PASS',message);};

async function launch(){
  app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
  page=await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true})));
  await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__frames.push(event.frame);});});
}
async function settle(action){
  const count=await page.evaluate(()=>window.__frames.length);
  await action();
  await page.waitForFunction(count=>window.__frames.length>count,count);
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(frame=>frame.kind!=='detail').at(-1)?.url);
}
async function open(path){
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
  await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());
}
async function save(name){
  const path=join(out,name+'.xmp');
  rmSync(path,{force:true});
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(()=>existsSync(path)).toBe(true);
  await page.locator('.rendering').waitFor({state:'hidden'});
  return {path,recipe:await readDocument(path)};
}
const pixels=()=>page.locator('canvas').evaluate(canvas=>canvas.toDataURL());

try{
  await launch();
  await open(source);
  await page.getByRole('button',{name:'蒙版 M',exact:true}).click();
  await page.getByRole('button',{name:'选择对象',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('点击对象',{timeout:60000});
  const sky=page.getByRole('button',{name:'自动天空',exact:true});
  await expect(sky).toBeVisible();
  await sky.click();
  const preview=page.locator('.person-part-preview img[alt="天空蒙版预览"]');
  await expect(preview).toBeVisible({timeout:60000});
  await expect(page.locator('.person-part-preview span')).toContainText('像素');
  await expect(sky).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'创建蒙版',exact:true})).toBeEnabled();
  await page.screenshot({path:join(out,'sky-mask-preview.png')});
  pass('visible automatic-sky control produces a real local mask preview');

  await settle(()=>page.getByRole('button',{name:'创建蒙版',exact:true}).click());
  await expect(page.locator('.mask-row')).toHaveCount(1);
  await expect(page.getByTestId('mask-coverage')).toBeVisible();
  const before=await pixels();
  await settle(async()=>{
    const control=page.getByRole('spinbutton',{name:'局部亮度',exact:true});
    await control.fill('0.6');
    await control.press('Tab');
  });
  expect(await pixels()).not.toBe(before);
  const saved=await save('自动天空');
  expect(saved.recipe.adjustments.masks).toHaveLength(1);
  expect(saved.recipe.adjustments.masks[0].components[0].type).toBe('raster');
  expect(saved.recipe.maskAssets.files).toHaveLength(1);
  pass('automatic sky commit creates a raster mask and drives a real local adjustment');

  const reopenedPixels=await pixels();
  await app.close();
  app=undefined;
  await launch();
  await open(saved.path);
  expect(await pixels()).toBe(reopenedPixels);
  pass('saved sky mask reopens with identical displayed pixels without inference');

  const output=join(out,'automatic-sky.tiff');
  rmSync(output,{force:true});
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
  await page.getByRole('button',{name:'导出',exact:true}).click();
  await page.getByRole('button',{name:'TIFF · 16 位'}).click();
  await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
  expect(existsSync(output)).toBe(true);
  pass('automatic sky mask exports through the native 16-bit TIFF path');

  expect(hash(source)).toBe(sourceHash);
  expect(errors).toEqual([]);
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({
    visible:window.isVisible(),focused:window.isFocused(),focusable:window.isFocusable()
  })));
  expect(windows.every(window=>!window.visible&&!window.focused&&!window.focusable)).toBe(true);
  pass('source remains unchanged and every E2E window stays hidden and unfocused');
}catch(error){
  if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});
  throw error;
}finally{
  writeFileSync(join(out,'report.json'),JSON.stringify({
    checks,errors,source,sourceSHA256:sourceHash,executablePath:executablePath||null,backgroundWindow:true,httpBlocked:true
  },null,2)+'\n');
  if(app){
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});
    await app.close().catch(()=>{});
  }
}
