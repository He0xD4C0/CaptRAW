// Actual hidden App; requires the parent's frozen native/UI build.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {XMP,CRS,CT,property,text,encode,encodeAdjustments,lookup} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {POINT_CURVE_PRESETS,ENGINE_VERSION} from '@captraw/contracts';
import {EngineClient} from '../../support/engine-client.mjs';
import {copyFileSync,existsSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const work=mkdtempSync(join(tmpdir(),'captraw-curve-refine-gui-')),files=['来源','目标','未选'].map(n=>join(work,n+'.png')),checks=[],errors=[];
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let app,page,passed=false;
const defaultFiles=['新图 identity','已有32 未标记','旧27 已编辑','外来仅Refine'].map(n=>join(work,n+'.png')),expectedLegacy=new Map();
const sidePath=file=>file.replace(/\.png$/,'.xmp');
const side=i=>files[i].replace('.png','.xmp'),button=name=>page.getByRole('button',{name,exact:true}),field=()=>page.getByRole('spinbutton',{name:'优化饱和度',exact:true}),photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__refineFrames.filter(f=>f.kind==='fit').at(-1)?.url);await expect(page.getByRole('alert')).toHaveCount(0);}
async function select(i){await photo(i).locator('.film-open').click();await idle();}
async function amount(value){await field().scrollIntoViewIfNeeded();await expect(field()).toBeInViewport();await field().fill(String(value));await field().press('Tab');await idle();}
async function save(){const multiple=await page.locator('.film-open[aria-pressed=true]').count()>1;await button(multiple?'保存所选…':'保存').click();if(multiple){const d=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await expect(d.getByRole('button',{name:'返回编辑',exact:true})).toBeEnabled();await d.getByRole('button',{name:'返回编辑',exact:true}).click();}await idle();}
async function selectPath(file){await page.locator('.film-item').filter({hasText:basename(file)}).locator('.film-open').click();await idle();}
async function readPath(file){const properties=(await xmp.read(sidePath(file))).properties;return {doc:await documents.read(sidePath(file)),node:lookup(properties,CRS,'CurveRefineSaturation')};}
async function exportLegacy(file){
 const output=join(work,basename(file,'.png')+'-actual.tif');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
 await button('导出').click();await page.getByRole('button',{name:/TIFF · 16 位/}).click();await expect.poll(()=>existsSync(output),{timeout:60000}).toBe(true);await expect(page.locator('.job-toast')).toHaveClass(/completed|success|done/,{timeout:60000});
 execFileSync(resolve('build/qa-venv/bin/python'),['-c','import numpy as np,tifffile,sys\na=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert np.array_equal(a,b)',output,expectedLegacy.get(file)]);
}
async function read(i){const properties=(await xmp.read(side(i))).properties;return {doc:await documents.read(side(i)),node:lookup(properties,CRS,'CurveRefineSaturation')};}
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex'),pass=s=>{checks.push(s);console.log('PASS',s);};
async function launch(paths){app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,paths.length===1?'restart':'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.__refineFrames=[];window.__refineInputTrace=[];
 const record=(kind,target)=>{const f=document.querySelector('input[aria-label="优化饱和度"]');window.__refineInputTrace.push({at:Math.round(performance.now()),kind,target:target?.getAttribute?.('aria-label')||target?.tagName,value:f?.value,disabled:f?.disabled,focused:document.activeElement===f,frame:document.querySelector('canvas')?.dataset.frame});if(window.__refineInputTrace.length>300)window.__refineInputTrace.shift();};
 for(const kind of ['input','blur','focus','keydown'])document.addEventListener(kind,e=>{if(e.target?.getAttribute?.('aria-label')==='优化饱和度'||kind==='keydown'&&e.key==='Escape')record(kind==='keydown'?kind+':'+e.key:kind,e.target);},true);
 new MutationObserver(records=>{for(const r of records)if(r.target.getAttribute?.('aria-label')==='优化饱和度')record('attribute:'+r.attributeName,r.target);}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['disabled']});
 window.captraw.onEvent(e=>{if(e.event==='preview')window.__refineFrames.push(e.frame);});});await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});dialog.showMessageBox=async()=>({response:1});},paths);await button('打开').click();await idle();}
try{
 for(let i=0;i<3;i++){
  execFileSync(resolve('build/qa-venv/bin/python'),['-c',"from PIL import Image\nimport sys\nim=Image.new('RGB',(320,240));im.putdata([(50+x%100,60+y%90,80+(x+y)%80) for y in range(240) for x in range(320)]);im.save(sys.argv[1])",files[i]]);
  const state={incrementalTemperature:0,incrementalTint:0,relativeWBModel:'art-ctl-v1',exposure:i*.1,contrast:25,curve:POINT_CURVE_PRESETS['Medium Contrast'],curveName:'Medium Contrast',redCurve:POINT_CURVE_PRESETS.Linear,greenCurve:POINT_CURVE_PRESETS.Linear,blueCurve:POINT_CURVE_PRESETS.Linear};
  writeFileSync(side(i),(await xmp.call('write','',[...encodeAdjustments(state),property(CRS,'CurveRefineSaturation',{...text('100'),qualifiers:[property('https://example.com/refine/1.0/','note',text('retained while updating'))]})])).packet);
 }
 // Fixtures use the real explicit legacy engine path as an unmarked STD
 // oracle. App open/save/export must not acquire the new current default.
 for(const file of defaultFiles)copyFileSync(files[0],file);
 const defaultsOriginals=defaultFiles.map(hash),opaque=property(CRS,'CurveRefineSaturation',{...text('100'),qualifiers:[property('https://example.com/refine-default/','note',text('external inactive'))]});
 const fixture=new EngineClient({cache:join(work,'legacy-oracle')});
 try{
  for(const [index,version]of [[1,ENGINE_VERSION],[2,'CaptRAW-27_ART-1.26.10_LibRaw-3b20539']]){
   const path=defaultFiles[index],image=await fixture.call('open',{path,sessionId:'legacy-oracle-'+index,effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
   const adjustments={...image.adjustments,curve:POINT_CURVE_PRESETS['Strong Contrast'],curveName:'Strong Contrast',contrast:25};assert.equal(adjustments.curveRefineModel,undefined);
   const composed=await fixture.call('compose',{path,width:image.width,height:image.height,adjustments,artProfile:image.artProfile}),reference=join(work,'expected-legacy-'+index+'.tif');
   await fixture.call('export',{path,artProfile:composed.artProfile,output:reference,format:'tiff',colorSpace:'srgb'});expectedLegacy.set(path,reference);
   const packet=(await xmp.call('write','',[opaque])).packet,document=await documents.serialize({engineVersion:version,baselineVersion:4,source:{path,size:readFileSync(path).length,sha256:hash(path)},adjustments,artProfile:composed.artProfile,xmpPacket:packet});
   writeFileSync(sidePath(path),(await xmp.call('write',document,[property(CT,'EngineVersion',encode(version))])).packet);
  }
 }finally{await fixture.stop();}
 // HasSettings and otherwise unsupported CRS are both existing active edits.
 // This record deliberately has no engine version, ARTProfile or known curve.
 writeFileSync(sidePath(defaultFiles[3]),(await xmp.call('write','',[opaque,property(CRS,'HasSettings',text('True')),property(CRS,'AlreadyApplied',text('False'))])).packet);
 const originals=files.map(hash),untouched=hash(side(2));await launch(files);await select(0);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await field().scrollIntoViewIfNeeded();await expect(field()).toBeInViewport();await expect(field()).toHaveValue('0');await save();const legacy=await read(0);assert.equal(legacy.doc.adjustments.curveRefineModel,undefined);assert.equal(legacy.node.value,'100');
 pass('visible small-window control does not activate or overwrite unmarked qualified Adobe Refine on save');
 const before=await pixels();await amount(40);assert.notEqual(await pixels(),before);await save();const active=await read(0);assert.equal(active.doc.adjustments.curveRefineModel,'weighted-std-v1');assert.equal(active.doc.adjustments.curveRefineSaturation,40);assert.deepEqual(active.node.qualifiers,legacy.node.qualifiers);assert.equal(active.doc.adjustments.curveName,'Medium Contrast');
 pass('explicit numeric edit changes the real preview and saves paired model/value without losing qualifiers or curve name');
 await photo(1).locator('.film-open').click({modifiers:['Meta']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);await amount(60);await save();for(const i of [0,1]){const v=await read(i);assert.equal(v.doc.adjustments.curveRefineModel,'weighted-std-v1');assert.equal(v.doc.adjustments.curveRefineSaturation,60);}assert.equal(hash(side(2)),untouched);
 await button('撤销').click();await idle();await save();assert.equal((await read(0)).doc.adjustments.curveRefineSaturation,40);assert.equal((await read(1)).doc.adjustments.curveRefineModel,undefined);await expect(button('重做')).toBeEnabled();const baseline=await pixels();
 await field().fill('80');await idle();await field().press('Escape');await idle();assert.equal(await pixels(),baseline);await expect(button('重做')).toBeEnabled();await button('重做').click();await idle();await save();assert.equal((await read(1)).doc.adjustments.curveRefineSaturation,60);
 pass('amount-only multi-photo transaction carries its marker, undoes in one step and numeric Esc preserves pixels and redo');
 await select(0);const original=await pixels(),thumb=page.getByRole('slider',{name:'优化饱和度滑杆',exact:true});await thumb.scrollIntoViewIfNeeded();const track=thumb.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," slider ")][1]'),box=await track.boundingBox(),start=await thumb.boundingBox();assert(box&&start);await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.25,box.y+box.height/2,{steps:8});await idle();await page.keyboard.press('Escape');await idle();await page.mouse.move(box.x+box.width*.9,box.y+box.height/2,{steps:8});await page.mouse.up();await idle();assert.equal(await pixels(),original);await expect(field()).toHaveValue('60');
 pass('held slider Escape restores the complete state and suppresses subsequent move/up writes');
 await button('复制设置…').click();const copy=page.getByRole('dialog',{name:'复制编辑设置',exact:true});await copy.getByRole('button',{name:'全不选',exact:true}).click();await copy.getByRole('checkbox',{name:'点曲线与参数曲线',exact:true}).check();await copy.getByRole('button',{name:'复制所选设置',exact:true}).click();await select(1);await amount(20);await button('粘贴设置').click();await idle();await save();assert.equal((await read(1)).doc.adjustments.curveRefineSaturation,60);assert.equal((await read(1)).doc.adjustments.curveRefineModel,'weighted-std-v1');
 pass('real curves-only copy/paste applies the paired refinement settings');
 await button('预设').click();await button('创建预设').click();const form=page.getByRole('dialog',{name:'创建预设',exact:true});await form.getByRole('textbox',{name:'预设名称',exact:true}).fill('曲线优化 专项');await form.getByRole('combobox',{name:'预设分组',exact:true}).fill('专项');await form.getByRole('button',{name:'全不选',exact:true}).click();await form.getByRole('checkbox',{name:'点曲线与参数曲线',exact:true}).check();await form.getByRole('button',{name:'保存预设',exact:true}).click();await expect(form).toHaveCount(0);await select(2);await button('曲线优化 专项').click();await idle();await save();assert.equal((await read(2)).doc.adjustments.curveRefineModel,'weighted-std-v1');assert.equal((await read(2)).doc.adjustments.curveRefineSaturation,60);
 await closeElectron(app);app=null;await launch([files[2]]);await field().scrollIntoViewIfNeeded();await expect(field()).toHaveValue('60');for(let i=0;i<3;i++)assert.equal(hash(files[i]),originals[i]);assert.deepEqual(errors,[]);
 pass('actual preset application and fresh App reopening restore model/value while originals remain unchanged');
 await closeElectron(app);app=null;await launch(defaultFiles);await selectPath(defaultFiles[0]);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await idle();
 await field().scrollIntoViewIfNeeded();await expect(field()).toBeInViewport();await expect(field()).toHaveValue('100');await expect(field()).toBeDisabled();const identity=await pixels();
 await save();assert.equal(await pixels(),identity);let current=await readPath(defaultFiles[0]);assert.equal(current.doc.adjustments.curveRefineModel,'weighted-std-v1');assert.equal(current.doc.adjustments.curveRefineSaturation,100);
 pass('genuinely new App photo starts at explicit owned100 on disabled identity and saves without pixel change');
 const preset=()=>page.getByRole('combobox',{name:'点曲线预设',exact:true});let medium;
 for(const [name,caption]of [['Medium Contrast','Medium'],['Strong Contrast','Strong']]){
  await preset().scrollIntoViewIfNeeded();await preset().selectOption(name);await idle();await expect(field()).toHaveValue('100');await expect(field()).toBeEnabled();const refined=await pixels();if(caption==='Medium')medium=refined;
  await save();const saved=await readPath(defaultFiles[0]);assert.equal(saved.doc.adjustments.curveRefineModel,'weighted-std-v1');assert.equal(saved.doc.adjustments.curveRefineSaturation,100);assert.equal(saved.doc.adjustments.curveName,name);
  await amount(0);assert.notEqual(await pixels(),refined,caption+' must actually render inherited100');await button('撤销').click();await idle();assert.equal(await pixels(),refined);await expect(field()).toHaveValue('100');
 }
 await button('撤销').click();await idle();assert.equal(await pixels(),medium,'Undo Strong must restore Medium100 in one step');await button('撤销').click();await idle();assert.equal(await pixels(),identity);await expect(field()).toHaveValue('100');await expect(field()).toBeDisabled();await save();
 pass('real Medium/Strong inherit100 and differ from0; amount and preset undo restore exact pixels and the default');
 for(const [index,version]of [[1,ENGINE_VERSION],[2,'CaptRAW-27_ART-1.26.10_LibRaw-3b20539']]){
  const file=defaultFiles[index];await selectPath(file);await field().scrollIntoViewIfNeeded();await expect(field()).toHaveValue('0');await expect(field()).toBeEnabled();const original=await pixels(),imported=await readPath(file);assert.equal(imported.doc.engineVersion,version);assert.equal(imported.doc.adjustments.curveRefineModel,undefined);
  await save();assert.equal(await pixels(),original);const saved=await readPath(file);assert.equal(saved.doc.adjustments.curveRefineModel,undefined);assert.equal(saved.doc.adjustments.curveRefineSaturation,undefined);assert.deepEqual(saved.node,imported.node);
  const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await exposure.scrollIntoViewIfNeeded();await exposure.fill('.5');await exposure.press('Tab');await idle();assert.notEqual(await pixels(),original);await button('撤销').click();await idle();assert.equal(await pixels(),original);await expect(button('重做')).toBeEnabled();await save();assert.equal((await readPath(file)).doc.adjustments.curveRefineModel,undefined);await exportLegacy(file);
 }
 pass('existing32 unmarked and old27 App edits retain STD, qualified Refine and exact legacy TIFF through save and undo');
 await selectPath(defaultFiles[3]);await field().scrollIntoViewIfNeeded();await expect(field()).toHaveValue('0');await expect(field()).toBeDisabled();const externalBefore=await readPath(defaultFiles[3]);assert.equal(externalBefore.doc.adjustments.curveRefineModel,undefined);
 await preset().scrollIntoViewIfNeeded();await preset().selectOption('Medium Contrast');await idle();await expect(field()).toHaveValue('0');await expect(field()).toBeEnabled();await save();const externalSaved=await readPath(defaultFiles[3]);assert.equal(externalSaved.doc.adjustments.curveRefineModel,undefined);assert.equal(externalSaved.doc.adjustments.curveRefineSaturation,undefined);assert.deepEqual(externalSaved.node,externalBefore.node);
 pass('external active Refine-only packet never receives the current default, including after an explicit curve preset/save');
 await closeElectron(app);app=null;await launch([defaultFiles[0]]);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await idle();await field().scrollIntoViewIfNeeded();await expect(field()).toHaveValue('100');await expect(field()).toBeDisabled();assert.equal(await pixels(),identity);
 for(let i=0;i<defaultFiles.length;i++)assert.equal(hash(defaultFiles[i]),defaultsOriginals[i]);assert.deepEqual(errors,[]);
 pass('saved new default reopens as owned100 without altering any original source pixels');
 passed=true;console.log(JSON.stringify({checks,errors}));
}catch(error){if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});const trace=page?await page.evaluate(()=>({input:window.__refineInputTrace,frames:window.__refineFrames.map(({sessionId,revision,url,kind})=>({sessionId,revision,url,kind})),focused:document.activeElement?.getAttribute('aria-label')})).catch(()=>undefined):undefined;writeFileSync(join(work,'failure.json'),JSON.stringify({error:String(error),checks,errors,trace},null,2));throw error;}finally{if(page)await page.mouse.up().catch(()=>{});if(app)await closeElectron(app);if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
