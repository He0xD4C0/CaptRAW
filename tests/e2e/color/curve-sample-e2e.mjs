import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {mkdtempSync,copyFileSync,readFileSync,existsSync,rmSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Documents} from '@captraw/desktop-core/documents';import {XMP} from '@captraw/desktop-core/xmp';
import {EngineClient} from '../../support/engine-client.mjs';
const sourceName='曲线 照片 '+ '长文件名'.repeat(10)+'.tif';
const work=mkdtempSync(join(tmpdir(),'captraw-curve-sample-gui-')),source=join(work,sourceName),target=join(work,'另一张.tif');
const docs=new Documents(new XMP(resolve('build/xmp/captraw-xmp'))),sidecar=p=>p.replace(/\.tif$/,'.xmp');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let app,page,success=false;const checks=[];
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByRole('spinbutton',{name:'曲线输入',exact:true}),output=()=>page.getByRole('spinbutton',{name:'曲线输出',exact:true});
const photo=name=>page.locator('.film-open').filter({has:page.getByText(name,{exact:true})});
const circles=()=>page.locator('svg[aria-label="多点色调曲线"] circle');
const pass=s=>{checks.push(s);console.log('PASS',s);};
async function ready(){
 await page.waitForTimeout(140);
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__tatFrames?.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});
}
async function launch(){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'user-data'),OMP_NUM_THREADS:'2'}});page=await app.firstWindow();page.setDefaultTimeout(60000);
 await page.evaluate(()=>{window.__tatFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__tatFrames.push(e.frame);});});
 await app.evaluate(({BrowserWindow,app,dialog})=>{
  globalThis.__tatWindowEvents=[];const watch=w=>{for(const name of ['show','focus'])w.on(name,()=>globalThis.__tatWindowEvents.push(name));};BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
  dialog.showMessageBox=async()=>({response:1});
 });
}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);const n=await page.evaluate(()=>window.__tatFrames.length);await button('打开').click();await page.waitForFunction(n=>window.__tatFrames.length>n,n);await ready();}
async function patchPoint(x=640,y=550){
 const svg=page.getByTestId('viewport').locator('svg.mask-overlay'),b=await svg.boundingBox();assert(b);
 const r=await svg.locator('#mask-image-bounds rect').evaluate(e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(e.getAttribute(k))])));
 const rotated=await page.evaluate(()=>window.__tatFrames.filter(f=>f.kind==='fit').at(-1).fullWidth===1024);
 return {x:b.x+r.x+(rotated?(1023-y+.5)/1024:(x+.5)/1536)*r.width,y:b.y+r.y+(rotated?(x+.5)/1536:(y+.5)/1024)*r.height};
}
async function arm(){await button('曲线定点调整').scrollIntoViewIfNeeded();if(await button('曲线定点调整').getAttribute('aria-pressed')!=='true')await button('曲线定点调整').click();await expect(button('曲线定点调整')).toHaveAttribute('aria-pressed','true');}
async function toastLayout(){
 const running=page.getByRole('status',{name:'联动调整',exact:true}),done=page.locator('.job-toast.done');
 await expect(running).toBeVisible();await expect(done).toBeVisible();await expect(done.locator('details')).toHaveAttribute('open','');
 const layout=await page.evaluate(()=>{
  const running=document.querySelector('[aria-label="联动调整"]'),done=document.querySelector('.job-toast.done'),cancel=running?.querySelector('button');
  if(!running||!done||!cancel)throw new Error('Both real notifications must coexist');
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const r=cancel.getBoundingClientRect();return {running:rect(running),done:rect(done),cancel:rect(cancel),width:innerWidth,height:innerHeight,
   hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===cancel};
 });
 const a=layout.running,b=layout.done;
 assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Notification rectangles overlap');
 for(const key of ['running','done','cancel']){const r=layout[key];assert(r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.x+r.width<=layout.width+.5&&r.y+r.height<=layout.height+.5,key+' must be fully in viewport');}
 assert(layout.hit,'The real cancel button must receive pointer events');return layout;
}
async function pick(x=640,y=550,checkToasts=false){await arm();const p=await patchPoint(x,y);await page.mouse.click(p.x,p.y);if(checkToasts)await toastLayout();await expect(input()).toBeEnabled();await expect(button('取消取样')).toHaveCount(0,{timeout:120000});await expect(button('曲线定点调整')).toBeEnabled();}
async function channel(name){await page.getByRole('group',{name:'曲线通道'}).getByRole('button',{name,exact:true}).click();}
async function save(predicate,path=source){
 await button('保存').click();await expect.poll(async()=>{if(!existsSync(sidecar(path)))return false;return predicate((await docs.read(sidecar(path))).adjustments);},{timeout:30000}).toBe(true);await ready();return docs.read(sidecar(path));
}
async function hidden(){assert((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable()))));assert.deepEqual(await app.evaluate(()=>globalThis.__tatWindowEvents),[]);}
try{
 copyFileSync('artifacts/stage-0/acr-reference/tat-interaction-187/inputs/controlled-tat.tif',source);copyFileSync(source,target);const original=hash(source);
 await launch();await open(source);await button('曲线定点调整').scrollIntoViewIfNeeded();await expect(button('曲线定点调整')).toBeVisible();await expect(circles()).toHaveCount(2);
 const pixels=await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL());
 await button('曲线定点调整').click();await pick();await expect(input()).toHaveValue('166');await expect(output()).toHaveValue('166');await expect(circles()).toHaveCount(3);await ready();
 assert.equal(await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL()),pixels);pass('visible photo click inserts native input166 on the unchanged current curve');
 await pick();await expect(circles()).toHaveCount(3);await button('撤销').click();await expect(circles()).toHaveCount(2);await expect(button('撤销')).toBeDisabled();await ready();await button('重做').click();await expect(circles()).toHaveCount(3);await ready();pass('reselect creates no history; insertion undoes/redoes in exactly one step');
 await output().fill('201');await output().press('Enter');await ready();await pick();await expect(input()).toHaveValue('166');await expect(output()).toHaveValue('201');await expect(circles()).toHaveCount(3);pass('reselect preserves current smooth curve output201');
 for(const name of ['红','绿','蓝']){await channel(name);await pick();await expect(input()).toHaveValue('201');await expect(circles()).toHaveCount(3);await ready();}pass('RGB channel sampling sees the preceding main curve through actual controls');
 const saved=await save(a=>a.curve.length===3&&Math.abs(a.curve[1].y-201/255)<1e-6&&a.redCurve.length===3&&a.greenCurve.length===3&&a.blueCurve.length===3);await hidden();await closeElectron(app);app=undefined;
 await launch();await open(source);await button('曲线定点调整').scrollIntoViewIfNeeded();await button('曲线定点调整').click();await pick();await expect(input()).toHaveValue('166');await expect(output()).toHaveValue('201');await expect(circles()).toHaveCount(3);pass('SDK XMP save and full App restart restore curve and point selection');
 await button('1:1').click();await page.waitForTimeout(150);await pick();await expect(input()).toHaveValue('166');await expect(circles()).toHaveCount(3);await button('适屏').click();
 await page.keyboard.press('r');await ready();await pick();await expect(input()).toHaveValue('166');await expect(output()).toHaveValue('201');await expect(circles()).toHaveCount(3);
 await page.keyboard.press('l');await ready();pass('real 1:1 and coarse-rotated viewport clicks retain the same native curve location');
 const out=join(work,'曲线 输出.tif');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},out);await button('导出').click();await page.getByRole('dialog',{name:'导出设置'}).getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toContainText('已导出',{timeout:120000});
 const core=new EngineClient({cache:join(work,'oracle'),env:{OMP_NUM_THREADS:'2'}}),reference=join(work,'reference.tif');try{await core.call('export',{path:source,artProfile:saved.artProfile,output:reference,format:'tiff',colorSpace:'srgb'});}finally{await core.stop();}
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',"import tifffile,numpy as np,sys\na=[]\nfor p in sys.argv[1:]:\n with tifffile.TiffFile(p) as f:\n  assert f.pages[0].dtype.name=='uint16' and len(f.pages[0].tags[34675].value)>128;a.append(f.asarray())\nassert np.array_equal(*a)",out,reference]);pass('actual TIFF16/ICC export matches independent snapshot output');
 await open(target);await button('曲线定点调整').scrollIntoViewIfNeeded();if(await button('曲线定点调整').getAttribute('aria-pressed')!=='true')await button('曲线定点调整').click();
 let p=await patchPoint();await page.mouse.click(p.x,p.y);await page.keyboard.press('Escape');await expect(button('取消取样')).toHaveCount(0);await page.waitForTimeout(500);await expect(circles()).toHaveCount(2);pass('Esc cancels an actual cold sampler without committing a late point');
 if(await button('曲线定点调整').getAttribute('aria-pressed')!=='true')await button('曲线定点调整').click();p=await patchPoint();await page.mouse.click(p.x,p.y);await photo(sourceName).click();await ready();await page.waitForTimeout(500);
 await photo('另一张.tif').click();await ready();await expect(circles()).toHaveCount(2);pass('switching photo cancels and cannot submit the old result');
 await photo(sourceName).click();await ready();await channel('RGB');
 if(await button('曲线定点调整').getAttribute('aria-pressed')!=='true')await button('曲线定点调整').click();
 await photo('另一张.tif').click({modifiers:['Meta']});await pick();await expect(circles()).toHaveCount(3);
 // The source already has166. Selecting it must not copy its curve to the target.
 await photo('另一张.tif').click();await ready();await expect(circles()).toHaveCount(2);
 await save(a=>a.curve.length===2,target);await photo(sourceName).click();await ready();await photo('另一张.tif').click({modifiers:['Meta']});
 // Produce real expandable results through the visible batch export flow.
 // The previous export is never dismissed to make a cancellation test pass.
 const batchDirectory=join(work,'保留展开的旧导出结果 '+ '长目录名 '.repeat(5));mkdirSync(batchDirectory);
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},batchDirectory);
 await button('导出').click();await page.getByRole('dialog',{name:'导出设置'}).getByRole('button',{name:'TIFF · 16 位'}).click();
 await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});await page.locator('.job-toast.done summary').click();
 await expect(page.locator('.job-toast.done details')).toHaveAttribute('open','');await expect(page.locator('.job-toast.done .export-results li')).toHaveCount(2);
 await pick(384,550,true);await expect(input()).toHaveValue('76');await expect(circles()).toHaveCount(4);await ready();
 const multi=await save(a=>a.curve.length===4);await photo('另一张.tif').click();await ready();await expect(circles()).toHaveCount(4);
 const copied=await save(a=>a.curve.length===4,target);assert.deepEqual(copied.adjustments.curve,multi.adjustments.curve);pass('frozen visible multi-target insertion copies one sampled fixed curve; existing-point selection is zero-edit');
 await photo(sourceName).click();await ready();await photo('另一张.tif').click({modifiers:['Meta']});await button('撤销').click();await ready();await expect(circles()).toHaveCount(3);
 await save(a=>a.curve.length===3);await photo('另一张.tif').click();await ready();await expect(circles()).toHaveCount(2);await save(a=>a.curve.length===2,target);pass('one shared operation undoes each participating photo to its different original curve');
 await photo(sourceName).click();await ready();await photo('另一张.tif').click({modifiers:['Meta']});
 await arm();
 const backup=join(work,'missing-target.tif');renameSync(target,backup);
 try{p=await patchPoint(384,550);await page.mouse.click(p.x,p.y);await expect(button('取消取样')).toHaveCount(0,{timeout:120000});await expect(page.getByText(/原片已变化|无法读取/).first()).toBeVisible();await expect(circles()).toHaveCount(3);}finally{renameSync(backup,target);}
 await save(a=>a.curve.length===3);pass('missing participant fails the whole prepared batch without editing the source');
 const minimum=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1080,720,false);return {bounds:w.getBounds(),visible:w.isVisible(),focused:w.isFocused()};});
 assert.equal(minimum.bounds.width,1080);assert.equal(minimum.bounds.height,720);assert(!minimum.visible&&!minimum.focused);await page.waitForTimeout(150);await arm();
 await expect(page.locator('.job-toast.done details')).toHaveAttribute('open','');
 p=await patchPoint(896,970);assert(!await page.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('.job-toast'),p),'The initiating photo click must reach the image');
 await page.mouse.click(p.x,p.y);const minimumLayout=await toastLayout();console.log('minimum toast bounds',JSON.stringify(minimumLayout));
 await button('取消联动').click();await expect(button('取消取样')).toHaveCount(0,{timeout:120000});await ready();await expect(circles()).toHaveCount(3);
 await expect(page.locator('.job-toast.done details')).toHaveAttribute('open','');await expect(page.locator('.job-toast.done .export-results li')).toHaveCount(2);
 await photo('另一张.tif').click();await ready();await expect(circles()).toHaveCount(2);pass('cancel during actual batch preparation commits neither participant');
 await hidden();assert.equal(hash(source),original);assert.equal(hash(target),original);success=true;console.log(JSON.stringify({checks:checks.length,hidden:true,sourceUnchanged:true}));
}catch(error){writeFileSync(join(work,'failure.txt'),String(error.stack||error));writeFileSync(join(work,'checks.json'),JSON.stringify(checks));throw error;}
finally{
 if(app){if(!success){writeFileSync(join(work,'diagnostics.json'),JSON.stringify(electronDiagnostics(app),null,2));await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});}await closeElectron(app);}
 if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);
}
