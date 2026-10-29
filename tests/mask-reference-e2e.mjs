import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {readDocument} from './xmp-test.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {mkdtemp,rm,copyFile,writeFile} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// No builds, CUA, renderer-state mutation or fabricated native results.
// Bundle27 is an explicitly supplied immutable comparison, never build/bundle by assumption.
const oldBinary=process.env.CAPTRAW_MASK_OLD_ENGINE,oldSHA=process.env.CAPTRAW_MASK_OLD_SHA256;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
if(oldBinary)assert(oldSHA&&hash(oldBinary)===oldSHA,'Supply the verified bundle27 engine SHA256');
const executable=process.env.CAPTRAW_APP;
const native=executable?resolve(dirname(executable),'../Resources/native'):resolve('build/native');
const binary=join(native,'captraw-engine'),resources=join(native,'resources'),engineSHA=hash(binary);
if(oldBinary)assert.notEqual(engineSHA,oldSHA,'Legacy comparison must use a different engine');
const work=await mkdtemp(join(tmpdir(),'captraw-mask-reference-app-'));
const python=resolve(process.env.CAPTRAW_PYTHON||'build/qa-venv/bin/python');
const checks=[],metrics=[],errors=[];let app,page,passed=false;
const button=name=>page.getByRole('button',{name,exact:true});
const canvas=()=>page.locator('canvas[aria-label="显影预览"]');
const frame=()=>page.evaluate(()=>window.__referenceFrames.filter(f=>f.kind==='fit').at(-1));
const canvasHash=async()=>createHash('sha256').update(await canvas().evaluate(c=>c.toDataURL())).digest('hex');
const pass=name=>{checks.push(name);console.log('PASS',name);};
async function hidden(){
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));
 assert(windows.length&&windows.every(w=>!w.visible&&!w.focused&&!w.focusable));
 assert.deepEqual(await app.evaluate(()=>globalThis.__referenceWindowEvents),[]);return windows;
}
async function launch(){
 app=await electron.launch({executablePath:executable});page=await app.firstWindow();page.setDefaultTimeout(60000);
 page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__referenceFrames=[];window.__referenceComparisons=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__referenceFrames.push(e.frame);if(e.event==='comparison-preview')window.__referenceComparisons.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog,BrowserWindow,app})=>{
  globalThis.__referenceWindowEvents=[];const watch=w=>{for(const name of ['show','focus'])w.on(name,()=>globalThis.__referenceWindowEvents.push(name));};
  BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
  globalThis.__referenceTrace=[];
  for(const channel of ['image:coordinates','image:update','image:export','session:save','comparison:update']){
   const handler=ipcMain._invokeHandlers.get(channel);if(!handler)throw Error('Missing '+channel);
   ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{
    const record={channel,input:structuredClone(input)};globalThis.__referenceTrace.push(record);
    record.result=await handler(event,input);return record.result;
   });
  }
  dialog.showMessageBox=async(...args)=>{const options=args.at(-1);return {response:options.buttons?.findIndex(v=>v.includes('确认保存')||v.includes('放弃'))>=0?options.buttons.findIndex(v=>v.includes('确认保存')||v.includes('放弃')):1};};
 });
}
async function ready(){
 // Selection schedules a 90ms overlay update. Drain it, then require the
 // resulting real frame to be loaded before starting a canvas transaction.
 await page.waitForTimeout(160);
 await page.locator('.rendering').waitFor({state:'hidden'});await page.locator('.mask-gesture-status').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__referenceFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});
 await expect(page.getByRole('alert')).toHaveCount(0);await expect(canvas()).toBeVisible();
}
async function settle(action){const before=(await frame())?.revision??-1;await action();await page.waitForFunction(r=>(window.__referenceFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,before);await ready();}
async function open(file){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},file);await settle(()=>button('打开').click());}
async function save(source){
 const before=await app.evaluate(()=>globalThis.__referenceTrace.filter(r=>r.channel==='session:save'&&r.result).length);
 await button('保存').click();await expect.poll(()=>app.evaluate(()=>globalThis.__referenceTrace.filter(r=>r.channel==='session:save'&&r.result).length)).toBe(before+1);
 const path=source.replace(/\.png$/,'.xmp');await expect.poll(()=>existsSync(path)).toBe(true);await ready();return {path,doc:await readDocument(path)};
}
async function section(name){const locator=page.locator('details.adjust-section').filter({has:page.locator(':scope > summary',{hasText:name})});if(await locator.getAttribute('open')===null)await locator.locator(':scope > summary').click();await locator.scrollIntoViewIfNeeded();await expect(locator).toBeInViewport();}
async function number(name,value){const control=page.getByRole('spinbutton',{name,exact:true});await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();await expect(control).toBeInViewport();await settle(async()=>{await control.fill(String(value));await control.press('Tab');});}
async function imageRect(){
 const svg=page.getByTestId('viewport').locator('svg.mask-overlay'),box=await svg.boundingBox();assert(box);
 const r=await svg.locator('#mask-image-bounds rect').evaluate(e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(e.getAttribute(k))])));
 return {x:box.x+r.x,y:box.y+r.y,width:r.width,height:r.height};
}
async function drag(from,to){
 const r=await imageRect(),point=p=>({x:r.x+p.x*r.width,y:r.y+p.y*r.height}),a=point(from),b=point(to);
 for(const p of [a,b])assert(await page.getByTestId('viewport').evaluate((e,p)=>e.contains(document.elementFromPoint(p.x,p.y)),p),'Gesture must hit displayed viewport');
 await settle(async()=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();});
}
const marker=file=>JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(float)
y,x=np.where((a[:,:,2]>a[:,:,0]*1.35)&(a[:,:,2]>a[:,:,1]*1.2));assert len(x)>20
print(json.dumps(dict(x=float(x.mean()),y=float(y.mean()),width=a.shape[1],height=a.shape[0])))
`,file],{encoding:'utf8'}));
async function location(type,label){
 await ready();await expect(page.getByTestId('mask-coverage')).toBeVisible();const enabled=await frame(),painted=join(work,label+'-painted.png');await copyFile(enabled.file,painted);
 const actualCanvas=await canvasHash();assert(actualCanvas,'The real renderer has loaded the current image');
 const row=page.getByRole('listitem').filter({has:page.locator('.mask-select')});await settle(()=>row.getByTitle('停用蒙版',{exact:true}).click());
 const neutral=await frame(),plain=join(work,label+'-neutral.png');await copyFile(neutral.file,plain);assert.notEqual(await canvasHash(),actualCanvas,'Visible image must change when local effect is disabled');
 const target=marker(plain);await settle(()=>row.getByTitle('启用蒙版',{exact:true}).click());
 await expect(page.getByTestId('mask-coverage')).toBeVisible();const coverage=(await frame()).mask;assert(coverage?.file);
 const pixel=JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a,b=[np.array(Image.open(f).convert('RGB')).astype(float) for f in sys.argv[1:3]]
m=np.array(Image.open(sys.argv[3]).getchannel('A'));q=json.loads(sys.argv[4]);x,y=round(q['x']),round(q['y'])
d=np.abs(a-b).mean(axis=2);yy,xx=np.indices(d.shape);weight=d.sum();assert weight>100
assert m[y,x]>150,('coverage lost image marker',int(m[y,x]));assert d[y-2:y+3,x-2:x+3].mean()>1
cx,cy=float((xx*d).sum()/weight),float((yy*d).sum()/weight)
assert ((cx-x)**2+(cy-y)**2)**.5<max(a.shape[:2])*.09,('effect drift',cx,cy,x,y)
print(json.dumps(dict(coverageAtMarker=int(m[y,x]),effectCentroid=[cx,cy],marker=[x,y])))
`,painted,plain,coverage.file,JSON.stringify(target)],{encoding:'utf8'}));
 if(type==='radial'){
  await expect(page.getByTestId('mask-mapped-guide')).toBeVisible();const r=await imageRect(),box=await page.getByTestId('mask-guide-path').boundingBox();assert(box);
  const point={x:r.x+target.x/target.width*r.width,y:r.y+target.y/target.height*r.height};
  assert(point.x>box.x&&point.x<box.x+box.width&&point.y>box.y&&point.y<box.y+box.height,'Actual image marker must remain inside visible guide');
  for(const name of ['start','end','move']){await expect(page.getByTestId(`mask-${name}-handle`)).toBeVisible();await expect(page.getByTestId(`mask-${name}-handle`)).toBeInViewport();}
 }
 metrics.push({label,type,...pixel});await hidden();return {frame:await frame(),canvas:await canvasHash()};
}
async function exportTIFF(path){
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);
 await button('导出').click();await page.getByRole('button',{name:'TIFF · 16 位',exact:false}).click();
 await expect(page.locator('.job-toast.done')).toContainText('已导出 '+basename(path),{timeout:180000});
 await button('关闭导出结果').click();await ready();
}
function compareTIFF(a,b){
 return JSON.parse(execFileSync(python,['-c',String.raw`
import tifffile,numpy as np,json,sys
a,b=[tifffile.imread(p) for p in sys.argv[1:3]];assert a.dtype==b.dtype==np.uint16
assert a.shape==b.shape;assert np.array_equal(a,b),int(np.abs(a.astype(int)-b).max())
print(json.dumps(dict(shape=list(a.shape),maximumDifference16bit=0)))
`,a,b],{encoding:'utf8'}));
}
async function legacy(source){
 assert(oldBinary,'Set CAPTRAW_MASK_OLD_ENGINE and CAPTRAW_MASK_OLD_SHA256 to verified bundle27; no legacy claim is made without it');
 const old=new EngineClient({executable:oldBinary,resources:process.env.CAPTRAW_MASK_OLD_RESOURCES||join(dirname(oldBinary),'resources'),cache:join(work,'old-cache')});
 let legacyVersion;old.once('ready',event=>{legacyVersion=event.engineVersion;});
 const fresh=new EngineClient({executable:binary,resources,cache:join(work,'new-cache')});
 try{
  await old.ready;assert(legacyVersion.startsWith('CaptRAW-27_'),'Legacy baseline must identify as bundle27');
  const image=await old.call('open',{path:source,sessionId:'legacy'});let revision=0;
  for(const type of ['radial','brush'])for(const rotation of [0,90]){
   const mask={id:'legacy',name:'legacy',type,enabled:true,inverted:false,feather:30,brightness:.5,contrast:0,saturation:0,
    points:type==='brush'?[{x:.35,y:.45,radius:.18}]:[],start:{x:.28,y:.36},end:{x:.42,y:.54}};
   assert(!('referenceAngle'in mask)&&!('geometryReference'in mask));
   const adjustments={...image.adjustments,rotation,fineRotation:17,lensManualDistortion:20,masks:[mask],
    perspective:{enabled:true,horizontal:18,vertical:-12,angle:1,shear:0,focalLength:0,cropFactor:1,aspect:1}};
   const waiting=old.preview(++revision),snapshot=await old.call('update',{revision,artProfile:image.artProfile,adjustments});await waiting;
   const a=join(work,`legacy-${type}-${rotation}-old.tiff`),b=join(work,`legacy-${type}-${rotation}-new.tiff`);
   await old.call('export',{path:source,artProfile:snapshot.artProfile,format:'tiff',colorSpace:'srgb',output:a});
   await fresh.call('export',{path:source,artProfile:snapshot.artProfile,format:'tiff',colorSpace:'srgb',output:b});
   metrics.push({legacy:type,rotation,legacyVersion,...compareTIFF(a,b)});
  }
 }finally{await old.stop();await fresh.stop();}
 pass('No-reference legacy brush/radial ARPs match verified bundle27 TIFF16 pixels at coarse0/90');
}
try{
 const fixture=join(work,'fixture.png');execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw
import sys
im=Image.new('RGB',(1024,768),(96,96,96));d=ImageDraw.Draw(im);d.rectangle((346,335,370,359),fill=(35,80,160));im.save(sys.argv[1])
`,fixture]);const originalHash=hash(fixture);
 if(process.env.CAPTRAW_MASK_REFERENCE_LEGACY_ONLY!=='1'){
 await launch();
 for(const type of process.env.CAPTRAW_MASK_REFERENCE_PROMOTE==='1'?['radial']:['radial','brush']){
  const source=join(work,type+'.png');await copyFile(fixture,source);await open(source);
  if(process.env.CAPTRAW_MASK_REFERENCE_FLIPS==='1'){
   const initial=await app.evaluate(()=>globalThis.__referenceTrace.filter(r=>r.channel==='image:update').at(-1).input);
   assert(!Object.hasOwn(initial.adjustments,'flipHorizontal')&&!Object.hasOwn(initial.adjustments,'flipVertical'),'Fresh GUI document must start with absent flip controls');
   await button('裁切 C').click();await ready();const before=await canvasHash();
   await settle(()=>button('水平翻转').click());assert.notEqual(await canvasHash(),before);
   await settle(()=>button('撤销').click());assert.equal(await canvasHash(),before,'Fresh absent flip must undo actual displayed pixels');
   const restored=await app.evaluate(()=>globalThis.__referenceTrace.filter(r=>r.channel==='image:update').at(-1).input);
   assert(!Object.hasOwn(restored.adjustments,'flipHorizontal'),'History must restore absence, not synthesize false');
   metrics.push({type,freshAbsentFlipUndo:true,undoProfileLength:restored.artProfile?.length||0});
   await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();
  }
  await button('蒙版 M').click();await settle(()=>button(type==='radial'?'径向':'画笔').click());await ready();
  await drag(type==='radial'?{x:.27,y:.35}:{x:.32,y:.45},type==='radial'?{x:.43,y:.55}:{x:.38,y:.45});
  const initial=await save(source),leaf=initial.doc.adjustments.masks[0].components[0];assert.equal(leaf.geometryReference?.version,3,'Real GUI authoring must receive a framed backend reference');
  const rpc=await app.evaluate(()=>globalThis.__referenceTrace.filter(r=>r.channel==='image:coordinates'&&r.input.geometryReference==='current'));
  assert(rpc.length&&rpc.every(r=>r.result.geometryReference?.version===3),'No stale core or synthesized reference accepted');
  const initialCanvas=await canvasHash();await settle(()=>button('撤销').click());const undone=await save(source);
  assert.equal(undone.doc.adjustments.masks[0].components[0].geometryReference,undefined,'Undo removes owned reference from saved XMP');
  await settle(()=>button('重做').click());assert.equal(await canvasHash(),initialCanvas);assert.deepEqual((await save(source)).doc.adjustments.masks[0].components[0].geometryReference,leaf.geometryReference);
  await location(type,type+'-authored');
  await button('编辑').click();await section('几何');await number('水平透视',28);await number('垂直透视',-16);
  await section('光学');await number('手动扭曲',35);
  await button('蒙版 M').click();await ready();await location(type,type+'-perspective-distortion');
  if(process.env.CAPTRAW_MASK_REFERENCE_FLIPS==='1'){
   await button('裁切 C').click();await ready();
   for(const name of ['水平翻转','垂直翻转']){
    await expect(button(name)).toBeVisible();await expect(button(name)).toBeInViewport();
    const before=await canvasHash();await settle(()=>button(name).click());await expect(button(name)).toHaveAttribute('aria-pressed','true');
    const after=await canvasHash();assert.notEqual(after,before);await settle(()=>button('撤销').click());assert.equal(await canvasHash(),before);
    await settle(()=>button('重做').click());assert.equal(await canvasHash(),after);
   }
   await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();await button('蒙版 M').click();await ready();await location(type,type+'-both-flips');
   const current=marker((await frame()).file),currentCanvas=await canvasHash();
   for(let cycle=0;cycle<3;++cycle){
    const count=await page.evaluate(()=>window.__referenceComparisons.length);
    await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('left-right');
    await page.waitForFunction(n=>window.__referenceComparisons.slice(n).some(f=>f.kind==='fit'),count);
    const compared=await page.evaluate(()=>window.__referenceComparisons.filter(f=>f.kind==='fit').at(-1));
    const prior=marker(compared.file);metrics.push({type,comparisonCycle:cycle,currentMarker:current,beforeMarker:prior});
    assert(Math.hypot(current.x/current.width-prior.x/prior.width,current.y/current.height-prior.y/prior.height)<.006,'Comparison must share mirrored geometry');
    await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('off');await ready();
    assert.equal(await canvasHash(),currentCanvas,'Repeated comparison must not accumulate flips');
   }
   for(let swap=0;swap<2;++swap){
    await settle(()=>button('交换前后设置').click());const swapped=marker((await frame()).file);
    metrics.push({type,comparisonSwap:swap,marker:swapped});
    assert(Math.hypot(current.x/current.width-swapped.x/swapped.width,current.y/current.height-swapped.y/swapped.height)<.006,'Swap must preserve flips, perspective and manual distortion');
   }
   assert.equal(await canvasHash(),currentCanvas,'Two swaps must restore exact pixels without accumulating flips');
  }
  const beforeRotation=await canvasHash();await settle(()=>button('顺时针旋转 90 度').click());
  const rotated=await canvasHash();await settle(()=>button('撤销').click());assert.equal(await canvasHash(),beforeRotation);await settle(()=>button('重做').click());assert.equal(await canvasHash(),rotated);
  await location(type,type+'-coarse90');
  const saved=await save(source);assert.deepEqual(saved.doc.adjustments.masks[0].components[0].geometryReference,leaf.geometryReference);
  const desktop=join(work,type+'-desktop.tiff');await exportTIFF(desktop);
  const independent=new EngineClient({executable:binary,resources,cache:join(work,type+'-export-cache')});const output=join(work,type+'-independent.tiff');
  try{await independent.call('export',{path:source,artProfile:saved.doc.artProfile,format:'tiff',colorSpace:'srgb',output});}finally{await independent.stop();}
  metrics.push({type,independentExport:compareTIFF(desktop,output)});
  await hidden();await closeElectron(app);app=undefined;await launch();await open(saved.path);await button('蒙版 M').click();await ready();
  await page.locator('.mask-select').first().click();await ready();await location(type,type+'-reopened');
  assert.deepEqual((await save(source)).doc.adjustments.masks[0].components[0].geometryReference,leaf.geometryReference);
  if(process.env.CAPTRAW_MASK_REFERENCE_PROMOTE==='1'){
   const group=saved.doc.adjustments.masks[0],flat={...group,...group.components[0],id:group.id};delete flat.components;delete flat.operation;
   const flatPath=join(work,'flat-reference.xmp'),documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
   await writeFile(flatPath,await documents.serialize({...saved.doc,adjustments:{...saved.doc.adjustments,masks:[flat]}}));
   const before=await canvasHash(),coverage=hash((await frame()).mask.file),guide=await page.getByTestId('mask-guide-path').getAttribute('d');
   await hidden();await closeElectron(app);app=undefined;await launch();await open(flatPath);
   await button('蒙版 M').click();await page.locator('.mask-select').first().click();await ready();
   assert.equal(await canvasHash(),before,'Readable flat XMP retains existing rendered pixels');
   assert.equal(hash((await frame()).mask.file),coverage);assert.equal(await page.getByTestId('mask-guide-path').getAttribute('d'),guide);
   await button('添加画笔').scrollIntoViewIfNeeded();await expect(button('添加画笔')).toBeInViewport();await settle(()=>button('添加画笔').click());
   await page.getByRole('button',{name:`选择组件 ${flat.name}`,exact:true}).click();await ready();
   assert.equal(await canvasHash(),before,'Uninitialized new component must not change the original shape');
   assert.equal(hash((await frame()).mask.file),coverage,'Promoting flat mask retains exact coverage');
   assert.equal(await page.getByTestId('mask-guide-path').getAttribute('d'),guide,'Promoting flat mask retains visible guide geometry');
   const promoted=(await save(source)).doc.adjustments.masks[0];assert.equal(promoted.components.length,2);
   assert.deepEqual(promoted.components[0].geometryReference,flat.geometryReference);assert.equal(promoted.components[1].initialized,false);
   assert.equal(promoted.components[1].geometryReference,undefined,'Uninitialized component does not inherit container reference');
   pass('Readable XMP flat-mask promotion preserves exact pixels, coverage, guide and the old reference; new component remains uninitialized');
  }
  pass(`${type}: real GUI create, perspective/distortion, coarse90, visible coverage/guide/effect, undo/redo, saved reference removal, restart and independent TIFF`);
 }
 }
 await legacy(fixture);assert.equal(hash(fixture),originalHash);assert.equal(hash(binary),engineSHA,'Core must not change mid-test');
 assert.deepEqual(errors,[]);if(app)await hidden();passed=true;
 console.log(JSON.stringify({passed,engineSHA,oldSHA,checks,metrics,limits:['Independent TIFF uses a fresh process of the same ART implementation; this is not ACR equivalence.']},null,2));
}catch(error){
 if(page&&!page.isClosed())await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});
 await writeFile(join(work,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,metrics,errors,trace:app?await app.evaluate(()=>globalThis.__referenceTrace).catch(()=>[]):[],diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;
}finally{
 if(app)await closeElectron(app);
 if(passed)await rm(work,{recursive:true,force:true});else console.error('Retained latest failure:',work);
}
