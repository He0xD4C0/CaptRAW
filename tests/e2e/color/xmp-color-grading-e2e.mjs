import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {adobeGradingFields,adobeGradingSettings,adobeGradingFixture,readDocument} from '../../support/xmp-test.mjs';
import {XMP,CRS,CT,lookup,property,text,encode,readExtension} from '@captraw/desktop-core/xmp';
import {ENGINE_VERSION} from '@captraw/contracts';
import {EngineClient} from '../../support/engine-client.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';

const out=resolve(process.env.CAPTRAW_XMP_GRADING_GUI_OUT||'artifacts/xmp-color-grading-gui');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),source=resolve('build/samples/synthetic.dng'),plain=join(work,'Plain.dng'),input=join(work,'Adobe Grading.dng'),sidecar=join(work,'Adobe Grading.xmp');
copyFileSync(source,plain);copyFileSync(source,input);writeFileSync(sidecar,adobeGradingFixture);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),sourceHash=hash(source),sidecarHash=hash(sidecar),executablePath=process.env.CAPTRAW_APP;
const aliases={SplitToningShadowHue:'ColorGradeShadowHue',SplitToningShadowSaturation:'ColorGradeShadowSat',SplitToningHighlightHue:'ColorGradeHighlightHue',SplitToningHighlightSaturation:'ColorGradeHighlightSat',SplitToningBalance:'ColorGradeBalance'};
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),checks=[],errors=[],pass=message=>{checks.push(message);console.log('PASS',message);};
let app,page,success=false,tiffPixels;
async function launch(){
  app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true})));
  await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__frames.push(event.frame);});});
}
async function settle(action){const count=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(count=>window.__frames.length>count,count);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(frame=>frame.kind!=='detail').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(work,name+'.xmp');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(frame=>frame.kind!=='detail').at(-1)?.url);return {path,document:await readDocument(path)};}
async function grading(){const summary=page.locator('summary').filter({hasText:/^颜色分级$/});if(!await summary.evaluate(element=>element.parentElement.open))await summary.click();}
async function view(name){await page.getByRole('button',{name:name+'分级视图',exact:true}).click();}
async function change(name,value){await settle(async()=>{const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(String(value));await input.press('Tab');});}
const pixels=()=>page.locator('canvas').evaluate(canvas=>canvas.toDataURL());
try{
  await launch();await open(plain);const neutral=await pixels();await open(input);expect(await pixels()).not.toBe(neutral);const originalPixels=await pixels();
  await grading();
  for(const [name,key] of [['阴影','shadows'],['中间调','midtones'],['高光','highlights'],['全局','global']]){
    await view(name);
    for(const [label,field] of [['色相','hue'],['饱和度','saturation'],['明度','luminance']])await expect(page.getByRole('spinbutton',{name:name+'分级'+label,exact:true})).toHaveValue(String(adobeGradingSettings[key][field]));
  }
  await view('阴影');await expect(page.getByRole('spinbutton',{name:'分级平衡',exact:true})).toHaveValue('-14');
  pass('real RAW sidecar import displays all four Adobe grading wheels and balance with changed pixels');

  await change('阴影分级饱和度',35);const editedPixels=await pixels();expect(editedPixels).not.toBe(originalPixels);
  await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());expect(await pixels()).toBe(originalPixels);
  await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());expect(await pixels()).toBe(editedPixels);
  const saved=await save('标准 分级 编辑'),savedProperties=(await xmp.read(saved.path)).properties;
  expect(lookup(savedProperties,CRS,'SplitToningShadowSaturation').value).toBe('35');expect(readExtension(savedProperties,'EngineVersion')).toBe(ENGINE_VERSION);
  for(const name of Object.values(aliases))expect(lookup(savedProperties,CRS,name)).toBeUndefined();
  pass('visible grading edits are one undo step and save with canonical Adobe names and the current processing version');

  await app.close();app=undefined;await launch();await open(saved.path);expect(await pixels()).toBe(editedPixels);
  expect((await save('重开')).document.adjustments.colorGrading).toEqual(saved.document.adjustments.colorGrading);
  pass('a fresh process restores standard grading and exact displayed pixels');

  const legacyRaw=join(work,'Legacy RAW.dng');copyFileSync(source,legacyRaw);
  const legacyChanges=[property(CT,'EngineVersion',encode('CaptRAW-24_ART-1.26.10_LibRaw-3b20539')),property(CT,'Source',encode({...saved.document.source,path:legacyRaw}))];
  const fields={...adobeGradingFields,SplitToningShadowSaturation:35};
  for(const [canonical,alias] of Object.entries(aliases))legacyChanges.push(property(CRS,canonical,text(0)),property(CRS,alias,text(fields[canonical])));
  const legacy=join(work,'旧 分级.xmp');writeFileSync(legacy,(await xmp.call('write',readFileSync(saved.path,'utf8'),legacyChanges)).packet);const legacyHash=hash(legacy);
  await open(legacy);expect(await pixels()).toBe(editedPixels);
  await page.locator('.xmp-notice summary').click();const warning=page.locator('.xmp-notice p').filter({hasText:'误写的颜色分级字段'});await warning.scrollIntoViewIfNeeded();await expect(warning).toBeVisible();await page.screenshot({path:join(out,'legacy-migration.png')});
  const migrated=await save('已迁移 分级'),migratedProperties=(await xmp.read(migrated.path)).properties;
  for(const name of Object.values(aliases))expect(lookup(migratedProperties,CRS,name)).toBeUndefined();
  expect(migrated.document.adjustments.colorGrading).toEqual(saved.document.adjustments.colorGrading);expect(hash(legacy)).toBe(legacyHash);expect(await pixels()).toBe(editedPixels);
  pass('old CaptRAW XMP with stale Adobe values visibly warns, retains pixels and migrates without modifying the old file');

  await app.close();app=undefined;await launch();await open(migrated.path);expect(await pixels()).toBe(editedPixels);await expect(page.locator('.xmp-notice')).toHaveCount(0);
  pass('the migrated XMP reopens without migration warnings or grading drift');

  await change('曝光',1.25);await page.getByRole('button',{name:'预设',exact:true}).click();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},sidecar);await page.getByRole('button',{name:'导入…',exact:true}).click();
  await settle(()=>page.getByRole('button',{name:'ACR 分级测试',exact:true}).click());
  const presetApplied=await save('预设 应用');expect(presetApplied.document.adjustments.exposure).toBe(1.25);expect(presetApplied.document.adjustments.colorGrading).toEqual(adobeGradingSettings);
  await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());expect((await save('撤销 预设')).document.adjustments.colorGrading).toEqual(saved.document.adjustments.colorGrading);
  await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());
  pass('the visible Adobe grading preset preserves exposure and supports single-step undo and redo');

  const output=join(work,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
  const reference=join(work,'headless.tiff'),engine=new EngineClient({cache:join(work,'reference-cache')});
  try{await engine.call('export',{path:legacyRaw,artProfile:presetApplied.document.artProfile,format:'tiff',output:reference});}finally{await engine.stop();}
  tiffPixels=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np,json,sys
a,b=[tifffile.imread(p) for p in sys.argv[1:3]]
assert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)
with tifffile.TiffFile(sys.argv[1]) as t:
 icc=t.pages[0].tags[34675].value
 assert len(icc)>0
print(json.dumps(dict(shape=list(a.shape),bitsPerSample=16,maximumDifference=0,iccBytes=len(icc))))`,output,reference],{encoding:'utf8'}));
  await grading();await view('阴影');await page.locator('.color-grading-panel').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'canonical-grading.png')});
  pass('desktop standard-grading TIFF16 and ICC match independent native output pixel for pixel');
  if(process.env.CAPTRAW_GRADING_PREVIOUS_APP){
    const migratedHash=hash(migrated.path);await closeElectron(app);app=undefined;
    app=await electron.launch({executablePath:process.env.CAPTRAW_GRADING_PREVIOUS_APP});page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(String(error)));
    await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true})));
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},migrated.path);
    await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toContainText('不支持的 ART 显影版本');
    await expect(page.locator('.film-item')).toHaveCount(0);expect(hash(migrated.path)).toBe(migratedHash);
    pass('the previous installed application refuses the new processing version explicitly and leaves the saved XMP unchanged');
  }

  expect(hash(source)).toBe(sourceHash);expect(hash(input)).toBe(sourceHash);expect(hash(sidecar)).toBe(sidecarHash);expect(errors).toEqual([]);
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({visible:window.isVisible(),focused:window.isFocused(),focusable:window.isFocusable()})));
  expect(windows.every(window=>!window.visible&&!window.focused&&!window.focusable)).toBe(true);
  pass('original RAW and XMP files stay unchanged with hidden, unfocused windows and no page errors');success=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{
  if(app)await closeElectron(app);
  writeFileSync(join(out,'report.json'),JSON.stringify({checks,success,errors,executablePath:executablePath||null,backgroundWindow:true,httpBlocked:true,previousApp:process.env.CAPTRAW_GRADING_PREVIOUS_APP||null,sourceHash,sidecarHash,tiffPixels,...(!success?{work}:{})},null,2)+'\n');
  if(success){rmSync(work,{recursive:true,force:true});rmSync(join(out,'failure.png'),{force:true});}else console.error('Failure workspace:',work);
}
