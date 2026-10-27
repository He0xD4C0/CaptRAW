import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {ENGINE_VERSION} from '@captraw/contracts';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,statSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const rotation=Number(process.env.CAPTRAW_MASK_INTERACTION_ROTATION||'0');
assert([0,90,180,270].includes(rotation),'CAPTRAW_MASK_INTERACTION_ROTATION must be 0, 90, 180 or 270');
assert(['0','1'].includes(process.env.CAPTRAW_MASK_INTERACTION_CROP||'0'),'CAPTRAW_MASK_INTERACTION_CROP must be 0 or 1');
const crop=process.env.CAPTRAW_MASK_INTERACTION_CROP==='1'?{x:.08,y:.08,width:.84,height:.84}:null;
const root=resolve(process.env.CAPTRAW_MASK_INTERACTION_OUT||'artifacts/mask-interaction-gui');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),source=join(out,'interaction.png'),other=join(out,'other.png');
const fixture=[process.env.CAPTRAW_MASK_INTERACTION_IMAGE,'artifacts/mask-reference-verified/source.png','artifacts/coordinates/target.png'].filter(Boolean).map(p=>resolve(p)).find(existsSync);
assert(fixture,'Generate mask-reference-verified or coordinates fixtures first');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),fixtureHash=hash(fixture);
// Keep all generated assets private to this run. Supply real Lensfun metadata.
execFileSync(resolve('build/qa-venv/bin/python'),['-c',String.raw`
from PIL import Image,TiffImagePlugin
import sys
im=Image.open(sys.argv[1]).convert('RGB');exif=Image.Exif()
exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
im.save(sys.argv[2],exif=exif)
`,fixture,source]);copyFileSync(source,other);
const sourceHash=hash(source),documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const core=new EngineClient({cache:join(out,'oracle')}),checks=[],metrics=[],errors=[];
core.on('error',e=>errors.push('native: '+e.message));
let app,page,passed=false,revision=0,sequence=0,canvasDimensions;
const pass=name=>{checks.push(name);console.log('PASS',name);};
function section(profile,name,body){const start=profile.indexOf('['+name+']');assert(start>=0,name);const end=profile.indexOf('\n[',start);return profile.slice(0,start)+`[${name}]\n${body}\n`+(end<0?'':profile.slice(end));}
const leaf=(id,type)=>({id,name:id,type,enabled:true,inverted:false,initialized:true,referenceAngle:7,feather:0,points:[],start:{x:.37,y:.33},end:{x:.64,y:.64},operation:'add'});
const group=(id,type)=>({...leaf(id,type),brightness:.8,contrast:0,saturation:0,components:[leaf(id+' leaf',type)]});
const leafOf=(doc,id)=>doc.adjustments.masks.find(m=>m.id===id).components[0];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
// Independent inverse of recipe.cc's normalized coarse rotation. RPC points
// are in the rotated full canvas, whereas saved mask geometry is canonical.
function canonical(point,W,H){
 const x=point.x/W,y=point.y/H;
 switch(rotation){case 90:return {x:y,y:1-x};case 180:return {x:1-x,y:1-y};case 270:return {x:1-y,y:x};default:return {x,y};}
}
async function oracle(points,from='display',to='reference'){
 const result=await core.call('coordinates',{sessionId:'oracle',revision,from,to,referenceAngle:7,points});
 assert(result.points.every(Boolean),'Oracle inverse must exist');return result.points;
}
const viewport=()=>page.getByTestId('viewport');
const undo=()=>page.getByRole('button',{name:'撤销',exact:true}),redo=()=>page.getByRole('button',{name:'重做',exact:true});
async function frames(){return page.evaluate(()=>window.__maskFrames.length);}
async function ready(){
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__maskFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url;});
 await page.locator('.mask-gesture-status').waitFor({state:'hidden'});
 // Drain the existing 90 ms selection/overlay debounce, not a render substitute.
 await page.waitForTimeout(160);await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__maskFrames.filter(f=>f.kind==='fit').at(-1)?.url);
}
async function settle(action){const n=await frames();await action();await page.waitForFunction(n=>window.__maskFrames.length>n,n);await ready();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(label){
 const path=join(out,`${++sequence}-${label}.xmp`);
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();return documents.read(path);
}
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex');
async function choose(id){await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await page.getByRole('button',{name:id,exact:true}).click();await ready();}
async function imageRect(){
 await expect(viewport()).toBeVisible();
 const box=await viewport().locator('svg.mask-overlay').boundingBox();assert(box);
 const r=await viewport().locator('#mask-image-bounds rect').evaluate(e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(e.getAttribute(k))])));
 // The SVG clipping rectangle is the visible crop, not the complete canvas.
 // This crop is symmetric and therefore unchanged by all four coarse turns.
 const c=crop||{x:0,y:0,width:1,height:1},width=r.width/c.width,height=r.height/c.height;
 assert(width>0&&height>0);return {x:box.x+r.x-c.x*width,y:box.y+r.y-c.y*height,width,height};
}
async function screenPoint(p){const r=await imageRect();const q={x:r.x+p.x*r.width,y:r.y+p.y*r.height};await assertVisiblePoint(q);return q;}
async function assertVisiblePoint(p){assert(await viewport().evaluate((element,p)=>{const hit=document.elementFromPoint(p.x,p.y);return !!hit&&element.contains(hit);},p),'Pointer must hit the visible viewport');}
async function handlePoint(name){const h=page.getByTestId(`mask-${name}-handle`);await expect(h).toBeVisible();const b=await h.boundingBox();assert(b);const q={x:b.x+b.width/2,y:b.y+b.height/2};await assertVisiblePoint(q);return q;}
async function displayPixel(q){const r=await imageRect();const f=await page.evaluate(()=>window.__maskFrames.filter(f=>f.kind==='fit').at(-1));return {x:(q.x-r.x)/r.width*f.fullWidth,y:(q.y-r.y)/r.height*f.fullHeight};}
async function logReset(){await app.evaluate(()=>{globalThis.__maskRPC.records=[];});}
async function records(){return app.evaluate(()=>globalThis.__maskRPC.records);}
async function drag(a,b,fast=false){
 await assertVisiblePoint(a);await assertVisiblePoint(b);await page.mouse.move(a.x,a.y);await page.mouse.down();
 if(fast){
  // A real down establishes pointer capture. Deliberately omit the final move.
  await viewport().evaluate((element,p)=>element.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:p.x,clientY:p.y})),b);
 }else await page.mouse.move(b.x,b.y,{steps:9});
 await page.mouse.up();
}
async function verifyStroke(doc,oldCount,erase,expectedFirst,expectedLast,W,H){
 const rows=(await records()).filter(r=>r.from==='display'),input=rows.flatMap(r=>r.points);assert(input.length>2);
 assert(distance(input[0],expectedFirst)<1);assert(distance(input.at(-1),expectedLast)<1,'Final pointerup position must be sampled');
 const output=[];for(let i=0;i<input.length;i+=4096)output.push(...await oracle(input.slice(i,i+4096)));
 const saved=leafOf(doc,'Brush').points.slice(oldCount);assert.equal(saved.length,input.length);
 const canonicalWidth=rotation%180?H:W,canonicalHeight=rotation%180?W:H;
 let max=0;for(let i=0;i<saved.length;i++){
  assert.equal(saved[i].erase,erase);const expected=canonical(output[i],W,H);
  max=Math.max(max,Math.hypot((saved[i].x-expected.x)*canonicalWidth,(saved[i].y-expected.y)*canonicalHeight));
 }
 assert(max<.02,`Saved stroke error ${max}`);assert.equal(leafOf(doc,'Brush').referenceAngle,7);
 metrics.push({kind:erase?'erase':'brush',samples:saved.length,maxReferencePixelError:max});
}
async function undoRedo(before,after,beforePixels,afterPixels){
 await settle(()=>undo().click());assert.equal(await pixels(),beforePixels);assert.deepEqual((await save('undo')).adjustments.masks,before.adjustments.masks);
 await settle(()=>redo().click());assert.equal(await pixels(),afterPixels);assert.deepEqual((await save('redo')).adjustments.masks,after.adjustments.masks);
}
async function arm(mode){await app.evaluate((_,mode)=>{globalThis.__maskRPC.mode=mode;},mode);}
async function held(){await expect.poll(()=>app.evaluate(()=>globalThis.__maskRPC.held.length)).toBe(1);}
async function release(){await app.evaluate(()=>{const r=globalThis.__maskRPC;for(const resolve of r.held.splice(0))resolve();});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}

try{
 const image=await core.call('open',{path:source,sessionId:'oracle'});
 let profile=section(image.artProfile,'Rotation','Enabled=true\nDegree=23\nCaptRAWMaskCoordinates=true\nCaptRAWMaskReferenceDegree=7');
 profile=section(profile,'Common Properties for Transformations','AutoFill=true');
 profile=section(profile,'Perspective','Enabled=true\nHorizontal=25\nVertical=-15\nAngle=2\nShear=3\nFocalLength=10\nCropFactor=1.5\nAspect=1\nControlLines=');
 const adjustments={...image.adjustments,rotation,crop,lensCorrections:true,lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true},masks:[group('Brush','brush'),group('Radial','radial')]};
 const waiting=core.preview(++revision,'fit',120000),result=await core.call('update',{revision,artProfile:profile,adjustments}),frame=await waiting;
 const W=frame.fullWidth,H=frame.fullHeight;canvasDimensions={width:W,height:H};
 assert.equal(W,rotation%180?image.height:image.width);assert.equal(H,rotation%180?image.width:image.height);
 assert(result.lensStatus.distortion&&result.lensStatus.ca,'Fixture must exercise actual lens correction');profile=result.artProfile;
 const makeDoc=path=>({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path,size:statSync(path).size,sha256:hash(path)},adjustments,artProfile:profile});
 const initial=makeDoc(source),file=join(out,'fixture.xmp'),otherFile=join(out,'other.xmp');
 writeFileSync(file,await documents.serialize(initial));writeFileSync(otherFile,await documents.serialize(makeDoc(other)));
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__maskFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__maskFrames.push(e.frame);});});
 // Context-bridge objects are frozen. Wrap the actual main-process RPC handler
 // instead, always obtain the native result first, then hold its delivery.
 await app.evaluate(({ipcMain})=>{
  const original=ipcMain._invokeHandlers.get('image:coordinates');if(typeof original!=='function')throw new Error('Coordinates handler unavailable');
  const state={mode:'',held:[],records:[],dirty:[],updates:[]};globalThis.__maskRPC=state;
  for(const channel of ['documents:dirty','image:update']){
   const handler=ipcMain._invokeHandlers.get(channel);if(typeof handler!=='function')throw new Error(channel+' unavailable');
   ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{
    if(channel==='documents:dirty')state.dirty=[...input];else state.updates.push({sessionId:input.sessionId,revision:input.revision});
    return handler(event,input);
   });
  }
  ipcMain.removeHandler('image:coordinates');ipcMain.handle('image:coordinates',async(event,input)=>{
   const mode=state.mode,hold=mode==='hold'&&input.from==='display',fail=mode==='guide-failure'&&input.from==='reference';
   if(hold||fail)state.mode='';
   const result=await original(event,input);state.records.push({...input,result});
   if(hold)await new Promise(resolve=>state.held.push(resolve));
   if(fail)throw new Error('E2E guide mapping failure after native result');return result;
  });
 });
 await open(file);await choose('Brush');await expect(undo()).toBeDisabled();
 const displayed=await page.evaluate(()=>window.__maskFrames.filter(f=>f.kind==='fit').at(-1));
 assert.equal(displayed.fullWidth,W);assert.equal(displayed.fullHeight,H);
 const before=await save('initial'),beforePixels=await pixels();
 const a=await screenPoint({x:.35,y:.43}),b=await screenPoint({x:.65,y:.54});
 const aPixel=await displayPixel(a),bPixel=await displayPixel(b);await logReset();
 await settle(()=>drag(a,b));const brushed=await save('brush'),brushPixels=await pixels();assert.notEqual(brushPixels,beforePixels);
 await verifyStroke(brushed,0,false,aPixel,bPixel,W,H);await undoRedo(before,brushed,beforePixels,brushPixels);
 await settle(()=>undo().click());await expect(undo()).toBeDisabled();await settle(()=>redo().click());
 pass('visible brush samples match independent native coordinates; pixels change and one undo removes the entire stroke');

 await page.getByRole('button',{name:'蒙版橡皮擦',exact:true}).click();await ready();
 const ea=await screenPoint({x:.43,y:.4593333333333333}),eb=await screenPoint({x:.56,y:.507});
 await logReset();await settle(()=>drag(ea,eb));const erased=await save('erase'),erasePixels=await pixels();assert.notEqual(erasePixels,brushPixels);
 await verifyStroke(erased,leafOf(brushed,'Brush').points.length,true,await displayPixel(ea),await displayPixel(eb),W,H);
 await undoRedo(brushed,erased,brushPixels,erasePixels);pass('visible eraser appends mapped erase points and has a single reversible pixel change');

 await choose('Radial');await expect(page.getByTestId('mask-mapped-guide')).toBeVisible();
 const oldRadial=leafOf(erased,'Radial'),start=await handlePoint('end'),end={x:start.x+24,y:start.y+14};await assertVisiblePoint(end);
 const mapped=(await oracle([await displayPixel(start),await displayPixel(end)])).map(p=>canonical(p,W,H));await logReset();
 await settle(()=>drag(start,end));const shaped=await save('radial'),shapePixels=await pixels(),newRadial=leafOf(shaped,'Radial');
 assert(distance(newRadial.end,{x:oldRadial.end.x+mapped[1].x-mapped[0].x,y:oldRadial.end.y+mapped[1].y-mapped[0].y})<.00005);
 assert.deepEqual(newRadial.start,oldRadial.start);assert.notEqual(shapePixels,erasePixels);
 await undoRedo(erased,shaped,erasePixels,shapePixels);pass('visible radial handle drag preserves reference-space offset and exact single-step undo/redo pixels');

 await settle(()=>undo().click());await expect(redo()).toBeEnabled();
 const click=await handlePoint('end');await page.mouse.click(click.x+3,click.y+2);await ready();
 await expect(redo()).toBeEnabled();assert.deepEqual((await save('handle-click')).adjustments.masks,erased.adjustments.masks);
 await settle(()=>redo().click());assert.equal(await pixels(),shapePixels);pass('click inside existing handle hit area changes neither coordinates nor redo history');

 await choose('Brush');await page.getByRole('button',{name:'画笔蒙版 K',exact:true}).click();await ready();
 const fa=await screenPoint({x:.39,y:.59}),fb=await screenPoint({x:.61,y:.62});await logReset();
 await settle(()=>drag(fa,fb,true));const quick=await save('quick-up'),quickPixels=await pixels();
 await verifyStroke(quick,leafOf(shaped,'Brush').points.length,false,await displayPixel(fa),await displayPixel(fb),W,H);
 assert.notEqual(quickPixels,shapePixels);await undoRedo(shaped,quick,shapePixels,quickPixels);
 pass('visible pointerdown plus distinct pointerup without a final move retains the complete mapped tail');

 // Race coverage remains on the default orientation; rotated runs retain all
 // drawing, erasing, shape, persistence, history and final-pointerup checks.
 if(rotation===0){
 for(const mode of ['escape','leaf-switch','document-switch']){
  await choose('Brush');await page.getByRole('button',{name:'画笔蒙版 K',exact:true}).click();await ready();
  const baseline=await save('before-'+mode);await arm('hold');const ra=await screenPoint({x:.44,y:.4}),rb=await screenPoint({x:.53,y:.45});
  await page.mouse.move(ra.x,ra.y);await page.mouse.down();await held();await page.mouse.move(rb.x,rb.y,{steps:3});await page.mouse.up();
  await expect(page.locator('.mask-gesture-status')).toBeVisible();
  if(mode==='escape')await page.keyboard.press('Escape');
  else if(mode==='leaf-switch')await page.getByRole('button',{name:'Radial',exact:true}).click();
  else await open(otherFile);
  await page.locator('.mask-gesture-status').waitFor({state:'hidden'});await release();await ready();
  if(mode==='document-switch'){
   assert.deepEqual((await save('other-after-cancel')).adjustments.masks,initial.adjustments.masks);
   await settle(()=>page.locator('.film-open').filter({has:page.locator('span',{hasText:'interaction.png'})}).click());
  }
  assert.deepEqual((await save('after-'+mode)).adjustments.masks,baseline.adjustments.masks);assert.equal(await pixels(),quickPixels);
  pass(`${mode} cancels a held real native result without late writes to either document`);
 }

 // Selection changes schedule an overlay update without changing adjustments.
 await choose('Radial');const overlayBefore=await save('before-overlay-gate');
 const ga=await screenPoint({x:.45,y:.58}),gb=await screenPoint({x:.58,y:.6});
 await page.evaluate(()=>{
  window.__overlayTrace={accepted:false,errors:[]};
  window.__overlayObserver=new MutationObserver(()=>{
   if(document.querySelector('.mask-gesture-status'))window.__overlayTrace.accepted=true;
   const error=document.querySelector('[role="alert"]')?.textContent;if(error)window.__overlayTrace.errors.push(error);
  });window.__overlayObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
 });
 await page.getByRole('button',{name:'Brush',exact:true}).click();await drag(ga,gb,true);
 await ready();const trace=await page.evaluate(()=>{window.__overlayObserver.disconnect();return window.__overlayTrace;});
 const overlayAfter=await save('after-overlay-gate');
 const changed=JSON.stringify(overlayAfter.adjustments.masks)!==JSON.stringify(overlayBefore.adjustments.masks);
 if(trace.accepted)assert(changed,'An accepted gesture must not silently disappear when the overlay timer fires');
 if(!changed){assert(!trace.accepted);assert(trace.errors.some(message=>message.includes('预览')),'Rejected gesture must explain that the preview is pending');await settle(()=>drag(ga,gb,true));}
 metrics.push({kind:'overlay-gate',...trace,changed});
 const overlayDone=await save('overlay-retry');assert(leafOf(overlayDone,'Brush').points.length>leafOf(overlayBefore,'Brush').points.length);
 pass('pending overlay update either rejects before acceptance or preserves the stroke; ready retry succeeds');
 const alert=page.getByRole('button',{name:'关闭错误',exact:true});if(await alert.count())await alert.click();

 await choose('Radial');await expect(page.getByTestId('mask-mapped-guide')).toBeVisible();
 // Zoom changes guide sampling without racing a pending native revision update.
 await arm('guide-failure');const zoomAt=await screenPoint({x:.5,y:.5});await page.mouse.move(zoomAt.x,zoomAt.y);await page.mouse.wheel(0,120);
 await expect(page.getByRole('alert')).toContainText('E2E guide mapping failure');await ready();
 await expect(page.getByTestId('mask-mapped-guide')).toHaveCount(0);
 const retry=await screenPoint({x:.5,y:.5});await page.mouse.click(retry.x,retry.y);
 await expect(page.getByTestId('mask-mapped-guide')).toBeVisible();
 assert.deepEqual((await save('guide-retry')).adjustments.masks,overlayDone.adjustments.masks);
 await settle(()=>undo().click());assert.deepEqual((await save('guide-retry-undo')).adjustments.masks,overlayBefore.adjustments.masks);
 await settle(()=>redo().click());assert.deepEqual((await save('guide-retry-redo')).adjustments.masks,overlayDone.adjustments.masks);
 pass('current guide RPC failure is visible and clicking the visible canvas retries without editing history');
 if(await alert.count())await alert.click();

 // Exercise actual UI commands and the real Electron close/quit handlers while
 // a completed native coordinate result is waiting to reach the renderer.
 for(const action of ['shortcut-save','shortcut-close','export','native-window-close','native-quit']){
  await choose('Brush');await page.getByRole('button',{name:'画笔蒙版 K',exact:true}).click();await ready();
  const baseline=await save('clean-before-'+action),baselinePixels=await pixels();
  await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);
  await expect.poll(()=>app.evaluate(()=>globalThis.__maskRPC.dirty.length)).toBe(0);
  await app.evaluate(({dialog})=>{
   globalThis.__maskDialogs={saves:0,messages:[]};
   dialog.showSaveDialog=async()=>{globalThis.__maskDialogs.saves++;return {canceled:true};};
   dialog.showMessageBox=async(...args)=>{
    const options=args.at(-1);globalThis.__maskDialogs.messages.push({message:options.message,buttons:options.buttons});
    return {response:options.buttons.indexOf('继续编辑')>=0?options.buttons.indexOf('继续编辑'):options.cancelId??0};
   };
  });
  const first=await screenPoint({x:.31,y:.35}),last=await screenPoint({x:.58,y:.39});
  const firstPixel=await displayPixel(first),lastPixel=await displayPixel(last);
  await logReset();await arm('hold');await page.mouse.move(first.x,first.y);await page.mouse.down();await held();
  await page.mouse.move(last.x,last.y,{steps:5});await page.mouse.up();
  await expect(page.locator('.mask-gesture-status')).toBeVisible();
  await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);
  await expect.poll(()=>app.evaluate((_,path)=>globalThis.__maskRPC.dirty.includes(path),source)).toBe(true);
  const updates=await app.evaluate(()=>globalThis.__maskRPC.updates.length);
  if(action==='shortcut-save')await page.keyboard.press('Meta+s');
  else if(action==='shortcut-close')await page.keyboard.press('Meta+w');
  else if(action==='export'){
   await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();
  }else if(action==='native-window-close')await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  else await app.evaluate(({app})=>app.quit());
  if(action.startsWith('native-')){
   await expect.poll(()=>app.evaluate(()=>globalThis.__maskDialogs.messages.length)).toBe(1);
   const dialogs=await app.evaluate(()=>globalThis.__maskDialogs.messages);
   assert.match(dialogs[0].message,/未保存/);assert(dialogs[0].buttons.includes('继续编辑'));
   assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length>0));
  }else{
   await expect(page.getByRole('alert')).toContainText('蒙版笔画尚未完成');
   assert.equal(await app.evaluate(()=>globalThis.__maskDialogs.messages.length),0);
  }
  assert.equal(await app.evaluate(()=>globalThis.__maskDialogs.saves),0,'No old snapshot may reach a save/export dialog');
  assert.equal(await app.evaluate(()=>globalThis.__maskRPC.updates.length),updates,'Guarded action must not advance the native revision');
  await expect(page.locator('.mask-gesture-status')).toBeVisible();await expect(viewport()).toBeVisible();
  await settle(()=>release());const applied=await save('released-'+action),appliedPixels=await pixels();
  await verifyStroke(applied,leafOf(baseline,'Brush').points.length,false,firstPixel,lastPixel,W,H);
  // Repeated strokes may overlap fully; persistence and exact undo remain
  // mandatory, while the first lifecycle stroke must also change RGB pixels.
  if(action==='shortcut-save')assert.notEqual(appliedPixels,baselinePixels);
  await undoRedo(baseline,applied,baselinePixels,appliedPixels);
  await expect.poll(()=>app.evaluate(()=>globalThis.__maskRPC.dirty.length)).toBe(0);
  metrics.push({kind:'pending-lifecycle',action,nativeRevisionUnchanged:true,cleanDocumentProtected:true});
  pass(action+' protects a clean document while mapping is pending, then saves the complete stroke with one undo');
 }
 }
 await page.screenshot({path:join(out,'workbench.png')});
 assert.equal(hash(source),sourceHash);assert.equal(hash(fixture),fixtureHash);assert.deepEqual(errors,[]);passed=true;
}catch(error){errors.push(error.stack||String(error));if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally{
 const diagnostics=app?electronDiagnostics(app):undefined;
 if(app){await release().catch(()=>{});await closeElectron(app).catch(e=>{errors.push(String(e));passed=false;});}
 await core.stop().catch(e=>{errors.push(String(e));passed=false;});
 const report={status:passed?'passed':'failed',rotation,crop,canvasDimensions,raceChecks:rotation===0,checks,metrics,errors,backgroundWindow:true,packaged:!!process.env.CAPTRAW_APP,fixture,sourceHash,out,
  binaries:{app:process.env.CAPTRAW_APP,engine:process.env.CAPTRAW_ENGINE,resources:process.env.CAPTRAW_RESOURCES,xmp:process.env.CAPTRAW_XMP_BINARY},diagnostics};
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(join(root,'latest.json'),JSON.stringify({out,status:report.status},null,2)+'\n');
 console.log('REPORT',join(out,'report.json'));if(!passed)process.exitCode=1;
}
