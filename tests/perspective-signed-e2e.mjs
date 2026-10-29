import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP,CRS,CT,lookup,readExtension,property,encode} from '@captraw/desktop-core/xmp';
import {EngineClient} from './engine-client.mjs';
const root=await mkdtemp(join(tmpdir(),'captraw-signed-gui-')),file=join(root,'新版 几何.tif'),oldFile=join(root,'旧版 几何.tif');
const documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp'))),python=resolve('build/qa-venv/bin/python');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sidecar=p=>p.replace(/\.tif$/,'.xmp'),checks=[];
let app,page,passed=false;const errors=[],button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('spinbutton',{name,exact:true});
const canvas=()=>page.locator('canvas[aria-label="显影预览"]'),pixels=async()=>hash(await canvas().evaluate(c=>c.toDataURL()));
async function idle(){await page.waitForTimeout(150);await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===window.__signedFrames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function panel(){await button('编辑').click();const summary=page.locator('.adjust-section > summary').filter({hasText:/^几何$/});await summary.scrollIntoViewIfNeeded();if(await summary.locator('..').getAttribute('open')===null)await summary.click();}
async function launch(path){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__signedFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__signedFrames.push(e.frame);});});
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});dialog.showMessageBox=async()=>({response:1});},path);
 await button('打开').click();await idle();await panel();
}
async function number(name,value,key='Tab'){const el=input(name);await el.scrollIntoViewIfNeeded();await expect(el).toBeInViewport();await el.fill(String(value));await el.press(key);await idle();await expect(el).toHaveValue(String(value));}
async function save(path){await button('保存').click();await expect.poll(()=>existsSync(sidecar(path))).toBe(true);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await idle();return documents.read(sidecar(path));}
try{
 const original=resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif'),sourceBytes=await readFile(original);await copyFile(original,file);await copyFile(original,oldFile);
 const engine=new EngineClient({cache:join(root,'fixture')});
 try{
  const image=await engine.call('open',{path:oldFile,sessionId:'old',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'}),p={...image.adjustments.perspective,enabled:true,aspect:1.3};
  for(const key of ['manualModel','scale','offsetX','offsetY','constrainCrop'])delete p[key];
  const packet=await documents.serialize({source:{path:'旧版 几何.tif',size:sourceBytes.length,sha256:hash(sourceBytes)},artProfile:image.artProfile,adjustments:{...image.adjustments,perspective:p},baselineVersion:4});
  await writeFile(sidecar(oldFile),(await documents.xmp.call('write',packet,[property(CT,'EngineVersion',encode('CaptRAW-27_ART-1.26.10_LibRaw-3b20539'))])).packet);
 }finally{await engine.stop();}
 await launch(file);await expect(input('长宽比')).toHaveValue('0');await expect(input('几何缩放')).toHaveValue('100');
 for(const name of ['长宽比','横向补正','纵向补正']){await expect(input(name)).toHaveAttribute('min','-100');await expect(input(name)).toHaveAttribute('max','100');}
 await expect(input('几何缩放')).toHaveAttribute('min','50');await expect(input('几何缩放')).toHaveAttribute('max','150');
 const neutral=await pixels();await number('长宽比',25);await number('几何缩放',110);await number('横向补正',10);await number('纵向补正',10);const effect=await pixels();assert.notEqual(effect,neutral);
 const doc=await save(file);assert.equal(doc.adjustments.perspective.manualModel,'signed-framing-v1');assert.equal(doc.adjustments.perspective.aspect,25);assert.equal(doc.adjustments.perspective.offsetY,10);
 checks.push('visible controls expose actual ACR ranges and save signed units with real preview changes');
 await button('撤销').click();await idle();await expect(input('纵向补正')).toHaveValue('0');await button('重做').click();await idle();assert.equal(await pixels(),effect);
 await input('横向补正').scrollIntoViewIfNeeded();await input('横向补正').fill('30');await idle();await input('横向补正').press('Escape');await idle();await expect(input('横向补正')).toHaveValue('10');assert.equal(await pixels(),effect);
 checks.push('one-step history and numeric Escape restore the exact signed geometry and displayed pixels');
 const enabled=page.getByRole('checkbox',{name:'启用透视变换',exact:true});await enabled.uncheck();await idle();await save(file);
 let properties=(await documents.xmp.read(sidecar(file))).properties;assert.equal(lookup(properties,CRS,'PerspectiveAspect').value,'0');assert.equal(readExtension(properties,'ARTAdjustments').perspective.aspect,25);
 await enabled.check();await idle();assert.equal(await pixels(),effect);await save(file);properties=(await documents.xmp.read(sidecar(file))).properties;
 for(const key of ['aspect','scale','offsetX','offsetY'])assert.equal(readExtension(properties,'ARTAdjustments').perspective[key],undefined);
 assert.equal(lookup(properties,CRS,'PerspectiveAspect').value,'25');assert.equal(lookup(properties,CRS,'PerspectiveScale').value,'110');checks.push('disable remembers values privately; enable removes duplicate ownership and restores exact pixels');
 const output=join(root,'导出.tif');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
 await button('导出').click();const metadata=page.getByRole('combobox',{name:'输出元数据',exact:true});await metadata.scrollIntoViewIfNeeded();await metadata.selectOption('all');await page.getByRole('button',{name:/^TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const packet=(await documents.xmp.call('file-read','',[],{path:output,format:'tiff'})).properties;
 for(const [key,value] of [['PerspectiveAspect','25'],['PerspectiveScale','110'],['PerspectiveX','10'],['PerspectiveY','10'],['AlreadyApplied','True']])assert.equal(lookup(packet,CRS,key)?.value,value);
 assert.equal(readExtension(packet,'ARTAdjustments'),undefined);assert.equal(lookup(packet,CT,'BakedCRS'),undefined);
 execFileSync(python,['-c','import tifffile,sys\nwith tifffile.TiffFile(sys.argv[1]) as t:assert t.asarray().dtype.name=="uint16" and 34675 in t.pages[0].tags',output]);
 await closeElectron(app);app=undefined;await launch(file);assert.equal(await pixels(),effect);await expect(input('长宽比')).toHaveValue('25');checks.push('real TIFF16 export carries standard applied geometry only; restart restores saved pixels');
 await closeElectron(app);app=undefined;await launch(oldFile);await expect(input('长宽比')).toHaveValue('1.3');const oldPixels=await pixels();
 await button('采用新版并重置透视').scrollIntoViewIfNeeded();await button('采用新版并重置透视').click();await idle();await expect(input('长宽比')).toHaveValue('0');await button('撤销').click();await idle();await expect(input('长宽比')).toHaveValue('1.3');assert.equal(await pixels(),oldPixels);
 checks.push('old unbound ART aspect keeps its units; explicit reset upgrades and one Undo restores the exact legacy state');
 assert.deepEqual(errors,[]);assert.deepEqual(await readFile(file),sourceBytes);assert.deepEqual(await readFile(oldFile),sourceBytes);
 assert((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable()))));passed=true;console.log(JSON.stringify({checks,hidden:true,sourceUnchanged:true}));
}finally{if(app){if(!passed){await writeFile(join(root,'diagnostics.json'),JSON.stringify(electronDiagnostics(app),null,2));await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});}await closeElectron(app);}if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained signed GUI failure:',root);}
