import {readDocument} from './xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';

const out=resolve(process.env.CAPTRAW_MATCH_EXPOSURE_OUT||'artifacts/match-exposure-gui');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const files=['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF'].map(name=>resolve('build/samples',name));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),before=files.map(hash);
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[];
let app,page;
const pass=message=>{checks.push(message);console.log('PASS',message);};

async function launch(){
  app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
  page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(String(error)));
  await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__frames.push(event.frame);});});
}
async function idle(){
  await page.locator('.rendering').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__frames.filter(frame=>frame.kind!=='detail').at(-1)?.url);
}
async function settle(action){
  const count=await page.evaluate(()=>window.__frames.length);
  await action();await page.waitForFunction(count=>window.__frames.length>count,count);await idle();
}
async function open(){
  await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},files);
  await page.getByRole('button',{name:'打开',exact:true}).click();
  await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();
  await expect(page.locator('.film-item')).toHaveCount(3);await idle();
}
const photo=index=>page.locator('.film-item').filter({hasText:files[index].split('/').at(-1)});
async function select(index){
  if(await photo(index).locator('.film-open').getAttribute('aria-current')!=='true')await settle(()=>photo(index).locator('.film-open').click());
  else await photo(index).locator('.film-open').click();
}
async function exposure(value){
  const input=page.getByRole('spinbutton',{name:'曝光',exact:true});
  await settle(async()=>{await input.fill(String(value));await input.press('Tab');});
  await expect(input).toHaveValue(String(value));
}
const pixels=()=>page.locator('canvas').evaluate(canvas=>canvas.toDataURL());
async function save(name){
  const path=join(out,name+'.xmp');
  await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},path);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(()=>existsSync(path)).toBe(true);
  return readDocument(path);
}

try{
  await launch();await open();
  await select(0);await exposure(1.8);const sourceExposureBefore=Number(await page.getByRole('spinbutton',{name:'曝光',exact:true}).inputValue()),sourcePixelsBefore=await pixels();
  const canonRangeThumbnail=await photo(1).locator('img').getAttribute('src'),fujiRangeThumbnail=await photo(2).locator('img').getAttribute('src');
  await page.getByRole('button',{name:'选择全部',exact:true}).click();await page.getByRole('button',{name:'匹配曝光',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('canon-r5.CR3');
  await page.screenshot({path:join(out,'match-exposure-range-error.png')});
  expect(await photo(1).locator('img').getAttribute('src')).toBe(canonRangeThumbnail);
  expect(await photo(2).locator('img').getAttribute('src')).toBe(fujiRangeThumbnail);
  await page.getByRole('button',{name:'关闭错误',exact:true}).click();
  await select(1);expect(Number(await page.getByRole('spinbutton',{name:'曝光',exact:true}).inputValue())).toBe(0);
  pass('out-of-range camera exposure is rejected atomically with a visible actionable error');

  await exposure(-4);const canonPixelsBefore=await pixels(),canonThumbnailBefore=await photo(1).locator('img').getAttribute('src');
  await select(2);await exposure(-4);const fujiPixelsBefore=await pixels(),fujiThumbnailBefore=await photo(2).locator('img').getAttribute('src');
  await select(0);
  await page.getByRole('button',{name:'选择全部',exact:true}).click();
  await page.getByRole('button',{name:'匹配曝光',exact:true}).click();
  await expect(page.locator('.statusbar')).toContainText('已按相机设置匹配 2 张照片曝光');
  expect(await photo(1).locator('img').getAttribute('src')).not.toBe(canonThumbnailBefore);
  expect(await photo(2).locator('img').getAttribute('src')).not.toBe(fujiThumbnailBefore);
  await page.screenshot({path:join(out,'match-exposure.png')});
  pass('visible Match Exposure updates both target thumbnails and reports the camera-setting match');

  await select(1);const canonExposureAfter=Number(await page.getByRole('spinbutton',{name:'曝光',exact:true}).inputValue()),canonPixelsAfter=await pixels();
  expect(canonExposureAfter).not.toBe(-4);expect(canonPixelsAfter).not.toBe(canonPixelsBefore);
  const canonRecipe=await save('canon-matched');expect(canonRecipe.adjustments.exposure).toBe(canonExposureAfter);
  await select(2);const fujiExposureAfter=Number(await page.getByRole('spinbutton',{name:'曝光',exact:true}).inputValue()),fujiPixelsAfter=await pixels();
  expect(fujiExposureAfter).not.toBe(-4);expect(fujiPixelsAfter).not.toBe(fujiPixelsBefore);
  pass('both real RAW targets change pixels while saving the matched exposure to XMP');

  await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
  expect(Number(await page.getByRole('spinbutton',{name:'曝光',exact:true}).inputValue())).toBe(-4);
  expect(await pixels()).toBe(fujiPixelsBefore);
  await select(0);expect(Number(await page.getByRole('spinbutton',{name:'曝光',exact:true}).inputValue())).toBe(sourceExposureBefore);
  expect(await pixels()).toBe(sourcePixelsBefore);
  pass('each target is one-step undoable and the active source photo remains unchanged');

  expect(errors).toEqual([]);expect(files.map(hash)).toEqual(before);
  pass('no renderer errors occur and all source RAW files remain byte-identical');
}catch(error){
  if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});
  writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),diagnostics:app?electronDiagnostics(app):null},null,2)+'\n');
  throw error;
}finally{
  writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors,sourceUnchanged:files.every((path,index)=>hash(path)===before[index])},null,2)+'\n');
  if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await closeElectron(app).catch(()=>{});}
}
