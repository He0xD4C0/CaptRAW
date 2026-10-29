// Actual hidden production App. No state mutation through evaluation: tracing
// only observes real UI transactions; the native dialogs use test destinations.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP,CRS,property,text,lookup,readExtension} from '@captraw/desktop-core/xmp';
const root=await mkdtemp(join(tmpdir(),'captraw-perspective-manual-app-')),python=resolve('build/qa-venv/bin/python');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),hash=b=>createHash('sha256').update(b).digest('hex');
const rendererHTML='apps/desktop/dist/renderer/index.html',asset=(await readFile(rendererHTML,'utf8')).match(/src="\.\/([^\"]+\.js)"/)[1];
const paths=[binary,'apps/desktop/dist/electron/main.cjs','apps/desktop/dist/electron/preload.cjs',rendererHTML,'apps/desktop/dist/renderer/'+asset,'packages/desktop-core/dist/synchronize.js','packages/desktop-core/dist/documents.js'];
const cohort=Object.fromEntries(await Promise.all(paths.map(async path=>[path,hash(await readFile(path))]))),documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp')));
const files=[0,1,2].map(i=>join(root,`照片 ${i}.png`)),side=i=>files[i].replace(/\.png$/,'.xmp'),checks=[],errors=[];
const scaleMode=process.env.CAPTRAW_PERSPECTIVE_SCALE_XMP==='1';
function legacyPerspective(p){assert(p);for(const key of ['manualModel','scale','offsetX','offsetY','constrainCrop'])assert(!Object.hasOwn(p,key),'legacy projection must omit '+key);}
let core,app,page,passed=false;
const button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('spinbutton',{name,exact:true}),photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])}).locator('.film-open');
const frame=()=>page.evaluate(()=>window.__manualFrames.filter(f=>f.kind==='fit').at(-1));
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===window.__manualFrames.filter(f=>f.kind==='fit').at(-1)?.url);await expect(page.getByRole('alert')).toHaveCount(0);}
async function panel(){await button('编辑').click();const summary=page.locator('.adjust-section > summary').filter({hasText:/^几何$/});await summary.scrollIntoViewIfNeeded();if(await summary.locator('..').getAttribute('open')===null)await summary.click();}
async function select(i){await photo(i).click();await idle();await panel();}
async function pixels(){return hash(await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL()));}
async function latest(){return app.evaluate(()=>globalThis.__manualUpdates.at(-1)?.adjustments);}
async function snapshot(){return {adjustments:await latest(),pixels:await pixels(),dirty:await page.locator('.document-title .dirty-dot').count(),undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled()};}
async function restored(before){await idle();assert.deepEqual(await snapshot(),before,'cancel restores full snapshot, absent fields, dirty, history and exact displayed pixels');}
async function number(name,value,key='Tab'){const el=input(name);await el.scrollIntoViewIfNeeded();await expect(el).toBeInViewport();await el.fill(String(value));await el.press(key);await idle();await expect(el).toHaveValue(String(value));}
async function dragCancel(name){
 const thumb=page.getByRole('slider',{name:name+'滑杆',exact:true});await thumb.scrollIntoViewIfNeeded();await expect(thumb).toBeInViewport();
 const box=await thumb.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," slider ")][1]').boundingBox(),start=await thumb.boundingBox();assert(box&&start);
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.68,box.y+box.height/2,{steps:6});await idle();
 await page.keyboard.press('Escape');await idle();await page.mouse.move(box.x+box.width*.83,box.y+box.height/2,{steps:6});await page.mouse.up();await idle();
}
async function saveOne(i){await button('保存').click();await expect.poll(async()=>(await snapshot()).dirty).toBe(0);await idle();const doc=await documents.read(side(i));if(scaleMode&&doc.adjustments.perspective?.manualModel){const properties=(await documents.xmp.read(side(i))).properties,p=doc.adjustments.perspective;assert.equal(Number(lookup(properties,CRS,'PerspectiveScale').value)/100,p.enabled?p.scale??1:1);if(p.enabled)assert.equal(readExtension(properties,'ARTAdjustments').perspective.scale,undefined);}return doc;}
async function launch(pathsToOpen,userData){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,userData)}});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__manualFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__manualFrames.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog},paths)=>{
  globalThis.__manualUpdates=[];const original=ipcMain._invokeHandlers.get('image:update');ipcMain.removeHandler('image:update');ipcMain.handle('image:update',(event,input)=>{globalThis.__manualUpdates.push(structuredClone(input));return original(event,input);});
  globalThis.__manualSync=[];const synchronize=ipcMain._invokeHandlers.get('images:synchronize');ipcMain.removeHandler('images:synchronize');ipcMain.handle('images:synchronize',async(event,input)=>{const result=await synchronize(event,input);globalThis.__manualSync.push(structuredClone(result));return result;});
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});dialog.showMessageBox=async()=>({response:1});
 },pathsToOpen);await button('打开').click();await idle();await panel();
}
try{
 const fixture=join(root,'fixture.png');execFileSync(python,['-c',"from PIL import Image,ImageDraw;import sys;im=Image.new('RGB',(640,480),(80,100,120));d=ImageDraw.Draw(im);[(d.rectangle((x,y,x+30,y+25),fill=(200,60,40))) for x in range(30,620,70) for y in range(30,460,60)];im.save(sys.argv[1])",fixture]);
 core=new EngineClient({cache:join(root,'fixture-core'),executable:binary});const image=await core.call('open',{path:fixture,sessionId:'manual-ui-fixture'});
 const defaults=image.adjustments.perspective;assert.equal((await core.call('validate',{artProfile:image.artProfile,adjustments:{...image.adjustments,perspective:{...defaults,manualModel:'art-perspective-v1',scale:1}}})).perspective.manualModel,'art-perspective-v1','new coordinated native core required');
 for(let i=0;i<3;i++){
  await copyFile(fixture,files[i]);const bytes=await readFile(files[i]),adjustments={...image.adjustments,exposure:i*.1};delete adjustments.perspective;
  await writeFile(side(i),await documents.serialize({source:{path:basename(files[i]),size:bytes.length,sha256:hash(bytes)},artProfile:image.artProfile,adjustments}));
  if(scaleMode&&i===2)await writeFile(side(i),(await documents.xmp.call('write','',[property(CRS,'Version',text('18.7')),property(CRS,'ProcessVersion',text('15.4')),property(CRS,'PerspectiveScale',text(110))])).packet);
 }
 await core.stop();core=null;const sourceHashes=await Promise.all(files.map(async f=>hash(await readFile(f)))),unselectedHash=hash(await readFile(side(2)));
 await launch(files,'userdata');await select(0);let before=await snapshot();legacyPerspective(before.adjustments.perspective);
 await input('长宽比').scrollIntoViewIfNeeded();await input('长宽比').fill('1.15');await idle();await input('长宽比').press('Escape');await restored(before);
 checks.push('legacy projection numeric Esc restores the whole object, absent manual fields, dirty, history and exact pixels through the real context');
 await number('垂直透视',12);await button('撤销').click();await idle();before=await snapshot();legacyPerspective(before.adjustments.perspective);assert(before.redo);
 await input('几何缩放').scrollIntoViewIfNeeded();await input('几何缩放').fill('125');await idle();await input('几何缩放').press('Escape');await restored(before);
 await dragCancel('长宽比');await restored(before);await button('重做').click();await idle();await expect(input('垂直透视')).toHaveValue('12');await button('撤销').click();await idle();
 checks.push('Undo then numeric Esc and held-slider Esc preserve redo; late move/up does not revive the cancelled geometry');
 await select(1);const targetBefore=await snapshot();await select(0);await photo(1).click({modifiers:['Meta']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);
 await number('垂直透视',14);await button('撤销').click();await idle();before=await snapshot();await dragCancel('几何缩放');await restored(before);
 await select(1);const targetAfter=await snapshot();assert.deepEqual(targetAfter.adjustments,targetBefore.adjustments);assert.equal(targetAfter.pixels,targetBefore.pixels);assert.equal(targetAfter.dirty,0);assert(targetAfter.redo);
 await button('重做').click();await idle();await expect(input('垂直透视')).toHaveValue('14');await button('撤销').click();await idle();assert.equal(hash(await readFile(side(2))),unselectedHash);
 checks.push('selected-photo transaction cancellation keeps the other photo absent/clean with its redo, and leaves the unselected sidecar unchanged');
 await select(0);await number('长宽比',1.001,'Enter');assert.equal((await saveOne(0)).adjustments.perspective.aspect,1.001);
 await number('长宽比',1.002);await number('长宽比',1.001);assert.equal((await saveOne(0)).adjustments.perspective.aspect,1.001);
 await select(1);await select(0);await expect(input('长宽比')).toHaveValue('1.001');
 const precisionPixels=await pixels();await photo(1).click({modifiers:['Meta']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);await number('几何缩放',130);
 const linked=await app.evaluate(()=>globalThis.__manualSync.at(-1));assert.equal(linked.length,2);const linkedTarget=linked.find(r=>r.path===files[1]);
 assert.equal(linkedTarget.adjustments.perspective.manualModel,'art-perspective-v1');assert.equal(linkedTarget.adjustments.perspective.enabled,true,'a manual control auto-enables every edited selected photo');assert.equal(linkedTarget.adjustments.perspective.scale,1.3);assert.equal(linkedTarget.adjustments.perspective.aspect,1,'editing scale alone must not copy the source aspect into the target');
 await button('撤销').click();await idle();assert.equal(await pixels(),precisionPixels);await select(1);legacyPerspective((await latest()).perspective);await select(0);await expect(input('长宽比')).toHaveValue('1.001');await expect(input('几何缩放')).toHaveValue('100');
 checks.push('a scalar-only linked edit carries the model to a legacy target without copying unrelated aspect; one Undo restores both prior parameter shapes');
 await closeElectron(app);app=null;await launch([files[0]],'restart-userdata');await expect(input('长宽比')).toHaveValue('1.001');assert.equal((await saveOne(0)).adjustments.perspective.aspect,1.001);
 checks.push('aspect 1.001 remains visible and saved through Enter, blur, document switching and a fresh App reopen');
 for(const [label,value] of [['几何缩放',125],['横向补正',4],['纵向补正',-3]]){
  const old=await pixels();await number(label,value);const changed=await pixels();assert.notEqual(changed,old,label+' changes displayed pixels');await button('撤销').click();await idle();assert.equal(await pixels(),old);await button('重做').click();await idle();assert.equal(await pixels(),changed);
 }
 if(scaleMode){
  await saveOne(0);const applied=await pixels(),enabled=page.getByRole('checkbox',{name:'启用透视变换',exact:true});await enabled.uncheck();await idle();
  const bypassed=await saveOne(0);assert.notEqual(await pixels(),applied,'bypass must change the actual displayed pixels');assert.equal(bypassed.adjustments.perspective.scale,1.25);assert.equal(lookup((await documents.xmp.read(side(0))).properties,CRS,'PerspectiveScale').value,'100');
  await enabled.check();await idle();await saveOne(0);assert.equal(await pixels(),applied);checks.push('real UI bypass saves standard100 and remembers125 privately; re-enable returns exact pixels and a sole standard125 authority');
 }
 await number('几何缩放',65);await number('横向补正',12);await number('纵向补正',-8);
 const empty=join(root,'empty.png');await copyFile((await frame()).file,empty);const constrain=page.getByRole('checkbox',{name:'约束裁切',exact:true});await constrain.scrollIntoViewIfNeeded();await expect(constrain).toBeInViewport();await constrain.check();await idle();
 const blank=JSON.parse(execFileSync(python,['-c',"from PIL import Image;import numpy as np,json,sys;a,b=[np.array(Image.open(p).convert('RGB')) for p in sys.argv[1:]];print(json.dumps([int(np.all(x==0,axis=2).sum()) for x in [a,b]]))",empty,(await frame()).file],{encoding:'utf8'}));assert(blank[0]>1000);assert.equal(blank[1],0);
 const saved=await saveOne(0),effect=await pixels(),previewHash=hash(await readFile((await frame()).file));assert.equal(saved.adjustments.perspective.constrainCrop,true);
 checks.push('visible scale and both offsets change pixels with single-step Undo/Redo; constraint removes measured blank pixels and persists');
 for(let i=0;i<2;i++){
  await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('left-right');await page.waitForFunction(()=>!!document.querySelector('canvas[aria-label="显影预览"]')?.dataset.before);
  const comparison=await page.locator('canvas[aria-label="显影预览"]').evaluate(async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(c.dataset.before)).arrayBuffer()))));
  assert.equal(Buffer.from(comparison).toString('hex'),previewHash,'before/current share complete current geometry when only geometry changed');await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('off');await idle();assert.equal(await pixels(),effect);
 }
 checks.push('repeated before/current comparison shares the full manual geometry without changing current pixels');
 const output=join(root,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await button('导出').click();
 if(scaleMode){const metadata=page.getByRole('combobox',{name:'输出元数据',exact:true});await metadata.scrollIntoViewIfNeeded();await expect(metadata).toBeInViewport();await metadata.selectOption('all');}
 await page.getByRole('button',{name:/^TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const independent=join(root,'independent.tiff');core=new EngineClient({cache:join(root,'independent'),executable:binary});await core.call('export',{path:files[0],artProfile:saved.artProfile,output:independent,format:'tiff',colorSpace:'srgb'});await core.stop();core=null;
 execFileSync(python,['-c',"import tifffile,numpy as np,sys;a,b=[tifffile.imread(p) for p in sys.argv[1:]];assert a.dtype==b.dtype==np.uint16;assert np.array_equal(a,b)",output,independent]);
 checks.push('real App TIFF16 pixels equal an independently opened core using the saved complete geometry recipe');
 if(!scaleMode){
 await closeElectron(app);app=null;
 const bwFiles=['BW来源','BW目标','BW未选'].map(name=>join(root,name+'.png')),mixes=[[0,3,5,7,9,11,13,15],[0,-3,-5,-7,-9,-11,-13,-15],[0,1,2,3,4,5,6,7]];
 for(let i=0;i<3;i++){
  await copyFile(fixture,bwFiles[i]);const bytes=await readFile(bwFiles[i]);
  await writeFile(bwFiles[i].replace(/\.png$/,'.xmp'),await documents.serialize({source:{path:basename(bwFiles[i]),size:bytes.length,sha256:hash(bytes)},artProfile:image.artProfile,adjustments:{...image.adjustments,blackWhite:{...image.adjustments.blackWhite,enabled:i===0,mixer:mixes[i]}}}));
 }
 const bwPhoto=i=>page.locator('.film-item').filter({hasText:basename(bwFiles[i])}).locator('.film-open'),bwUnselectedHash=hash(await readFile(bwFiles[2].replace(/\.png$/,'.xmp')));
 await launch(bwFiles,'bw-userdata');await bwPhoto(1).click();await idle();const bwTargetBefore=await snapshot();await expect(button('彩色')).toHaveAttribute('aria-pressed','true');
 await bwPhoto(0).click();await idle();await expect(button('黑白')).toHaveAttribute('aria-pressed','true');const bwSourceBefore=await snapshot();
 await bwPhoto(1).click({modifiers:['Meta']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);
 const thumb=page.getByRole('slider',{name:'红色灰度滑杆',exact:true});await thumb.scrollIntoViewIfNeeded();await expect(thumb).toBeInViewport();
 const track=await thumb.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," slider ")][1]').boundingBox(),start=await thumb.boundingBox();assert(track&&start);
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(track.x+track.width*.65,track.y+track.height/2,{steps:6});await page.mouse.up();await idle();
 const red=Number(await input('红色灰度').inputValue());assert.notEqual(red,0);const bwLinked=await app.evaluate(()=>globalThis.__manualSync.at(-1)),bwTarget=bwLinked.find(r=>r.path===bwFiles[1]);
 assert.equal(bwTarget.adjustments.blackWhite.enabled,true);assert.equal(bwTarget.adjustments.blackWhite.mixer[0],red);assert.deepEqual(bwTarget.adjustments.blackWhite.mixer.slice(1),mixes[1].slice(1));
 await bwPhoto(1).click();await idle();await expect(button('黑白')).toHaveAttribute('aria-pressed','true');await expect(input('红色灰度')).toHaveValue(String(red));
 assert.notEqual(await pixels(),bwTargetBefore.pixels);const chroma=Number(execFileSync(python,['-c',"from PIL import Image;import numpy as np,sys;a=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int);print(int((a.max(2)-a.min(2)).max()))",(await frame()).file],{encoding:'utf8'}));assert(chroma<=2,'target must actually render grayscale');
 await bwPhoto(0).click();await idle();await bwPhoto(1).click({modifiers:['Meta']});await button('撤销').click();await idle();assert.deepEqual((await latest()),bwSourceBefore.adjustments);assert.equal(await pixels(),bwSourceBefore.pixels);
 await bwPhoto(1).click();await idle();assert.deepEqual((await latest()),bwTargetBefore.adjustments);assert.equal(await pixels(),bwTargetBefore.pixels);await expect(button('彩色')).toHaveAttribute('aria-pressed','true');
 assert.equal(hash(await readFile(bwFiles[2].replace(/\.png$/,'.xmp'))),bwUnselectedHash);
 checks.push('actual grayscale-band drag from an enabled BW source enables a selected color target, retains its other seven bands, changes visible pixels to grayscale and undoes both photos in one step');
 }else{
  const embedded=await documents.xmp.call('file-read','',[],{path:output,format:'tiff'});assert.equal(lookup(embedded.properties,CRS,'PerspectiveScale')?.value,'65');assert.equal(readExtension(embedded.properties,'ARTAdjustments'),undefined,'Rendered output must omit all private editing state');
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},files[2]);await button('打开').click();await idle();await panel();await expect(input('几何缩放')).toHaveValue('110');const importedPixels=await pixels();await saveOne(2);
  await closeElectron(app);app=null;await launch([files[2]],'scale-reopen-userdata');await expect(input('几何缩放')).toHaveValue('110');assert.equal(await pixels(),importedPixels);
  const neutral=join(root,'标准100.png');await copyFile(fixture,neutral);await writeFile(neutral.replace(/\.png$/,'.xmp'),(await documents.xmp.call('write','',[property(CRS,'PerspectiveScale',text(100))])).packet);
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},neutral);await button('打开').click();await idle();await panel();await expect(input('几何缩放')).toHaveValue('100');legacyPerspective((await latest()).perspective);
  checks.push('actual standard110 sidecar imports, saves and reopens at identical pixels; TIFF embeds standard65 without private duplication; foreign100 leaves the manual model inactive');
 }
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));assert(windows.every(w=>!w.visible&&!w.focused&&!w.focusable));
 for(let i=0;i<3;i++)assert.equal(hash(await readFile(files[i])),sourceHashes[i]);for(const path of paths)assert.equal(hash(await readFile(path)),cohort[path],path+' remained frozen');assert.deepEqual(errors,[]);
 passed=true;console.log(JSON.stringify({cohort,checks,windows},null,2));
}catch(error){if(page)await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),cohort,checks,errors,updates:app?await app.evaluate(()=>globalThis.__manualUpdates).catch(()=>undefined):undefined,sync:app?await app.evaluate(()=>globalThis.__manualSync).catch(()=>undefined):undefined,diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
finally{await core?.stop();if(app)await closeElectron(app);if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained manual App failure:',root);}
