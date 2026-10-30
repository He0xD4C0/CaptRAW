// Run only against a coordinated native/UI build. No build step or product hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,readdir} from 'node:fs/promises';
import {join,resolve,basename,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {XMP,CRS,CT,TIFF,XMP_BASIC,lookup,property,text} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {DEFAULT_EXPORT_OPTIONS} from '@captraw/contracts/export-options';
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),U='https://example.invalid/baked-app/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sidecar=path=>path.slice(0,-extname(path).length)+'.xmp';
const snapshot=image=>({path:image.path,width:image.width,height:image.height,artProfile:image.recipe?.artProfile||image.artProfile||'',adjustments:image.adjustments,sourceIdentity:image.sourceIdentity,rating:image.rating,label:image.label,xmpPacket:image.recipe?.xmpPacket});
async function packet(flag='True',look=true){
 const nodes=[property(CRS,'AlreadyApplied',text(flag)),property(CRS,'HasSettings',text('True')),property(CRS,'Exposure2012',text(1)),property(CRS,'HDREditMode',text(1)),property(XMP_BASIC,'Rating',text(4)),property(XMP_BASIC,'Label',text('自定义 蓝标签')),
  property(CRS,'FutureBaked',{items:[{fields:[property(U,'Secret',{value:'do-not-export-旧蒙版',qualifiers:[property(U,'Proof',text('qualified original'))]})]}],options:0x600})];
 if(look)nodes.push(property(CRS,'Look',{fields:[property(CRS,'Parameters',{fields:[property(CRS,'CameraProfile',text('missing-baked-only.dcp')),property(CRS,'LookTable',text('0123456789ABCDEF0123456789ABCDEF'))]})]}));
 return (await xmp.call('write','',nodes)).packet;
}
async function rendered(root,name,format,orientation=false){
 const path=join(root,name+'.'+(format==='jpeg'?'jpg':'tiff'));
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',`from PIL import Image
import numpy as np,tifffile,sys
a=np.zeros((96,128,3),dtype=np.uint8);a[:,:64]=[80,100,120];a[:,64:]=[130,95,60];a[:24,:32]=[40,70,120]
if sys.argv[2]=='jpeg':Image.fromarray(a).save(sys.argv[1],quality=95)
else:tifffile.imwrite(sys.argv[1],a.astype(np.uint16)*257,photometric='rgb',metadata=None)`,path,format]);
 if(orientation)execFileSync('exiftool',['-overwrite_original','-EXIF:Orientation#=6',path],{stdio:'pipe'});
 return path;
}
async function scenario(run){
 const root=await mkdtemp(join(tmpdir(),'captraw-already-applied-app-'));let app,page,passed=false;
 try{
  console.log('artifacts',JSON.stringify(Object.fromEntries(await Promise.all(['build/native/captraw-engine','apps/desktop/dist/electron/main.cjs','apps/desktop/dist/renderer/index.html'].map(async path=>[path,hash(await readFile(path))])))));
  app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'user-data'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({app,BrowserWindow,ipcMain,dialog})=>{
   const state=globalThis.__aa={images:[],opens:[],saves:[],events:[],savePath:null,gate:null};
   const watch=w=>{for(const event of ['show','focus'])w.on(event,()=>state.events.push(event));};BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_,w)=>watch(w));
   for(const [channel,key]of [['image:open','images'],['session:save','saves']]){
    const original=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{const result=await original(...args);state[key].push(structuredClone(result));return result;});
   }
   dialog.showMessageBox=async(...args)=>{const options=args.at(-1);if(options.message==='确认保存这些 XMP 旁车？'||options.message.startsWith('放弃 ')||options.message.startsWith('保存“'))return {response:1};throw new Error('Unexpected native dialog '+options.message);};
   dialog.showSaveDialog=async()=>{if(!state.savePath)throw new Error('Test requires an explicit destination');return {canceled:false,filePath:state.savePath};};
   const cp=process.getBuiltinModule('node:child_process'),spawn=cp.spawn;
   cp.spawn=function(...args){const child=spawn.apply(this,args);if(!/captraw-engine(?:\.exe)?$/.test(String(args[0])))return child;
    const write=child.stdin.write;child.stdin.write=function(chunk,...rest){
     try{for(const line of String(chunk).trim().split('\n')){const request=JSON.parse(line);if(request.method==='open')state.opens.push(request.params);
      // A real inventory request occurs after recipe:save has read its target.
      if(request.method==='maskAssets'&&state.gate&&!state.gate.reached){const fs=process.getBuiltinModule('node:fs');fs.writeFileSync(state.gate.path,state.gate.packet);state.gate.reached=true;}
     }}catch(error){if(state.gate)state.gate.error=String(error);}
     return write.call(this,chunk,...rest);
    };return child;
   };
  });
  await page.evaluate(()=>{window.__aaFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__aaFrames.push(e.frame);});});
  const button=name=>page.getByRole('button',{name,exact:true});
  async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const f=window.__aaFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});await expect(page.getByRole('alert')).toHaveCount(0);}
  async function open(path){const before=await app.evaluate(()=>globalThis.__aa.images.length),frames=await page.evaluate(()=>window.__aaFrames.length);await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await button('打开').click();await expect.poll(()=>app.evaluate(()=>globalThis.__aa.images.length)).toBeGreaterThan(before);await page.waitForFunction(n=>window.__aaFrames.length>n,frames);await idle();return app.evaluate(()=>globalThis.__aa.images.at(-1));}
  async function settle(action){const frames=await page.evaluate(()=>window.__aaFrames.length);await action();await page.waitForFunction(n=>window.__aaFrames.length>n,frames);await idle();}
  const pixels=()=>page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL());
  await run({root,app,page,open,idle,settle,pixels,button});assert.deepEqual(errors,[]);
  const hidden=await app.evaluate(({BrowserWindow})=>({events:globalThis.__aa.events,windows:BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()}))}));
  assert.deepEqual(hidden.events,[]);assert(hidden.windows.length&&hidden.windows.every(w=>!w.visible&&!w.focused&&!w.focusable));passed=true;
 }catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:error.stack||String(error),diagnostics:app?electronDiagnostics(app):undefined},null,2));if(page)await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});throw error;}
 finally{if(app)await closeElectron(app);if(passed)await rm(root,{recursive:true,force:true});else console.error('AlreadyApplied App failure retained:',root);}
}

for(const format of ['jpeg','tiff']){
 test(`${format}: visible embedded True uses current defaults and False applies actual edits`,()=>scenario(async({root,app,page,open,pixels})=>{
  const baseline=await rendered(root,'plain',format),baked=join(root,'baked'+extname(baseline)),active=join(root,'active'+extname(baseline));await copyFile(baseline,baked);await copyFile(baseline,active);
  await xmp.call('file-write',await packet(),[],{path:baked,format});
  const falsePacket=(await xmp.call('write',await packet('False',false),[property(CRS,'HDREditMode',text(0))])).packet;
  await xmp.call('file-write',falsePacket,[],{path:active,format});
  const originals=await Promise.all([baseline,baked,active].map(path=>readFile(path))),plain=await open(baseline),plainPixels=await pixels(),image=await open(baked);
  assert.equal(image.adjustments.exposure,plain.adjustments.exposure);assert.equal(image.adjustments.hdrEnabled,plain.adjustments.hdrEnabled);assert.equal(await pixels(),plainPixels);
  assert.equal(image.rating,4);assert.equal(image.label,'自定义 蓝标签');assert(lookup((await xmp.call('read',image.recipe.xmpPacket)).properties,CT,'BakedCRS'));
  let request=await app.evaluate(()=>globalThis.__aa.opens.at(-1));assert.equal(request.effectsDefaults,'current');assert.equal(request.whiteBalanceDefaults,'current');
  const edited=await open(active);assert.equal(edited.adjustments.exposure,1);await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('1');assert.notEqual(await pixels(),plainPixels);
  request=await app.evaluate(()=>globalThis.__aa.opens.at(-1));assert.equal(request.effectsDefaults,'legacy');
  for(const [index,path]of [baseline,baked,active].entries())assert.deepEqual(await readFile(path),originals[index]);
 }));

 test(`${format}: external sidecar wins over embedded edits, and explicit XMP True stays inactive`,()=>scenario(async({root,page,open,pixels})=>{
  const baseline=await rendered(root,'sidecar-baseline',format),plain=await open(baseline),reference=await pixels();
  for(const explicit of [false,true]){
   const path=await rendered(root,'sidecar-'+explicit,format);await xmp.call('file-write',await packet('False',false),[],{path,format});const bytes=await readFile(path);
   await writeFile(sidecar(path),await packet());const image=await open(explicit?sidecar(path):path);
   assert.equal(image.adjustments.exposure,plain.adjustments.exposure);assert.equal(image.adjustments.hdrEnabled,plain.adjustments.hdrEnabled);assert.equal(image.rating,4);assert.equal(image.label,'自定义 蓝标签');
   await expect(page.getByRole('button',{name:'HDR 编辑',exact:true})).toHaveAttribute('aria-pressed','false');assert.equal(await pixels(),reference);
   const properties=(await xmp.call('read',image.recipe.xmpPacket)).properties;assert(lookup(properties,CT,'BakedCRS'));assert.equal(lookup(properties,CRS,'Look'),undefined);
   assert.deepEqual(await readFile(path),bytes);
  }
 }));

 test(`${format}: no-CRS EXIF Orientation6 and metadata-only embedded packets keep native frame/pixels/current defaults`,()=>scenario(async({root,app,open,pixels})=>{
  const baseline=await rendered(root,'oriented-plain',format,true),bytes=await readFile(baseline),plain=await open(baseline),reference=await pixels();
  for(const labeled of [false,true]){
   const path=join(root,'oriented-'+labeled+extname(baseline));await copyFile(baseline,path);
   const nodes=[property(TIFF,'Orientation',text(6))];if(labeled)nodes.push(property(XMP_BASIC,'Rating',text(4)),property(XMP_BASIC,'Label',text('仅元数据')));
   await xmp.call('file-write',(await xmp.call('write','',nodes)).packet,[],{path,format});const original=await readFile(path),image=await open(path);
   assert.equal(image.width,plain.width);assert.equal(image.height,plain.height);assert.deepEqual(image.sourceFrame,plain.sourceFrame);
   for(const key of ['rotation','flipHorizontal','flipVertical'])assert.equal(image.adjustments[key],plain.adjustments[key]);
   assert.equal(await pixels(),reference);if(labeled){assert.equal(image.rating,4);assert.equal(image.label,'仅元数据');}
   const request=await app.evaluate(()=>globalThis.__aa.opens.at(-1));assert.equal(request.effectsDefaults,'current');assert.equal(request.whiteBalanceDefaults,'current');assert.equal(request.sourceFramePolicy,'active-area-v1');assert.deepEqual(await readFile(path),original);
  }
  const command=await rendered(root,'explicit-orientation',format);await writeFile(sidecar(command),(await xmp.call('write','',[property(TIFF,'Orientation',text(6))])).packet);
  const image=await open(sidecar(command));assert.equal(image.adjustments.rotation,90);assert.deepEqual(await readFile(baseline),bytes);
 }));
}

test('real ACR embedded active False TIFF opens its full-zero gradient without a sidecar',()=>scenario(async({root,page,open})=>{
 const source=resolve('artifacts/stage-0/acr-reference/linear-gradient-active-187/inputs/controlled-linear-active.tif'),bytes=await readFile(source),path=join(root,'real-active.tif');
 assert.equal(hash(bytes),'f138e1c921e02e7237e020c0496572ae44f35ad46a2219fd8c0ce8d2884a1bfb');await copyFile(source,path);
 const image=await open(path),leaf=image.adjustments.masks[0].components[0];assert.equal(leaf.type,'linear');assert.equal(leaf.linearGradientModel,'full-zero-v1');assert.deepEqual(leaf.start,{x:.315451,y:.499285});assert.deepEqual(leaf.end,{x:.625417,y:.499285});
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await expect(page.getByText('蒙版 1',{exact:true}).first()).toBeVisible();assert.deepEqual(await readFile(source),bytes);assert.deepEqual(await readFile(path),bytes);
}));

test('visible legacy warning, all three real save paths, reopen and JPEG/TIFF output keep old baked CRS inactive',()=>scenario(async({root,app,page,open,idle,settle,button})=>{
 const path=await rendered(root,'legacy','tiff'),bytes=await readFile(path),identity={path:basename(path),size:bytes.length,sha256:hash(bytes)};
 const active=await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:identity,artProfile:'',adjustments:{exposure:.75},rating:4,label:'迁移色标'});
 const legacy=(await xmp.call('write',active,[property(CRS,'AlreadyApplied',text('True')),property(CRS,'FutureBaked',lookup((await xmp.call('read',await packet())).properties,CRS,'FutureBaked'))])).packet;await writeFile(sidecar(path),legacy);
 let image=await open(path);assert.equal(image.adjustments.exposure,.75);await expect(page.locator('.xmp-notice summary')).toBeVisible();if(await page.locator('.xmp-notice').getAttribute('open')===null)await page.locator('.xmp-notice summary').click();await expect(page.locator('.xmp-notice')).toContainText('AlreadyApplied=True');await expect(page.locator('.xmp-notice p').filter({hasText:'原有显影外观已保留'})).toBeVisible();
 const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await settle(async()=>{await exposure.fill('.25');await exposure.press('Tab');});const saves=await app.evaluate(()=>globalThis.__aa.saves.length);await button('保存').click();await expect.poll(()=>app.evaluate(()=>globalThis.__aa.saves.length)).toBe(saves+1);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await idle();
 const session=await app.evaluate(()=>globalThis.__aa.saves.at(-1));assert.equal(session.results[0].error,undefined);const saved=session.results[0].xmpPacket;
 const assertSaved=async output=>{const properties=(await xmp.read(output)).properties;assert.equal(lookup(properties,CRS,'AlreadyApplied').value,'False');assert.equal(lookup(properties,CRS,'FutureBaked'),undefined);assert(lookup(properties,CT,'BakedCRS'));assert.equal(Number(lookup(properties,CRS,'Exposure2012').value),.25);};
 await assertSaved(sidecar(path));await button('关闭文件').click();image=await open(sidecar(path));assert.equal(image.adjustments.exposure,.25);assert.equal(image.label,'迁移色标');
 const batchDirectory=join(root,'batch');await mkdir(batchDirectory);await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},batchDirectory);
 const doc={...snapshot(image),xmpPacket:saved};const batch=await page.evaluate(doc=>window.captraw.saveSelected({documents:[doc]}),doc);assert.equal(batch.results[0].error,undefined);await assertSaved(batch.results[0].output);
 const explicit=join(root,'explicit.xmp');await writeFile(explicit,(await xmp.call('write','',[property(CRS,'AlreadyApplied',text('False')),property(U,'Latest',text('new external metadata'))])).packet);
 await app.evaluate((_,path)=>{globalThis.__aa.savePath=path;},explicit);await page.evaluate(image=>window.captraw.save(image,image.recipe?.artProfile||image.artProfile||''),image);await assertSaved(explicit);assert.equal(lookup((await xmp.read(explicit)).properties,U,'Latest').value,'new external metadata');
 const replacement=await packet();await app.evaluate((_,gate)=>{globalThis.__aa.gate=gate;},{path:explicit,packet:replacement,reached:false});
 await assert.rejects(page.evaluate(image=>window.captraw.save(image,image.recipe?.artProfile||image.artProfile||''),image),/XMP.*外部修改.*未覆盖原数据/);assert.equal(await app.evaluate(()=>globalThis.__aa.gate.reached),true);assert.equal(await readFile(explicit,'utf8'),replacement);await app.evaluate(()=>{globalThis.__aa.gate=null;});
 for(const format of ['jpeg','tiff']){
  const output=join(root,'output.'+(format==='jpeg'?'jpg':'tiff'));await app.evaluate((_,path)=>{globalThis.__aa.savePath=path;},output);
  const options={...structuredClone(DEFAULT_EXPORT_OPTIONS),metadata:{include:'all',removeLocation:false}};
  assert.equal(await page.evaluate(request=>window.captraw.export(request),{document:doc,format,colorSpace:'srgb',options}),output);
  const properties=(await xmp.call('file-read','',[],{path:output,format})).properties;assert.equal(lookup(properties,CT,'BakedCRS'),undefined);assert.equal(lookup(properties,CRS,'FutureBaked'),undefined);assert.equal(lookup(properties,CRS,'AlreadyApplied').value,'True');assert(!(await readFile(output)).includes(Buffer.from('do-not-export-旧蒙版')));
  const renderedImage=await open(output);assert.equal(renderedImage.adjustments.exposure,0);assert.equal(renderedImage.rating,4);assert.equal(renderedImage.label,'迁移色标');
 }
 assert.deepEqual(await readFile(path),bytes);assert(!(await readdir(root)).some(name=>name.endsWith('.tmp')||name.startsWith('.session-save-')));
}));
