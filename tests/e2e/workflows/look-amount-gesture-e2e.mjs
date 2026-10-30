import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {enhancedFixtures,digest} from '../../support/enhanced-profile-fixtures.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {parseEnhancedProfile} from '@captraw/desktop-core/profiles';
const root=await mkdtemp(join(tmpdir(),'captraw-look-gesture-')),xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp);
const checks=[],failures=[],errors=[],traces={};let app,page,core,fixtures,template,passed=false;
const only=process.env.CAPTRAW_LOOK_GESTURE_CASE;
const button=name=>page.getByRole('button',{name,exact:true});
const slider=()=>page.getByRole('slider',{name:/^Look 强度(?:滑杆)?$/});
const number=()=>page.getByRole('spinbutton',{name:'Look 强度',exact:true});
const amount=()=>slider().evaluate(el=>Number(el.getAttribute('aria-valuenow')??el.value));
const pixels=async()=>digest(await page.locator('canvas').evaluate(c=>c.toDataURL()));
async function idle(){
 await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__lookFrames.filter(f=>f.kind==='fit').at(-1)?.url);
}
async function launch(name,count){
 const directory=join(root,name);await mkdir(directory);const paths=[];
 for(let i=0;i<count;i++){
  const path=join(directory,`照片 ${i}.png`);await copyFile(fixtures.png,path);paths.push(path);const bytes=await readFile(path);
  const adjustments={...structuredClone(template.adjustments),colorProfile:{...structuredClone(template.adjustments.colorProfile),look:{...structuredClone(template.adjustments.colorProfile.look),amount:i?.5:1}}};
  await writeFile(path.replace(/\.png$/,'.xmp'),await documents.serialize({source:{path:basename(path),size:bytes.length,sha256:digest(bytes)},artProfile:template.artProfile,adjustments}));
 }
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(directory,'userdata'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__lookFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__lookFrames.push(e.frame);});});
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});dialog.showMessageBox=async()=>({response:1});},paths);
 await button('打开').click();await idle();await photo(paths[0]).click();await idle();if(count>1){await button('选择全部').click();await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(count);}
 await expect(slider()).toBeVisible();assert.equal(await amount(),100);await expect(button('撤销')).toBeDisabled();return paths;
}
const photo=path=>page.locator('.film-item').filter({hasText:basename(path)}).locator('.film-open');
async function otherAmount(paths,expected){if(paths.length<2)return;await photo(paths[1]).click();await idle();assert.equal(await amount(),expected);}
async function rangeGeometry(){
 await slider().scrollIntoViewIfNeeded();await expect(slider()).toBeInViewport();
 const thumb=await slider().boundingBox(),radix=await slider().evaluate(el=>el.tagName!=='INPUT');
 const track=radix?slider().locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," slider ")][1]'):slider();
 const box=await track.boundingBox();assert(box&&thumb);return {box,x:radix?thumb.x+thumb.width/2:box.x+box.width*(await amount()/200),y:thumb.y+thumb.height/2};
}
async function drag(name,cancel){
 const {box,x,y}=await rangeGeometry(),trace=[];await page.mouse.move(x,y);await page.mouse.down();
 for(const ratio of [.56,.62,.68,.74]){
  await page.mouse.move(box.x+box.width*ratio,y,{steps:3});
  trace.push({ratio,value:await amount(),inert:await page.locator('.workbench').getAttribute('inert'),disabled:await slider().isDisabled()});
  await page.waitForTimeout(90);
 }
 if(cancel){await page.keyboard.press('Escape');await idle();for(const ratio of [.8,.87]){await page.mouse.move(box.x+box.width*ratio,y,{steps:4});await page.waitForTimeout(120);} }
 await page.mouse.up();await idle();traces[name]=trace;return trace;
}
async function run(name,fn){
 if(only&&only!==name)return;
 try{await fn();checks.push(name);console.log('PASS',name);}
 catch(error){failures.push({name,error:String(error)});console.error('FAIL',name,String(error));if(page)await page.screenshot({path:join(root,name+'.png')}).catch(()=>{});if(app)await writeFile(join(root,name+'-diagnostics.json'),JSON.stringify(electronDiagnostics(app),null,2));}
 finally{if(page)await page.mouse.up().catch(()=>{});if(app)await closeElectron(app);app=undefined;page=undefined;}
}
try{
 fixtures=await enhancedFixtures(root,xmp);const packet=await xmp.read(fixtures.files.rgb),profile=parseEnhancedProfile(packet.properties,packet.packet).profile;
 core=new EngineClient({cache:join(root,'fixture-core')});const image=await core.call('open',{path:fixtures.png,sessionId:'look-fixture'});
 const adjustments={...image.adjustments,colorProfile:{...image.adjustments.colorProfile,look:{profile,amount:1}}};template={adjustments,...await core.call('compose',{path:fixtures.png,width:image.width,height:image.height,artProfile:image.artProfile,adjustments})};await core.stop();core=undefined;
 for(const count of [1,2]){
  await run(`drag-one-history-${count}`,async()=>{
   const paths=await launch(`drag-one-history-${count}`,count),before=await pixels(),trace=await drag(`drag-one-history-${count}`,false),final=await amount(),after=await pixels();
   console.log('DRAG',count,JSON.stringify(trace),'final',final);
   await button('撤销').click();await idle();console.log('ONE UNDO',count,await amount());assert.equal(await amount(),100,'one undo restores the entire drag');assert.equal(await pixels(),before);await expect(button('撤销')).toBeDisabled();
   await button('重做').click();await idle();assert.equal(await amount(),final);assert.equal(await pixels(),after);await expect(button('重做')).toBeDisabled();await otherAmount(paths,final);
   assert(final>135,'drag must reach the final pointer position');assert(trace.every(t=>t.inert===null&&!t.disabled),'pointer ticks must remain editable until release');
  });
  await run(`drag-escape-held-${count}`,async()=>{
   const paths=await launch(`drag-escape-held-${count}`,count);await slider().press('End');await idle();await button('撤销').click();await idle();const before=await pixels();await expect(button('重做')).toBeEnabled();
   await drag(`drag-escape-held-${count}`,true);assert.equal(await amount(),100,'Esc remains cancelled through later pointermove/up');assert.equal(await pixels(),before);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();await expect(button('重做')).toBeEnabled();
   await otherAmount(paths,50);if(count>1){await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await photo(paths[0]).click();await idle();await button('选择全部').click();}
   await button('重做').click();await idle();assert.equal(await amount(),200);await otherAmount(paths,200);
  });
  if(!process.env.CAPTRAW_LOOK_GESTURE_BASELINE)for(const cancel of [false,true])await run(`number-${cancel?'escape':'one-history'}-${count}`,async()=>{
   const paths=await launch(`number-${cancel?'escape':'one-history'}-${count}`,count);await expect(number()).toBeVisible();const before=await pixels();
   if(cancel){await slider().press('End');await idle();await button('撤销').click();await idle();}
   await number().fill('135');await page.waitForTimeout(120);await number().fill('165');await idle();await number().press(cancel?'Escape':'Enter');await idle();
   if(cancel){assert.equal(await amount(),100);assert.equal(await pixels(),before);await expect(button('撤销')).toBeDisabled();await expect(button('重做')).toBeEnabled();await otherAmount(paths,50);}
   else{assert.equal(await amount(),165);await button('撤销').click();await idle();assert.equal(await amount(),100);await expect(button('撤销')).toBeDisabled();await button('重做').click();await idle();assert.equal(await amount(),165);await otherAmount(paths,165);}
  });
 }
 await run('profile-selection-one-history',async()=>{
  await launch('profile-selection-one-history',1);const before=await pixels();
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},fixtures.files.curveOnly);
  await button('导入 DCP / ICC / Look…').click();await idle();const select=page.getByRole('combobox',{name:'输入配置文件',exact:true});await expect(select.locator('option:checked')).toContainText('仅曲线 无表 Look');const after=await pixels();assert.notEqual(after,before);
  await button('撤销').click();await idle();await expect(select.locator('option:checked')).toContainText('彩色 Look 中文');assert.equal(await pixels(),before);await expect(button('撤销')).toBeDisabled();
  await button('重做').click();await idle();await expect(select.locator('option:checked')).toContainText('仅曲线 无表 Look');assert.equal(await pixels(),after);await expect(button('重做')).toBeDisabled();
 });
 if(!process.env.CAPTRAW_LOOK_GESTURE_BASELINE)await run('raw-dcp-illuminant-discrete-wb-recompute',async()=>{
  const directory=join(root,'raw-dcp-illuminant-discrete-wb-recompute');await mkdir(directory);const path=join(directory,'原片.dng'),dcp=join(directory,'双光源.dcp');await copyFile(fixtures.raw,path);
  execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import sys,numpy as np,tifffile
from pathlib import Path
m1=[1,1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1,1];m2=[9,10,1,10,0,1,1,10,9,10,0,1,0,1,0,1,1,1]
tags=[(50721,'2i',9,m1,False),(50722,'2i',9,m2,False),(50778,'H',1,21,False),(50779,'H',1,17,False),(50936,'s',0,'Look Gesture Dual',False),(50941,'I',1,0,False),(50708,'s',0,'CaptRAW Synthetic Bayer',False)]
tifffile.imwrite(sys.argv[1],np.zeros((1,1),np.uint8),metadata=None,extratags=tags);b=bytearray(Path(sys.argv[1]).read_bytes());b[2:4]=b'RC';Path(sys.argv[1]).write_bytes(b)
`,dcp]);
  core=new EngineClient({cache:join(directory,'fixture-core')});const raw=await core.call('open',{path,sessionId:'raw-look-gesture'}),coefficients=[2,1,1.5],adjustments={...raw.adjustments,wbMultipliers:coefficients,wbMode:'camera'};
  const composed=await core.call('compose',{path,width:raw.width,height:raw.height,artProfile:raw.artProfile,adjustments}),bytes=await readFile(path);
  await writeFile(path.replace(/\.dng$/,'.xmp'),await documents.serialize({source:{path:basename(path),size:bytes.length,sha256:digest(bytes)},artProfile:composed.artProfile,adjustments}));await core.stop();core=undefined;
  app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(directory,'userdata'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
  await page.evaluate(()=>{window.__lookFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__lookFrames.push(e.frame);});});
  await app.evaluate(({ipcMain,dialog},path)=>{
   globalThis.__lookWB=[];globalThis.__lookUpdates=[];
   for(const [channel,key] of [['images:synchronize','__lookWB'],['image:update','__lookUpdates']]){const original=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{const result=await original(...args);globalThis[key].push({args:structuredClone(args[1]),result});return result;});}
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});dialog.showMessageBox=async()=>({response:1});
  },path);
  await button('打开').click();await idle();const selection=page.getByRole('combobox',{name:'输入配置文件',exact:true}),baseline=await selection.inputValue();
  assert.deepEqual(await app.evaluate(()=>globalThis.__lookUpdates.at(-1).args.adjustments.wbMultipliers),coefficients);
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},dcp);await button('导入 DCP / ICC / Look…').click();await idle();
  const light=page.getByRole('combobox',{name:'DCP 光源',exact:true});await expect(light).toBeVisible();assert.equal(await app.evaluate(()=>globalThis.__lookWB.length),1);
  await button('撤销').click();await idle();await expect(selection).toHaveValue(baseline);await expect(button('撤销')).toBeDisabled();assert.deepEqual(await app.evaluate(()=>globalThis.__lookUpdates.at(-1).args.adjustments.wbMultipliers),coefficients);
  await button('重做').click();await idle();await expect(light).toHaveValue('0');await expect(button('重做')).toBeDisabled();
  await light.selectOption('2');await idle();await expect(light).toHaveValue('2');
  const actual=await app.evaluate(()=>({calls:globalThis.__lookWB,adjustments:globalThis.__lookUpdates.at(-1).args.adjustments}));assert.equal(actual.calls.length,2);
  for(const call of actual.calls){assert.equal(call.args.recompute.type,'whiteBalance');assert.equal(call.args.recompute.request.mode,'profile');assert.equal(call.result.length,1);assert(Array.isArray(call.result[0].adjustments.wbMultipliers));}
  assert.equal(actual.calls[0].args.recompute.request.colorProfile.illuminant,0);assert.equal(actual.calls.at(-1).args.recompute.request.colorProfile.illuminant,2);assert.equal(actual.calls.at(-1).result[0].adjustments.colorProfile.illuminant,2);assert(Array.isArray(actual.adjustments.wbMultipliers));
  await button('撤销').click();await idle();await expect(light).toHaveValue('0');await button('撤销').click();await idle();await expect(selection).toHaveValue(baseline);await expect(button('撤销')).toBeDisabled();assert.equal(digest(await readFile(path)),digest(bytes));
 });
 for(const [path,hash] of fixtures.before)assert.equal(digest(await readFile(path)),hash);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({checks,failures,errors,traces}));await writeFile(join(root,'result.json'),JSON.stringify({checks,failures,errors,traces},null,2));assert(checks.length+failures.length>0,'No matching Look gesture case');assert.equal(failures.length,0,'Look amount gesture regressions');passed=true;
}finally{if(core)await core.stop();if(app)await closeElectron(app);if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained Look gesture failure:',root);}
