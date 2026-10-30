import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {readDocument} from '../../support/xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {readFileSync,writeFileSync,mkdirSync,cpSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const out=resolve(process.env.CAPTRAW_GRADING_E2E_OUT||'artifacts/color-grading-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[],frames=[];let app,page;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),pass=s=>{checks.push(s);console.log('PASS',s);};
async function launch(){app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});}
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve(path));await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(out,name+'.xmp');rmSync(path,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);await settle(()=>page.getByRole('button',{name:'保存',exact:true}).click());await expect.poll(()=>existsSync(path)).toBe(true);return (await readDocument(path));}
const pixels=async()=>hash(await page.evaluate(()=>window.__frames.filter(f=>f.kind!=='detail').at(-1).file));
const wheel=region=>page.getByRole('group',{name:region+'色轮',exact:true});
async function view(region){await page.getByRole('button',{name:region==='all'?'三轮总览':region+'分级视图',exact:true}).click();}
async function value(label,n){const input=page.getByRole('spinbutton',{name:label,exact:true});if(await input.inputValue()===String(n))return;await settle(async()=>{await input.fill(String(n));await input.press('Tab');});}
async function grading(){const summary=page.locator('summary').filter({hasText:/^颜色分级$/});if(!await summary.evaluate(e=>e.parentElement.open))await summary.click();}
async function drag(region,to,{modifier,fromHandle=true,cancel=false}={}){
 const w=wheel(region);await w.scrollIntoViewIfNeeded();const b=await w.boundingBox(),h=await w.locator('.grading-handle').boundingBox(),r=b.width/2-9;
 const start=fromHandle?{x:h.x+h.width/2,y:h.y+h.height/2}:{x:b.x+b.width/2,y:b.y+b.height/2};
 await settle(async()=>{if(modifier)await page.keyboard.down(modifier);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(b.x+b.width/2+to[0]*r,b.y+b.height/2+to[1]*r,{steps:12});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();if(modifier)await page.keyboard.up(modifier);});
}
async function context(region,item){await wheel(region).click({button:'right'});await page.getByRole('menuitem',{name:item,exact:true}).click();}
async function exportFile(name){const file=join(out,name+'.tiff');rmSync(file,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});expect(existsSync(file)).toBe(true);}
const source=resolve('build/samples/local-tone.png'),sourceHash=hash(source),inputPath=join(out,'初始显影.xmp');
const fixtureEngine=new EngineClient({cache:join(out,'fixture-cache')});
try{const im=await fixtureEngine.call('open',{path:source,sessionId:'fixture'}),pending=fixtureEngine.preview(1);const r=await fixtureEngine.call('update',{revision:1,adjustments:im.adjustments});cpSync((await pending).file,join(out,'initial.png'));writeFileSync(inputPath,await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:readFileSync(source).length,sha256:sourceHash},adjustments:im.adjustments,artProfile:r.artProfile}));}finally{await fixtureEngine.stop();}
const inputHash=hash(inputPath);
try{
 await launch();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.session.enableNetworkEmulation({offline:true}));
 await open(inputPath);const initialPixels=await pixels();expect(initialPixels).toBe(hash(join(out,'initial.png')));
 await grading();
 for(const name of ['阴影','中间调','高光']){await expect(wheel(name)).toBeVisible();await wheel(name).scrollIntoViewIfNeeded();await expect(wheel(name)).toBeInViewport();}
 const mid=await wheel('中间调').boundingBox(),shadow=await wheel('阴影').boundingBox(),high=await wheel('高光').boundingBox();expect(mid.y).toBeLessThan(shadow.y);expect(shadow.x).toBeLessThan(high.x);
 const initial=await save('initial');expect(initial.engineVersion).toBe(ENGINE_VERSION);expect(initial.baselineVersion).toBe(4);expect(initial.artProfile).not.toContain('[CaptRAW Color Grading]');pass('current XMP keeps exact pixels and exposes three visible wheels in the ACR arrangement');
 await drag('阴影',[-.35,.606]);const tinted=await save('tinted'),tintedPixels=await pixels();expect(tinted.adjustments.colorGrading.shadows.hue).toBeCloseTo(240,0);expect(tinted.adjustments.colorGrading.shadows.saturation).toBe(70);expect(tintedPixels).not.toBe(initialPixels);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());expect(await pixels()).toBe(initialPixels);await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());expect(await pixels()).toBe(tintedPixels);pass('wheel drag changes native pixels and forms exactly one undo/redo step');
 await drag('阴影',[-.2,.346],{modifier:'Shift'});const shifted=(await save('shift')).adjustments.colorGrading.shadows;expect(shifted.hue).toBe(240);expect(shifted.saturation).toBe(40);
 await drag('阴影',[.6,.2],{modifier:'Meta'});const constrained=(await save('command')).adjustments.colorGrading.shadows;expect(constrained.saturation).toBe(40);expect(constrained.hue).not.toBe(240);pass('Shift locks hue and Command locks saturation during actual pointer gestures');
 await view('阴影');await expect(page.locator('.grading-wheel')).toHaveCount(1);await value('阴影分级色相',0);await value('阴影分级饱和度',40);
 await drag('阴影',[.8,0],{modifier:'Alt'});const fine=(await save('fine')).adjustments.colorGrading.shadows;expect(fine.hue).toBe(0);expect(fine.saturation).toBe(44);
 await wheel('阴影').focus();await settle(()=>page.keyboard.press('ArrowUp'));expect(await wheel('阴影').getAttribute('data-saturation')).toBe('45');pass('single-wheel numeric controls, Option fine adjustment and keyboard editing work');
 await value('阴影分级明度',12);const beforeCancel=(await save('before-cancel')).adjustments.colorGrading;
 await drag('阴影',[-.5,-.5],{cancel:true});expect((await save('after-cancel')).adjustments.colorGrading).toEqual(beforeCancel);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(page.getByRole('spinbutton',{name:'阴影分级明度',exact:true})).toHaveValue('0');await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());pass('Escape cancels a drag without leaving an extra history step');
 await context('阴影','复制色轮设置');await view('高光');await settle(()=>context('高光','粘贴色轮设置'));const copied=await save('copied');expect(copied.adjustments.colorGrading.highlights).toEqual(copied.adjustments.colorGrading.shadows);pass('context menu copies and pastes the whole wheel independently');
 const hb=await wheel('高光').locator('.grading-handle').boundingBox();await settle(()=>page.mouse.dblclick(hb.x+hb.width/2,hb.y+hb.height/2));
 const resetHS=(await save('reset-hs')).adjustments.colorGrading.highlights;expect(resetHS).toEqual({hue:0,saturation:0,luminance:12});pass('double-click resets hue and saturation while retaining wheel luminance');
 await view('中间调');await value('中间调分级色相',35);await value('中间调分级饱和度',30);await value('中间调分级明度',-8);await value('分级混合',75);await value('分级平衡',-20);
 await view('全局');await expect(page.getByRole('spinbutton',{name:'分级混合',exact:true})).toHaveCount(0);await value('全局分级色相',220);await value('全局分级饱和度',12);await value('全局分级明度',4);
 const mixed=await save('mixed'),mixedPixels=await pixels();await settle(()=>context('全局','复位三轮'));const threeReset=await save('three-reset');expect(threeReset.adjustments.colorGrading.global).toEqual(mixed.adjustments.colorGrading.global);expect(threeReset.adjustments.colorGrading.blending).toBe(75);await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());expect(await pixels()).toBe(mixedPixels);pass('four independent wheels, luminance, blending and balance persist; three-wheel reset preserves global settings');
 await view('all');await page.locator('.color-grading-panel').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'three-wheels.png')});
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await expect(page.locator('.grading-wheel')).toHaveCount(0);await page.getByRole('button',{name:'编辑',exact:true}).click();await grading();
 expect((await save('mode-restored')).adjustments.colorGrading).toEqual(mixed.adjustments.colorGrading);pass('grading controls stay in edit mode and retain document state across tool changes');
 await app.close();await launch();await open(join(out,'mixed.xmp'));expect(await pixels()).toBe(mixedPixels);expect((await save('restarted')).adjustments).toEqual(mixed.adjustments);pass('Chinese/space paths and a fresh application restore the entire recipe and exact pixels');
 await grading();await view('all');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));for(const name of ['阴影','中间调','高光']){await wheel(name).scrollIntoViewIfNeeded();await expect(wheel(name)).toBeInViewport();}await page.screenshot({path:join(out,'small-window.png')});pass('three-wheel controls remain reachable in the supported small window');
 const raw=resolve('build/samples/nikon-d850.NEF'),rawHash=hash(raw);await open(raw);await grading();await view('全局');await value('全局分级色相',35);await value('全局分级饱和度',25);await value('全局分级明度',-5);const rawRecipe=await save('真实 RAW 分级');
 const n=await page.evaluate(()=>window.__frames.filter(f=>f.kind==='detail').length);await page.getByRole('button',{name:'1:1',exact:true}).click();await page.waitForFunction(n=>window.__frames.filter(f=>f.kind==='detail').length>n,n);await page.waitForFunction(()=>!!document.querySelector('canvas').dataset.detail);await page.locator('.rendering').waitFor({state:'hidden'});
 const f=await page.evaluate(()=>window.__frames.filter(f=>f.kind==='detail').at(-1));await expect(page.locator('canvas')).toHaveAttribute('data-detail',f.url);cpSync(f.file,join(out,'raw-detail.png'));frames.push(f);
 await exportFile('raw');await page.screenshot({path:join(out,'raw-global-wheel.png')});expect(hash(raw)).toBe(rawHash);pass('real RAW grading displays true 1:1 detail and exports TIFF16 through the desktop');
 const independent=new EngineClient({cache:join(out,'independent-cache'),executable:executablePath?resolve(executablePath,'../../Resources/native/captraw-engine'):undefined,resources:executablePath?resolve(executablePath,'../../Resources/native/resources'):undefined});
 try{await independent.call('export',{path:raw,artProfile:rawRecipe.artProfile,output:join(out,'raw-independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 expect(hash(source)).toBe(sourceHash);expect(hash(inputPath)).toBe(inputHash);expect(errors).toEqual([]);pass('source files and original XMP remain unchanged; no page runtime errors');
}catch(e){if(page)await page.screenshot({path:join(out,'failure.png')});throw e;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors,frames},null,2)+'\n');if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await app.close().catch(()=>{});}}
