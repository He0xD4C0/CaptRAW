import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {mkdtemp,readFile,writeFile,rm,mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
const work=await mkdtemp(join(tmpdir(),'captraw-p3-gui-')),input=join(work,'宽色域 监看.tiff'),checks=[],pixels=[],errors=[],consoleErrors=[];
execFileSync(resolve('build/qa-venv/bin/python'),['-c',"import sys,numpy as np,tifffile\na=np.empty((384,512,3),dtype=np.uint16);a[:]=np.round(np.array([.85,.15,.05])*65535).astype(np.uint16)\nicc=open(sys.argv[2],'rb').read();tifffile.imwrite(sys.argv[1],a,photometric='rgb',extratags=[(34675,'B',len(icc),icc,False)])",input,resolve('build/native/resources/iccprofiles/output/RTv4_DisplayP3.icc')]);
const original=await readFile(input),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let app,page,passed=false,stage='launch';
const button=name=>page.getByRole('button',{name,exact:true}),canvas=()=>page.getByRole('img',{name:'显影预览',exact:true});
const pass=message=>{checks.push(message);console.log('PASS',message);};
async function rendered(kind='fit'){
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(kind=>{const frame=window.__p3Frames.filter(f=>f.kind===kind).at(-1),canvas=document.querySelector('canvas[aria-label="显影预览"]');return frame&&canvas?.dataset[kind==='detail'?'detail':'frame']===frame.url;},kind);
 await expect(canvas()).toBeVisible();await expect(canvas()).toBeInViewport();await expect(page.locator('.linear-display-status')).toContainText(/Display P3/);
}
async function proof(colorSpace,name){
 const previous=await canvas().evaluate(c=>c.toDataURL()),revision=await page.evaluate(()=>window.__p3Frames.filter(f=>f.kind==='fit').at(-1)?.revision);
 await page.getByRole('dialog',{name:'导出设置',exact:true}).getByRole('combobox',{name:'输出色彩空间',exact:true}).selectOption(colorSpace);
 await page.waitForFunction(colorSpace=>{const frame=window.__p3Frames.filter(f=>f.kind==='fit').at(-1),canvas=document.querySelector('canvas[aria-label="显影预览"]');return frame?.linear?.outputProfile===colorSpace&&canvas?.dataset.outputProfile===colorSpace;},colorSpace,{timeout:120000});
 await expect(page.locator('.linear-display-status')).toContainText(`${name} 目标预览`);
 const frame=await page.evaluate(()=>window.__p3Frames.filter(f=>f.kind==='fit').at(-1));
 const changed=await canvas().evaluate((c,before)=>c.toDataURL()!==before,previous);
 pixels.push({kind:'target-preview',revision:frame.revision,colorSpace,changed});
 assert.equal(frame.revision,revision);assert(changed,`${colorSpace} target preview must change the visible P3 presentation`);
 return previous;
}
async function inspect(kind='fit'){
 const frame=await page.evaluate(kind=>window.__p3Frames.filter(f=>f.kind===kind).at(-1),kind);
 const result=await canvas().evaluate(async(source,frame)=>{
  const configuration=source.getContext('2d').getContextAttributes();
  const bytes=await (await fetch(frame.linear.url)).arrayBuffer(),data=new Float16Array(bytes),index=(Math.floor(frame.height/2)*frame.width+Math.floor(frame.width/2))*4;
  const expected=Array.from(data.slice(index,index+3));
  const copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;const context=copy.getContext('2d',{colorSpace:'display-p3',colorType:'float16'});context.drawImage(source,0,0);const actual=Array.from(context.getImageData(Math.floor(copy.width/2),Math.floor(copy.height/2),1,1,{colorSpace:'display-p3',pixelFormat:'rgba-float16'}).data).slice(0,3);
  return {configuration:{colorType:configuration.colorType,colorSpace:configuration.colorSpace,toneMapping:configuration.toneMapping.mode},expected,actual,maxError:Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])))};
 },frame);
 assert.equal(frame.linear.colorSpace,'display-p3');assert.deepEqual(result.configuration,{colorType:'float16',colorSpace:'display-p3',toneMapping:'standard'});assert(result.maxError<.002,JSON.stringify(result));pixels.push({kind,revision:frame.revision,...result});
}
async function open(){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},input);await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(1);await rendered();}
try{
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'user-data')}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await app.evaluate(({dialog,session})=>{dialog.showMessageBox=async()=>({response:1});session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));});
 await page.evaluate(()=>{window.__p3Frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__p3Frames.push(event.frame);});});
 stage='open';await open();await inspect();pass('normal file opening uses the real managed float P3 canvas; displayed pixels match native P3 plus one transfer encoding');
 stage='edit';const before=await canvas().evaluate(c=>c.toDataURL()),previous=await canvas().getAttribute('data-frame');const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await expect(exposure).toBeInViewport();await exposure.fill('.2');await exposure.press('Tab');await expect(canvas()).not.toHaveAttribute('data-frame',previous);await rendered();await inspect();assert.notEqual(await canvas().evaluate(c=>c.toDataURL()),before);pass('a visible exposure edit changes the actual float P3 presentation');
 stage='detail';await button('1:1').click();await rendered('detail');await inspect('detail');pass('actual 1:1 detail retains the same managed color interpretation');
 stage='preset';await button('适屏').click();await rendered();const edited=await canvas().evaluate(c=>c.toDataURL());await button('预设').click();const preset=page.getByRole('button',{name:'曝光 +0.50 · 内置',exact:true});await expect(preset).toBeInViewport();await preset.hover();await expect(page.getByText('预设预览 · 移开指针恢复，单击应用',{exact:true})).toBeVisible();await expect(canvas()).toHaveAttribute('data-color-space','display-p3');await expect.poll(()=>canvas().evaluate(c=>c.toDataURL())).not.toBe(edited);await page.getByRole('searchbox',{name:'搜索预设',exact:true}).hover();await expect.poll(()=>canvas().evaluate(c=>c.toDataURL())).toBe(edited);pass('preset hover and restoration keep the production P3 monitor path without changing edits');
 stage='comparison';await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('left-right');await expect(canvas()).not.toHaveAttribute('data-before','');await expect(canvas()).toHaveAttribute('data-layout','left-right');await expect(page.getByText('Display P3 · 浮点 SDR',{exact:true})).toBeVisible();await page.getByRole('combobox',{name:'前后对比视图',exact:true}).selectOption('off');await rendered();pass('before/current comparison keeps both panes in the same declared P3 space');
 stage='target-preview';await button('导出').click();await expect(page.getByRole('dialog',{name:'导出设置',exact:true})).toBeVisible();const normal=await proof('srgb','sRGB');await proof('rec2020','Rec. 2020');await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'导出设置',exact:true})).toHaveCount(0);await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.outputProfile==='' ,{},{timeout:120000});assert.equal(await canvas().evaluate(c=>c.toDataURL()),normal);pass('export target selection uses real clipping previews in the P3 monitor path and Escape restores the unproved image');
 stage='capability-failure';await page.evaluate(()=>{window.__p3GetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(name,options){return window.__p3GetContext.call(this,name,options?.colorType==='float16'?{...options,colorType:'unorm8'}:options);};});await button('编辑').click();await exposure.fill('.3');await exposure.press('Tab');await expect(page.getByRole('status').filter({hasText:'受限 sRGB 兼容预览'})).toBeVisible();await expect(button('重试浮点显示')).toBeInViewport();await page.evaluate(()=>{HTMLCanvasElement.prototype.getContext=window.__p3GetContext;});await button('重试浮点显示').click();await rendered();await inspect();pass('unsupported float canvas explicitly falls back to limited sRGB; the visible Retry restores P3 and exact edit parameters');
 stage='persist';await button('编辑').click();await expect(exposure).toHaveValue('0.3');await button('保存').click();await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);const saved=JSON.parse(await readFile(input+'.captraw','utf8'));assert.equal(saved.payload.adjustments.exposure,.3);const savedPixels=await canvas().evaluate(c=>c.toDataURL());await button('关闭当前文件').click();await expect(page.locator('.film-item')).toHaveCount(0);await open();await expect(exposure).toHaveValue('0.3');assert.equal(await canvas().evaluate(c=>c.toDataURL()),savedPixels);assert.deepEqual(await readFile(input),original);pass('native save/reopen restores the same float P3 pixels and leaves the ICC-tagged source untouched');
 assert.deepEqual(errors,[]);passed=true;
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});await writeFile(join(work,'ui.txt'),await page.locator('body').ariaSnapshot()).catch(()=>{});}await writeFile(join(work,'failure.json'),JSON.stringify({error:String(error.stack||error),stage,checks,pixels,errors,consoleErrors,diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
finally{if(passed&&process.env.CAPTRAW_FLOAT_E2E_OUT){const out=resolve(process.env.CAPTRAW_FLOAT_E2E_OUT);await mkdir(out,{recursive:true});await page.screenshot({path:join(out,'workbench.png')});await writeFile(join(out,'report.json'),JSON.stringify({passed,checks,pixels,errors,consoleErrors,packaged:!!process.env.CAPTRAW_APP,backgroundWindow:true,manualVisibleAcceptance:false},null,2));}if(app)await closeElectron(app);console.log(JSON.stringify({passed,stage,checks,pixels,sourceSHA256:hash(original),packaged:!!process.env.CAPTRAW_APP,backgroundWindow:true}));if(passed)await rm(work,{recursive:true,force:true});else console.error('Retained P3 GUI failure:',work);}
