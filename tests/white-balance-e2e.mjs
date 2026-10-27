import {expect} from '@playwright/test';
import {readDocument} from './xmp-test.mjs';
import {electron} from './electron-background.mjs';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
const out=resolve(process.env.CAPTRAW_WB_OUT||'artifacts/white-balance-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[],checks=[];page.on('pageerror',e=>errors.push(String(e)));
const passed=name=>{checks.push(name);console.log('PASS',name);};
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve(path));await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(out,name+'.xmp');rmSync(path,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);return readDocument(path);}
try{
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await open('build/samples/nikon-d850.NEF');const selector=page.getByRole('combobox',{name:'白平衡',exact:true});
 await expect(selector).toBeVisible();const original=await save('original');expect(original.baselineVersion).toBe(4);expect(original.adjustments.wbMultipliers).toHaveLength(3);
 const wbTemp=page.getByRole('spinbutton',{name:'色温',exact:true});await wbTemp.focus();await wbTemp.press('Tab');expect((await save('focus-only')).adjustments).toEqual(original.adjustments);
 await wbTemp.focus();await wbTemp.press('Escape');expect((await save('escape-only')).adjustments).toEqual(original.adjustments);
 await wbTemp.fill('6500');await wbTemp.press('Escape');expect((await save('cancel-temperature')).adjustments).toEqual(original.adjustments);passed('focus, Tab and Escape preserve exact camera WB and cancel the complete edit');
 const inputProfile=page.getByRole('combobox',{name:'输入配置文件'});await inputProfile.selectOption('matrix');await expect(inputProfile).toHaveValue('matrix');
 const matrixWB=await save('matrix-wb');expect(matrixWB.adjustments.wbMultipliers).toEqual(original.adjustments.wbMultipliers);expect(matrixWB.adjustments.wbMode).toBe('camera');expect(matrixWB.adjustments.temperature).not.toBe(original.adjustments.temperature);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(inputProfile).toHaveValue('auto');expect((await save('profile-undone')).adjustments).toEqual(original.adjustments);passed('profile change preserves fixed coefficients, reprojects coordinates and undoes in one step');
 const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await settle(async()=>{await exposure.fill('0.5');await exposure.press('Tab');});
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},join(out,'original.xmp'));
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toContainText('未保存');await expect(exposure).toHaveValue('0.5');await expect(page.locator('.film-item')).toHaveCount(1);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());passed('opening another recipe cannot replace unsaved edits');
 const originalPacket=readFileSync(join(out,'original.xmp'),'utf8'),invalid=originalPacket.replace(/crs:Temperature="[^"]*"/,'crs:Temperature="invalid"');expect(invalid).not.toBe(originalPacket);writeFileSync(join(out,'invalid.xmp'),invalid);
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},join(out,'invalid.xmp'));
 const canvasBefore=await page.locator('canvas').evaluate(c=>c.toDataURL());await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Temperature 超出');expect(await page.locator('canvas').evaluate(c=>c.toDataURL())).toBe(canvasBefore);await expect(page.locator('.film-item')).toHaveCount(1);passed('invalid recipe is rejected before replacing the current image');
 await settle(()=>selector.selectOption('auto'));const auto=await save('auto');expect(auto.adjustments.wbMode).toBe('auto');expect(auto.adjustments.wbMultipliers).not.toEqual(original.adjustments.wbMultipliers);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(selector).toHaveValue('camera');
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(selector).toHaveValue('auto');passed('automatic WB uses native coefficients and is one undoable action');
 await settle(()=>selector.selectOption('preset:0'));const preset=await save('preset');expect(preset.adjustments.wbMode).toBe('preset:0');expect(preset.adjustments.wbMultipliers).toHaveLength(3);passed('camera-specific preset is visible, applied and saved');
 await settle(()=>selector.selectOption('camera'));expect((await save('camera')).adjustments.wbMultipliers).toEqual(original.adjustments.wbMultipliers);
 const temp=page.getByRole('spinbutton',{name:'色温',exact:true});await settle(async()=>{await temp.fill('6500');await temp.press('Tab');});await expect(selector).toHaveValue('custom');expect((await save('manual')).adjustments.wbMultipliers).toBeNull();passed('manual temperature switches to custom and clears exact coefficients');
 const tint=page.getByRole('spinbutton',{name:'色调',exact:true});await expect(tint).toHaveAttribute('min','-150');await expect(tint).toHaveAttribute('max','150');
 const beforeTint=await page.locator('canvas').evaluate(c=>c.toDataURL());await settle(async()=>{await tint.fill('25');await tint.press('Tab');});expect(await page.locator('canvas').evaluate(c=>c.toDataURL())).not.toBe(beforeTint);
 const tinted=await save('adobe-tint');expect(tinted.adjustments.tint).toBe(25);expect(tinted.adjustments.temperature).toBe(6500);expect(readFileSync(join(out,'adobe-tint.xmp'),'utf8')).toContain('crs:Tint="25"');
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(tint).toHaveValue('25');passed('Adobe Tint range, visible pixel effect, standard XMP and undo/redo work');
 await expect(selector).toBeEnabled();await selector.focus();await page.keyboard.press('i');await expect(page.getByRole('combobox',{name:'取样大小'})).toHaveCount(0);passed('typing in a dropdown does not activate global tools');await expect(selector).toBeEnabled();await settle(()=>selector.selectOption('custom'));
 await page.locator('canvas').click({position:{x:10,y:10}});await page.keyboard.press('i');await expect(page.getByRole('combobox',{name:'取样大小'})).toBeVisible();await page.getByRole('combobox',{name:'取样大小'}).selectOption('25');
 const b=await page.getByTestId('viewport').boundingBox(),frame=await page.evaluate(()=>window.__frames.filter(f=>f.kind==='fit').at(-1));const scale=Math.min((b.width-64)/frame.fullWidth,(b.height-64)/frame.fullHeight);
 await settle(()=>page.mouse.click(b.x+b.width/2+(.6-.5)*frame.fullWidth*scale,b.y+b.height/2+(.6-.5)*frame.fullHeight*scale));
 await expect(selector).toHaveValue('sample');const sampled=await save('sampled');expect(sampled.adjustments.wbMultipliers).toHaveLength(3);
 await page.keyboard.press('Escape');await expect(page.getByRole('combobox',{name:'取样大小'})).toHaveCount(0);passed('I selects the visible eyedropper, 25px sample works, Escape exits');
 await page.waitForFunction(()=>document.querySelector('.film-item.selected img')?.dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);passed('filmstrip thumbnail matches the current preview revision');
 await page.locator('.rendering').waitFor({state:'hidden'});await page.screenshot({path:join(out,'sampled.png')});await open(join(out,'sampled.xmp'));expect((await save('restored')).adjustments).toEqual(sampled.adjustments);passed('sampled WB coefficients restore from the saved document');
 await open('build/samples/synthetic.dng');await settle(()=>page.locator('.film-item').filter({hasText:'nikon-d850.NEF'}).locator('.film-open').click());expect((await save('switched')).adjustments).toEqual(sampled.adjustments);passed('current XMP white balance survives filmstrip switching');
 const output=join(out,'sampled.tiff');rmSync(output,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
 await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});expect(existsSync(output)).toBe(true);passed('restored sampled white balance exports TIFF16');
 expect(errors).toEqual([]);
}catch(e){await page.screenshot({path:join(out,'failure.png')});console.error(await page.locator('body').innerText());throw e;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors},null,2)+'\n');await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await app.close();}
