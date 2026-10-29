// Hidden production App, real pointer/control gestures and native pixels.
// A delayed RPC response below exercises cancellation; its pixels are not mocked.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {readDocument} from './xmp-test.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {mkdtemp,writeFile,readFile,rm,stat,readdir} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
assert(readFileSync('apps/desktop/dist/electron/main.cjs','utf8').includes('brush:prepare'),'Build the current UI before running this test');
const root=await mkdtemp(join(tmpdir(),'captraw-brush-app-')),source=join(root,'source.png'),python=resolve('build/qa-venv/bin/python');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),hash=b=>createHash('sha256').update(b).digest('hex'),engineSHA=hash(await readFile(binary));
if(process.env.CAPTRAW_BRUSH_ENGINE_SHA256)assert.equal(engineSHA,process.env.CAPTRAW_BRUSH_ENGINE_SHA256);
let app,page,passed=false;const errors=[],checks=[];let restoredCore;
const button=name=>page.getByRole('button',{name,exact:true});
const latest=()=>page.evaluate(()=>window.__brushFrames.filter(f=>f.kind==='fit').at(-1));
const input=()=>app.evaluate(()=>globalThis.__brushTrace.filter(t=>t.channel==='image:update'&&t.result).at(-1).input);
const leaf=a=>a.masks.at(-1).components?.[0]||a.masks.at(-1);
const pixels=frame=>execFileSync(python,['-c',"from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).getchannel('A').tobytes())",frame.mask.file]);
const coverage=async()=>hash(pixels(await latest()));
async function ready(){await page.waitForTimeout(160);await page.locator('.rendering').waitFor({state:'hidden'});await page.locator('.mask-gesture-status').waitFor({state:'hidden'});await page.waitForFunction(()=>{const f=window.__brushFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});await expect(page.getByRole('alert')).toHaveCount(0);}
async function settle(action){const revision=(await latest())?.revision??-1;await action();await page.waitForFunction(r=>(window.__brushFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,revision);await ready();}
async function number(name,value,render=true){const control=page.getByRole('spinbutton',{name,exact:true});await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();await expect(control).toBeInViewport();const action=async()=>{await control.fill(String(value));await control.press('Tab');};if(render)await settle(action);else await action();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());}
async function point(p){const svg=page.getByTestId('viewport').locator('svg.mask-overlay'),box=await svg.boundingBox();assert(box);const r=await svg.locator('#mask-image-bounds rect').evaluate(e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(e.getAttribute(k))])));const q={x:box.x+r.x+p.x*r.width,y:box.y+r.y+p.y*r.height};assert(await page.getByTestId('viewport').evaluate((e,p)=>e.contains(document.elementFromPoint(p.x,p.y)),q));return q;}
async function draw(from,to,wait=true){const a=await point(from),b=await point(to);const action=async()=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();};if(wait)await settle(action);else await action();}
async function save(){const count=await app.evaluate(()=>globalThis.__brushTrace.filter(t=>t.channel==='session:save'&&t.result).length);await button('保存').click();await expect.poll(()=>app.evaluate(()=>globalThis.__brushTrace.filter(t=>t.channel==='session:save'&&t.result).length)).toBe(count+1);await ready();return readDocument(source.replace('.png','.xmp'));}
async function section(name){const details=page.locator('details.adjust-section').filter({has:page.locator(':scope > summary').getByText(name,{exact:true})});if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();}
try{
 execFileSync(python,['-c',"from PIL import Image,ImageDraw;import sys;im=Image.new('RGB',(800,600),(180,50,35));ImageDraw.Draw(im).rectangle((400,0,799,599),fill=(30,145,190));im.save(sys.argv[1])",source]);const sourceSHA=hash(await readFile(source));
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__brushFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__brushFrames.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog,BrowserWindow,app})=>{
  globalThis.__brushTrace=[];globalThis.__brushWindowEvents=[];const watch=w=>{for(const name of ['show','focus'])w.on(name,()=>globalThis.__brushWindowEvents.push(name));};BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
  for(const channel of ['image:update','brush:prepare','brush:cancel','session:save','image:close','session:forget']){
   const handler=ipcMain._invokeHandlers.get(channel);if(!handler)throw Error('Missing '+channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{
    const record={channel,input:structuredClone(input)};globalThis.__brushTrace.push(record);record.result=await handler(event,input);record.completed=true;
    if(channel==='brush:prepare'&&globalThis.__holdBrush){globalThis.__holdBrush=false;await new Promise(done=>{globalThis.__releaseBrush=done;});}return record.result;
   });
  }
  dialog.showMessageBox=async(...args)=>{const options=args.at(-1),save=options.buttons?.findIndex(v=>v.includes('确认保存'));return {response:save>=0?save:1};};
 });
 await open(source);await button('蒙版 M').click();await settle(()=>button('画笔').click());await ready();
 for(const name of ['流量','密度']){const control=page.getByRole('spinbutton',{name,exact:true});await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();await expect(control).toHaveValue('100');}
 await expect(page.getByRole('checkbox',{name:'自动蒙版',exact:true})).not.toBeChecked();
 await number('流量',25,false);await number('密度',45,false);await number('画笔大小',.3,false);
 await draw({x:.32,y:.45},{x:.43,y:.45});let a=(await input()).adjustments,s=leaf(a).brush.strokes[0];assert.equal(s.flow,25);assert.equal(s.density,45);assert.equal(s.autoMask,false);assert.equal(s.geometryReference.version,3);assert.equal(a.sourceFrame.policy,'active-area-v1');assert.equal(leaf(a).points.length,0);const first=await coverage();
 assert((await input()).artProfile===undefined||(await app.evaluate(()=>globalThis.__brushTrace.filter(t=>t.channel==='image:update'&&t.result).at(-1).result.artProfile)).includes('CaptRAWBrushProgramV1'));
 await draw({x:.32,y:.45},{x:.43,y:.45});const second=await coverage();assert.notEqual(second,first);assert.equal(leaf((await input()).adjustments).brush.strokes.length,2);
 await settle(()=>button('撤销').click());assert.equal(await coverage(),first);await settle(()=>button('重做').click());assert.equal(await coverage(),second);checks.push('visible defaults, formal stroke fields, additive flow, history pixel restoration');
 await settle(()=>button('画笔').click());await number('流量',40,false);await number('密度',70,false);await number('画笔大小',1.4,false);await page.getByRole('checkbox',{name:'自动蒙版',exact:true}).check();
 await draw({x:.4,y:.55},{x:.6,y:.55});a=(await input()).adjustments;s=leaf(a).brush.strokes[0];assert(s.autoMask.seed&&s.coverage);assert((await stat(s.coverage.path)).isFile());const assetSHA=hash(await readFile(s.coverage.path));assert.equal(assetSHA,s.coverage.sha256);const frozen=await coverage();
 const m=await latest();assert(Number(execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]).getchannel('A');print(im.getpixel((round(im.width*.6),round(im.height*.55))))",m.mask.file],{encoding:'utf8'}))<5);checks.push('real native AutoMask prepare, immutable gray16 asset and visible opposite-color rejection');
 await button('编辑').click();await section('颜色');await number('色温',2800);await number('饱和度',-65);await button('蒙版 M').click();await ready();assert.equal(await coverage(),frozen);assert.equal(hash(await readFile(s.coverage.path)),assetSHA);checks.push('WB and global color leave authored coverage unchanged');
 await button('编辑').click();await section('几何');await number('水平透视',12);await number('垂直透视',-8);await section('光学');await number('手动扭曲',18);await settle(()=>button('顺时针旋转 90 度').click());await button('裁切 C').click();await settle(()=>button('水平翻转').click());await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();await button('蒙版 M').click();await ready();
 assert.equal(hash(await readFile(s.coverage.path)),assetSHA);await expect(page.getByTestId('mask-coverage')).toBeVisible();const transformed=await coverage(),document=await save();assert.equal(leaf(document.adjustments).brush.strokes[0].coverage.path,'captraw-mask:'+assetSHA);assert(document.maskAssets.files.some(f=>f.id===assetSHA));
 const packet=await readFile(source.replace('.png','.xmp'),'utf8');assert(packet.includes('brush'));assert(!packet.includes('CaptRAWBrushProgramV1')||packet.includes('ARTProfile'));
 await open(source.replace('.png','.xmp'));await button('蒙版 M').click();await button(document.adjustments.masks.at(-1).name).click();await ready();assert.equal(await coverage(),transformed);checks.push('perspective/distortion/coarse90/flip, typed XMP asset copy and reopen pixels');
 restoredCore=new EngineClient({cache:join(root,'independent')});const restored=await restoreRecipeMasks(restoredCore,source.replace('.png','.xmp'),document,join(root,'restored'));
 const one=join(root,'one.tiff'),two=join(root,'two.tiff');await restoredCore.call('export',{path:source,artProfile:restored.artProfile,output:one,format:'tiff',colorSpace:'srgb'});
 const independent=new EngineClient({cache:join(root,'independent-two')});try{await independent.call('export',{path:source,artProfile:restored.artProfile,output:two,format:'tiff',colorSpace:'srgb'});}finally{await independent.stop();}
 execFileSync(python,['-c',"import tifffile,numpy as np,sys;a=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert a.dtype==np.uint16;assert np.array_equal(a,b)",one,two]);checks.push('portable saved coverage renders identical TIFF16 in independent ART processes');
 // Hold only delivery of a real completed task; Escape must discard its lease.
 await number('画笔大小',.5,false);await app.evaluate(()=>{globalThis.__holdBrush=true;});await draw({x:.35,y:.35},{x:.4,y:.4},false);
 await expect.poll(()=>app.evaluate(()=>!!globalThis.__releaseBrush)).toBe(true);const late=await app.evaluate(()=>globalThis.__brushTrace.filter(t=>t.channel==='brush:prepare'&&t.result).at(-1).result);assert(existsSync(late.coverage.path));
 const before=(await input()).adjustments;await page.keyboard.press('Escape');await expect(page.locator('.mask-gesture-status')).toHaveCount(0);await expect.poll(()=>existsSync(late.coverage.path)).toBe(false);await app.evaluate(()=>{globalThis.__releaseBrush();delete globalThis.__releaseBrush;});await page.waitForTimeout(250);assert.deepEqual((await input()).adjustments,before);checks.push('Escape rejects a late real prepare result and removes its unadopted asset');
 await button('蒙版 M').click();await settle(()=>button('画笔').click());
 // Freeze only the renderer's debounce clock. Real native preparation and UI
 // input continue, so Undo is deterministic before the first update is sent.
 await page.clock.install({time:Date.now()});await page.clock.pauseAt(new Date(Date.now()+100));
 await draw({x:.35,y:.35},{x:.4,y:.4},false);
 await expect.poll(()=>page.locator('.mask-gesture-status').count(),{timeout:60000}).toBe(0);
 const unrendered=await app.evaluate(()=>globalThis.__brushTrace.filter(t=>t.channel==='brush:prepare'&&t.result).at(-1).result);
 assert(await app.evaluate(id=>!globalThis.__brushTrace.some(t=>t.channel==='image:update'&&JSON.stringify(t.input.adjustments).includes(id)),unrendered.id),'First rendered update must not have adopted this stroke yet');
 await page.keyboard.press('Meta+z');await expect.poll(()=>button('重做').isEnabled()).toBe(true);await page.clock.resume();await ready();assert(existsSync(unrendered.coverage.path),'Undo before first render must retain coverage for Redo');
 await settle(()=>button('重做').click());assert.equal(leaf((await input()).adjustments).brush.strokes[0].coverage.sha256,unrendered.coverage.sha256);checks.push('real UI Undo before first render retains its lease and Redo renders it');
 await save();await settle(()=>button('撤销').click());const undone=await save();assert(!leaf(undone.adjustments).brush,'Undo then save removes the new brush field without unknown-field resurrection');checks.push('undo/save removes an owned brush field from previously saved typed RDF');
 // The real export handler has copied its document before opening the dialog.
 // Keep that dialog pending while Done closes the whole editing session.
 const heldAsset=(await input()).adjustments.masks[1].components[0].brush.strokes[0].coverage.path,afterDone=join(root,'after-done.tiff');assert(existsSync(heldAsset));
 await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>{globalThis.__brushExportSnapshot=true;await new Promise(done=>{globalThis.__releaseBrushExport=done;});return {canceled:false,filePath:output};};},afterDone);
 await button('导出').click();await page.getByRole('button',{name:'TIFF · 16 位',exact:false}).click();await expect.poll(()=>app.evaluate(()=>!!globalThis.__releaseBrushExport)).toBe(true);
 await button('完成').click();await expect.poll(()=>app.evaluate(()=>globalThis.__brushTrace.some(t=>t.channel==='session:forget'&&t.completed))).toBe(true);assert(existsSync(heldAsset),'Done must retain an asset still held by an export snapshot');
 await app.evaluate(()=>{globalThis.__releaseBrushExport();delete globalThis.__releaseBrushExport;});await expect(page.locator('.job-toast.done')).toContainText('已导出 after-done.tiff',{timeout:180000});assert(existsSync(heldAsset));
 execFileSync(python,['-c',"import tifffile,numpy as np,sys;a=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert a.dtype==np.uint16;assert np.array_equal(a,b)",one,afterDone]);checks.push('real whole-session Done preserves a pending export snapshot and its TIFF16 pixels');
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));assert(windows.every(w=>!w.visible&&!w.focused&&!w.focusable));assert.deepEqual(await app.evaluate(()=>globalThis.__brushWindowEvents),[]);assert.deepEqual(errors,[]);assert.equal(hash(await readFile(source)),sourceSHA);assert.equal(hash(await readFile(binary)),engineSHA);
 passed=true;console.log(JSON.stringify({engineSHA,checks,limits:['Candidate brush semantics; no ACR algorithm-equivalence claim. Independent TIFF is the same ART implementation.']},null,2));
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,errors,trace:app?await app.evaluate(()=>globalThis.__brushTrace).catch(()=>[]):[],diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
finally{await restoredCore?.stop();if(app)await closeElectron(app);if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained latest brush App failure:',root);}
