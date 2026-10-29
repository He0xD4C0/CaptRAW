import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {XMP,XMP_BASIC,lookup,property,text} from '@captraw/desktop-core/xmp';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Production App/main/native only; build coordination is external.
const scratch=await mkdtemp(join(tmpdir(),'captraw-labels-app-')),python=resolve('build/qa-venv/bin/python');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),U='https://example.invalid/labels-gui/';
const custom='客户 🟪 / 任意 текст  ';
const files=[
 {id:'A',name:'照片20.tiff',label:'Red',rating:1,iso:800},
 {id:'B',name:'照片3.tiff',label:'Yellow',rating:5,iso:100},
 {id:'C',name:'照片10.tiff',label:custom,rating:3,iso:400},
 {id:'D',name:'照片2.tiff',label:'Blue',rating:0,iso:200},
 {id:'E',name:'照片1.tiff',label:undefined,rating:2,iso:undefined},
].map(f=>({...f,path:join(scratch,f.name),sidecar:join(scratch,f.name.replace('.tiff','.xmp'))}));
const [a,b,c,d,e]=files,checks=[],errors=[],findings=[],sourceHashes=new Map(),sidecarHashes=new Map();
let app,page,passed=false,failure;
const button=name=>page.getByRole('button',{name,exact:true});
const card=f=>page.locator('.film-item').filter({hasText:f.name});
const labelGroup=()=>page.getByRole('group',{name:'所选照片色标',exact:true});
const status=()=>page.getByRole('status',{name:'所选色标',exact:true});
const labelFilter=()=>page.getByRole('combobox',{name:'色标筛选',exact:true});
const ratingFilter=()=>page.getByRole('combobox',{name:'评分筛选',exact:true});
const sorting=()=>page.getByRole('combobox',{name:'照片排序',exact:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pixels=async()=>hash(await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL()));
async function hidden(){
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>({events:globalThis.__labelWindows,
  hidden:BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable())})),{events:[],hidden:true});
}
async function pass(message){await hidden();checks.push(message);console.log('PASS',message);}
async function idle(){
 await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 // A filtered-out active image intentionally has a blocking canvas overlay;
 // visible selected targets may still be exported independently of that image.
 if(!(await page.locator('.rating-count').textContent()).includes('当前照片未通过筛选'))await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__labelFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function launch(){
 app=await electron.launch({env:{CAPTRAW_APP:'',CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(String(error)));
 await page.evaluate(()=>{window.__labelFrames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__labelFrames.push(event.frame);});});
 await app.evaluate(({app,BrowserWindow,ipcMain,dialog})=>{
  globalThis.__labelWindows=[];const watch=w=>{for(const event of ['show','focus'])w.on(event,()=>globalThis.__labelWindows.push(event));};
  BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
  globalThis.__labelTrace={updates:0,saves:[],single:[],batch:[]};
  for(const [channel,key]of [['session:save','saves'],['image:export','single'],['images:export','batch']]){
   const original=ipcMain._invokeHandlers.get(channel);if(!original)throw new Error('Missing production IPC '+channel);ipcMain.removeHandler(channel);
   ipcMain.handle(channel,async(event,request)=>{
    const record={request:structuredClone(request)};globalThis.__labelTrace[key].push(record);
    if(key==='batch'&&globalThis.__holdLabelBatch)await new Promise(resolve=>{globalThis.__releaseLabelBatch=resolve;});
    record.result=await original(event,request);return record.result;
   });
  }
  const update=ipcMain._invokeHandlers.get('image:update');ipcMain.removeHandler('image:update');
  ipcMain.handle('image:update',async(...args)=>{globalThis.__labelTrace.updates++;return update(...args);});
  dialog.showMessageBox=async(...args)=>{
   const options=args.at(-1);if(options.message==='确认保存这些 XMP 旁车？')return {response:1};
   throw new Error('Unexpected native dialog: '+options.message);
  };
 });
}
async function open(items){
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},items.map(f=>f.path));
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(items.length);await idle();
}
async function select(f){await card(f).locator('.film-open').click();await expect(card(f).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();}
async function badge(f,label){
 if(label)await expect(card(f).locator('.film-label')).toHaveAttribute('data-label',label);
 else await expect(card(f).locator('.film-label')).toHaveCount(0);
}
const order=()=>page.locator('.film-open>span').allTextContents();
const selected=()=>page.locator('.film-open[aria-pressed="true"]>span').allTextContents();
async function expectOrder(items){await expect.poll(order).toEqual(items.map(f=>f.name));}
async function originalSources(){for(const [path,digest]of sourceHashes)assert.equal(hash(await readFile(path)),digest,path);}
function nodeProof(node,id){assert(node);assert.equal(node.qualifiers?.find(q=>q.ns===U&&q.name==='Origin')?.node?.value,'label-origin-'+id);}
async function save(f){
 const n=await app.evaluate(()=>globalThis.__labelTrace.saves.length);await button('保存').click();
 await expect.poll(()=>app.evaluate(()=>globalThis.__labelTrace.saves.length)).toBe(n+1);
 await expect.poll(()=>app.evaluate(()=>!!globalThis.__labelTrace.saves.at(-1)?.result)).toBe(true);await idle();
 await expect(card(f).locator('.dirty-dot')).toHaveCount(0);return lookup((await xmp.read(f.sidecar)).properties,XMP_BASIC,'Label');
}
async function exportLabel(f,label,format){
 const path=join(scratch,`current-${f.id}.${format==='jpeg'?'jpg':'tiff'}`);
 const before=await pixels(),updates=await app.evaluate(()=>globalThis.__labelTrace.updates),dirty=await card(f).locator('.dirty-dot').count();
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);
 await button('导出').click();const menu=page.getByRole('dialog',{name:'导出设置'});
 const policy=menu.getByRole('combobox',{name:'输出元数据',exact:true});await policy.scrollIntoViewIfNeeded();await policy.selectOption('all');
 const run=menu.getByRole('button',{name:format==='jpeg'?/^JPEG/:/TIFF · 16 位/});await run.scrollIntoViewIfNeeded();await run.click();
 await expect(page.locator('.job-toast.done')).toContainText('已导出 '+basename(path),{timeout:120000});
 await expect.poll(()=>app.evaluate((_,path)=>globalThis.__labelTrace.single.some(r=>r.result===path),path)).toBe(true);
 const captured=await app.evaluate(()=>globalThis.__labelTrace.single.at(-1).request);assert.equal(captured.document.path,f.path);assert.equal(captured.document.label,label);
 let node=lookup((await xmp.call('file-read','',[],{path,format})).properties,XMP_BASIC,'Label');
 if(label===''&&node===undefined){
  // Keep the SDK file-read failure visible, while independently proving the
  // physical rendered packet still contains the explicit clear + qualifier.
  const packet=execFileSync('exiftool',['-b','-XMP',path],{encoding:'utf8'});
  node=lookup((await xmp.call('read',packet)).properties,XMP_BASIC,'Label');
  findings.push({file:basename(path),issue:'SDK file-read omits present qualified empty Label; raw-packet SDK parse retains it'});
 }
 assert.equal(node?.value,label);nodeProof(node,f.id);
 await button('关闭导出结果').click();await idle();assert.equal(await pixels(),before);assert.equal(await app.evaluate(()=>globalThis.__labelTrace.updates),updates);await expect(card(f).locator('.dirty-dot')).toHaveCount(dirty);
 return path;
}
async function fixtures(){
 for(const [i,f]of files.entries()){
  execFileSync(python,['-c',"from PIL import Image\nimport sys\ni=int(sys.argv[2]);a=Image.new('RGB',(192,128));a.putdata([((x+y+i*11)%256,(x*2+y+i*7)%256,(x+y*2+i*17)%256) for y in range(128) for x in range(192)]);a.save(sys.argv[1])",f.path,String(i)]);
  if(f===a){const packet=(await xmp.call('write','',[property(XMP_BASIC,'Label',{value:'Red',qualifiers:[property(U,'Origin',text('label-origin-A'))]})])).packet;await xmp.call('file-write',packet,[],{path:f.path,format:'tiff'});}
  if(f.iso)execFileSync('exiftool',['-overwrite_original',`-EXIF:ISO=${f.iso}`,f.path],{stdio:'pipe'});
  const properties=[property(XMP_BASIC,'Rating',text(f.rating)),property(U,'Keep',text('unknown-'+f.id))];
  if(f.label!==undefined)properties.push(property(XMP_BASIC,'Label',{value:f.label,qualifiers:[property(U,'Origin',text('label-origin-'+f.id))]}));
  await writeFile(f.sidecar,(await xmp.call('write','',properties)).packet);
  sourceHashes.set(f.path,hash(await readFile(f.path)));sidecarHashes.set(f.sidecar,hash(await readFile(f.sidecar)));
 }
}
try{
 await fixtures();await launch();await open(files);await expectOrder(files);for(const f of files)await badge(f,f.label);
 await expect(status()).toHaveText('无色标');await expect(labelGroup().getByRole('button')).toHaveCount(6);
 await pass('real import displays five standard/custom/empty label cases and preserves the exact arbitrary custom text without a custom-rule editor');
 await select(a);await card(c).locator('.film-open').click({modifiers:['Meta']});await expect(status()).toHaveText('色标不一致');
 const beforePixels=await pixels(),beforeUpdates=await app.evaluate(()=>globalThis.__labelTrace.updates);
 await button('设为绿色色标').click();for(const f of [a,c]){await badge(f,'Green');await expect(card(f).locator('.dirty-dot')).toHaveCount(1);}
 await button('撤销').click();for(const f of [a,c]){await badge(f,f.label);await expect(card(f).locator('.dirty-dot')).toHaveCount(0);}await expect(button('撤销')).toBeDisabled();
 await button('重做').click();for(const f of [a,c])await badge(f,'Green');await button('撤销').click();for(const f of [a,c])await badge(f,f.label);
 for(const f of [b,d,e])await badge(f,f.label);assert.equal(await pixels(),beforePixels);assert.equal(await app.evaluate(()=>globalThis.__labelTrace.updates),beforeUpdates);
 await pass('multi-photo label linking is one shared Undo/Redo step, leaves unselected photos intact, and never invokes native image updates or changes pixels');
 const sortCases=[['name',[e,d,b,c,a],[a,c,b,d,e]],['rating',[b,c,e,a,d],[d,a,e,c,b]],['label',[a,b,d,c,e],[e,c,d,b,a]],['iso',[b,d,c,a,e],[a,c,d,b,e]]];
 for(const [mode,initial,reverse]of sortCases){await sorting().selectOption(mode);await expectOrder(initial);await button('切换排序方向').click();await expectOrder(reverse);}
 await sorting().selectOption('import');await expectOrder(files);await expect(button('切换排序方向')).toBeDisabled();
 await sorting().selectOption('name');await expectOrder([e,d,b,c,a]);await select(d);await card(c).locator('.film-open').click({modifiers:['Shift']});
 await expect.poll(selected).toEqual([d,b,c].map(f=>f.name));await expect(card(d).locator('.film-open')).toHaveAttribute('aria-current','true');
 await pass('filename numeric order, rating, label and ISO directions match displayed order (missing ISO last); Shift selects the displayed contiguous range');
 await button('选择全部').click();const frozen=[e,d,b,c,a];await expect.poll(selected).toEqual(frozen.map(f=>f.name));
 const directory=join(scratch,'frozen-display-order');await mkdir(directory);
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});globalThis.__holdLabelBatch=true;},directory);
 await button('导出').click();const tiff=page.getByRole('dialog',{name:'导出设置'}).getByRole('button',{name:/TIFF · 16 位/});await tiff.scrollIntoViewIfNeeded();await tiff.click();
 await expect.poll(()=>app.evaluate(()=>!!globalThis.__releaseLabelBatch)).toBe(true);
 await button('切换排序方向').click();await labelFilter().selectOption('Red');await expectOrder([a]);
 await app.evaluate(()=>{globalThis.__holdLabelBatch=false;globalThis.__releaseLabelBatch();});
 await expect(page.locator('.job-toast.done')).toContainText('已导出 5/5',{timeout:120000});
 await expect.poll(()=>app.evaluate(()=>globalThis.__labelTrace.batch.at(-1)?.result?.length??0)).toBe(5);
 const batch=await app.evaluate(()=>globalThis.__labelTrace.batch.at(-1));assert.deepEqual(batch.request.documents.map(doc=>doc.path),frozen.map(f=>f.path));assert.deepEqual(batch.result.map(row=>row.source),frozen.map(f=>f.path));
 for(const f of files){const doc=batch.request.documents.find(doc=>doc.path===f.path);assert.equal(doc.label,f.label??'');const row=batch.result.find(row=>row.source===f.path);assert(row.output,JSON.stringify(row));assert.equal(lookup((await xmp.call('file-read','',[],{path:row.output,format:'tiff'})).properties,XMP_BASIC,'Label')?.value??'',f.label??'');}
 await button('关闭导出结果').click();await button('清除筛选').click();await sorting().selectOption('import');await expectOrder(files);
 await pass('actual batch freezes target snapshots and both request/result order to displayed order even when sorting/filtering changes before the backend continues');
 await select(a);await labelFilter().selectOption('Blue');await expectOrder([d]);await expect(page.locator('.document-title')).toContainText(a.name);
 await expect(page.locator('.rating-count')).toContainText('当前照片未通过筛选');await expect(button('导出')).toBeDisabled();await expect(page.locator('.inspector-content')).toHaveAttribute('inert','');
 for(const control of await labelGroup().getByRole('button').all())await expect(control).toBeDisabled();
 await page.locator('.rating-count').click();await page.keyboard.press('6');await button('选择全部').click();await expect.poll(selected).toEqual([d.name]);
 await exportLabel(d,'Blue','tiff');await expect(page.locator('.document-title')).toContainText(a.name);
 await button('设为紫色色标').click();await expect(page.locator('.film-item')).toHaveCount(0);await expect(button('导出')).toBeDisabled();
 await expect(page.getByText('没有符合筛选条件的照片',{exact:true})).toBeVisible();await expect(page.locator('.document-title')).toContainText(a.name);
 await button('清除筛选').click();await badge(a,'Red');await badge(d,'Purple');await expect(card(a).locator('.dirty-dot')).toHaveCount(0);await expect(card(d).locator('.dirty-dot')).toHaveCount(1);
 await button('撤销').click();await badge(d,'Blue');await expect(card(d).locator('.dirty-dot')).toHaveCount(0);
 await labelFilter().selectOption('custom');await ratingFilter().selectOption('4');await expect(page.locator('.film-item')).toHaveCount(0);
 await ratingFilter().selectOption('3');await expectOrder([c]);await button('清除筛选').click();await expectOrder(files);
 await pass('hidden active stays unchanged and uneditable; visible-only label targets may leave the filter, while empty and combined rating/label filters never fall back to hidden active');
 await select(a);await button('清除色标').click();await badge(a,'');await expect(status()).toHaveText('无色标');await expect(card(a).locator('.dirty-dot')).toHaveCount(1);
 const cleared=await save(a);assert.equal(cleared?.value,'');nodeProof(cleared,'A');
 assert.equal(lookup((await xmp.call('file-read','',[],{path:a.path,format:'tiff'})).properties,XMP_BASIC,'Label')?.value,'Red');
 for(const format of ['jpeg','tiff'])await exportLabel(a,'',format);
 await pass('visible Clear writes present empty XMP Label over embedded Red, retains its qualifier and exports current empty Label in both JPEG and TIFF');
 await select(c);await expect(status()).toHaveText('自定义色标：'+custom);await expect(status()).toHaveAttribute('title',custom);
 const retained=await save(c);assert.equal(retained?.value,custom);nodeProof(retained,'C');
 assert.equal(lookup((await xmp.read(c.sidecar)).properties,U,'Keep')?.value,'unknown-C');
 for(const format of ['jpeg','tiff'])await exportLabel(c,custom,format);
 await pass('imported arbitrary Unicode/trailing-space custom Label survives visible save and real JPEG/TIFF export with its unknown qualifier and unrelated metadata');
 await hidden();await closeElectron(app);app=undefined;await launch();await open([a,c]);await badge(a,'');await badge(c,custom);
 await select(a);await expect(status()).toHaveText('无色标');await expect(button('撤销')).toBeDisabled();await expect(button('重做')).toBeDisabled();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 await labelFilter().selectOption('none');await expectOrder([a]);await button('清除筛选').click();await labelFilter().selectOption('custom');await expectOrder([c]);await button('清除筛选').click();
 await pass('fresh App reopening original paths respects saved empty override rather than embedded Red and restores exact custom text/qualifiers without dirty state or history');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));
 for(const control of [ratingFilter(),labelFilter(),sorting(),button('切换排序方向'),...await labelGroup().getByRole('button').all()]){
  await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();await expect(control).toBeInViewport();
 }
 await sorting().selectOption('name');await expectOrder([c,a]);await button('切换排序方向').click();await expectOrder([a,c]);
 await pass('minimum hidden window keeps five standard-colour buttons, Clear, combined filters, sorting and direction visible and operable');
 await originalSources();for(const f of [b,d,e])assert.equal(hash(await readFile(f.sidecar)),sidecarHashes.get(f.sidecar));
 assert.deepEqual(errors,[]);await pass('all source bytes and untouched sidecars remain unchanged; only explicit saves change their own temporary sidecars, with hidden unfocused windows and no renderer errors');
 assert.deepEqual(findings,[],'SDK file-read must preserve explicit empty Label with qualifiers');
 passed=true;console.log(JSON.stringify({passed,checks,scope:'production App/main/native/SDK hidden GUI, no build or installed-package claim'}));
}catch(error){failure=error;}
finally{
 if(app){
  await app.evaluate(()=>globalThis.__releaseLabelBatch?.()).catch(()=>{});
  if(failure){if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});await writeFile(join(scratch,'failure.json'),JSON.stringify({failure:failure.stack||String(failure),checks,findings,errors,diagnostics:electronDiagnostics(app)},null,2));}
  try{await closeElectron(app);}catch(error){failure??=error;passed=false;await writeFile(join(scratch,'shutdown-failure.txt'),String(error));}
 }else if(failure)await writeFile(join(scratch,'failure.json'),JSON.stringify({failure:failure.stack||String(failure),diagnostics:failure.electronDiagnostics},null,2));
 if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Labels App failure retained:',scratch);
}
if(failure)throw failure;
