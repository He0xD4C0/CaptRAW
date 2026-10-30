import assert from 'node:assert/strict';
import {expect as playwrightExpect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {ENGINE_VERSION} from '@captraw/contracts';
import {mkdirSync,mkdtempSync,copyFileSync,existsSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const expect=playwrightExpect.configure({timeout:30000});
const root=resolve(process.env.CAPTRAW_VIEWPORT_LIFECYCLE_OUT||'artifacts/viewport-lifecycle-gui');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),source=join(out,'first.png'),other=join(out,'second.png'),third=join(out,'third.png'),recipe=join(out,'original.xmp');
const fixture=[process.env.CAPTRAW_VIEWPORT_LIFECYCLE_IMAGE,'artifacts/mask-reference-verified/source.png','artifacts/coordinates/target.png'].filter(Boolean).map(p=>resolve(p)).find(existsSync);
assert(fixture,'An existing PNG fixture is required');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),fixtureHash=hash(fixture);
for(const path of [source,other,third])copyFileSync(fixture,path);
const checks=[],errors=[];let app,page,core,failure,stage='fixture',trace,events,diagnostics;
const pass=name=>{checks.push(name);console.log('PASS',name);};
const fitCount=()=>page.evaluate(()=>window.__lifecycleEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').length);
async function ready(){
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__lifecycleEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.url);
 await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});
}
async function openClick(path){
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
 await page.getByRole('button',{name:'打开',exact:true}).click();
}
async function open(path){const n=await fitCount();await openClick(path);await expect.poll(fitCount).toBeGreaterThan(n);await ready();}
async function exposure(value){const input=page.getByRole('spinbutton',{name:'曝光',exact:true});await expect(input).toBeVisible();await input.fill(String(value));await input.press('Tab');}
async function editable(value){
 const before=await page.locator('canvas').evaluate(c=>c.toDataURL()),n=await fitCount();
 await exposure(value);await expect.poll(fitCount).toBeGreaterThan(n);await ready();
 assert.notEqual(await page.locator('canvas').evaluate(c=>c.toDataURL()),before,'Editing must change displayed pixels');
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function arm(rules){return app.evaluate((_,rules)=>{const s=globalThis.__lifecycle;s.rules.push(...rules);return s.records.length;},rules);}
async function record(index){return app.evaluate((_,index)=>globalThis.__lifecycle.records[index],index);}
async function waitRecord(index,key){await expect.poll(async()=>(await record(index))?.[key]).toBeTruthy();}
async function watch(){await page.evaluate(()=>{window.__lifecycleAlerts=[];});}
async function quiet(){
 // Give the IPC rejection and React effects time to run. The observer also
 // catches a transient alert that a later render might otherwise clear.
 await page.waitForTimeout(250);await expect(page.getByRole('alert')).toHaveCount(0);
 assert.deepEqual(await page.evaluate(()=>window.__lifecycleAlerts),[]);
}
async function releaseError(index){
 await waitRecord(index,'error');await app.evaluate((_,index)=>globalThis.__lifecycle.errors.get(index)(),index);
 await waitRecord(index,'delivered');
}
async function viewportRequest(rule){
 const items=page.locator('.film-item'),count=await items.count();
 if(count>1){
  // Reopen through another document so a valid detailed-frame cache from an
  // earlier scenario cannot hide the transport path under test.
  const activeIndex=await items.evaluateAll(nodes=>nodes.findIndex(node=>node.classList.contains('active')));
  const otherIndex=activeIndex===0?1:0;
  await items.nth(otherIndex).locator('.film-open').click();await ready();
  await items.nth(activeIndex).locator('.film-open').click();await ready();
 }
 await page.getByRole('button',{name:'适屏',exact:true}).click();await ready();
 const index=await arm([{method:'viewport',...rule}]);
 await page.getByRole('button',{name:'1:1',exact:true}).click();await waitRecord(index,'written');return index;
}

try{
 core=new EngineClient({cache:join(out,'fixture-cache')});core.on('error',e=>errors.push(String(e)));
 const image=await core.call('open',{path:source,sessionId:'fixture'});
 const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
 writeFileSync(recipe,await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:statSync(source).size,sha256:hash(source)},adjustments:image.adjustments,artProfile:image.artProfile}));
 await core.stop();core=undefined;
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{
  window.__lifecycleEvents=[];window.__lifecycleAlerts=[];
  window.captraw.onEvent(e=>window.__lifecycleEvents.push(e));
  new MutationObserver(()=>{for(const e of document.querySelectorAll('[role="alert"]'))if(e.textContent)window.__lifecycleAlerts.push(e.textContent);}).observe(document.body,{subtree:true,childList:true,characterData:true});
 });
 await app.evaluate(({ipcMain})=>{
  const state={rules:[],records:[],errors:new Map(),writes:new Map()};globalThis.__lifecycle=state;
  for(const method of ['viewport','update']){
   const channel='image:'+method,original=ipcMain._invokeHandlers.get(channel);
   if(typeof original!=='function')throw new Error(channel+' handler unavailable');
   ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{
    const rule=state.rules[0];if(!rule||rule.method!==method)return original(event,input);
    state.rules.shift();
    const children=process._getActiveHandles().filter(h=>h.spawnargs?.[0]?.endsWith('/captraw-engine')&&!h.killed&&h.exitCode===null);
    if(children.length!==1)throw new Error('Expected exactly one active image core, got '+children.length);
    const child=children[0],stream=child.stdin,write=stream.write,index=state.records.length;
    const row={method,mode:rule.mode,sessionId:input.sessionId,revision:input.revision,pid:child.pid,written:false};state.records.push(row);
    // NativeEngine has registered the pending promise before stdin.write. Hold
    // that actual transport write until replacement kills the old core. The
    // error below is the real NativeEngine SIGTERM rejection, never fabricated.
    stream.write=function(chunk,...args){
     let message;try{message=JSON.parse(String(chunk));}catch{return write.call(this,chunk,...args);}
     if(message.method!==method)return write.call(this,chunk,...args);
     stream.write=write;row.written=true;row.rpcId=message.id;
     if(rule.mode==='invalid'){
      // Exercise a genuine native JSON type error in the current viewport.
      message.params.width='invalid-native-width';return write.call(this,JSON.stringify(message)+'\n',...args);
     }
     state.writes.set(index,()=>{state.writes.delete(index);row.sent=true;write.call(stream,chunk,...args);});return true;
    };
    try{return await original(event,input);}
    catch(error){
     row.error=String(error);row.signal=child.signalCode;
     await new Promise(resolve=>state.errors.set(index,()=>{state.errors.delete(index);resolve();}));
     row.delivered=true;throw error;
    }finally{if(stream.write!==write)stream.write=write;}
   });
  }
 });

 stage='viewport replacement';await open(recipe);
 let index=await viewportRequest({mode:'pending-exit'});await open(other);await waitRecord(index,'error');
 assert.match((await record(index)).error,/SIGTERM/);assert.equal((await record(index)).signal,'SIGTERM');
 await watch();await releaseError(index);await quiet();await page.screenshot({path:join(out,'other-after-old-viewport.png')});await editable(.35);
 pass('GUI 1:1 pending viewport rejects with real SIGTERM after opening another image; no stale alert and editing works');
 stage='ACR document selection shortcuts';
 await page.keyboard.press('Meta+a');await expect(page.locator('.film-item.selected')).toHaveCount(2);
 await page.keyboard.press('Meta+Shift+A');await expect(page.locator('.film-item.selected')).toHaveCount(1);
 await expect(page.locator('.film-item.active.selected')).toHaveCount(1);
 await page.keyboard.press('Meta+a');await expect(page.locator('.film-item.selected')).toHaveCount(2);
 await page.keyboard.press('Meta+d');await expect(page.locator('.film-item.selected')).toHaveCount(1);
 pass('ACR select-only-current shortcuts leave the active image selected through visible filmstrip state');

 stage='original XMP reopen';index=await viewportRequest({mode:'pending-exit'});await open(recipe);await waitRecord(index,'error');
 assert.match((await record(index)).error,/SIGTERM/);await watch();await releaseError(index);await quiet();
 await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue(String(image.adjustments.exposure));
 await page.screenshot({path:join(out,'recipe-restored.png')});await editable(.55);
 pass('reopening original XMP restores its values and remains editable after the old viewport rejection');

 stage='late update and busy';
 index=await arm([{method:'update',mode:'pending-exit'}]);
 await exposure(.8);await waitRecord(index,'written');await open(third);await waitRecord(index,'error');
 // Finish opening before holding the next update: otherwise opening=true
 // would conceal an incorrect setBusy(false) from the old rejection.
 assert.equal(await arm([{method:'update',mode:'pending-success'}]),index+1);
 await exposure(.2);await waitRecord(index+1,'written');
 assert.match((await record(index)).error,/SIGTERM/);assert.notEqual((await record(index)).sessionId,(await record(index+1)).sessionId);
 await expect(page.locator('.rendering')).toBeVisible();await watch();await releaseError(index);await quiet();
 await expect(page.locator('.rendering')).toBeVisible();
 await app.evaluate((_,index)=>globalThis.__lifecycle.writes.get(index)(),index+1);await ready();await editable(.45);
 pass('old update SIGTERM rejection cannot clear the new document busy state or show a stale error');

 stage='same session revision';index=await viewportRequest({mode:'invalid'});await waitRecord(index,'error');
 assert.match((await record(index)).error,/type_error|number/i);await editable(.7);await watch();await releaseError(index);await quiet();
 pass('a genuine native viewport error from an older revision is ignored within the same session');

 stage='current viewport error';index=await viewportRequest({mode:'invalid'});await waitRecord(index,'error');
 assert.match((await record(index)).error,/type_error|number/i);await releaseError(index);
 await expect(page.getByRole('alert')).toContainText('type_error');
 await page.screenshot({path:join(out,'current-native-error.png')});
 await page.getByRole('button',{name:'关闭错误',exact:true}).click();
 await page.getByRole('button',{name:'适屏',exact:true}).click();await editable(.95);
 pass('current viewport native failure is visibly reported and a subsequent edit recovers');

 stage='ACR view shortcuts';
 await page.getByRole('button',{name:'适屏',exact:true}).click();await ready();
 await page.keyboard.press('Meta+Alt+0');
 await expect(page.getByRole('button',{name:'1:1',exact:true})).toHaveClass(/active/);
 await page.waitForFunction(()=>window.__lifecycleEvents.filter(e=>e.event==='preview'&&e.frame.kind==='detail').length>0);
 await page.waitForFunction(()=>{const frame=window.__lifecycleEvents.filter(e=>e.event==='preview'&&e.frame.kind==='detail').at(-1)?.frame;return frame&&document.querySelector('canvas')?.dataset.detail===frame.url;});
 await page.keyboard.press('Meta+0');await ready();
 await expect(page.getByRole('button',{name:'适屏',exact:true})).toHaveClass(/active/);
 const fitZoom=await page.getByLabel('缩放比例').innerText();
 await page.keyboard.press('Meta+=');
 await expect.poll(()=>page.getByLabel('缩放比例').innerText()).not.toBe(fitZoom);
 await page.keyboard.press('Meta+-');
 await expect.poll(()=>page.getByLabel('缩放比例').innerText()).toBe(fitZoom);
 pass('ACR view shortcuts fit, show native 1:1 pixels and step zoom from the visible canvas controls');

 assert.equal(hash(fixture),fixtureHash);for(const path of [source,other,third])assert.equal(hash(path),fixtureHash);
 events=await page.evaluate(()=>window.__lifecycleEvents);assert.deepEqual(events.filter(e=>e.event==='error'),[],'Old core errors are filtered in main; the test must exercise IPC rejection independently');
 assert.deepEqual(errors,[]);stage='complete';
}catch(error){failure=error;console.error(error);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});}
finally{
 if(core)await core.stop().catch(()=>{});
 if(app){
  trace=await app.evaluate(()=>globalThis.__lifecycle?.records).catch(()=>undefined);
  events=await page.evaluate(()=>window.__lifecycleEvents).catch(()=>events);diagnostics=electronDiagnostics(app);
  await closeElectron(app).catch(error=>{errors.push(String(error));failure??=error;});
 }
 writeFileSync(join(out,'report.json'),JSON.stringify({status:failure?'failed':'passed',stage,checks,errors,error:failure?.stack,trace,events,diagnostics,backgroundWindow:true,binaries:{app:process.env.CAPTRAW_APP||'dev',engine:process.env.CAPTRAW_ENGINE,resources:process.env.CAPTRAW_RESOURCES,xmp:process.env.CAPTRAW_XMP_BINARY}},null,2)+'\n');
 console.log('Report:',join(out,'report.json'));if(failure)process.exitCode=1;
}
