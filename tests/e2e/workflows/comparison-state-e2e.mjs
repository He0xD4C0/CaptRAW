import {expect} from '@playwright/test';
import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out=resolve(process.env.CAPTRAW_COMPARISON_STATE_OUT||'artifacts/comparison-state-gui');mkdirSync(out,{recursive:true});
const source=resolve('build/samples/nikon-d850.NEF'),other=resolve('build/samples/canon-r5.CR3');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sources=[source,other],sourceHashes=sources.map(hash),checks=[],errors=[];
const pass=s=>{checks.push(s);console.log('PASS',s);};
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const input=join(out,'打开时 中文 配方.xmp'),fixture=new EngineClient({cache:join(out,'fixture')});
const hidden='Curve2=1;0;0;0.5;0.75;1;1;';let fixtureHash;
try{
 const image=await fixture.call('open',{path:source,sessionId:'fixture'});
 const base=(await fixture.call('save')).artProfile,adjustments={...image.adjustments,exposure:.65};
 const before=fixture.preview(1);const result=await fixture.call('update',{revision:1,artProfile:base.replace('Curve2=0;',hidden),adjustments});
 const frame=await before;fixtureHash=hash(frame.file);copyFileSync(frame.file,join(out,'opening-reference.png'));
 expect(result.artProfile).toContain(hidden);
 writeFileSync(input,await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:readFileSync(source).length,sha256:sourceHashes[0]},adjustments,artProfile:result.artProfile}));
}finally{await fixture.stop();}
const inputHash=hash(input);let app,page,status='failed';
async function launch(){
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true})));
 await page.evaluate(()=>{window.after=[];window.before=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.after.push(e.frame);if(e.event==='comparison-preview')window.before.push(e.frame);});});
}
const button=name=>page.getByRole('button',{name,exact:true}),view=()=>page.getByLabel('前后对比视图'),dirty=()=>page.locator('.document-title .dirty-dot');
async function idle(){await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.after.filter(f=>f.kind==='fit').at(-1)?.url);}
async function settle(fn){const n=await page.evaluate(()=>window.after.length);await fn();await page.waitForFunction(n=>window.after.length>n,n);await idle();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());}
async function change(n){await settle(async()=>{const c=page.getByRole('spinbutton',{name:'曝光',exact:true});await c.fill(String(n));await c.press('Tab');});}
async function ready(single=false){await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(single=>{const c=document.querySelector('canvas');return c.dataset[single?'frame':'before']===window.before.filter(f=>f.kind==='fit').at(-1)?.url;},single);}
async function reference(fn,single=false){const n=await page.evaluate(()=>window.before.length);await fn();await page.waitForFunction(n=>window.before.length>n,n);await ready(single);}
const imageHash=async which=>hash(await page.evaluate(which=>window[which].filter(f=>f.kind==='fit').at(-1).file,which));
async function save(name){const file=join(out,name+'.xmp');rmSync(file,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await settle(()=>button('保存').click());await expect.poll(()=>existsSync(file)).toBe(true);return {file,doc:await readDocument(file)};}
async function key(k){await page.getByTestId('viewport').click({position:{x:10,y:10}});await page.keyboard.press(k);}
try{
 await launch();for(const n of ['保存前状态','交换前后设置','还原打开时状态'])await expect(button(n)).toBeDisabled();
 await open(input);expect(await imageHash('after')).toBe(fixtureHash);await expect(button('保存前状态')).toBeEnabled();
 await view().selectOption('left-right');await ready();expect(await imageHash('before')).toBe(fixtureHash);await expect(page.getByLabel('前后对比',{exact:true})).toContainText('打开时状态');await expect(dirty()).toHaveCount(0);
 pass('XMP opening settings, including the hidden ART second curve, define the actual before image');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));
 for(const n of ['保存前状态','交换前后设置','还原打开时状态'])await expect(button(n)).toBeInViewport();
 pass('all comparison actions remain visible in the minimum window');
 await change(1.25);const savedB=await save('状态 B'),hashB=await imageHash('after');expect(hashB).not.toBe(fixtureHash);
 await reference(()=>button('保存前状态').click());expect(await imageHash('before')).toBe(hashB);await expect(dirty()).toHaveCount(0);
 expect((await save('保存前状态后')).doc.artProfile).toBe(savedB.doc.artProfile);
 pass('saving a before checkpoint changes neither the edit recipe nor its dirty state');
 await change(-.5);const hashC=await imageHash('after');await ready();expect(await imageHash('before')).toBe(hashB);await expect(dirty()).toHaveCount(1);
 await reference(()=>settle(()=>button('交换前后设置').click()));expect(await imageHash('after')).toBe(hashB);expect(await imageHash('before')).toBe(hashC);await expect(dirty()).toHaveCount(0);
 await reference(()=>settle(()=>button('撤销').click()));expect(await imageHash('after')).toBe(hashC);expect(await imageHash('before')).toBe(hashB);await expect(dirty()).toHaveCount(1);
 await reference(()=>settle(()=>button('重做').click()));expect(await imageHash('after')).toBe(hashB);expect(await imageHash('before')).toBe(hashC);await expect(dirty()).toHaveCount(0);
 await reference(()=>settle(()=>button('撤销').click()));
 pass('swap exchanges actual pixels and both states; undo and redo restore saved/dirty identity in one step');
 await reference(()=>button('还原打开时状态').click());expect(await imageHash('before')).toBe(fixtureHash);expect(await imageHash('after')).toBe(hashC);
 await settle(()=>button('撤销').click());await ready();expect(await imageHash('after')).toBe(hashB);expect(await imageHash('before')).toBe(fixtureHash);await expect(dirty()).toHaveCount(0);
 await settle(()=>button('重做').click());await ready();expect(await imageHash('after')).toBe(hashC);
 pass('restoring the opening reference leaves edits and the ordinary edit history intact');
 await reference(()=>key('Alt+p'));expect(await imageHash('before')).toBe(hashC);await expect(page.getByLabel('前后对比',{exact:true})).toContainText('已存前状态');
 await key('Shift+P');await expect(button('预设')).toHaveClass('selected');await expect(page.getByRole('region',{name:'用户预设'})).toBeVisible();await expect(view()).toHaveValue('left-right');await button('编辑').click();
 await key('p');await ready(true);await expect(view()).toHaveValue('off');await expect(page.locator('.before-state-label')).toHaveText('已存前状态 · 同步构图');
 await key('p');await idle();await expect(page.locator('.before-state-label')).toHaveCount(0);
 pass('Option/Alt+P captures, Shift+P opens presets, and P toggles an isolated single-image before view');
 await change(1.8);const hashD=await imageHash('after');const savedD=await save('状态 D');expect(savedD.doc.artProfile).toContain(hidden);
 await button('1:1').click();await page.waitForFunction(()=>!!document.querySelector('canvas').dataset.detail);
 const afterDetail=await page.locator('canvas').getAttribute('data-detail');await reference(()=>key('p'),true);await expect(page.getByLabel('缩放比例')).toHaveText('100%');await page.waitForFunction(()=>{const f=window.before.filter(f=>f.kind==='detail').at(-1);return f&&document.querySelector('canvas').dataset.detail===f.url;});
 const beforeHistogram=await page.evaluate(()=>{const bins=window.before.filter(f=>f.kind==='fit').at(-1).histogram,peak=Math.max(1,...bins.flat());return bins.map(channel=>channel.map((v,x)=>`${x?'L':'M'}${x},${88-Math.pow(v/peak,.5)*83}`).join(' ')+'L255 90H0Z');});
 expect(await page.getByRole('img',{name:'RGB 直方图',exact:true}).locator('path').evaluateAll(paths=>paths.map(p=>p.getAttribute('d')))).toEqual(beforeHistogram);

 await key('p');await idle();await expect(page.getByLabel('缩放比例')).toHaveText('100%');await expect(page.locator('canvas')).toHaveAttribute('data-detail',afterDetail);
 await button('适屏').click();await view().selectOption('left-right');await ready();expect(await imageHash('before')).toBe(hashC);
 await page.screenshot({path:join(out,'saved-before.png')});
 pass('P shows the before histogram, preserves 1:1 and restores the current frame and detail');
 await open(other);await expect(view()).toHaveValue('off');await settle(()=>page.locator('.film-item').filter({hasText:'nikon-d850.NEF'}).locator('.film-open').click());await view().selectOption('left-right');await ready();expect(await imageHash('before')).toBe(hashC);expect(await imageHash('after')).toBe(hashD);
 pass('each photo retains its checkpoint when switching the session filmstrip');
 const output=join(out,'desktop.tiff');rmSync(output,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);await button('导出').click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const independent=new EngineClient({cache:join(out,'independent')});try{await independent.call('export',{path:source,artProfile:savedD.doc.artProfile,output:join(out,'independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 execFileSync('build/qa-venv/bin/python',['-c',String.raw`import json,sys,io,numpy as np,tifffile
from pathlib import Path
from PIL import ImageCms
p=Path(sys.argv[1]);a=tifffile.imread(p/'desktop.tiff');b=tifffile.imread(p/'independent.tiff');assert a.dtype==np.uint16 and np.array_equal(a,b)
with tifffile.TiffFile(p/'desktop.tiff') as f:
 assert f.pages[0].bitspersample==16
 icc=f.pages[0].tags[34675].value;assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc)))
(p/'pixels.json').write_text(json.dumps({'maximumDifference16bit':0,'shape':list(a.shape),'ICCBytes':len(icc)},indent=2)+'\n')`,out]);
 pass('desktop TIFF16 with sRGB ICC equals independent core pixels, including hidden ART settings');
 await closeElectron(app);app=undefined;await launch();await open(savedD.file);expect(await imageHash('after')).toBe(hashD);await view().selectOption('left-right');await ready();expect(await imageHash('before')).toBe(hashD);await expect(button('还原打开时状态')).toBeDisabled();await expect(dirty()).toHaveCount(0);
 const restored=await save('重新打开');expect(restored.doc.artProfile).toBe(savedD.doc.artProfile);expect(restored.doc.adjustments).toEqual(savedD.doc.adjustments);
 pass('fresh process restores the saved XMP exactly; session-only checkpoints do not leak into the document');
 await view().selectOption('off');await button('裁切 C').click();await settle(()=>page.getByLabel('裁切比例',{exact:true}).selectOption('6'));await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();await settle(()=>button('顺时针旋转 90 度').click());await change(.3);const geometry=(await save('交换前构图')).doc.adjustments;
 await view().selectOption('left-right');await ready();await reference(()=>settle(()=>button('交换前后设置').click()));const swapped=(await save('交换后构图')).doc;
 for(const field of ['crop','cropAspect','rotation','lensCorrections','lensProfile'])expect(swapped.adjustments[field]).toEqual(geometry[field]);expect(swapped.adjustments.exposure).toBe(1.8);expect(swapped.artProfile).toContain(hidden);
 pass('swapping keeps the current crop, locked aspect, rotation and lens settings while replacing tone');
 for(const [i,path] of sources.entries())expect(hash(path)).toBe(sourceHashes[i]);expect(hash(input)).toBe(inputHash);expect(errors).toEqual([]);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));expect(windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true);
 pass('source RAW/XMP stay unchanged; all GUI windows remain hidden, unfocused and nonfocusable');status='passed';
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({status,packaged:!!process.env.CAPTRAW_APP,checks,errors},null,2)+'\n');if(app)await closeElectron(app);}
