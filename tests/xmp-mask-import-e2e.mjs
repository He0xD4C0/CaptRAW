import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {readDocument,adobeMaskFixture} from './xmp-test.mjs';
import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const out=resolve(process.env.CAPTRAW_XMP_MASK_GUI_OUT||'artifacts/xmp-mask-import-gui');
const source=resolve('build/samples/synthetic.dng');
const executablePath=process.env.CAPTRAW_APP;
mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-'));
let success=false,tiffPixels,adobeReference,brightnessFrame;
copyFileSync(source,join(work,'Adobe Masks.dng'));
writeFileSync(join(work,'Adobe Masks.xmp'),adobeMaskFixture);
const importedImage=join(work,'Adobe Masks.dng'),sidecar=join(work,'Adobe Masks.xmp');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const imageHash=hash(importedImage),sidecarHash=hash(sidecar),checks=[],errors=[];
let app,page;
const pass=message=>{checks.push(message);console.log('PASS',message);};
async function launch(){
  app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
  page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true})));
  await app.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('image:update');if(typeof original!=='function')throw new Error('image:update handler unavailable');
    globalThis.__maskImportUpdates=[];ipcMain.removeHandler('image:update');
    ipcMain.handle('image:update',async(event,input)=>{const row={revision:input.revision,sessionId:input.sessionId,maskId:input.maskId,brightness:input.adjustments.masks.find(mask=>mask.id==='adobe-LINEAR')?.brightness};globalThis.__maskImportUpdates.push(row);const result=await original(event,input);row.completed=true;return result;});
  });
  await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__frames.push(event.frame);});});
}
async function settle(action){
  const count=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(count=>window.__frames.length>count,count);
  await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(frame=>frame.kind!=='detail').at(-1)?.url);
}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').evaluate(canvas=>canvas.toDataURL())).digest('hex');
async function renderedBrightness(value){
  await expect.poll(()=>app.evaluate((_electron,value)=>globalThis.__maskImportUpdates.filter(row=>row.brightness===value&&row.maskId==='adobe-LINEAR'&&row.completed).at(-1)?.revision||0,value)).toBeGreaterThan(0);
  const row=await app.evaluate((_electron,value)=>globalThis.__maskImportUpdates.filter(row=>row.brightness===value&&row.maskId==='adobe-LINEAR'&&row.completed).at(-1),value);
  await page.waitForFunction(row=>{const frame=window.__frames.filter(frame=>frame.sessionId===row.sessionId&&frame.revision>=row.revision&&frame.kind==='fit').at(-1);return frame&&document.querySelector('canvas').dataset.frame===frame.url;},row);
  await page.locator('.rendering').waitFor({state:'hidden'});return row;
}
try{
  await launch();
  const logo=page.getByRole('img',{name:'CaptRAW 标志',exact:true});
  await expect(logo).toBeVisible();await expect.poll(()=>logo.evaluate(img=>img.complete&&img.naturalWidth===512&&img.naturalHeight===512)).toBe(true);
  const logoState=await logo.evaluate(async img=>({svg:await(await fetch(img.src)).text(),favicon:await(await fetch(document.querySelector('link[rel=icon]').href)).text()}));
  expect(logoState.svg).toBe(readFileSync('assets/branding/logo.svg','utf8'));expect(logoState.favicon).toBe(logoState.svg);
  pass('the titlebar logo and favicon visibly load the supplied SVG asset');
  await open(importedImage);
  await page.getByRole('button',{name:'蒙版 M',exact:true}).click();
  await expect(page.locator('.mask-row')).toHaveCount(4);
  for(const name of ['Linear','Radial','Lum','Brush'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  await page.locator('.xmp-notice summary').click();
  const incompleteWarning=page.locator('.xmp-notice p').filter({hasText:/Person minus gradient.*整组未应用/});
  await incompleteWarning.scrollIntoViewIfNeeded();await expect(incompleteWarning).toBeVisible();
  await page.screenshot({path:join(out,'incomplete-warning.png')});
  await expect(page.locator('.xmp-notice')).toContainText('MaskSubType=2');
  await expect(page.locator('.xmp-notice')).toContainText('Person minus gradient');
  await expect(page.locator('.xmp-notice')).toContainText('整组未应用');
  await expect(page.getByRole('button',{name:'Person minus gradient',exact:true})).toHaveCount(0);
  await page.locator('.xmp-notice summary').click();
  await page.screenshot({path:join(out,'imported-masks.png')});
  pass('visible ACR sidecar imports four editable mask groups and discloses the unsupported AI mask');

  await page.getByRole('button',{name:'Linear',exact:true}).click();
  const brightness=page.getByRole('spinbutton',{name:'局部亮度',exact:true});
  await expect(brightness).toHaveValue('2');
  const beforeRequest=await renderedBrightness(2),before=await pixels();
  await brightness.fill('2.5');await brightness.press('Tab');
  const afterRequest=await renderedBrightness(2.5),after=await pixels();brightnessFrame={beforeRequest,afterRequest,beforeSHA256:before,afterSHA256:after};
  expect(after).not.toBe(before);
  const savedPath=join(work,'Adobe Masks CaptRAW.xmp');rmSync(savedPath,{force:true});
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},savedPath);
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(savedPath)).toBe(true);await page.locator('.rendering').waitFor({state:'hidden'});
  const saved=await readDocument(savedPath);
  expect(saved.adjustments.masks).toHaveLength(4);
  expect(saved.adjustments.masks[0].brightness).toBe(2.5);
  expect(saved.adjustments.masks[3].components?.map(component=>component.operation)).toEqual(['add','subtract']);
  expect(readFileSync(savedPath,'utf8')).toContain('MaskGroupBasedCorrections');
  pass('imported masks remain editable in CaptRAW, preserve component operations and retain the ACR structure');

  await page.getByRole('button',{name:'编辑',exact:true}).click();
  const editedPixels=await pixels();await app.close();app=undefined;await launch();await open(savedPath);
  expect(await pixels()).toBe(editedPixels);
  await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await expect(page.locator('.mask-row')).toHaveCount(4);
  pass('a fresh process restores imported masks and identical displayed pixels');

  const output=join(work,'adobe-masks.tiff');rmSync(output,{force:true});
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();
  await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});expect(existsSync(output)).toBe(true);
  const reference=join(work,'headless.tiff'),engine=new EngineClient({cache:join(work,'reference-cache')});
  try{await engine.call('export',{path:importedImage,artProfile:saved.artProfile,format:'tiff',output:reference});}finally{await engine.stop();}
  tiffPixels=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np,sys,json
a,b=[tifffile.imread(p) for p in sys.argv[1:3]]
assert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)
with tifffile.TiffFile(sys.argv[1]) as t:
 assert t.pages[0].bitspersample==16
 icc=t.pages[0].tags[34675].value
 assert len(icc)>0
print(json.dumps(dict(shape=list(a.shape),bitsPerSample=16,maximumDifference=0,iccBytes=len(icc))))`,output,reference],{encoding:'utf8'}));
  pass('imported ACR masks export as ICC-tagged TIFF16 with identical desktop and headless pixels');

  await page.getByRole('button',{name:'蒙版 M',exact:true}).click();
  await page.screenshot({path:join(out,'restored-masks.png')});
  for(let count=4;count>0;count--){
    await page.locator('.mask-select').first().click();
    await settle(()=>page.getByTitle('删除蒙版',{exact:true}).click());
    await expect(page.locator('.mask-row')).toHaveCount(count-1);
  }
  await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(page.locator('.mask-row')).toHaveCount(1);
  await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(page.locator('.mask-row')).toHaveCount(0);
  const emptyPath=join(work,'Empty Masks.xmp');
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},emptyPath);
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(emptyPath)).toBe(true);
  expect((await readDocument(emptyPath)).adjustments.masks).toEqual([]);
  expect(readFileSync(emptyPath,'utf8')).toContain('MaskGroupBasedCorrections');
  pass('deleting all imported masks supports undo and redo and saves an authoritative empty list without removing the original ACR structure');

  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.rendering').waitFor({state:'hidden'});
  const emptyPixels=await pixels();await app.close();app=undefined;await launch();await open(emptyPath);
  expect(await pixels()).toBe(emptyPixels);
  await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await expect(page.locator('.mask-row')).toHaveCount(0);
  await page.screenshot({path:join(out,'empty-masks.png')});
  pass('a fresh process reopens the saved empty list with identical pixels and never resurrects Adobe masks');

  if(process.env.CAPTRAW_ADOBE_MASK_REFERENCE){
    const reference=resolve(process.env.CAPTRAW_ADOBE_MASK_REFERENCE),referenceHash=hash(reference),referenceRaw=join(work,'Real ACR.dng'),referenceSidecar=join(work,'Real ACR.xmp');
    copyFileSync(source,referenceRaw);copyFileSync(reference,referenceSidecar);
    const expected=await readDocument(reference);expect(expected.adjustments.masks).toHaveLength(1);
    await open(referenceRaw);await page.getByRole('button',{name:'蒙版 M',exact:true}).click();
    await expect(page.locator('.mask-row')).toHaveCount(1);
    await expect(page.getByRole('button',{name:expected.adjustments.masks[0].name,exact:true})).toBeVisible();
    await page.locator('.xmp-notice summary').click();
    const warning=page.locator('.xmp-notice p').filter({hasText:'整组未应用'}).first();
    await warning.scrollIntoViewIfNeeded();await expect(warning).toBeVisible();
    await page.screenshot({path:join(out,'real-acr-warning.png')});
    const savedReference=join(work,'Real ACR CaptRAW.xmp');
    await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},savedReference);
    await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(savedReference)).toBe(true);
    expect((await readDocument(savedReference)).adjustments.masks).toHaveLength(1);
    expect(hash(reference)).toBe(referenceHash);expect(hash(referenceSidecar)).toBe(referenceHash);expect(hash(referenceRaw)).toBe(imageHash);
    adobeReference={sha256:referenceHash,importedGroups:1,appliedTo:'synthetic.dng',sourceUnchanged:true};
    pass('real ACR 18.7 settings applied to a controlled DNG visibly keep the supported group, disclose incomplete groups and save without modifying the reference');
  }

  expect(hash(importedImage)).toBe(imageHash);expect(hash(sidecar)).toBe(sidecarHash);expect(errors).toEqual([]);
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({visible:window.isVisible(),focused:window.isFocused(),focusable:window.isFocusable()})));
  expect(windows.every(window=>!window.visible&&!window.focused&&!window.focusable)).toBe(true);
  pass('the source RAW and original Adobe XMP remain unchanged in hidden, unfocused windows');
  success=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{
  writeFileSync(join(out,'report.json'),JSON.stringify({checks,errors,executablePath:executablePath||null,backgroundWindow:true,httpBlocked:true,imageHash,sidecarHash,tiffPixels,adobeReference,brightnessFrame,success},null,2)+'\n');
  if(app)await closeElectron(app);
  if(success){rmSync(work,{recursive:true,force:true});rmSync(join(out,'failure.png'),{force:true});}
  else console.error('Failure workspace:',work);
}
