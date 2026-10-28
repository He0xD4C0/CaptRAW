import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {readDocument} from './xmp-test.mjs';
import {EngineClient} from './engine-client.mjs';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.env.CAPTRAW_AUTO_GUI_OUT||'artifacts/auto-perspective-gui');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const source=join(out,'建筑 倾斜.png'),blank=join(out,'无直线.png'),checks=[],errors=[],metrics=[];let app,page,failure,n=0;
execFileSync('build/qa-venv/bin/python',['-c',String.raw`
from PIL import Image,ImageDraw
import sys
a=Image.new('RGB',(1000,800),(100,100,100));d=ImageDraw.Draw(a)
for x in range(50,1000,100):
 for y in range(50,800,100):d.rectangle((x,y,x+60,y+65),fill=(220,220,220),outline=(30,30,30),width=5)
d.line((150,400,850,400),fill=(240,20,20),width=7)
a.rotate(6,resample=Image.Resampling.BICUBIC,fillcolor=(100,100,100)).save(sys.argv[1]);Image.new('RGB',a.size,(100,100,100)).save(sys.argv[2])
`,source,blank]);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source),button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('spinbutton',{name,exact:true});
const pass=s=>{checks.push(s);console.log('PASS',s);},frame=()=>page.evaluate(()=>window.__autoFrames.filter(f=>f.kind==='fit').at(-1));
async function ready(){await page.waitForFunction(()=>{const f=window.__autoFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});}
async function settle(fn){const before=(await frame())?.url;await fn();await expect.poll(async()=>(await frame())?.url,{timeout:120000}).not.toBe(before);await ready();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());}
async function save(name){const path=join(out,`${++n}-${name}.xmp`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await button('保存').click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();return {path,doc:await readDocument(path)};}
async function panel(){await button('编辑').click();const summary=page.locator('.adjust-section > summary').filter({hasText:/^几何$/});await summary.scrollIntoViewIfNeeded();if(await summary.locator('..').getAttribute('open')===null)await summary.click();await button('自动联合').scrollIntoViewIfNeeded();}
async function tilt(){return page.locator('canvas').evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0,sx=0,sy=0,sxx=0,sxy=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(a[i]-Math.max(a[i+1],a[i+2])>100){n++;sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}}if(n<100)throw Error('No red reference line');return Math.abs(Math.atan((sxy-sx*sy/n)/(sxx-sx*sx/n))*180/Math.PI);});}
async function launch(){app=await electron.launch({executablePath:process.env.CAPTRAW_APP});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.__autoFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__autoFrames.push(e.frame);});});await app.evaluate(({ipcMain,session})=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true}));
 const real=ipcMain._invokeHandlers.get('image:auto-perspective');globalThis.__autoFinished=0;
 ipcMain.removeHandler('image:auto-perspective');ipcMain.handle('image:auto-perspective',async(...args)=>{const result=await real(...args);if(globalThis.__holdAuto){globalThis.__autoHeld=true;await new Promise(resolve=>{globalThis.__releaseAuto=resolve;});}globalThis.__autoFinished++;return result;});
 });}
async function hold(){await app.evaluate(()=>{globalThis.__holdAuto=true;globalThis.__autoHeld=false;});await button('自动联合').click();await expect.poll(()=>app.evaluate(()=>globalThis.__autoHeld),{timeout:120000}).toBe(true);await expect(button('取消自动透视')).toBeVisible();}
async function release(){const n=await app.evaluate(()=>globalThis.__autoFinished);await app.evaluate(()=>{globalThis.__holdAuto=false;globalThis.__releaseAuto();});await expect.poll(()=>app.evaluate(()=>globalThis.__autoFinished)).toBe(n+1);}
try{
 await launch();await open(source);await panel();assert(await tilt()>5.5);const original=await save('original'),neutral=hash((await frame()).file);
 for(const name of ['自动水平','自动垂直','自动联合']){
  await button(name).scrollIntoViewIfNeeded();await expect(button(name)).toBeInViewport({ratio:1});await settle(()=>button(name).click());await expect(button('取消自动透视')).toHaveCount(0);const angle=await tilt();assert(angle<.2);metrics.push({name,residualDegrees:angle});
  await expect(page.getByRole('checkbox',{name:'启用透视变换'})).toBeChecked();const after=hash((await frame()).file);assert.notEqual(after,neutral);await settle(()=>button('撤销').click());assert.equal(hash((await frame()).file),neutral);await settle(()=>button('重做').click());assert.equal(hash((await frame()).file),after);await settle(()=>button('撤销').click());
 }
 pass('three visible automatic modes straighten the actual displayed line below 0.2 degrees and each apply one undoable edit');
 await hold();const forbidden=join(out,'must-not-save.xmp');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});dialog.showMessageBox=async()=>({response:0});},forbidden);await page.keyboard.press('Meta+s');await expect(page.getByRole('alert')).toContainText('尚未完成');assert(!existsSync(forbidden));await button('关闭错误').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await expect(page.getByTestId('viewport')).toBeVisible();
 await page.keyboard.press('Escape');await expect(button('取消自动透视')).toHaveCount(0);await release();assert.deepEqual((await save('cancelled')).doc.adjustments,original.doc.adjustments);pass('pending real result is save/exit protected; Escape releases the transaction and rejects the delayed result');
 await hold();await settle(async()=>{await input('垂直透视').fill('10');await input('垂直透视').press('Tab');});await expect(button('取消自动透视')).toHaveCount(0);const manual=await save('manual');await release();assert.deepEqual((await save('after-late')).doc.adjustments,manual.doc.adjustments);await settle(()=>button('撤销').click());pass('manual editing cancels analysis and a late result cannot overwrite the new settings');
 await hold();await button('蒙版 M').click();await expect(button('取消自动透视')).toHaveCount(0);await release();await button('编辑').click();await ready();await panel();assert.deepEqual((await save('mode-cancel')).doc.adjustments,original.doc.adjustments);pass('leaving the edit tool cancels pending automatic correction');
 await hold();await open(blank);await release();await panel();const blankBefore=await save('blank-before');await button('自动联合').click();await expect(page.getByRole('alert')).toContainText('未找到足够可靠的直线',{timeout:120000});await button('关闭错误').click();assert.deepEqual((await save('blank-after')).doc.adjustments,blankBefore.doc.adjustments);pass('switching photos rejects the old result; no-line failure leaves the new document unchanged');
 await open(original.path);await panel();await settle(()=>button('自动联合').click());const final=await save('corrected');await page.screenshot({path:join(out,'auto-perspective-workbench.png')});await closeElectron(app);app=undefined;await launch();await open(final.path);await panel();assert.deepEqual((await save('reopened')).doc.adjustments,final.doc.adjustments);assert(await tilt()<.2);pass('a successful solve can be retried after failure and restores exact settings and corrected pixels from XMP');
 const output=join(out,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await button('导出').click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const old=resolve('/Users/he0xd4c0/Applications/CaptRAW-0.52.app/Contents/Resources/native'),oracle=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference-cache')});try{await oracle.call('export',{path:source,artProfile:final.doc.artProfile,format:'tiff',output:join(out,'reference.tiff')});}finally{await oracle.stop();}
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np,sys,json\na,b=[tifffile.imread(p) for p in sys.argv[1:3]]\nassert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)\nwith tifffile.TiffFile(sys.argv[1]) as x,tifffile.TiffFile(sys.argv[2]) as y: icc=x.pages[0].tags[34675].value;assert icc==y.pages[0].tags[34675].value\nopen(sys.argv[3],'w').write(json.dumps(dict(shape=list(a.shape),maximumDifference=0,iccBytes=len(icc))))`,output,join(out,'reference.tiff'),join(out,'pixels.json')]);pass('desktop solved-profile TIFF16 and ICC exactly match independent installed 0.52 output');
 await button('关闭导出结果').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));await panel();for(const name of ['自动水平','自动垂直','自动联合'])await expect(button(name)).toBeInViewport({ratio:1});await page.screenshot({path:join(out,'minimum-window.png')});await button('裁切 C').click();await expect(button('自动联合')).toBeDisabled();pass('automatic buttons fit the minimum window and are disabled during a canvas crop tool');
 assert.equal(hash(source),sourceHash);assert.deepEqual(errors,[]);
}catch(e){failure=e.stack;if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw e;}finally{if(app)await closeElectron(app);rmSync(join(out,'reference-cache'),{recursive:true,force:true});writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,checks,metrics,errors,failure,executablePath:process.env.CAPTRAW_APP||null,httpBlocked:true},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
