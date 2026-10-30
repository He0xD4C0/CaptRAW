import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {resolve,join,dirname,extname} from 'node:path';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(process.env.CAPTRAW_FINE_GUI_OUT||'artifacts/fine-rotation-gui');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const executablePath=process.env.CAPTRAW_APP,resources=executablePath?resolve(dirname(executablePath),'../Resources/native'):resolve('build/native');
const docs=new Documents(new XMP(executablePath?join(resources,'captraw-xmp'):resolve('build/xmp/captraw-xmp')));
const fixture=resolve(process.env.CAPTRAW_FINE_SOURCE||'build/samples/synthetic.dng'),source=join(out,'角度 原片'+extname(fixture));copyFileSync(fixture,source);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),original=hash(fixture),checks=[],errors=[],metrics=[];let app,page,failure,sequence=0;
const button=name=>page.getByRole('button',{name,exact:true}),angle=()=>page.getByRole('spinbutton',{name:'角度',exact:true});
const pass=s=>{checks.push(s);console.log('PASS',s);};
const frame=()=>page.evaluate(()=>window.__fineEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame);
async function ready(){await page.waitForFunction(()=>{const f=window.__fineEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame;return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});await expect(page.getByRole('alert')).toHaveCount(0);}
async function settle(action){const previous=(await frame())?.revision||0;await action();await expect.poll(async()=>(await frame())?.revision||0,{timeout:120000}).toBeGreaterThan(previous);await ready();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());}
async function save(name){const path=join(out,`${++sequence}-${name}.xmp`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await button('保存').click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();return {path,doc:await docs.read(path)};}
async function setAngle(value){await settle(async()=>{await angle().fill(String(value));await angle().press('Tab');});}
async function launch(){app=await electron.launch({executablePath});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true})));await page.evaluate(()=>{window.__fineEvents=[];window.captraw.onEvent(e=>window.__fineEvents.push(e));});}
try{
 await launch();await open(source);const initial=hash((await frame()).file);await button('裁切 C').click();await expect(angle()).toBeVisible();await expect(angle()).toHaveValue('0');await expect(page.getByRole('slider',{name:'角度滑杆',exact:true})).toBeVisible();
 await setAngle(23);assert.notEqual(hash((await frame()).file),initial);const saved=await save('angle');assert.equal(saved.doc.adjustments.fineRotation,23);assert.match(saved.doc.artProfile,/\[Rotation\][\s\S]*?Enabled=true\nDegree=23/);
 await settle(()=>button('撤销').click());await expect(angle()).toHaveValue('0');assert.equal(hash((await frame()).file),initial);await settle(()=>button('重做').click());await expect(angle()).toHaveValue('23');
 await settle(()=>page.getByRole('slider',{name:'角度滑杆',exact:true}).press('ArrowLeft'));await expect(angle()).toHaveValue('22.99');await settle(()=>button('撤销').click());await expect(angle()).toHaveValue('23');
 await angle().fill('100');await angle().press('Escape');await expect(angle()).toHaveValue('23');await settle(()=>button('重置角度').click());await expect(angle()).toHaveValue('0');await settle(()=>button('撤销').click());await expect(angle()).toHaveValue('23');
 await page.screenshot({path:join(out,'angle-controls.png')});pass('visible numeric and slider controls rotate RAW pixels; reset, Escape and single-step undo/redo work');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));
 await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(1080);
 for(const control of [angle(),page.getByRole('slider',{name:'角度滑杆',exact:true}),button('重置角度'),page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true})])await expect(control).toBeInViewport({ratio:1});
 await page.screenshot({path:join(out,'angle-minimum-window.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,960));await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(1480);
 pass('angle input, slider, reset and crop completion remain fully visible at the minimum window size');
 const current=join(out,'current-angle.png');copyFileSync((await frame()).file,current);
 await page.keyboard.press('p');await page.waitForFunction(()=>window.__fineEvents.some(e=>e.event==='comparison-preview'&&e.frame.kind==='fit'));
 const before=await page.evaluate(()=>window.__fineEvents.filter(e=>e.event==='comparison-preview'&&e.frame.kind==='fit').at(-1).frame);copyFileSync(before.file,join(out,'before-angle.png'));
 execFileSync('build/qa-venv/bin/python',['-c','from PIL import Image;import numpy as np,sys;assert np.array_equal(np.asarray(Image.open(sys.argv[1])),np.asarray(Image.open(sys.argv[2])))',current,join(out,'before-angle.png')]);await page.keyboard.press('p');
 pass('before-state rendering retains the current fine rotation and matches the same untouched image pixels');
 await button('蒙版 M').click();await settle(()=>button('径向').click());
 const view=page.getByTestId('viewport'),bounds=await view.boundingBox();assert(bounds);
 await settle(async()=>{await page.mouse.move(bounds.x+bounds.width*.35,bounds.y+bounds.height*.35);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.6,{steps:5});await page.mouse.up();});
 const masked=await save('mask');const leaf=masked.doc.adjustments.masks[0].components[0];assert.equal(leaf.referenceAngle,23);await expect(page.getByTestId('mask-coverage')).toBeVisible();
 await button('裁切 C').click();await setAngle(-17);const rotated=await save('rotated-mask');assert.deepEqual(rotated.doc.adjustments.masks,masked.doc.adjustments.masks);
 await settle(()=>button('撤销').click());await expect(angle()).toHaveValue('23');await settle(()=>button('重做').click());await expect(angle()).toHaveValue('-17');
 pass('mask created at 23 degrees retains its reference and coordinates when angle changes to -17');
 const output=join(out,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await button('导出').click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const oldNative='/Users/he0xd4c0/Applications/CaptRAW-0.47.app/Contents/Resources/native',core=new EngineClient({executable:join(oldNative,'captraw-engine'),resources:join(oldNative,'resources'),cache:join(out,'reference')});
 try{await core.call('export',{path:source,artProfile:rotated.doc.artProfile,format:'tiff',output:join(out,'reference.tiff')});}finally{await core.stop();}
 const outputMetrics=JSON.parse(execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np,json,sys\na,b=[tifffile.imread(p) for p in sys.argv[1:]]\nwith tifffile.TiffFile(sys.argv[1]) as f: icc=f.pages[0].tags[34675].value\nassert a.dtype==np.uint16 and np.array_equal(a,b) and len(icc)>0\nprint(json.dumps(dict(shape=list(a.shape),maximumDifference=0,iccBytes=len(icc))))`,output,join(out,'reference.tiff')],{encoding:'utf8'}));metrics.push(outputMetrics);
 const visible=hash((await frame()).file);await closeElectron(app);app=undefined;await launch();await open(rotated.path);assert.equal(hash((await frame()).file),visible);await button('裁切 C').click();await expect(angle()).toHaveValue('-17');assert.deepEqual((await save('reopened')).doc.adjustments.masks,masked.doc.adjustments.masks);
 pass('XMP reopens exact preview and masks; desktop TIFF16 with ICC equals independent 0.47 engine output');
 // Older XMP has the angle only in its ART profile. Fresh-image zero must not override it.
 const inherited=structuredClone(rotated.doc);delete inherited.adjustments.fineRotation;
 const legacyPath=join(out,'legacy-angle.xmp');writeFileSync(legacyPath,await docs.serialize(inherited));const legacyHash=hash(legacyPath);
 await closeElectron(app);app=undefined;await launch();await open(legacyPath);
 assert.equal(hash((await frame()).file),visible);await button('裁切 C').click();await expect(angle()).toHaveValue('-17');
 const projected=await save('projected-angle');assert.equal(projected.doc.adjustments.fineRotation,-17);assert.deepEqual(projected.doc.adjustments.masks,masked.doc.adjustments.masks);assert.equal(hash(legacyPath),legacyHash);
 pass('legacy profile-only angle projects into the visible control without changing preview, masks or source XMP');
 const states=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));assert(states.every(w=>!w.visible&&!w.focused&&!w.focusable));metrics.push({windows:states});assert.equal(hash(fixture),original);assert.equal(hash(source),original);assert.deepEqual(errors,[]);
}catch(e){failure={stack:e.stack||String(e),stdout:e.stdout?.toString(),stderr:e.stderr?.toString()};if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw e;}
finally{let diagnostics;if(app){diagnostics=electronDiagnostics(app);await closeElectron(app).catch(e=>{errors.push(String(e));process.exitCode=1;});}writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,checks,errors,failure,metrics,fixture,fixtureSHA256:original,executablePath:executablePath||null,diagnostics},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
