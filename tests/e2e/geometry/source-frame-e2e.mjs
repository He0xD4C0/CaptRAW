// Hidden production App: imported coordinate basis, visible controls and pixels.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP,CRS} from '@captraw/desktop-core/xmp';
import {mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=await mkdtemp(join(tmpdir(),'captraw-source-frame-app-')),python=resolve('build/qa-venv/bin/python');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const sha=b=>createHash('sha256').update(b).digest('hex'),engineSHA=sha(await readFile(binary));
const rendererHTML='apps/desktop/dist/renderer/index.html',rendererAsset=(await readFile(rendererHTML,'utf8')).match(/src="\.\/([^\"]+\.js)"/)[1];
const cohortFiles=['apps/desktop/dist/electron/main.cjs',rendererHTML,'apps/desktop/dist/renderer/'+rendererAsset,'packages/desktop-core/dist/presets/synchronize.js','packages/desktop-core/dist/presets/presets.js'];
const cohort=Object.fromEntries(await Promise.all(cohortFiles.map(async path=>[path,sha(await readFile(path))])));
const documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp'))),checks=[];
let app,page,core,passed=false;const errors=[];
const button=name=>page.getByRole('button',{name,exact:true});
const frame=()=>page.evaluate(()=>window.__sourceFrames.filter(f=>f.kind==='fit').at(-1));
const trace=channel=>app.evaluate((_,channel)=>globalThis.__sourceTrace.filter(t=>t.channel===channel&&t.result).at(-1),channel);
async function ready(){await page.waitForTimeout(160);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const f=window.__sourceFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});await expect(page.getByRole('alert')).toHaveCount(0);}
async function settle(action){const prior=await frame();await action();await page.waitForFunction(prior=>{const f=window.__sourceFrames.filter(f=>f.kind==='fit').at(-1);return f&&(!prior||f.sessionId!==prior.sessionId||f.revision>prior.revision);},prior);await ready();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());return (await trace('image:open')).result;}
const coverage=async()=>{const f=await frame();assert(f.mask);return sha(execFileSync(python,['-c',"from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).getchannel('A').tobytes())",f.mask.file]));};
try{
 execFileSync(python,['tests/fixtures/generators/source-frame-fixtures.py',root],{stdio:'pipe'});
 const raw=await readFile(join(root,'bayer.dng')),sourceSHA=sha(raw);
 for(const name of ['old','adobe','fresh'])await copyFile(join(root,'bayer.dng'),join(root,name+'.dng'));
 core=new EngineClient({cache:join(root,'fixture'),executable:binary});
 const old=await core.call('open',{path:join(root,'old.dng'),sessionId:'legacy-fixture'});
 assert.equal(old.width,184);assert.equal(old.adjustments.sourceFrame,undefined);
 const oldMask={id:'old-mask',name:'Legacy mask',type:'radial',enabled:true,inverted:false,initialized:true,feather:0,brightness:.5,contrast:0,saturation:0,points:[],start:{x:.2,y:.2},end:{x:.5,y:.6}};
 await writeFile(join(root,'old.xmp'),await documents.serialize({engineVersion:'CaptRAW-28_ART-1.26.10_LibRaw-3b20539',baselineVersion:4,source:{path:'old.dng',size:raw.length,sha256:sourceSHA},artProfile:old.artProfile,adjustments:{...old.adjustments,masks:[oldMask]}}));
 await core.stop();core=undefined;
 const adobe=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:c="${CRS}" c:ProcessVersion="15.4" c:HasCrop="True" c:CropLeft="0.125" c:CropTop="0.25" c:CropRight="0.875" c:CropBottom="0.75" c:CropAngle="0"><c:MaskGroupBasedCorrections><rdf:Seq><rdf:li rdf:parseType="Resource"><c:CorrectionName>Adobe frame mask</c:CorrectionName><c:LocalExposure2012>0.125</c:LocalExposure2012><c:CorrectionMasks><rdf:Seq><rdf:li rdf:parseType="Resource"><c:What>Mask/CircularGradient</c:What><c:Left>0.25</c:Left><c:Top>0.3</c:Top><c:Right>0.55</c:Right><c:Bottom>0.7</c:Bottom><c:Feather>0</c:Feather><c:Flipped>True</c:Flipped><c:Version>2</c:Version></rdf:li></rdf:Seq></c:CorrectionMasks></rdf:li></rdf:Seq></c:MaskGroupBasedCorrections></rdf:Description></rdf:RDF></x:xmpmeta>`;
 await writeFile(join(root,'adobe.xmp'),adobe);assert.equal((await documents.read(join(root,'adobe.xmp'))).engineVersion,'');
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__sourceFrames=[];window.__sourceComparisons=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__sourceFrames.push(e.frame);if(e.event==='comparison-preview')window.__sourceComparisons.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog})=>{
  globalThis.__sourceTrace=[];
  for(const channel of ['image:open','image:update','session:save','comparison:update']){
   const original=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{const record={channel,input:structuredClone(input)};globalThis.__sourceTrace.push(record);record.result=await original(event,input);return record.result;});
  }
  dialog.showMessageBox=async(...args)=>{const options=args.at(-1),confirm=options.buttons?.findIndex(v=>v.includes('确认保存'));return {response:confirm>=0?confirm:1};};
 });
 let loaded=await open(join(root,'old.xmp'));assert.equal(loaded.sourceFrame.policy,'legacy');assert.equal(loaded.width,184);
 await button('蒙版 M').click();await page.locator('.mask-select').first().click();await ready();await expect(page.getByTestId('mask-coverage')).toBeVisible();const oldCoverage=await coverage();
 assert.equal((await trace('image:update')).input.adjustments.sourceFrame,undefined,'legacy document is not materialized into a new frame');
 checks.push('old CT/ARP opens in its 184x120 canvas and keeps a legacy mask');
 loaded=await open(join(root,'adobe.xmp'));assert.equal(loaded.sourceFrame.policy,'active-area-v1');assert.deepEqual([loaded.width,loaded.height],[192,128]);
 let f=await frame();assert.deepEqual([f.fullWidth,f.fullHeight],[192,128]);
 const update=(await trace('image:update')).input;assert.deepEqual(update.adjustments.crop,{x:.125,y:.25,width:.75,height:.5});
 assert.equal(update.adjustments.sourceFrame.width,192);assert.equal(update.adjustments.masks[0].components[0].start.x,.25);
 await button('蒙版 M').click();await page.locator('.mask-select').first().click();await ready();await expect(page.getByTestId('mask-coverage')).toBeVisible();const importedCoverage=await coverage();
 // A visible selection and native scalar coverage must agree on the imported
 // original-frame center, not the historical 184-pixel ART layout.
 f=await frame();const alpha=Number(execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]).getchannel('A');print(im.getpixel((round(im.width*.4),round(im.height*.5))))",f.mask.file],{encoding:'utf8'}));assert(alpha>180);
 checks.push('standard Adobe crop and readable radial mask use the 192x128 decoded frame');
 const beforeSave=await app.evaluate(()=>globalThis.__sourceTrace.filter(t=>t.channel==='session:save'&&t.result).length);
 await button('保存').click();await expect.poll(()=>app.evaluate(()=>globalThis.__sourceTrace.filter(t=>t.channel==='session:save'&&t.result).length)).toBe(beforeSave+1);
 const saved=await documents.read(join(root,'adobe.xmp'));assert.equal(saved.adjustments.sourceFrame.policy,'active-area-v1');
 assert.equal(saved.adjustments.sourceFrame.width,192);assert((await readFile(join(root,'adobe.xmp'),'utf8')).includes('sourceFrame'));
 await open(join(root,'adobe.xmp'));await button('蒙版 M').click();await page.locator('.mask-select').first().click();await ready();assert.equal(await coverage(),importedCoverage);
 checks.push('typed XMP save/reopen preserves imported crop and coverage');
 loaded=await open(join(root,'fresh.dng'));assert.equal(loaded.sourceFrame.policy,'active-area-v1');assert.equal(loaded.width,192);
 await button('蒙版 M').click();await settle(()=>button('画笔').click());await ready();
 const overlay=page.getByTestId('viewport').locator('svg.mask-overlay'),box=await overlay.boundingBox();assert(box);
 const bounds=await overlay.locator('#mask-image-bounds rect').evaluate(e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(e.getAttribute(k))])));
 const q={x:box.x+bounds.x+.4*bounds.width,y:box.y+bounds.y+.5*bounds.height};
 assert(await page.getByTestId('viewport').evaluate((e,p)=>e.contains(document.elementFromPoint(p.x,p.y)),q));
 await settle(async()=>{await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+3,q.y,{steps:3});await page.mouse.up();});
 const authored=(await trace('image:update')).input.adjustments.masks.at(-1),leaf=authored.components?.at(-1)||authored;assert.equal(leaf.brush.strokes[0].geometryReference.version,3);
 const freshCoverage=await coverage();await settle(()=>button('撤销').click());await settle(()=>button('重做').click());assert.equal(await coverage(),freshCoverage);
 for(let i=0;i<2;++i){
  const count=await page.evaluate(()=>window.__sourceComparisons.filter(f=>f.kind==='fit').length);
  await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('left-right');
  await page.waitForFunction(count=>window.__sourceComparisons.filter(f=>f.kind==='fit').length>count,count);
  await expect(page.getByLabel('前后对比',{exact:true})).toBeVisible();
  const compared=await page.evaluate(()=>window.__sourceComparisons.filter(f=>f.kind==='fit').at(-1));assert.deepEqual([compared.fullWidth,compared.fullHeight],[192,128]);
  await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('off');await ready();assert.equal(await coverage(),freshCoverage);
 }
 checks.push('repeated visible comparison opens independent workers in the same active frame without changing coverage');
 await open(join(root,'old.xmp'));await button('蒙版 M').click();await page.locator('.mask-select').first().click();await ready();assert.equal(await coverage(),oldCoverage,'opening new/Adobe frames cannot mutate a legacy document');
 checks.push('fresh GUI brush records v3 binding; undo/redo restores coverage; old document remains unchanged');
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));assert(windows.every(w=>!w.visible&&!w.focused&&!w.focusable));
 assert.deepEqual(errors,[]);assert.equal(sha(await readFile(binary)),engineSHA);for(const path of cohortFiles)assert.equal(sha(await readFile(path)),cohort[path],path+' stayed frozen');passed=true;console.log(JSON.stringify({engineSHA,cohort,checks,windows},null,2));
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
finally{await core?.stop();if(app)await closeElectron(app);if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained source-frame App failure:',root);}
