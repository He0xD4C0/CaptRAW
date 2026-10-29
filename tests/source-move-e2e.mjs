import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP,lookup,property,text} from '@captraw/desktop-core/xmp';
import {saveRecipeWithMasks} from '@captraw/desktop-core/mask-assets';
import {ENGINE_VERSION} from '@captraw/contracts';
const work=await mkdtemp(join(tmpdir(),'captraw-source-move-')),before=join(work,'原目录 空格'),after=join(work,'移动后 空格');
const source=join(before,'原片.dng'),sidecar=join(before,'原片.xmp'),seed=join(work,'selection.png'),python=resolve('build/qa-venv/bin/python');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),ns='urn:captraw:test:portable-source';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),errors=[],checks=[];
let app,page,passed=false,failure;
const button=name=>page.getByRole('button',{name,exact:true});
const pixels=async()=>sha(await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL()));
async function idle(){
 await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__moveFrames.at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function launch(path){
 app=await electron.launch({env:{CAPTRAW_APP:'',CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);
 page.on('pageerror',error=>errors.push(String(error)));
 await page.evaluate(()=>{window.__moveFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview'&&e.frame.kind==='fit')window.__moveFrames.push(e.frame);});});
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});dialog.showMessageBox=async()=>({response:1});},path);
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(1);await idle();
}
async function hidden(){assert((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable()))));}
async function pass(message){await hidden();checks.push(message);console.log('PASS',message);}
async function output(path){
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);
 await button('导出').click();await page.getByRole('button',{name:/^TIFF · 16 位/}).click();
 await expect(page.locator('.job-toast.done')).toContainText(path.endsWith('before.tiff')?'before.tiff':'after.tiff',{timeout:120000});
 await button('关闭导出结果').click();
}
try{
 await mkdir(before);await copyFile(resolve('build/samples/synthetic.dng'),source);const original=await readFile(source);
 execFileSync(python,['-c',`from PIL import Image
import numpy as np,sys
a=np.zeros((768,1024),dtype=np.uint16);a[160:610,240:790]=49152;Image.fromarray(a).save(sys.argv[1])`,seed]);
 const core=new EngineClient({cache:join(work,'fixture')});
 try{
  const image=await core.call('open',{path:source,sessionId:'move-fixture'});
  const mask={id:'portable',name:'移动 资产蒙版',type:'raster',enabled:true,inverted:false,feather:0,brightness:.5,contrast:0,saturation:0,points:[],start:{x:0,y:0},end:{x:1,y:1},referenceAngle:0,raster:{path:seed,sha256:sha(await readFile(seed)),width:1024,height:768}};
  const adjustments={...image.adjustments,exposure:.4,masks:[mask]},composed=await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments});
  const packet=(await xmp.call('write','',[property(ns,'Retain',{value:'移动后保留',qualifiers:[property(ns,'Proof',text('qualified'))]})])).packet;
  const doc={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:(await stat(source)).size,sha256:sha(original)},artProfile:composed.artProfile,adjustments,xmpPacket:packet};
  await saveRecipeWithMasks(core,sidecar,doc,value=>documents.serialize(value));
 }finally{await core.stop();}
 await rm(seed);await launch(sidecar);
 const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await expect(exposure).toHaveValue('0.4');
 const previousFrame=await page.locator('canvas[aria-label="显影预览"]').getAttribute('data-frame');
 await exposure.fill('0.65');await exposure.press('Tab');
 await expect(page.locator('canvas[aria-label="显影预览"]')).not.toHaveAttribute('data-frame',previousFrame);await idle();
 await button('保存').click();await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await idle();
 const saved=await documents.read(sidecar);assert.equal(saved.source.path,'原片.dng');assert.equal(saved.source.sha256,sha(original));assert.equal(saved.maskAssets.files.length,1);
 assert.equal(lookup((await xmp.read(sidecar)).properties,ns,'Retain').qualifiers[0].node.value,'qualified');
 const expected=await pixels(),assetPath=join(before,saved.maskAssets.files[0].path),assetHash=sha(await readFile(assetPath));
 await writeFile(join(work,'expected-preview.png'),Buffer.from((await page.locator('canvas[aria-label="显影预览"]').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 await output(join(work,'before.tiff'));await pass('visible editing and Save write a relative source association and portable immutable mask asset without losing unknown XMP qualifiers');
 await closeElectron(app);app=undefined;await rename(before,after);
 const movedSource=join(after,'原片.dng'),movedSidecar=join(after,'原片.xmp');
 assert.equal(sha(await readFile(movedSource)),sha(original));assert.equal(sha(await readFile(join(after,saved.maskAssets.files[0].path))),assetHash);
 await launch(movedSidecar);await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.65');assert.equal(await pixels(),expected);
 await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();
 await pass('a fresh App opens the moved XMP, resolves the moved source and mask assets, and restores identical preview pixels with no dirty state or history');
 await output(join(work,'after.tiff'));
 execFileSync(python,['-c',`import numpy as np,tifffile,sys
with tifffile.TiffFile(sys.argv[1]) as a,tifffile.TiffFile(sys.argv[2]) as b:
 assert a.pages[0].dtype==b.pages[0].dtype==np.uint16
 assert np.array_equal(a.asarray(),b.asarray())
 assert a.pages[0].tags[34675].value==b.pages[0].tags[34675].value`,join(work,'before.tiff'),join(work,'after.tiff')]);
 assert.equal(sha(await readFile(movedSource)),sha(original));assert.equal(sha(await readFile(join(after,saved.maskAssets.files[0].path))),assetHash);assert.deepEqual(errors,[]);
 await pass('visible TIFF16 export after moving reproduces every pixel and ICC byte; source and published asset bytes stay unchanged');passed=true;
}catch(error){failure=error;}
finally{
 if(failure&&page&&!page.isClosed()){await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});await writeFile(join(work,'failure.json'),JSON.stringify({failure:failure.stack||String(failure),checks,errors,diagnostics:electronDiagnostics(app)},null,2));}
 if(app)await closeElectron(app);
 if(passed)await rm(work,{recursive:true,force:true});else console.error('Source move failure retained:',work);
}
if(failure)throw failure;
