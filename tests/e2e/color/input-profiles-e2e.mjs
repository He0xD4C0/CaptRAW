import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {readDocument} from '../../support/xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron} from '../../support/electron-background.mjs';
import {resolve,join} from 'node:path';
import {writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const fixtures=resolve(process.env.CAPTRAW_INPUT_PROFILE_FIXTURES||'artifacts/input-profiles');
const out=resolve(process.env.CAPTRAW_INPUT_PROFILES_E2E_OUT||'artifacts/input-profiles-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[];
let app,page;
async function launch(){app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});}
const pass=name=>{checks.push(name);console.log('PASS',name);};
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve(path));await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(out,name+'.xmp');rmSync(path,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);return (await readDocument(path));}
async function chooseProfile(mode){await profile().selectOption(mode);await expect(profile()).toHaveValue(mode);await save('_rendered');}
async function chooseLight(mode){await light().selectOption(mode);await expect(light()).toHaveValue(mode);await save('_rendered');}
const pixels=()=>page.locator('canvas').evaluate(c=>c.toDataURL());
const profile=()=>page.getByRole('combobox',{name:'输入配置文件',exact:true});
const light=()=>page.getByRole('combobox',{name:'DCP 光源',exact:true});
const colorTable=()=>page.getByRole('checkbox',{name:'基础颜色表',exact:true});
try{
 await launch();await open('build/samples/nikon-d850.NEF');await expect(profile()).toBeVisible();await expect(profile()).toHaveValue('auto');await expect(page.locator('.profile-line')).toContainText('DCP');
 await expect(colorTable()).toBeVisible();await expect(light()).toHaveValue('0');
 for(const name of ['风格表','配置文件色调曲线','基准曝光补偿'])await expect(page.getByRole('checkbox',{name,exact:true})).toHaveCount(0);pass('visible profile choices and DCP controls match actual camera data');
 await expect(profile()).toBeEnabled();const baseline=await pixels();await settle(()=>chooseProfile('matrix'));expect(await pixels()).not.toBe(baseline);await expect(colorTable()).toHaveCount(0);await expect(light()).toHaveCount(0);await expect(page.locator('.profile-line')).toContainText('相机矩阵');pass('matrix changes pixels and hides DCP-only controls');
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(profile()).toHaveValue('auto');expect(await pixels()).toBe(baseline);
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(profile()).toHaveValue('matrix');await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());pass('profile selection is one undoable action and restores exact pixels');
 await expect(colorTable()).toBeEnabled();await settle(()=>colorTable().uncheck());expect(await pixels()).not.toBe(baseline);await settle(()=>colorTable().check());expect(await pixels()).toBe(baseline);pass('DCP base color table affects actual image pixels');
 await expect(light()).toBeEnabled();await settle(()=>chooseLight('1'));const first=await pixels();expect(first).not.toBe(baseline);await expect(light()).toBeEnabled();await settle(()=>chooseLight('2'));expect(await pixels()).not.toBe(first);pass('DCP illuminant controls reach native interpolation');
 const saved=await save('saved');expect(saved.engineVersion).toBe(ENGINE_VERSION);expect(saved.baselineVersion).toBe(4);expect(saved.adjustments.colorProfile.illuminant).toBe(2);
 await app.close();await launch();await open(join(out,'saved.xmp'));const restored=await save('restored');expect(restored.adjustments).toEqual(saved.adjustments);await expect(light()).toHaveValue('2');pass('a new application process restores profile settings and all edits');
 await open(join(fixtures,'default.xmp'));const reopenedDefault=await save('restored-default'),originalDefault=await readDocument(join(fixtures,'default.xmp'));
 expect(reopenedDefault.baselineVersion).toBe(4);expect(reopenedDefault.adjustments).toEqual(originalDefault.adjustments);expect(reopenedDefault.artProfile).toBe(originalDefault.artProfile);const defaultPixels=await pixels();pass('current XMP retains camera white balance, crop and all input-profile settings');
 const unavailable=(await readDocument(join(fixtures,'inherited.xmp')));unavailable.adjustments.colorProfile.reference='file:'+resolve('build/missing-input.dcp');unavailable.artProfile=unavailable.artProfile.replace(/InputProfile=file:[^\n]+/,'InputProfile='+unavailable.adjustments.colorProfile.reference);const unavailablePath=join(out,'unavailable.xmp');writeFileSync(unavailablePath,await documents.serialize(unavailable));
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},unavailablePath);await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toContainText('输入配置文件不可用');expect(await pixels()).toBe(defaultPixels);pass('a missing input profile reports an error before replacing the current image');
 await open(join(fixtures,'inherited.xmp'));await expect(profile()).toHaveValue(/^file:/);const inherited=await pixels();await expect(profile()).toBeEnabled();await settle(()=>chooseProfile('matrix'));await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(profile()).toHaveValue(/^file:/);expect(await pixels()).toBe(inherited);
 const preserved=await save('inherited');expect(preserved.adjustments.colorProfile.reference).toMatch(/^captraw-profile:/);expect(preserved.inputProfileAsset).toBeTruthy();await open(join(out,'inherited.xmp'));expect(await pixels()).toBe(inherited);pass('existing external profile references survive switching, undo and reopen');
 await open('build/samples/synthetic.dng');await expect(profile().locator('option[value=embedded]')).toHaveCount(1);await expect(profile()).toBeEnabled();await settle(()=>chooseProfile('embedded'));await expect(light()).toHaveCount(0);await expect(colorTable()).toHaveCount(0);await save('embedded');pass('embedded DNG profile is selectable without invented DCP capabilities');
 await open('build/samples/embedded-srgb.png');await expect(profile().locator('option[value=matrix]')).toHaveCount(0);await expect(page.locator('.profile-line')).toContainText('嵌入 ICC');await expect(profile()).toBeEnabled();await settle(()=>chooseProfile('embedded'));await save('icc');pass('non-RAW embedded ICC is shown with no RAW matrix choice');
 await settle(()=>page.locator('.film-item').filter({hasText:'nikon-d850.NEF'}).locator('.film-open').click());await settle(()=>page.getByTitle('重置全部编辑').click());await expect(profile()).toBeEnabled();await settle(()=>chooseProfile('matrix'));await save('matrix');
 const output=join(out,'matrix.tiff');rmSync(output,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:60000});expect(existsSync(output)).toBe(true);pass('selected matrix profile exports through the desktop workflow');
 await page.locator('.rendering').waitFor({state:'hidden'});await profile().scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'workbench.png')});expect(errors).toEqual([]);
}catch(error){if(page){await page.screenshot({path:join(out,'failure.png')});console.error(await page.locator('body').innerText());}throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors},null,2)+'\n');if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await app.close().catch(()=>{});}}
