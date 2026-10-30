import assert from 'node:assert/strict';
import {expect as playwrightExpect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,statSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';

const expect=playwrightExpect.configure({timeout:15000}),expectLost=process.argv.includes('--expect-lost');
const executablePath=process.env.CAPTRAW_APP||(expectLost?join(homedir(),'Applications/CaptRAW-0.46.app/Contents/MacOS/CaptRAW'):undefined);
const resources=executablePath?resolve(dirname(executablePath),'../Resources'):resolve('build');
const fixture=resolve(process.env.CAPTRAW_OBJECT_START_FIXTURE||'artifacts/acceptance-0.46/geometry-settled/run-uEJOdE/4-edited.xmp');
const root=resolve(process.env.CAPTRAW_OBJECT_START_OUT||'artifacts/object-start-gui');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const documents=new Documents(new XMP(process.env.CAPTRAW_XMP_BINARY||(executablePath?join(resources,'native/captraw-xmp'):resolve('build/xmp/captraw-xmp'))));
const checks=[],errors=[],observations=[];let app,page,failure,diagnostics,ipc,dom,frames,windows,fixtureHash,sourceHash,stage='fixture';
const button=name=>page.getByRole('button',{name,exact:true});
const records=()=>app.evaluate(()=>globalThis.__objectStartRPC);
const evidence=()=>page.evaluate(()=>({dom:window.__objectStartDOM,frames:window.__objectStartFrames}));
const pass=name=>{checks.push(name);console.log('PASS',name);};
async function ready(){
 await page.waitForFunction(()=>{const f=window.__objectStartFrames.at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
try{
 assert(existsSync(fixture),'Prepare the fixed masked XMP fixture first');fixtureHash=hash(fixture);
 const doc=await documents.read(fixture);assert(doc.adjustments.masks.length>0&&doc.maskAssets.files.length>0);
 const original=doc.source.path,source=join(out,'source.png');sourceHash=hash(original);copyFileSync(original,source);
 for(const file of doc.maskAssets.files){const dest=join(out,file.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(dirname(fixture),file.path),dest);assert.equal(hash(dest),file.id);}
 doc.source={...doc.source,path:source,size:statSync(source).size,sha256:sourceHash};
 const path=join(out,'fixture.xmp');writeFileSync(path,await documents.serialize(doc));
 stage='launch';app=await electron.launch({executablePath});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.stack||String(e)));
 await app.evaluate(({ipcMain,session})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true}));
  const records=[];globalThis.__objectStartRPC=records;const gate={armed:false,held:[]};globalThis.__objectStartGate=gate;
  for(const channel of ['image:update','object:begin','object:predict','object:cancel']){
   const original=ipcMain._invokeHandlers.get(channel);if(typeof original!=='function')throw new Error(channel+' unavailable');
   ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{
    const row={channel,started:Date.now(),input};records.push(row);const hold=channel==='image:update'&&gate.armed;if(hold)gate.armed=false;
    try{const result=await original(event,input);row.completed=Date.now();row.result=result;if(hold)await new Promise(done=>gate.held.push(done));return result;}
    catch(e){row.completed=Date.now();row.error=String(e);throw e;}
   });
  }
 });
 await page.evaluate(()=>{
  window.__objectStartDOM=[];window.__objectStartFrames=[];
  const sample=(type,extra={})=>{const b=document.querySelector('button.object-create');window.__objectStartDOM.push({type,time:Date.now(),disabled:b?.disabled??null,rendering:!!document.querySelector('.rendering'),panel:!!document.querySelector('.object-selection'),...extra});};
  window.captraw.onEvent(e=>{if(e.event==='preview'&&e.frame.kind==='fit')window.__objectStartFrames.push({time:Date.now(),revision:e.frame.revision,url:e.frame.url,file:e.frame.file,maskId:e.frame.mask?.id});});
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','keydown','keyup'])document.addEventListener(type,e=>{
   const target=e.target.closest?.('button'),name=target?.getAttribute('aria-label')||target?.textContent.trim();
   if(name==='选择对象'||name==='蒙版 M')sample(type,{name,trusted:e.isTrusted,key:e.key,buttons:e.buttons,targetDisabled:target.disabled});
  },true);
  let previous='';new MutationObserver(()=>{const b=document.querySelector('button.object-create'),next=JSON.stringify([b?.disabled??null,!!document.querySelector('.rendering'),!!document.querySelector('.object-selection')]);if(next!==previous){previous=next;sample('state');}}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['disabled','class'],childList:true});
 });
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
 await button('打开').click();await ready();
 const before=await page.evaluate(()=>({revision:window.__objectStartFrames.at(-1).revision,events:window.__objectStartDOM.length}));
 stage='single-pointer-gesture';await button('蒙版 M').click();
 // Deliberately press during the real coverage debounce, before busy starts.
 // Do not use locator.click(): its complete gesture cannot expose this interval.
 const target=button('选择对象'),box=await target.boundingBox();assert(box,'Object entry must be visible');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 const down=await page.evaluate(()=>window.__objectStartDOM.filter(e=>e.type==='pointerdown'&&e.name==='选择对象').at(-1));
 assert(down?.trusted&&down.targetDisabled===false&&!down.rendering,'Single press must precede busy; this is a timing precondition, never retried');
 await page.waitForFunction(()=>!!document.querySelector('.rendering'),undefined,{polling:'raf',timeout:5000});
 const during=await target.evaluate(b=>({time:Date.now(),disabled:b.disabled,rendering:!!document.querySelector('.rendering')}));
 assert(during.rendering,'Real update must still be busy when the pointer is released');
 await page.mouse.up();
 const gesture=(await evidence()).dom.slice(before.events),up=gesture.find(e=>e.type==='pointerup'&&e.name==='选择对象');
 assert(up?.trusted&&up.rendering,'Release must be a trusted event while rendering, without a synthetic click');
 observations.push({kind:'gesture',down,during,up,gesture});
 await page.waitForFunction(revision=>window.__objectStartFrames.at(-1)?.revision>revision,before.revision);await ready();
 const updates=(await records()).filter(r=>r.channel==='image:update'&&r.input.revision>before.revision);
 assert(updates.length>0&&updates.some(r=>r.started>=down.time&&r.started<=up.time),'A real image:update must begin between pointerdown and pointerup');
 await page.screenshot({path:join(out,'after-gesture.png')});
 if(expectLost){
  assert.equal(during.disabled,true);assert.equal(up.targetDisabled,true);
  assert.equal(gesture.filter(e=>e.type==='click'&&e.name==='选择对象').length,0,'Browser must suppress the click on the now-disabled button');
  assert.equal((await records()).filter(r=>r.channel.startsWith('object:')).length,0);
  await expect(page.getByRole('region',{name:'对象选择'})).toHaveCount(0);await expect(target).toBeEnabled();
  pass('0.46 reproduced: enabled trusted pointerdown, real update disables entry, trusted pointerup produces no click or object IPC');
 }else{
  assert.equal(gesture.filter(e=>e.type==='click'&&e.name==='选择对象'&&e.trusted).length,1);
  await expect(page.getByRole('region',{name:'对象选择'})).toBeVisible();await expect(button('点选')).toBeEnabled({timeout:120000});
  assert.equal((await records()).filter(r=>r.channel==='object:begin').length,1);pass('single trusted click across preview busy starts one real object snapshot');
  await button('取消').click();await expect(page.getByRole('region',{name:'对象选择'})).toHaveCount(0);await ready();
  stage='keyboard-cancel';const beginCount=(await records()).filter(r=>r.channel==='object:begin').length;
  await app.evaluate(()=>{globalThis.__objectStartGate.armed=true;});
  await target.focus();await page.keyboard.press('Space');await expect(page.getByRole('region',{name:'对象选择'})).toBeVisible();
  await expect.poll(()=>app.evaluate(()=>globalThis.__objectStartGate.held.length)).toBe(1);
  await button('取消').click();await app.evaluate(()=>{for(const done of globalThis.__objectStartGate.held.splice(0))done();});
  await ready();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  assert.equal((await records()).filter(r=>r.channel==='object:begin').length,beginCount);
  await expect(page.getByRole('region',{name:'对象选择'})).toHaveCount(0);
  pass('Space starts preparation; cancelling before a held real update reply prevents late object creation');
  await target.focus();await page.keyboard.press('Enter');await expect(button('点选')).toBeEnabled({timeout:120000});
  assert.equal((await records()).filter(r=>r.channel==='object:begin').length,beginCount+1);
  pass('Enter starts a fresh snapshot after cancellation');await button('取消').click();await ready();
  stage='pending-exposure';await button('编辑').click();
  const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await expect(exposure).toBeVisible();
  await app.evaluate(()=>{globalThis.__objectStartGate.armed=true;});await exposure.fill('1.25');await exposure.press('Tab');
  await expect.poll(()=>app.evaluate(()=>globalThis.__objectStartGate.held.length)).toBe(1);
  await button('蒙版 M').click();await target.click();await expect(button('点选')).toBeEnabled({timeout:120000});
  const begun=(await records()).filter(r=>r.channel==='object:begin').at(-1);assert.equal(begun.input.adjustments.exposure,1.25);
  await app.evaluate(()=>{for(const done of globalThis.__objectStartGate.held.splice(0))done();});await ready();
  const userData=await app.evaluate(({app})=>app.getPath('userData')),preview=join(userData,'preview-cache');
  const cache=readdirSync(preview).map(n=>join(preview,n)).find(p=>existsSync(join(p,'objects')));assert(cache);
  const selections=readdirSync(join(cache,'objects'));assert.equal(selections.length,1);
  const input=join(cache,'objects',selections[0],'input.png'),latest=(await evidence()).frames.at(-1);assert.equal(hash(input),hash(latest.file));
  copyFileSync(input,join(out,'latest-exposure-snapshot.png'));observations.push({kind:'pending-exposure',inputSHA256:hash(input),previewSHA256:hash(latest.file),exposure:begun.input.adjustments.exposure});
  const bounds=await page.getByTestId('viewport').locator('#mask-image-bounds rect').boundingBox();assert(bounds);
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await expect(button('创建蒙版')).toBeEnabled({timeout:120000});
  pass('pending exposure uses the latest real rendered snapshot and delayed updates do not invalidate its model candidates');
  await button('取消').click();
 }
 assert.equal(hash(fixture),fixtureHash);assert.equal(hash(original),sourceHash);assert.equal(hash(source),sourceHash);assert.deepEqual(errors,[]);
 windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));
 assert(windows.length&&windows.every(w=>!w.visible&&!w.focused&&!w.focusable));stage='complete';
}catch(e){failure={stage,stack:e.stack||String(e),diagnostics:e.electronDiagnostics};if(e.electronScreenshot)writeFileSync(join(out,'launch-failure.png'),e.electronScreenshot);if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(error=>errors.push(String(error)));throw e;}
finally{
 if(app){diagnostics=electronDiagnostics(app);ipc=await records().catch(e=>{errors.push(String(e));});const captured=await evidence().catch(e=>{errors.push(String(e));});dom=captured?.dom;frames=captured?.frames;await closeElectron(app).catch(e=>{errors.push(String(e));process.exitCode=1;});}
 const report={status:failure||errors.length?'failed':expectLost?'reproduced':'passed',stage,expectLost,command:process.argv,executablePath,appSHA256:hash(executablePath?join(resources,'app.asar'):resolve('apps/desktop/dist/electron/main.cjs')),coreSHA256:hash(join(resources,'native/captraw-engine')),fixture,fixtureHash,sourceHash,checks,observations,errors,failure,windows,ipc,dom,frames,diagnostics,scope:'Single pointer gesture uses real timing without held replies or retries. Additional cases hold delivery of real update replies for cancellation and exposure races; no fabricated native results or React state mutation.'};
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('REPORT',join(out,'report.json'));
}
