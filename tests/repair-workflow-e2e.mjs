import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {readDocument} from './xmp-test.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Real production App + main/preload + native RPC. No renderer/component harness.
// Build coordination is external: this test deliberately performs no builds.
const scratch=await mkdtemp(join(tmpdir(),'captraw-repair-app-')),source=join(scratch,'修复 工作流.png'),sidecar=source.replace('.png','.xmp');
const checks=[],errors=[],findings=[];let app,page,passed=false,failure;
const button=name=>page.getByRole('button',{name,exact:true});
const list=()=>page.getByRole('list',{name:'修复列表'}).getByRole('listitem');
const auto=()=>page.getByRole('checkbox',{name:'自动选择来源',exact:true});
const count=()=>app.evaluate(()=>globalThis.__repairSourceTrace.length);
const canvas=()=>page.locator('canvas[aria-label="显影预览"]');
const pixelHash=async()=>createHash('sha256').update(await canvas().evaluate(c=>c.toDataURL())).digest('hex');
async function idle(){
 await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 await page.getByTestId('repair-gesture-pending').waitFor({state:'hidden'});await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__repairFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url;});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function launch(){
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__repairFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__repairFrames.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog,BrowserWindow,app})=>{
  globalThis.__repairWindowEvents=[];
  const watch=w=>{for(const event of ['show','focus'])w.on(event,()=>globalThis.__repairWindowEvents.push(event));};
  BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
  globalThis.__repairSourceTrace=[];
  globalThis.__repairSaved=[];globalThis.__repairSaveStarts=[];globalThis.__repairUpdates=[];globalThis.__repairExports=[];
  const update=ipcMain._invokeHandlers.get('image:update');
  ipcMain.removeHandler('image:update');ipcMain.handle('image:update',async(event,request)=>{globalThis.__repairUpdates.push(request.revision);return update(event,request);});
  const save=ipcMain._invokeHandlers.get('session:save');
  ipcMain.removeHandler('session:save');ipcMain.handle('session:save',async(...args)=>{globalThis.__repairSaveStarts.push(globalThis.__repairUpdates.at(-1));const result=await save(...args);globalThis.__repairSaved.push(result);return result;});
  const exportImage=ipcMain._invokeHandlers.get('image:export');
  ipcMain.removeHandler('image:export');ipcMain.handle('image:export',async(event,request)=>{const record={request:structuredClone(request)};globalThis.__repairExports.push(record);record.output=await exportImage(event,request);return record.output;});
  const original=ipcMain._invokeHandlers.get('image:repair-source');
  if(!original)throw new Error('Build the current main/preload and native repair-source RPC before this App test');
  ipcMain.removeHandler('image:repair-source');
  ipcMain.handle('image:repair-source',async(event,request)=>{
   const record={request:structuredClone(request)};globalThis.__repairSourceTrace.push(record);
   const result=await original(event,request);record.result=structuredClone(result);
   if(globalThis.__holdRepairSource)await new Promise(resolve=>{globalThis.__releaseRepairSource=resolve;});
   return result;
  });
  dialog.showMessageBox=async(...args)=>{const options=args.at(-1);
   if(options.message==='确认保存这些 XMP 旁车？')return {response:1};
   const discard=options.buttons?.findIndex(v=>v.includes('放弃'));return {response:discard>=0?discard:0};
  };
 });
}
async function open(){
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
 await button('打开').click();await expect(page.locator('.film-item').filter({hasText:basename(source)})).toHaveCount(1);await idle();
 await button('修复 B').click();await page.getByLabel('修复面板',{exact:true}).waitFor();await idle();
 await page.getByTestId('repair-guides').waitFor({state:'attached'});
}
async function at(x,y){
 const b=await page.getByTestId('viewport').boundingBox(),f=await page.evaluate(()=>window.__repairFrames.filter(f=>f.kind==='fit').at(-1));
 const scale=Math.min((b.width-64)/f.fullWidth,(b.height-64)/f.fullHeight);
 return {x:b.x+b.width/2+(x-.5)*f.fullWidth*scale,y:b.y+b.height/2+(y-.5)*f.fullHeight*scale};
}
async function stroke(start,end){
 await idle();const previous=await page.evaluate(()=>window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision),p=await at(...start),q=await at(...end);
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:8});await page.mouse.up();await page.waitForFunction(r=>(window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,previous);await idle();
}
async function dragHandle(part,dx,dy){
 const previous=await page.evaluate(()=>window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision);
 await page.getByTestId('repair-guides').waitFor({state:'attached'});
 const b=await page.getByTestId(`repair-${part}-handle`).boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
 await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:4});await page.mouse.up();
 await page.waitForFunction(r=>(window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,previous);await idle();
}
async function save(){
 const previous=await app.evaluate(()=>globalThis.__repairSaved.length);await button('保存').click();
 await expect.poll(()=>app.evaluate(()=>globalThis.__repairSaved.length)).toBe(previous+1);
 await expect.poll(()=>existsSync(sidecar)).toBe(true);await idle();
 return readDocument(sidecar);
}
async function exportTIFF(name){
 const path=join(scratch,name+'.tiff');
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);
 await button('导出').click();await page.getByRole('dialog',{name:'导出设置'}).getByRole('button',{name:'TIFF · 16 位',exact:false}).click();
 await expect(page.locator('.job-toast.done')).toContainText('已导出 '+basename(path),{timeout:120000});
 await expect.poll(()=>app.evaluate((_,file)=>globalThis.__repairExports.some(e=>e.output===file),path)).toBe(true);
 await button('关闭导出结果').click();await idle();return path;
}
async function dustWorkflow(){
 const dust=()=>page.getByRole('checkbox',{name:'灰尘可视化',exact:true}),threshold=()=>page.getByRole('spinbutton',{name:'灰尘可视化阈值',exact:true});
 const original=await save(),packet=await readFile(sidecar,'utf8'),off=await exportTIFF('dust-off'),normal=await pixelHash();
 await writeFile(join(scratch,'dust-normal.png'),Buffer.from((await canvas().evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 const counts=()=>app.evaluate(()=>({updates:globalThis.__repairUpdates.length,source:globalThis.__repairSourceTrace.length,saves:globalThis.__repairSaved.length,exports:globalThis.__repairExports.length}));
 const before=await counts();
 async function unchanged(){
  await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();await expect(button('重做')).toBeDisabled();
  assert.deepEqual(await counts(),before);assert.equal(await readFile(sidecar,'utf8'),packet);
 }
 // Inspect PNG snapshots without getImageData on the live product canvas:
 // repeated readback can force Chromium's GPU canvas to a different raster backend.
 const stats=async()=>JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',"from PIL import Image\nfrom io import BytesIO\nimport sys,json,numpy as np\np=np.array(Image.open(BytesIO(sys.stdin.buffer.read())));a=p[:,:,3]==255;gray=(p[:,:,0]==p[:,:,1])&(p[:,:,1]==p[:,:,2]);print(json.dumps({k:int(v.sum()) for k,v in dict(opaque=a,gray=a&gray,white=a&(p[:,:,0]>200),black=a&(p[:,:,0]<30)).items()}))"],{input:Buffer.from((await canvas().evaluate(c=>c.toDataURL())).split(',')[1],'base64')}).toString());
 await expect(dust()).toBeVisible();await expect(dust()).not.toBeChecked();await expect(canvas()).toHaveAttribute('data-dust','false');
 assert((await stats()).gray<(await stats()).opaque);
 await dust().check();await expect(canvas()).toHaveAttribute('data-dust','true');await expect.poll(pixelHash).not.toBe(normal);
 const defaultStats=await stats();assert.equal(defaultStats.gray,defaultStats.opaque);assert(defaultStats.white>0&&defaultStats.black>0);await unchanged();
 checks.push('visible dust checkbox changes actual main-canvas pixels to a monochrome speck map without editing the clean document');
 await threshold().fill('0');await threshold().press('Tab');await expect(threshold()).toHaveValue('0');const low=await pixelHash(),lowStats=await stats();
 await threshold().fill('100');await threshold().press('Tab');await expect(threshold()).toHaveValue('100');await expect.poll(pixelHash).not.toBe(low);
 const high=await pixelHash(),highStats=await stats();assert(lowStats.white>highStats.white);await unchanged();
 checks.push('visible threshold changes main-canvas detection density; lower threshold produces more white detections');
 await dust().uncheck();await expect(canvas()).toHaveAttribute('data-dust','false');
 await writeFile(join(scratch,'dust-restored.png'),Buffer.from((await canvas().evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 assert.equal(await pixelHash(),normal);await expect(threshold()).toHaveCount(0);await unchanged();
 await dust().check();await expect(canvas()).toHaveAttribute('data-dust','true');assert.equal(await pixelHash(),high);
 await button('编辑').click();await expect(canvas()).toHaveAttribute('data-dust','false');assert.equal(await pixelHash(),normal);await expect(dust()).toHaveCount(0);await unchanged();
 await button('修复 B').click();await expect(dust()).toBeChecked();await expect(canvas()).toHaveAttribute('data-dust','true');assert.equal(await pixelHash(),high);
 await button('平移 H').click();await expect(page.getByTestId('viewport')).toHaveClass(/tool-hand/);
 if(await canvas().getAttribute('data-dust')!=='false'){
  findings.push('Dust remains on the main canvas after selecting Pan H while the Repair tab stays open');
  await page.screenshot({path:join(scratch,'dust-pan.png')});
 }
 else{assert.equal(await pixelHash(),normal);checks.push('Pan tool suppresses dust outside repair drawing mode');}
 await button('修复 B').click();await expect(canvas()).toHaveAttribute('data-dust','true');await unchanged();
 checks.push('dust Off and Edit mode restore the exact normal canvas; returning to Repair retains its display preference and threshold');
 const on=await exportTIFF('dust-on'),saved=await save();assert.deepEqual(saved.adjustments,original.adjustments);assert.equal(saved.artProfile,original.artProfile);
 await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();await expect(button('重做')).toBeDisabled();
 const exported=await app.evaluate(()=>globalThis.__repairExports.map(e=>e.request));assert.equal(exported.length,2);
 for(const field of ['adjustments','artProfile'])assert.deepEqual(exported[0].document[field],exported[1].document[field]);
 assert.deepEqual(exported[0].options,exported[1].options);
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',"import numpy as np,tifffile,sys,json\na,b=map(tifffile.imread,sys.argv[1:]);assert a.dtype==b.dtype==np.uint16;assert np.array_equal(a,b);assert np.any(a[:,:,0]!=a[:,:,1]);print(json.dumps({'dustExportPixelDifference':0,'shape':list(a.shape),'dtype':str(a.dtype)}))",off,on],{stdio:'inherit'});
 checks.push('dust display and threshold never dirty, add history, auto-save or re-render natively; actual saved recipe and TIFF16 pixels remain identical');
 console.log('Dust canvas evidence:',JSON.stringify({defaultStats,lowStats,highStats}));
 await dust().uncheck();await expect(canvas()).toHaveAttribute('data-dust','false');assert.equal(await pixelHash(),normal);
}
try{
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',"from PIL import Image,ImageDraw\nimport sys\na=Image.new('RGB',(640,480));a.putdata([(80+x//8,85+y//8,90+(x+y)%37) for y in range(480) for x in range(640)]);ImageDraw.Draw(a).line([(288,192),(339,211)],fill=(15,15,15),width=5);a.save(sys.argv[1])",source]);
 const originalHash=createHash('sha256').update(await readFile(source)).digest('hex');
 await launch();await open();
 await expect(auto()).toBeChecked();await expect(button('选择取样来源')).toHaveAttribute('aria-pressed','false');assert.equal(await count(),0);
 await dustWorkflow();
 const neutral=await pixelHash();await stroke([.45,.4],[.53,.44]);await expect(list()).toHaveCount(1);await expect.poll(count).toBe(1);assert.notEqual(await pixelHash(),neutral);
 let document=await save(),trace=await app.evaluate(()=>globalThis.__repairSourceTrace),first=document.adjustments.spots[0];
 assert.equal(first.method,'heal');assert.equal(first.sourceMode,'auto');assert(first.path.length>2);assert.deepEqual(first.source,trace[0].result.source);
 assert.deepEqual(trace[0].request.path,first.path);checks.push('fresh production App draws Heal target directly and stores native automatic source');
 await button('新建修复').click();await expect(auto()).toBeChecked();await expect(button('选择取样来源')).toHaveAttribute('aria-pressed','false');
 await stroke([.65,.55],[.72,.58]);await expect(list()).toHaveCount(2);await expect.poll(count).toBe(2);
 document=await save();trace=await app.evaluate(()=>globalThis.__repairSourceTrace);let second=document.adjustments.spots[1];
 assert.equal(second.sourceMode,'auto');assert.deepEqual(second.source,trace[1].result.source);assert.notDeepEqual(trace[1].request.path,trace[0].request.path);
 checks.push('New keeps automatic mode and searches each stroke despite an existing source');
 const beforeManual=await page.evaluate(()=>window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision);
 const p=await at(.2,.25);await page.keyboard.down('Alt');try{await page.mouse.click(p.x,p.y);}finally{await page.keyboard.up('Alt');}
 await page.getByTestId('repair-gesture-pending').waitFor({state:'hidden'});
 await expect(auto()).not.toBeChecked();assert.equal(await count(),2);let manual=await save();second=manual.adjustments.spots[1];
 assert.equal(await app.evaluate(()=>globalThis.__repairSaveStarts.at(-1)),beforeManual,'Save must reach IPC before the changed-source preview update');
 await page.waitForFunction(r=>(window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,beforeManual);await idle();
 assert.equal(second.sourceMode,'manual');assert.notDeepEqual(second.source,document.adjustments.spots[1].source);assert.deepEqual(second.path,document.adjustments.spots[1].path);
 checks.push('Option explicitly changes source without invoking automatic search or changing the target path');
 const beforeSearch=await page.evaluate(()=>window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision);
 await button('重新搜索来源').click();await expect.poll(count).toBe(3);
 await page.waitForFunction(r=>(window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,beforeSearch);await idle();
 let searched=(await save()).adjustments.spots[1];trace=await app.evaluate(()=>globalThis.__repairSourceTrace);
 assert.equal(searched.sourceMode,'auto');assert.notDeepEqual(searched.source,second.source);assert.deepEqual(searched.path,second.path);
 assert.deepEqual(trace[2].request.exclude,second.source);assert.deepEqual(searched.source,trace[2].result.source);
 let beforeUndo=await page.evaluate(()=>window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision);await button('撤销').click();
 await page.waitForFunction(r=>(window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,beforeUndo);await idle();
 assert.deepEqual((await save()).adjustments.spots,manual.adjustments.spots);assert.equal(await count(),3);
 beforeUndo=await page.evaluate(()=>window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision);await button('重做').click();
 await page.waitForFunction(r=>(window.__repairFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,beforeUndo);await idle();
 assert.deepEqual((await save()).adjustments.spots[1],searched);assert.equal(await count(),3);
 checks.push('manual source change saves before preview update, unlock restores visible current preview, and re-search is exactly one undo/redo step');
 checks.push('visible re-search invokes native RPC, excludes the old source and preserves the target path');
 await dragHandle('source',searched.source.x>.5?-6:6,searched.source.y>.5?-6:6);
 let moved=(await save()).adjustments.spots[1];assert.equal(moved.sourceMode,'manual');assert.notDeepEqual(moved.source,searched.source);assert.deepEqual(moved.path,searched.path);assert.equal(await count(),3);
 checks.push('visible source handle drag switches to manual and preserves the whole target path');
 await dragHandle('target',6,6);manual=await save();second=manual.adjustments.spots[1];
 assert.deepEqual(second.source,moved.source);assert.equal(second.path.length,moved.path.length);
 const dx=second.target.x-moved.target.x,dy=second.target.y-moved.target.y;assert(dx>0&&dy>0);
 assert(second.path.every((p,i)=>Math.abs(p.x-moved.path[i].x-dx)<1e-10&&Math.abs(p.y-moved.path[i].y-dy)<1e-10));assert.equal(await count(),3);
 checks.push('visible target handle drag translates the complete path and preserves source without re-search');
 await closeElectron(app);app=undefined;await launch();await open();assert.equal(await count(),0);
 await expect(auto()).not.toBeChecked();await expect(button('选择取样来源')).toHaveAttribute('aria-pressed','false');
 assert.deepEqual((await save()).adjustments.spots,manual.adjustments.spots);assert.equal(await count(),0);
 await list().first().getByRole('button').first().click();await expect(auto()).toBeChecked();assert.equal(await count(),0);
 assert.deepEqual((await save()).adjustments.spots,manual.adjustments.spots);
 checks.push('fresh App restores saved automatic/manual modes and exact sources without re-searching');
 await button('新建修复').click();await stroke([.5,.7],[.55,.73]);await expect(list()).toHaveCount(3);await expect.poll(count).toBe(1);
 const final=await save();assert.equal(final.adjustments.spots[2].sourceMode,'auto');assert.deepEqual(final.adjustments.spots.slice(0,2),manual.adjustments.spots);
 await button('新建修复').click();const cancelStart=await at(.35,.7),cancelEnd=await at(.4,.74);
 await page.mouse.move(cancelStart.x,cancelStart.y);await page.mouse.down();await page.mouse.move(cancelEnd.x,cancelEnd.y,{steps:5});
 await page.getByTestId('repair-gesture-pending').waitFor();await page.keyboard.press('Escape');await page.mouse.up();await idle();
 await button('修复 B').click();assert.deepEqual((await save()).adjustments.spots,final.adjustments.spots);assert.equal(await count(),1);
 checks.push('Escape during an active stroke discards its path without automatic search or stored edits');
 await app.evaluate(()=>{globalThis.__holdRepairSource=true;});await button('新建修复').click();
 await page.mouse.move(cancelStart.x,cancelStart.y);await page.mouse.down();await page.mouse.move(cancelEnd.x,cancelEnd.y,{steps:5});await page.mouse.up();
 await expect.poll(()=>app.evaluate(()=>!!globalThis.__releaseRepairSource)).toBe(true);
 await page.keyboard.press('Escape');await app.evaluate(()=>{globalThis.__holdRepairSource=false;globalThis.__releaseRepairSource();});await idle();
 await button('修复 B').click();assert.deepEqual((await save()).adjustments.spots,final.adjustments.spots);assert.equal(await count(),2);
 checks.push('Escape while native source response is pending rejects its late result and preserves stored edits');
 for(const {request,result}of await app.evaluate(()=>globalThis.__repairSourceTrace)){
  assert.deepEqual(Object.keys(request).sort(),['feather','path','radius','revision','seed','sessionId']);
  assert.equal(result.sessionId,request.sessionId);assert.equal(result.revision,request.revision);
 }
 checks.push('New after restoring an automatic record performs a fresh native search and preserves old records');
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>({events:globalThis.__repairWindowEvents,hidden:BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable())})),{events:[],hidden:true});
 assert.deepEqual(errors,[]);assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),originalHash);
 assert.deepEqual(findings,[]);
 passed=true;console.log(JSON.stringify({passed,scope:'full production App/main/preload/native, hidden GUI; no ACR quality or installation claim',checks}));
}catch(error){failure=error.stack||String(error);if(app)await writeFile(join(scratch,'diagnostics.json'),JSON.stringify(electronDiagnostics(app),null,2));if(page)await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});throw error;}
finally{
 if(app)await closeElectron(app);
 if(passed)await rm(scratch,{recursive:true,force:true});else{await writeFile(join(scratch,'failure.json'),JSON.stringify({failure,checks,findings,errors},null,2));console.error('Full App repair failure retained at '+scratch);}
}
