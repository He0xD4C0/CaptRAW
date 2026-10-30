import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP,CRS,CT,lookup,readExtension,property,encode} from '@captraw/desktop-core/xmp';
import {EngineClient} from '../../support/engine-client.mjs';
const root=await mkdtemp(join(tmpdir(),'captraw-signed-gui-')),file=join(root,'新版 几何.tif'),oldFile=join(root,'旧版 几何.tif');
const mixedSource=join(root,'混合 来源.tif'),mixedTarget=join(root,'混合 ART目标.tif');
const unmarkedTarget=join(root,'未标记 继承填充.tif'),sparseTarget=join(root,'省略透视 继承无填充.tif'),freshSource=join(root,'全新 来源.tif'),freshTarget=join(root,'全新 目标.tif'),checkUnmarked=process.argv.includes('--unmarked-fill');
const fixturePaths=[file,oldFile,mixedSource,mixedTarget,unmarkedTarget,sparseTarget,freshSource,freshTarget];
const documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp'))),python=resolve('build/qa-venv/bin/python');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sidecar=p=>p.replace(/\.tif$/,'.xmp'),checks=[];
const html='apps/desktop/dist/renderer/index.html',asset=(await readFile(html,'utf8')).match(/src="\.\/([^\"]+\.js)"/)[1],cohortFiles=['build/native/captraw-engine','apps/desktop/dist/electron/main.cjs','apps/desktop/dist/electron/preload.cjs',html,'apps/desktop/dist/renderer/'+asset,'packages/contracts/dist/synchronize.js','packages/desktop-core/dist/presets/synchronize.js','packages/desktop-core/dist/documents/documents.js'];
const cohort=Object.fromEntries(await Promise.all(cohortFiles.map(async path=>[path,hash(await readFile(path))])));
const commands=trace=>trace.input.commands??[trace.input.command];
let app,page,passed=false;const errors=[],button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('spinbutton',{name,exact:true});
const canvas=()=>page.locator('canvas[aria-label="显影预览"]'),pixels=async()=>hash(await canvas().evaluate(c=>c.toDataURL()));
async function idle(){await page.waitForTimeout(150);await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===window.__signedFrames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function panel(){await button('编辑').click();const summary=page.locator('.adjust-section > summary').filter({hasText:/^几何$/});await summary.scrollIntoViewIfNeeded();if(await summary.locator('..').getAttribute('open')===null)await summary.click();}
async function launch(path){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__signedFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__signedFrames.push(e.frame);});});
 await app.evaluate(({dialog,ipcMain},path)=>{
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:Array.isArray(path)?path:[path]});dialog.showMessageBox=async()=>({response:1});
  // Observe real commands/results; the explicit cancellation case can hold a
  // completed native prepare so its late delivery is deterministic.
  globalThis.__signedSync=[];const original=ipcMain._invokeHandlers.get('images:synchronize');ipcMain.removeHandler('images:synchronize');
  ipcMain.handle('images:synchronize',async(event,input)=>{const trace={input:structuredClone(input)};globalThis.__signedSync.push(trace);try{const result=await original(event,input);trace.result=structuredClone(result);if(globalThis.__signedHoldResult){globalThis.__signedHeld=true;await new Promise(resolve=>{globalThis.__signedRelease=resolve;});globalThis.__signedHeld=false;}return result;}catch(error){trace.error=String(error);throw error;}});
 },path);
 await button('打开').click();await idle();await panel();
}
async function number(name,value,key='Tab'){const el=input(name);await el.scrollIntoViewIfNeeded();await expect(el).toBeInViewport();await el.fill(String(value));await el.press(key);await idle();await expect(el).toHaveValue(String(value));}
async function save(path){await button('保存').click();await expect.poll(()=>existsSync(sidecar(path))).toBe(true);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await idle();return documents.read(sidecar(path));}
const photo=path=>page.locator('.film-item').filter({hasText:basename(path)}).locator('.film-open');
async function select(path){await photo(path).click();await expect(photo(path)).toHaveAttribute('aria-current','true');await idle();await panel();}
async function selectPair(target=mixedTarget,source=mixedSource){await select(source);await photo(target).click({modifiers:['Meta']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);await expect(photo(source)).toHaveAttribute('aria-current','true');await idle();}
async function savePair(target=mixedTarget,source=mixedSource){await button('保存所选…').click();const dialog=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'返回编辑',exact:true})).toBeVisible({timeout:120000});await dialog.getByRole('button',{name:'返回编辑',exact:true}).click();await idle();await expect(page.locator('.film-item .dirty-dot')).toHaveCount(0);return Promise.all([source,target].map(p=>documents.read(sidecar(p))));}
try{
 const original=resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif'),sourceBytes=await readFile(original);for(const path of fixturePaths)await copyFile(original,path);
 const engine=new EngineClient({cache:join(root,'fixture')});
 try{
  const image=await engine.call('open',{path:oldFile,sessionId:'old',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'}),p={...image.adjustments.perspective,enabled:true,aspect:1.3};
  for(const key of ['manualModel','scale','offsetX','offsetY','constrainCrop'])delete p[key];
  const packet=await documents.serialize({source:{path:'旧版 几何.tif',size:sourceBytes.length,sha256:hash(sourceBytes)},artProfile:image.artProfile,adjustments:{...image.adjustments,perspective:p},baselineVersion:4});
  await writeFile(sidecar(oldFile),(await documents.xmp.call('write',packet,[property(CT,'EngineVersion',encode('CaptRAW-27_ART-1.26.10_LibRaw-3b20539'))])).packet);
  const common={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,constrainCrop:false};
  for(const [path,perspective,rotation,fineRotation] of [[mixedSource,{...common,manualModel:'signed-framing-v1',aspect:25,scale:1.1,offsetX:10,offsetY:10},0,0],[mixedTarget,{...common,manualModel:'art-perspective-v1',aspect:1.2,scale:1.4,offsetX:.03,offsetY:-.04,horizontal:8,vertical:-6,angle:1.25,shear:2.5,focalLength:24,cropFactor:1.5},90,2]]){
   const adjustments={...image.adjustments,rotation,fineRotation,perspective},profile=await engine.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile,adjustments});
   await writeFile(sidecar(path),await documents.serialize({source:{path:basename(path),size:sourceBytes.length,sha256:hash(sourceBytes)},artProfile:profile.artProfile,adjustments,baselineVersion:4}));
  }
  const inherited={enabled:true,horizontal:12,vertical:-8,angle:2,shear:3,focalLength:0,cropFactor:1,aspect:1};
  for(const [path,fill,omit] of [[unmarkedTarget,true,false],[sparseTarget,false,true]]){
   const inheritedAdjustments={...image.adjustments,fineRotation:3,lensManualDistortion:12,perspective:inherited},inheritedProfile=(await engine.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile.replace(/^AutoFill=.*$/m,'AutoFill='+fill),adjustments:inheritedAdjustments})).artProfile;
   if(omit)delete inheritedAdjustments.perspective;
   await writeFile(sidecar(path),await documents.serialize({source:{path:basename(path),size:sourceBytes.length,sha256:hash(sourceBytes)},artProfile:inheritedProfile,adjustments:inheritedAdjustments,baselineVersion:4}));
  }
 }finally{await engine.stop();}
 await launch(file);await expect(input('长宽比')).toHaveValue('0');await expect(input('几何缩放')).toHaveValue('100');
 for(const name of ['长宽比','横向补正','纵向补正']){await expect(input(name)).toHaveAttribute('min','-100');await expect(input(name)).toHaveAttribute('max','100');}
 await expect(input('几何缩放')).toHaveAttribute('min','50');await expect(input('几何缩放')).toHaveAttribute('max','150');
 const neutral=await pixels();await number('长宽比',25);await number('几何缩放',110);await number('横向补正',10);await number('纵向补正',10);const effect=await pixels();assert.notEqual(effect,neutral);
 const doc=await save(file);assert.equal(doc.adjustments.perspective.manualModel,'signed-framing-v1');assert.equal(doc.adjustments.perspective.aspect,25);assert.equal(doc.adjustments.perspective.offsetY,10);
 checks.push('visible controls expose actual ACR ranges and save signed units with real preview changes');
 await button('撤销').click();await idle();await expect(input('纵向补正')).toHaveValue('0');await button('重做').click();await idle();assert.equal(await pixels(),effect);
 await input('横向补正').scrollIntoViewIfNeeded();await input('横向补正').fill('30');await idle();await input('横向补正').press('Escape');await idle();await expect(input('横向补正')).toHaveValue('10');assert.equal(await pixels(),effect);
 checks.push('one-step history and numeric Escape restore the exact signed geometry and displayed pixels');
 const enabled=page.getByRole('checkbox',{name:'启用透视变换',exact:true});await enabled.uncheck();await idle();await save(file);
 let properties=(await documents.xmp.read(sidecar(file))).properties;assert.equal(lookup(properties,CRS,'PerspectiveAspect').value,'0');assert.equal(readExtension(properties,'ARTAdjustments').perspective.aspect,25);
 await enabled.check();await idle();assert.equal(await pixels(),effect);await save(file);properties=(await documents.xmp.read(sidecar(file))).properties;
 for(const key of ['aspect','scale','offsetX','offsetY'])assert.equal(readExtension(properties,'ARTAdjustments').perspective[key],undefined);
 assert.equal(lookup(properties,CRS,'PerspectiveAspect').value,'25');assert.equal(lookup(properties,CRS,'PerspectiveScale').value,'110');checks.push('disable remembers values privately; enable removes duplicate ownership and restores exact pixels');
 const output=join(root,'导出.tif');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
 await button('导出').click();const metadata=page.getByRole('combobox',{name:'输出元数据',exact:true});await metadata.scrollIntoViewIfNeeded();await metadata.selectOption('all');await page.getByRole('button',{name:/^TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const packet=(await documents.xmp.call('file-read','',[],{path:output,format:'tiff'})).properties;
 for(const [key,value] of [['PerspectiveAspect','25'],['PerspectiveScale','110'],['PerspectiveX','10'],['PerspectiveY','10'],['AlreadyApplied','True']])assert.equal(lookup(packet,CRS,key)?.value,value);
 assert.equal(readExtension(packet,'ARTAdjustments'),undefined);assert.equal(lookup(packet,CT,'BakedCRS'),undefined);
 execFileSync(python,['-c','import tifffile,sys\nwith tifffile.TiffFile(sys.argv[1]) as t:assert t.asarray().dtype.name=="uint16" and 34675 in t.pages[0].tags',output]);
 await closeElectron(app);app=undefined;await launch(file);assert.equal(await pixels(),effect);await expect(input('长宽比')).toHaveValue('25');checks.push('real TIFF16 export carries standard applied geometry only; restart restores saved pixels');
 await closeElectron(app);app=undefined;await launch(oldFile);await expect(input('长宽比')).toHaveValue('1.3');const oldPixels=await pixels();
 await button('采用新版并重置透视').scrollIntoViewIfNeeded();await button('采用新版并重置透视').click();await idle();await expect(input('长宽比')).toHaveValue('0');await button('撤销').click();await idle();await expect(input('长宽比')).toHaveValue('1.3');assert.equal(await pixels(),oldPixels);
 checks.push('old unbound ART aspect keeps its units; explicit reset upgrades and one Undo restores the exact legacy state');
 await closeElectron(app);app=undefined;await launch([mixedSource,mixedTarget]);
 await select(mixedTarget);await expect(input('长宽比')).toHaveValue('1.2');await expect(input('几何缩放')).toHaveValue('140');
 for(const [label,value] of [['水平透视','8'],['垂直透视','-6'],['透视旋转','1.25'],['倾斜','2.5']]){await input(label).scrollIntoViewIfNeeded();await expect(input(label)).toBeInViewport();await expect(input(label)).toHaveValue(value);}
 const targetBeforePixels=await pixels(),targetBefore=await save(mixedTarget);await select(mixedSource);const sourceBeforePixels=await pixels(),sourceBefore=await save(mixedSource);
 const before=[sourceBefore,targetBefore],traceStart=await app.evaluate(()=>globalThis.__signedSync.length);await selectPair();await number('横向补正',20);const sourceAfterPixels=await pixels();assert.notEqual(sourceAfterPixels,sourceBeforePixels);
 let saved=await savePair();assert.deepEqual(saved[0].adjustments,{...sourceBefore.adjustments,perspective:{...sourceBefore.adjustments.perspective,offsetX:20}});assert.deepEqual(saved[1].adjustments,{...targetBefore.adjustments,perspective:{...targetBefore.adjustments.perspective,offsetX:.144}});
 const traces=await app.evaluate((_,start)=>globalThis.__signedSync.slice(start),traceStart),operations=new Set(traces.flatMap(t=>commands(t).map(c=>c.operationId)));assert.equal(operations.size,1);assert(traces.length>0&&traces.every(t=>!t.error&&t.result.length===2));
 await select(mixedTarget);await expect(input('横向补正')).toHaveValue('14.4');const targetAfterPixels=await pixels();assert.notEqual(targetAfterPixels,targetBeforePixels);
 checks.push('actual signed X20 maps only to ART offsetX .144; both saved XMP snapshots preserve target ratio1.2/scale1.4/H/V/angle/shear/focal/cropFactor/coarse/fine rotation and model');
 await selectPair();await button('撤销').click();await idle();await expect(input('横向补正')).toHaveValue('10');assert.equal(await pixels(),sourceBeforePixels);saved=await savePair();for(let i=0;i<2;i++)assert.deepEqual(saved[i].adjustments,before[i].adjustments);
 await select(mixedTarget);assert.equal(await pixels(),targetBeforePixels);await selectPair();await button('重做').click();await idle();assert.equal(await pixels(),sourceAfterPixels);saved=await savePair();assert.equal(saved[0].adjustments.perspective.offsetX,20);assert.equal(saved[1].adjustments.perspective.offsetX,.144);
 await select(mixedTarget);assert.equal(await pixels(),targetAfterPixels);checks.push('one shared operation supports one-click selected Undo/Redo, exact pixels and both XMP saves');
 await selectPair();await number('横向补正',100);const domainSourcePixels=await pixels();let domainSaved=await savePair();assert.deepEqual(domainSaved[0].adjustments,{...sourceBefore.adjustments,perspective:{...sourceBefore.adjustments.perspective,offsetX:100}});assert.deepEqual(domainSaved[1].adjustments,{...targetBefore.adjustments,perspective:{...targetBefore.adjustments.perspective,offsetX:.72}});
 await select(mixedTarget);await expect(input('横向补正')).toHaveAttribute('min','-72');await expect(input('横向补正')).toHaveAttribute('max','72');await expect(input('横向补正')).toHaveValue('72');const domainTargetPixels=await pixels();assert.notEqual(domainTargetPixels,targetAfterPixels);
 await selectPair();await button('撤销').click();await idle();await expect(input('横向补正')).toHaveValue('20');assert.equal(await pixels(),sourceAfterPixels);await select(mixedTarget);assert.equal(await pixels(),targetAfterPixels);await selectPair();await button('重做').click();await idle();await expect(input('横向补正')).toHaveValue('100');assert.equal(await pixels(),domainSourcePixels);await select(mixedTarget);assert.equal(await pixels(),domainTargetPixels);await selectPair();await savePair();
 await closeElectron(app);app=undefined;await launch([mixedSource,mixedTarget]);await select(mixedSource);await expect(input('横向补正')).toHaveValue('100');assert.equal(await pixels(),domainSourcePixels);await select(mixedTarget);await expect(input('横向补正')).toHaveValue('72');assert.equal(await pixels(),domainTargetPixels);
 checks.push('signed X100 maps to ART .72 without changing target aspect1.2/scale1.4/fill/H/V/angle/shear; visible legacy range72%, both XMPs, shared Undo/Redo and restart retain exact pixels');
 const reverseBefore=[await save(mixedTarget)];await select(mixedSource);reverseBefore.push(await save(mixedSource));await selectPair(mixedSource,mixedTarget);const savedHashes=await Promise.all([mixedTarget,mixedSource].map(async p=>hash(await readFile(sidecar(p))))),history={undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled()};
 const aspect=input('长宽比');await aspect.scrollIntoViewIfNeeded();await expect(aspect).toBeInViewport();await aspect.fill('2');await aspect.press('Tab');await expect(page.getByRole('alert')).toContainText('无法无损转换');await idle();await expect(aspect).toHaveValue('1.2');assert.equal(await pixels(),domainTargetPixels);assert.deepEqual({undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled()},history);
 for(const [i,path] of [mixedTarget,mixedSource].entries())assert.equal(hash(await readFile(sidecar(path))),savedHashes[i],'the rejected inverse Aspect must not publish a sidecar');
 await page.getByTitle('关闭错误',{exact:true}).click();await idle();saved=await savePair(mixedSource,mixedTarget);for(let i=0;i<2;i++)assert.deepEqual(saved[i].adjustments,reverseBefore[i].adjustments);await select(mixedSource);assert.equal(await pixels(),domainSourcePixels);
 const rejected=await app.evaluate(()=>globalThis.__signedSync.filter(t=>t.error));assert.equal(rejected.length,1);assert(rejected[0].error.includes('无法无损转换'));assert.equal(rejected[0].result,undefined);
 checks.push('ART Aspect2 cannot be represented by signed Aspect: visible error, both models/parameters/pixels/XMPs unchanged, no history entry and no result published');

 if(checkUnmarked){
  const fillControl=()=>page.getByRole('checkbox',{name:'自动填满画布',exact:true});
  for(const [target,fill,omit] of [[unmarkedTarget,true,false],[sparseTarget,false,true]]){
   if(omit)assert.equal((await documents.read(sidecar(target))).adjustments.perspective,undefined,'the input really omits perspective; open then projects its full ARP');
   await closeElectron(app);app=undefined;await launch(target);await expect(input('长宽比')).toHaveValue('1');await expect(input('水平透视')).toHaveValue('12');await expect(input('垂直透视')).toHaveValue('-8');assert.equal(await fillControl().isChecked(),fill);
   const singlePixels=await pixels(),singleBefore=await save(target);assert.equal(singleBefore.adjustments.perspective?.manualModel,undefined);
   await number('横向补正',7.2);const singleAfter=await save(target),p=singleAfter.adjustments.perspective;
   assert.equal(p.manualModel,'art-perspective-v1');assert.equal(p.offsetX,7.2/100);assert.equal(p.constrainCrop,fill);for(const [key,value] of Object.entries({horizontal:12,vertical:-8,angle:2,shear:3,aspect:1}))assert.equal(p[key],value);assert.equal(singleAfter.adjustments.fineRotation,3);assert.equal(singleAfter.adjustments.lensManualDistortion,12);assert(singleAfter.artProfile.includes('AutoFill='+fill));assert(!JSON.stringify(singleAfter.adjustments).includes('effectiveFill'));
   await button('撤销').click();await idle();assert.equal(await pixels(),singlePixels);assert.deepEqual((await save(target)).adjustments,singleBefore.adjustments);
   checks.push('single first framing retains full inherited H/V/fine/distortion and real fill='+fill+' (input perspective omitted='+omit+'); Undo restores exact pixels and complete unmarked state');
   await closeElectron(app);app=undefined;await launch([mixedSource,target]);await select(target);const targetPixels=await pixels(),targetDoc=await save(target);await select(mixedSource);const sourcePixels=await pixels(),sourceDoc=await save(mixedSource),initial=Number(await input('横向补正').inputValue()),next=initial===20?10:20;
   const traceStart=await app.evaluate(()=>globalThis.__signedSync.length);await selectPair(target);await number('横向补正',next);const sourceAfterPixels=await pixels(),saved=await savePair(target),converted=saved[1].adjustments.perspective;
   assert.equal(converted.manualModel,'art-perspective-v1');assert.equal(converted.constrainCrop,fill);assert.equal(converted.offsetX,next*.0072);assert.equal(converted.offsetY,0);assert.equal(converted.scale,1);for(const [key,value] of Object.entries({horizontal:12,vertical:-8,angle:2,shear:3,aspect:1}))assert.equal(converted[key],value);assert(saved[1].artProfile.includes('AutoFill='+fill));
   assert.equal(saved[1].adjustments.fineRotation,3);assert.equal(saved[1].adjustments.lensManualDistortion,12);await select(target);const targetAfterPixels=await pixels();assert.notEqual(targetAfterPixels,targetPixels);
   await selectPair(target);await button('撤销').click();await idle();assert.equal(await pixels(),sourcePixels);const undone=await savePair(target);assert.deepEqual(undone[0].adjustments,sourceDoc.adjustments);assert.deepEqual(undone[1].adjustments,targetDoc.adjustments);await select(target);assert.equal(await pixels(),targetPixels);
   await selectPair(target);await button('重做').click();await idle();assert.equal(await pixels(),sourceAfterPixels);await select(target);assert.equal(await pixels(),targetAfterPixels);await selectPair(target);await savePair(target);
   const traces=await app.evaluate((_,start)=>globalThis.__signedSync.slice(start),traceStart);assert.equal(new Set(traces.flatMap(t=>commands(t).map(c=>c.operationId))).size,1);assert(traces.every(t=>!t.error&&t.result.length===2));assert(traces.every(t=>!JSON.stringify(commands(t)).includes('effectiveFill')));
   checks.push('real mixed batch retains per-target inherited fill='+fill+' and complete ARP geometry, shared Undo/Redo exact pixels and two XMP saves (perspective omitted='+omit+')');
  }
  await closeElectron(app);app=undefined;await launch([freshSource,freshTarget]);await select(freshTarget);const targetGate=await fillControl().isChecked();await select(freshSource);const sourceGate=await fillControl().isChecked();await selectPair(freshTarget,freshSource);
  for(const [label,value,key,nativeValue] of [['横向补正',10,'offsetX',.072],['纵向补正',10,'offsetY',-.072],['几何缩放',110,'scale',1.1]]){
   const beforeSourcePixels=await pixels(),before=await savePair(freshTarget,freshSource),traceStart=await app.evaluate(()=>globalThis.__signedSync.length);await number(label,value);const afterSourcePixels=await pixels(),after=await savePair(freshTarget,freshSource);assert.equal(after[0].adjustments.perspective.manualModel,'signed-framing-v1');assert.equal(after[0].adjustments.perspective.constrainCrop,sourceGate);assert.equal(after[1].adjustments.perspective.manualModel,'art-perspective-v1');assert.equal(after[1].adjustments.perspective.constrainCrop,targetGate);assert.equal(after[1].adjustments.perspective[key],nativeValue);
   const traces=await app.evaluate((_,start)=>globalThis.__signedSync.slice(start),traceStart);assert(traces.length>0);assert.equal(new Set(traces.flatMap(t=>commands(t).map(c=>c.operationId))).size,1);for(const trace of traces){assert.equal(trace.input.command,undefined);assert.equal(trace.input.commands.length,2);const own=trace.input.commands.find(c=>c.path===freshSource),other=trace.input.commands.find(c=>c.path===freshTarget);assert.deepEqual(own.set.perspective,after[0].adjustments.perspective);assert.equal(own.set.masks,undefined);assert(other.merge.perspective);assert(!own.merge);}
   await button('撤销').click();await idle();assert.equal(await pixels(),beforeSourcePixels);const undone=await savePair(freshTarget,freshSource);for(let i=0;i<2;i++)assert.deepEqual(undone[i].adjustments,before[i].adjustments);await button('重做').click();await idle();assert.equal(await pixels(),afterSourcePixels);const redone=await savePair(freshTarget,freshSource);for(let i=0;i<2;i++)assert.deepEqual(redone[i].adjustments,after[i].adjustments);
  }
  checks.push('two genuinely new photos accept ordinary X/Y/Scale multi-edit from first use, retain their real gates and support shared one-step Undo/Redo with both saved XMPs');
  await select(freshTarget);const targetPixels=await pixels();await selectPair(freshTarget,freshSource);const sourcePixels=await pixels(),beforeCancel=await savePair(freshTarget,freshSource),paths=[freshSource,freshTarget],bytes=await Promise.all(paths.map(p=>readFile(sidecar(p)))),history={undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled()};
  await app.evaluate(()=>{globalThis.__signedHoldResult=true;});const x=input('横向补正');await x.scrollIntoViewIfNeeded();await x.fill('20');await x.press('Tab');const progress=page.getByRole('status',{name:'联动调整',exact:true});await expect(progress).toBeVisible();await expect.poll(()=>app.evaluate(()=>!!globalThis.__signedHeld),{timeout:120000}).toBe(true);await progress.getByRole('button',{name:'取消联动',exact:true}).click();await app.evaluate(()=>{globalThis.__signedHoldResult=false;globalThis.__signedRelease();});await idle();await expect(page.getByRole('alert')).toContainText('已取消联动');await expect(x).toHaveValue('10');assert.equal(await pixels(),sourcePixels);assert.deepEqual({undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled()},history);for(let i=0;i<paths.length;i++)assert.deepEqual(await readFile(sidecar(paths[i])),bytes[i]);
  await page.getByTitle('关闭错误',{exact:true}).click();const afterCancel=await savePair(freshTarget,freshSource);for(let i=0;i<2;i++)assert.deepEqual(afterCancel[i].adjustments,beforeCancel[i].adjustments);await select(freshTarget);assert.equal(await pixels(),targetPixels);await selectPair(freshTarget,freshSource);await button('撤销').click();await idle();await expect(input('几何缩放')).toHaveValue('100');await button('重做').click();await idle();await expect(input('几何缩放')).toHaveValue('110');assert.equal(await pixels(),sourcePixels);
  checks.push('cancelling after the real native prepare rejects its late result, preserves both XMP byte snapshots/parameters/pixels and adds no phantom shared history');
 }

 assert.deepEqual(errors,[]);for(const path of fixturePaths)assert.deepEqual(await readFile(path),sourceBytes);for(const path of cohortFiles)assert.equal(hash(await readFile(path)),cohort[path],path+' remained frozen');
 assert((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable()))));passed=true;console.log(JSON.stringify({cohort,checks,hidden:true,sourceUnchanged:true}));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,cohort,errors,sync:app?await app.evaluate(()=>globalThis.__signedSync).catch(()=>undefined):undefined},null,2));throw error;}finally{if(app){if(!passed){await writeFile(join(root,'diagnostics.json'),JSON.stringify(electronDiagnostics(app),null,2));await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});}await closeElectron(app);}if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained signed GUI failure:',root);}
