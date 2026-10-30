import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,copyFile,readFile,writeFile,rm,access,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';

const root=await mkdtemp(join(tmpdir(),'captraw-native-edit-gui-')),checks=[],errors=[];
const source=resolve('build/samples/synthetic.dng'),bytes=await readFile(source);
const raw=join(root,'Adobe 导入.dng'),defaults=join(root,'默认 显影.dng');
for(const path of [raw,defaults])await copyFile(source,path);
const legacyFolder=join(root,'旧编辑');await mkdir(legacyFolder);const legacy=join(legacyFolder,'synthetic.dng'),legacyXML=await readFile(resolve('tests/fixtures/native-documents-legacy32/synthetic.xmp'),'utf8');await copyFile(resolve('tests/fixtures/native-documents-legacy32/synthetic.dng'),legacy);await writeFile(join(legacyFolder,'synthetic.xmp'),legacyXML);
const adobe=path=>path.replace(/\.dng$/,'.xmp'),native=path=>path+'.captraw';
const xml=exposure=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:c="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:u="urn:native-edit-gui" c:Exposure2012="${exposure}" c:FutureControl="42"><u:Opaque rdf:parseType="Resource"><rdf:value>保留 来源</rdf:value><u:Proof>unknown qualifier</u:Proof></u:Opaque></rdf:Description></rdf:RDF></x:xmpmeta>`;
for(const path of [raw,defaults])await writeFile(adobe(path),xml(1.25));
let app,page,passed=false;
const button=name=>page.getByRole('button',{name,exact:true}),exposure=()=>page.getByRole('spinbutton',{name:'曝光',exact:true});
const canvas=()=>page.locator('canvas[aria-label="显影预览"]');
const pixels=async()=>createHash('sha256').update(await canvas().evaluate(c=>c.toDataURL())).digest('hex');
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const f=window.__nativeFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});}
async function rendered(action){const old=await canvas().getAttribute('data-frame');await action();await page.waitForFunction(old=>{const f=window.__nativeFrames.filter(f=>f.kind==='fit').at(-1);return f&&f.url!==old&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;},old);await idle();}
async function open(path,count){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await rendered(()=>button('打开').click());await expect(page.locator('.film-item')).toHaveCount(count);}
async function save(path){await button('保存').click();await expect.poll(()=>access(native(path)).then(()=>true,()=>false)).toBe(true);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await idle();const packet=JSON.parse(await readFile(native(path),'utf8'));assert.equal(packet.format,'CaptRAW');assert.equal(packet.kind,'edit');assert.equal(packet.version,1);return packet;}
async function launch(){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'user-data'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 if(process.env.CAPTRAW_E2E_OFFLINE==='1'){await app.evaluate(({session})=>{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,reply)=>reply({cancel:true}));});assert(await page.evaluate(()=>fetch('https://example.invalid/offline-check').then(()=>false,()=>true)));}
 await page.evaluate(()=>{window.__nativeFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__nativeFrames.push(e.frame);});});
 await app.evaluate(({dialog})=>{globalThis.__nativeDialogs=[];dialog.showMessageBox=async(_,options)=>{globalThis.__nativeDialogs.push(options);if(options.message==='导入 Adobe 设置？')return {response:options.detail.includes('默认 显影.dng')?0:1};if(options.message==='确认保存这些 CaptRAW 编辑文件？')return {response:1};throw new Error('Unexpected dialog: '+options.message);};});
}
const pass=message=>{checks.push(message);console.log('PASS',message);};
try{
 await launch();await open(raw,1);await expect(exposure()).toHaveValue('1.25');await expect(page.locator('.document-title .dirty-dot')).toHaveCount(1);
 const importedPixels=await pixels(),prompts=await app.evaluate(()=>globalThis.__nativeDialogs.filter(v=>v.message==='导入 Adobe 设置？'));assert.equal(prompts.length,1);assert(prompts[0].detail.includes('结果可能与ACR不同'));assert(prompts[0].detail.includes('.captraw'));assert(prompts[0].detail.includes('FutureControl'));assert(prompts[0].detail.includes('光线'));
 await rendered(()=>button('撤销').click());await expect(exposure()).toHaveValue('0');await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);assert.notEqual(await pixels(),importedPixels);
 await rendered(()=>button('重做').click());await expect(exposure()).toHaveValue('1.25');assert.equal(await pixels(),importedPixels);
 pass('Adobe import is explicitly confirmed, changes actual pixels and forms one undo/redo operation against default rendering');
 const packet=await save(raw);assert.equal(packet.payload.adjustments.exposure,1.25);assert(packet.sourceXMP.includes('保留 来源'));assert(!Object.hasOwn(packet.payload,'xmpPacket'));assert(!Object.hasOwn(packet.payload,'nativePacket'));assert.equal(await readFile(adobe(raw),'utf8'),xml(1.25));
 pass('Save writes a versioned native document with opaque source XML; source Adobe XMP and RAW are unchanged');
 await open(defaults,2);await expect(exposure()).toHaveValue('0');await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);const defaultPixels=await pixels();
 await save(defaults);assert.equal(await readFile(adobe(defaults),'utf8'),xml(1.25));
 const item=page.locator('.film-item').filter({hasText:basename(raw)}).locator('.film-open');await rendered(()=>item.click());await expect(exposure()).toHaveValue('1.25');assert.equal(await pixels(),importedPixels);assert.equal((await app.evaluate(()=>globalThis.__nativeDialogs.filter(v=>v.message==='导入 Adobe 设置？'))).length,2);
 pass('default-rendering choice does not apply Adobe edits; switching session photos does not prompt or import again');
 await open(legacy,3);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(1);const legacyPixels=await pixels();await save(legacy);assert.equal(await readFile(adobe(legacy),'utf8'),legacyXML);
 pass('legacy CaptRAW XMP opens faithfully, requires native migration and leaves the original sidecar intact');
 await closeElectron(app);app=undefined;
 // A later Adobe edit must not override an existing native sidecar.
 await writeFile(adobe(raw),xml(-1));await launch();await open(raw,1);await expect(exposure()).toHaveValue('1.25');assert.equal(await pixels(),importedPixels);assert.equal((await app.evaluate(()=>globalThis.__nativeDialogs)).length,0);
 await open(defaults,2);await expect(exposure()).toHaveValue('0');assert.equal(await pixels(),defaultPixels);assert.equal((await app.evaluate(()=>globalThis.__nativeDialogs)).length,0);
 await open(legacy,3);assert.equal(await pixels(),legacyPixels);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);assert.equal(await readFile(adobe(legacy),'utf8'),legacyXML);assert.equal((await app.evaluate(()=>globalThis.__nativeDialogs)).length,0);
 pass('fresh app process prefers native sidecars over Adobe changes and restores both imported and default-rendered pixels exactly');
 await rendered(()=>page.locator('.film-item').filter({hasText:basename(raw)}).locator('.film-open').click());
 const output=join(root,'原生 编辑导出.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await button('导出').click();const settings=page.getByRole('dialog',{name:'导出设置',exact:true});await expect(settings).toBeVisible();await settings.getByRole('button',{name:/TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible();
 const exported=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',"import sys,json,tifffile\nwith tifffile.TiffFile(sys.argv[1]) as f:\n a=f.asarray();assert a.dtype.name=='uint16';icc=f.pages[0].tags[34675].value;assert len(icc)>128;print(json.dumps({'shape':list(a.shape),'bits':16,'iccBytes':len(icc)}))",output],{encoding:'utf8'}));assert.deepEqual(exported.shape,[768,1024,3]);
 pass('restored native edit exports a real ICC-tagged 16-bit TIFF through visible export controls');
 if(process.env.CAPTRAW_E2E_EVIDENCE)await page.screenshot({path:resolve(process.env.CAPTRAW_E2E_EVIDENCE)});
 for(const path of [raw,defaults])assert.deepEqual(await readFile(path),bytes);assert.equal(await readFile(adobe(raw),'utf8'),xml(-1));assert.deepEqual(errors,[]);passed=true;
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});await writeFile(join(root,'ui.txt'),await page.locator('body').ariaSnapshot()).catch(()=>{});}await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,errors,dialogs:app?await app.evaluate(()=>globalThis.__nativeDialogs).catch(()=>undefined):undefined,diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
finally{if(app)await closeElectron(app);console.log(JSON.stringify({passed,checks,packaged:!!process.env.CAPTRAW_APP}));if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained native edit GUI:',root);}
