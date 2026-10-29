import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {XMP,CRS,CT,lookup,property,text} from '@captraw/desktop-core/xmp';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Existing production main/preload/native only. Build coordination is external.
// File handlers, rather than Exiv2's metadataPacket, are the XMP fidelity oracle.
const scratch=await mkdtemp(join(tmpdir(),'captraw-output-metadata-app-'));
const python=resolve('build/qa-venv/bin/python'),xmp=new XMP(resolve('build/xmp/captraw-xmp'));
const DC='http://purl.org/dc/elements/1.1/',EXIF='http://ns.adobe.com/exif/1.0/';
const PS='http://ns.adobe.com/photoshop/1.0/',U='https://example.invalid/output-metadata-gui/';
const fixtures=['A','B'].map((id,i)=>({id,path:join(scratch,`照片 ${id}.tiff`),sidecar:join(scratch,`照片 ${id}.xmp`),
 exposure:[.25,.75][i],copyright:`current copyright ${id}`,author:`current author ${id}`,packet:''}));
const checks=[],errors=[],findings=[],outputs=[],originals=new Map();let app,page,passed=false,failure;
const button=name=>page.getByRole('button',{name,exact:true});
const photo=f=>page.locator('.film-item').filter({hasText:basename(f.path)});
const menu=()=>page.getByRole('dialog',{name:'导出设置',exact:true});
const metadata=()=>menu().getByRole('combobox',{name:'输出元数据',exact:true});
const removeLocation=()=>menu().getByRole('checkbox',{name:'移除输出位置信息',exact:true});
const exposure=()=>page.getByRole('spinbutton',{name:'曝光',exact:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const latestRevision=()=>page.evaluate(()=>window.__metadataFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1);
async function unchangedFiles(){for(const [file,digest]of originals)assert.equal(hash(await readFile(file)),digest,file);}
async function hidden(){
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>({events:globalThis.__metadataWindowEvents,
  hidden:BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable())})),{events:[],hidden:true});
}
async function pass(message){await hidden();checks.push(message);console.log('PASS',message);}
async function idle(){
 await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__metadataFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function nextPreview(previous){
 await page.waitForFunction(r=>(window.__metadataFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,previous);await idle();
}
async function open(f,count){
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},f.path);
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(count);await idle();
 await button('编辑').click();await expect(exposure()).toHaveValue(String(f.exposure));
}
async function select(f){
 await photo(f).locator('.film-open').click();await expect(photo(f).locator('.film-open')).toHaveAttribute('aria-current','true');await idle();
}
async function state(){
 const dirty={};for(const f of fixtures)if(await photo(f).count())dirty[f.id]=await photo(f).locator('.dirty-dot').count();
 return {exposure:await exposure().inputValue(),dirty,undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled()};
}
async function choosePolicy(include,remove){
 await button('导出').click();await expect(menu()).toBeVisible();
 await metadata().scrollIntoViewIfNeeded();await expect(metadata()).toBeInViewport();await metadata().selectOption(include);
 await removeLocation().scrollIntoViewIfNeeded();await expect(removeLocation()).toBeInViewport();
 if(include==='copyright'||include==='none')await expect(removeLocation()).toBeDisabled();
 else{await expect(removeLocation()).toBeEnabled();await removeLocation().setChecked(remove);}
 const tiff=menu().getByRole('button',{name:'TIFF · 16 位',exact:false});
 await tiff.scrollIntoViewIfNeeded();await expect(tiff).toBeInViewport();return tiff;
}
async function exportOne(include,remove,name){
 const before=await state(),path=join(scratch,name+'.tiff');
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);
 await (await choosePolicy(include,remove)).click();
 await expect(page.locator('.job-toast.done')).toContainText('已导出 '+basename(path),{timeout:120000});
 await expect.poll(()=>app.evaluate((_,path)=>globalThis.__metadataSingle.some(r=>r.output===path),path)).toBe(true);
 await button('关闭导出结果').click();await idle();assert.deepEqual(await state(),before);await unchangedFiles();
 outputs.push({path,reference:outputs[0]?.path||path});return path;
}
function values(node){return node?[node.value,node.localized,...(node.items||[]).flatMap(values),...(node.fields||[]).flatMap(p=>values(p.node))].filter(v=>typeof v==='string'):[];}
function walk(properties){
 const result=[];const visit=ps=>{for(const p of ps){result.push(p);const n=p.node;if(!n)continue;visit(n.fields||[]);visit(n.qualifiers||[]);for(const item of n.items||[])visitNode(item);}};
 const visitNode=n=>{visit(n.fields||[]);visit(n.qualifiers||[]);for(const item of n.items||[])visitNode(item);};visit(properties);return result;
}
function qualified(properties,ns,name,proof){
 const node=lookup(properties,ns,name);assert(node,`${name} missing`);
 assert.equal(node.qualifiers?.find(p=>p.ns===U&&p.name==='Proof')?.node?.value,proof,`${name} qualifier`);return node;
}
async function inspect(path,f,include,remove){
 const result=await xmp.call('file-read','',[],{path,format:'tiff'}),properties=result.properties;
 const actual=JSON.parse(execFileSync('exiftool',['-j','-G1','-s','-n',path],{encoding:'utf8'}))[0];
 const bytes=await readFile(path);assert(!bytes.includes(Buffer.from(f.path)),'original source path in output bytes');
 const privateDevelop=new Set(['EngineVersion','Source','ARTProfile','BaselineVersion','MaskAssets','InputProfileAsset','ARTAdjustments','ARTWhiteBalanceCoordinates']);
 const leaked=properties.filter(p=>p.ns===CT&&privateDevelop.has(p.name));
 if(leaked.length)findings.push({output:basename(path),include,privateDevelop:leaked.map(p=>p.name)});
 if(include==='all'||include==='all-except-develop'){
  assert.equal(qualified(properties,U,'Keep',`unknown-qualified-${f.id}`).value,`opaque-${f.id}`);
  assert.equal(lookup(properties,U,'CurrentPacket')?.value,`currentpacket-${f.id}`);
  assert.equal(lookup(properties,U,'SourceOnly')?.value,`source-only-${f.id}`);
 }
 if(include!=='none'){
  assert(values(lookup(properties,DC,'rights')).includes(f.copyright));assert(values(lookup(properties,DC,'creator')).includes(f.author));
  assert.equal(actual['IFD0:Copyright'],f.copyright);assert.equal(actual['IFD0:Artist'],f.author);assert.equal(actual['IPTC:CopyrightNotice'],f.copyright);
 }
 if(include==='all'){
  assert.equal(Number(qualified(properties,CRS,'Exposure2012',`managed-qualified-${f.id}`).value),f.id==='A'?1.25:.75);
  assert.equal(lookup(properties,CRS,'AlreadyApplied')?.value,'True');
 }else assert(!properties.some(p=>p.ns===CRS),'develop settings must be absent');
 const location=walk(properties).filter(p=>p.ns===EXIF&&p.name.startsWith('GPS')||p.ns===PS&&p.name==='City');
 if(remove||include==='copyright'||include==='none'){
  assert.equal(location.length,0,'XMP location (including nested fields/qualifiers)');
  assert(!Object.keys(actual).some(k=>k.startsWith('GPS:')),'actual EXIF GPS');assert.equal(actual['IPTC:City'],undefined);
  for(const marker of ['GPSLatitude','GPSLongitude','GPSAltitude',`private city ${f.id}`])assert(!bytes.includes(Buffer.from(marker)),`location remains in physical output bytes: ${marker}`);
 }else{
  assert.match(lookup(properties,EXIF,'GPSLatitude')?.value||'',/^31,6(?:,0)?N$/);assert(Math.abs(actual['GPS:GPSLatitude']-31.1)<1e-8);assert.equal(actual['IPTC:City'],`current private city ${f.id}`);
 }
 if(include==='copyright'||include==='none'){
  assert(!properties.some(p=>p.ns===U));assert.equal(actual['IFD0:ImageDescription'],undefined);
  assert.equal(actual['IPTC:City'],undefined);assert.equal(lookup(properties,EXIF,'GPSLatitude'),undefined);
 }
 if(include==='none')for(const key of ['IFD0:Copyright','IFD0:Artist','IPTC:CopyrightNotice'])assert.equal(actual[key],undefined,key);
 assert.equal(actual['IFD0:Orientation'],1);return result;
}
async function fixtureFiles(){
 for(const [i,f]of fixtures.entries()){
  execFileSync(python,['-c',"from PIL import Image\nimport sys\ni=int(sys.argv[2]);a=Image.new('RGB',(320,224));a.putdata([((x*2+y+i*17)%256,(y*2+x+i*11)%256,(x+y*3+i*7)%256) for y in range(224) for x in range(320)]);a.save(sys.argv[1])",f.path,String(i)]);
  const embedded=(await xmp.call('write','',[
   property(DC,'rights',{localized:`old embedded copyright ${f.id}`}),property(DC,'creator',{items:[text(`old embedded author ${f.id}`)],options:0x600}),
   property(U,'SourceOnly',text(`source-only-${f.id}`)),property(CRS,'Exposure2012',text(-2)),
  ])).packet;
  await xmp.call('file-write',embedded,[],{path:f.path,format:'tiff'});
  // Only our generated TIFFs are passed to the independent metadata writer.
  execFileSync('exiftool',['-overwrite_original','-GPSLatitude=31.1','-GPSLongitude=121.2','-GPSLatitudeRef=N','-GPSLongitudeRef=E',
   `-IPTC:City=private city ${f.id}`,`-IPTC:CopyrightNotice=old physical copyright ${f.id}`,`-EXIF:Copyright=old physical copyright ${f.id}`,f.path],{stdio:'pipe'});
  f.packet=(await xmp.call('write','',[
   property(DC,'rights',{localized:f.copyright}),property(DC,'creator',{items:[text(f.author)],options:0x600}),
   property(U,'CurrentPacket',text(`currentpacket-${f.id}`)),
   property(U,'Keep',{value:`opaque-${f.id}`,qualifiers:[property(U,'Proof',text(`unknown-qualified-${f.id}`)),property(EXIF,'GPSAltitude',text(123))]}),
   property(U,'Nested',{fields:[property(U,'Leaf',text(`nested-${f.id}`)),property(EXIF,'GPSLongitude',text('121,12E'))]}),
   property(CRS,'Exposure2012',{value:String(f.exposure),qualifiers:[property(U,'Proof',text(`managed-qualified-${f.id}`))]}),
   property(EXIF,'GPSLatitude',text('31,6N')),property(EXIF,'GPSLongitude',text('121,12E')),property(PS,'City',text(`current private city ${f.id}`)),
  ])).packet;
  await writeFile(f.sidecar,f.packet);for(const path of [f.path,f.sidecar])originals.set(path,hash(await readFile(path)));
 }
}
try{
 await fixtureFiles();
 // Empty overrides ensure the default production main/native, even in a shell
 // previously configured to test an installed package or a development server.
 app=await electron.launch({env:{CAPTRAW_APP:'',CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__metadataFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__metadataFrames.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog,app,BrowserWindow})=>{
  globalThis.__metadataWindowEvents=[];const watch=w=>{for(const event of ['show','focus'])w.on(event,()=>globalThis.__metadataWindowEvents.push(event));};
  BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
  globalThis.__metadataSingle=[];globalThis.__metadataBatch=[];globalThis.__metadataSaves=0;
  for(const [channel,key]of [['image:export','__metadataSingle'],['images:export','__metadataBatch']]){
   const original=ipcMain._invokeHandlers.get(channel);assertHandler(original,channel);ipcMain.removeHandler(channel);
   ipcMain.handle(channel,async(event,request)=>{const record={request:structuredClone(request)};globalThis[key].push(record);record.output=await original(event,request);return record.output;});
  }
  function assertHandler(handler,name){if(!handler)throw new Error('Missing production IPC: '+name);}
  for(const channel of ['session:save','recipes:save','recipe:save']){
   const original=ipcMain._invokeHandlers.get(channel);if(!original)continue;ipcMain.removeHandler(channel);
   ipcMain.handle(channel,async(...args)=>{globalThis.__metadataSaves++;return original(...args);});
  }
  dialog.showMessageBox=async(...args)=>{throw new Error('Unexpected native message dialog: '+args.at(-1).message);};
 });
 const [a,b]=fixtures;await open(a,1);await expect(button('撤销')).toBeDisabled();await expect(button('重做')).toBeDisabled();
 let previous=await latestRevision();await exposure().fill('1.25');await exposure().press('Tab');await nextPreview(previous);
 await expect(exposure()).toHaveValue('1.25');await expect(photo(a).locator('.dirty-dot')).toHaveCount(1);
 const editing=await state();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await idle();
 await button('导出').click();await metadata().scrollIntoViewIfNeeded();await expect(metadata()).toBeInViewport();
 assert.deepEqual(await metadata().locator('option').evaluateAll(options=>options.map(o=>o.value).sort()),['all','all-except-develop','copyright','none']);
 await expect(metadata()).toHaveValue('all-except-develop');await removeLocation().scrollIntoViewIfNeeded();await expect(removeLocation()).toBeInViewport();await expect(removeLocation()).not.toBeChecked();
 await page.keyboard.press('Escape');await expect(menu()).toHaveCount(0);assert.deepEqual(await state(),editing);
 await pass('small hidden window exposes all four metadata policies and the location checkbox through visible scrolling without editing');
 const all=await exportOne('all',false,'all-current');await inspect(all,a,'all',false);
 let request=await app.evaluate(()=>globalThis.__metadataSingle.at(-1).request);
 assert.equal(request.document.adjustments.exposure,1.25);assert.equal(request.document.xmpPacket,a.packet);
 assert.equal(Number(lookup((await xmp.call('read',request.document.xmpPacket)).properties,CRS,'Exposure2012').value),.25);
 await pass('actual All TIFF uses unsaved exposure 1.25 with current sidecar copyright/author, unknown and managed qualifiers, and AlreadyApplied=True');
 const privateOutput=await exportOne('all',true,'all-without-location');await inspect(privateOutput,a,'all',true);
 await pass('Remove Location strips actual EXIF GPS, IPTC City and recursive XMP GPS while preserving current non-location qualified metadata');
 const withoutDevelop=await exportOne('all-except-develop',false,'without-develop');await inspect(withoutDevelop,a,'all-except-develop',false);
 await pass('All Except Develop preserves current copyright and unknown qualifiers while excluding all develop namespaces');
 for(const include of ['copyright','none'])await inspect(await exportOne(include,false,include),a,include,false);
 await pass('Copyright and None filter actual EXIF/IPTC/XMP descriptive metadata according to the selected visible policy');
 previous=await latestRevision();await button('撤销').click();await nextPreview(previous);await expect(exposure()).toHaveValue('0.25');
 await expect(photo(a).locator('.dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();
 previous=await latestRevision();await button('重做').click();await nextPreview(previous);await expect(exposure()).toHaveValue('1.25');assert.deepEqual(await state(),editing);
 await pass('single exports never save or add history: one Undo restores sidecar exposure/clean state and one Redo restores the sole unsaved edit');
 await open(b,2);await expect(photo(a).locator('.dirty-dot')).toHaveCount(1);await expect(photo(b).locator('.dirty-dot')).toHaveCount(0);
 await button('选择全部').click();await expect(page.locator('.film-open[aria-pressed="true"]')).toHaveCount(2);
 const batchState=await state(),directory=join(scratch,'批量 输出');await mkdir(directory);
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},directory);
 await (await choosePolicy('all',true)).click();await expect(page.locator('.job-toast.done')).toContainText('已导出 2/2',{timeout:120000});
 await expect.poll(()=>app.evaluate(()=>globalThis.__metadataBatch.at(-1)?.output?.length??0)).toBe(2);
 const batch=await app.evaluate(()=>globalThis.__metadataBatch.at(-1));assert.equal(batch.request.documents.length,2);
 for(const f of fixtures){
  const doc=batch.request.documents.find(d=>d.path===f.path);assert(doc);assert.equal(doc.adjustments.exposure,f.id==='A'?1.25:.75);assert.equal(doc.xmpPacket,f.packet);
  const output=batch.output.find(r=>r.source===f.path);assert(output?.output,JSON.stringify(output));await inspect(output.output,f,'all',true);
  outputs.push({path:output.output,reference:f.id==='A'?all:output.output});
 }
 await button('关闭导出结果').click();await idle();assert.deepEqual(await state(),batchState);await unchangedFiles();
 await pass('real two-photo All + Remove Location batch uses A 1.25/B .75 and each document’s current copyright, author and qualified packet while B is active');
 // B is active and unchanged; undoing A must not require a new B preview.
 await button('撤销').click();await expect(photo(a).locator('.dirty-dot')).toHaveCount(0);await idle();await expect(exposure()).toHaveValue('0.75');
 await expect(photo(a).locator('.dirty-dot')).toHaveCount(0);await expect(photo(b).locator('.dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();
 await select(a);await expect(exposure()).toHaveValue('0.25');previous=await latestRevision();await button('重做').click();await nextPreview(previous);
 await expect(exposure()).toHaveValue('1.25');await expect(photo(a).locator('.dirty-dot')).toHaveCount(1);await expect(photo(b).locator('.dirty-dot')).toHaveCount(0);
 await pass('batch export preserves both documents’ dirty states and adds no history; one Undo/Redo still targets only A’s exposure edit');
 execFileSync(python,['-c',`from PIL import Image
import sys,json,numpy as np,tifffile
items=json.loads(sys.argv[1]);icc=None
for item in items:
 p=item['path'];im=Image.open(p);assert im.format=='TIFF' and im.size==(320,224);profile=im.info.get('icc_profile');assert profile,p
 if icc is None:icc=profile
 else:assert profile==icc,p
 with tifffile.TiffFile(p) as t:
  a=t.asarray();assert a.dtype==np.uint16 and t.pages[0].bitspersample==16;assert t.pages[0].samplesperpixel==3;assert t.pages[0].tags[34675].value==profile
 assert np.array_equal(a,tifffile.imread(item['reference'])),p
 assert np.any(a[:,:,0]!=a[:,:,1]),p
print(json.dumps({'verifiedTIFF16':len(items),'pixelDifferenceAcrossPoliciesAndBatchA':0,'iccIdentical':True}))`,JSON.stringify(outputs)],{stdio:'inherit'});
 assert.equal(await app.evaluate(()=>globalThis.__metadataSaves),0);assert.deepEqual(errors,[]);await unchangedFiles();
 await pass('independent PIL/tifffile prove identical RGB16 pixels and ICC across metadata policies; all original TIFF/XMP hashes stay unchanged and no save IPC occurs');
 assert.deepEqual(findings,[],'private develop fields leaked into rendered output');
 passed=true;console.log(JSON.stringify({passed,checks,scope:'production App/main/native/SDK file handler, hidden GUI; no installed-package claim'}));
}catch(error){failure=error;}
finally{
 if(app){
  if(failure){
   if(page&&!page.isClosed())await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});
   await writeFile(join(scratch,'failure.json'),JSON.stringify({failure:failure.stack||String(failure),checks,findings,errors,diagnostics:electronDiagnostics(app)},null,2));
  }
  try{await closeElectron(app);}catch(error){failure??=error;passed=false;await writeFile(join(scratch,'shutdown-failure.txt'),String(error));}
 }else if(failure)await writeFile(join(scratch,'failure.json'),JSON.stringify({failure:failure.stack||String(failure),diagnostics:failure.electronDiagnostics},null,2));
 if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Output metadata failure retained:',scratch);
}
if(failure)throw failure;
