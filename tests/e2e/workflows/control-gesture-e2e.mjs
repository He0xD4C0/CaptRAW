import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const work=mkdtempSync(join(tmpdir(),'captraw-control-gesture-'));
const documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp'))),checks=[],failures=[],errors=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let app,page,core,passed=false,template,fixtureHash;
const button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('spinbutton',{name,exact:true});
async function idle(){
 await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');
 // Drain the actual 90 ms preview debounce, then require its displayed frame.
 await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__controlFrames.filter(f=>f.kind==='fit').at(-1)?.url);
}
async function pixels(){return hash(await page.locator('canvas').evaluate(c=>c.toDataURL()));}
async function latest(){return app.evaluate(()=>globalThis.__controlUpdates.at(-1)?.adjustments);}
async function inspect(label){return {value:await input(label).isVisible()?await input(label).inputValue():null,dirty:await page.locator('.document-title .dirty-dot').count(),undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled(),adjustments:await latest()};}
async function number(label,value){const field=input(label);await field.scrollIntoViewIfNeeded();await expect(field).toBeInViewport();await field.fill(String(value));await field.press('Tab');await idle();await expect(field).toHaveValue(String(value));}
async function maskPanel(){await button('蒙版 M').click();await idle();const overlay=page.getByRole('checkbox',{name:'显示蒙版组覆盖层',exact:true});if(await overlay.isChecked())await overlay.uncheck();await idle();}
async function snapshot(){return {pixels:await pixels(),adjustments:await latest()};}
async function cancelled(label,value,before){
 await idle();const state=await inspect(label);console.log('ESC state',JSON.stringify({label,value:state.value,dirty:state.dirty,undo:state.undo,redo:state.redo,mask:state.adjustments?.masks?.[0]}));
 await expect(input(label)).toBeVisible();await expect(input(label)).toHaveValue(String(value));
 assert.deepEqual(state.adjustments,before.adjustments,'Esc must restore the complete adjustment object, including omitted fields');
 expect(state.dirty).toBe(0);expect(state.undo).toBe(false);expect(state.redo).toBe(true);expect(await pixels()).toBe(before.pixels);
}
async function drag(label,{cancel=false}={}){
 const thumb=page.getByRole('slider',{name:`${label}滑杆`,exact:true});await thumb.scrollIntoViewIfNeeded();await expect(thumb).toBeInViewport();
 const track=thumb.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," slider ")][1]'),box=await track.boundingBox(),start=await thumb.boundingBox();assert(box&&start);
 const y=box.y+box.height/2;await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width*.68,y,{steps:8});await idle();
 if(cancel){await page.keyboard.press('Escape');await idle();await page.mouse.move(box.x+box.width*.83,y,{steps:8});await idle();}
 await page.mouse.up();await idle();
}
async function save(path){
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await button('保存').click();await idle();await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);return documents.read(path);
}
async function launchCase(name,count=1){
 const dir=join(work,name);mkdirSync(dir);const files=[];
 for(let i=0;i<count;i++){
  const file=join(dir,`照片 ${i}.tif`);copyFileSync(join(work,'fixture.tif'),file);files.push(file);
  const adjustments={...structuredClone(template.adjustments),exposure:i*.35};
  writeFileSync(file.replace(/\.tif$/,'.xmp'),await documents.serialize({source:{path:basename(file),size:readFileSync(file).length,sha256:fixtureHash},artProfile:template.artProfile,adjustments}));
 }
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(dir,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__controlFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__controlFrames.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog},paths)=>{
  globalThis.__controlUpdates=[];const update=ipcMain._invokeHandlers.get('image:update');ipcMain.removeHandler('image:update');
  ipcMain.handle('image:update',(...args)=>{globalThis.__controlUpdates.push(structuredClone(args[1]));return update(...args);});
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});
 },files);
 await button('打开').click();await idle();if(count>1){await page.locator('.film-item').filter({hasText:basename(files[0])}).locator('.film-open').click();await idle();await button('选择全部').click();await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(count);}
 return files;
}
async function run(name,test){
 try{await test();assert.deepEqual(errors,[]);checks.push(name);console.log('PASS',name);}
 catch(error){failures.push({name,error:String(error)});console.error('FAIL',name,String(error));if(page)await page.screenshot({path:join(work,name+'-failure.png')}).catch(()=>{});}
 finally{if(page)await page.mouse.up().catch(()=>{});if(app)await closeElectron(app);app=null;page=null;}
}
try{
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',`from PIL import Image
import sys
im=Image.new('RGB',(320,240));im.putdata([(50+x%100,60+y%90,80+(x+y)%80) for y in range(240) for x in range(320)]);im.save(sys.argv[1])`,join(work,'fixture.tif')]);
 fixtureHash=hash(readFileSync(join(work,'fixture.tif')));core=new EngineClient({cache:join(work,'fixture-core'),env:{OMP_NUM_THREADS:'2'}});
 const image=await core.call('open',{path:join(work,'fixture.tif'),sessionId:'control-fixture'});
 const mask={id:'existing-mask',name:'已有蒙版',type:'linear',enabled:true,inverted:false,initialized:true,feather:25,brightness:0,contrast:0,saturation:0,points:[],start:{x:.2,y:.2},end:{x:.8,y:.8}};
 const adjustments={...image.adjustments,exposure:0,masks:[mask]},composed=await core.call('compose',{path:join(work,'fixture.tif'),width:320,height:240,artProfile:image.artProfile,adjustments});
 template={adjustments,artProfile:composed.artProfile};await core.stop();core=null;
 await run('global-number-escape-redo',async()=>{
  const files=await launchCase('global-number-escape-redo');await number('曝光',.5);await button('撤销').click();await idle();const before=await snapshot();
  await input('曝光').fill('1.25');await idle();await input('曝光').press('Escape');await cancelled('曝光',0,before);await button('重做').click();await idle();await expect(input('曝光')).toHaveValue('0.5');
 });
 for(const count of [1,2])await run(`global-slider-escape-held-${count}`,async()=>{
  const files=await launchCase(`global-slider-escape-held-${count}`,count);await number('曝光',.5);await button('撤销').click();await idle();const before=await snapshot();
  await drag('曝光',{cancel:true});await cancelled('曝光',0,before);
  if(count>1){
   await page.locator('.film-item').filter({hasText:basename(files[1])}).locator('.film-open').click();await idle();await expect(input('曝光')).toHaveValue('0.35');await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await expect(button('重做')).toBeEnabled();
   await page.locator('.film-item').filter({hasText:basename(files[0])}).locator('.film-open').click();await idle();await button('选择全部').click();
  }
  await button('重做').click();await idle();await expect(input('曝光')).toHaveValue('0.5');
  if(count>1){await page.locator('.film-item').filter({hasText:basename(files[1])}).locator('.film-open').click();await idle();await expect(input('曝光')).toHaveValue('0.5');}
 });
 await run('local-number-escape-omitted-redo',async()=>{
  const files=await launchCase('local-number-escape-omitted-redo');await maskPanel();await number('局部亮度',.5);await button('撤销').click();await idle();const before=await snapshot();assert(!Object.hasOwn(before.adjustments.masks[0],'tone'));
  const field=input('局部高光');await field.scrollIntoViewIfNeeded();await field.fill('21');await idle();await field.press('Escape');await cancelled('局部高光',0,before);
  const saved=await save(files[0].replace(/\.tif$/,'.xmp'));assert(!Object.hasOwn(saved.adjustments.masks[0],'tone'));await button('重做').click();await idle();await expect(input('局部亮度')).toHaveValue('0.5');
 });
 await run('local-slider-escape-held-redo',async()=>{
  await launchCase('local-slider-escape-held-redo');await maskPanel();await number('局部亮度',.5);await button('撤销').click();await idle();const before=await snapshot();assert(!Object.hasOwn(before.adjustments.masks[0],'details'));
  await drag('局部纹理',{cancel:true});await cancelled('局部纹理',0,before);await button('重做').click();await idle();await expect(input('局部亮度')).toHaveValue('0.5');
 });
 for(const local of [false,true])await run(`${local?'local':'global'}-slider-one-history`,async()=>{
  await launchCase(`${local?'local':'global'}-slider-one-history`);if(local)await maskPanel();const label=local?'局部亮度':'曝光',before=await snapshot();await drag(label);const after=await snapshot(),value=await input(label).inputValue();expect(value).not.toBe('0');
  await button('撤销').click();await idle();await expect(input(label)).toHaveValue('0');expect(await pixels()).toBe(before.pixels);await expect(button('撤销')).toBeDisabled();
  await button('重做').click();await idle();await expect(input(label)).toHaveValue(value);expect(await pixels()).toBe(after.pixels);await expect(button('重做')).toBeDisabled();
 });
 console.log(JSON.stringify({checks,failures,errors}));if(failures.length)writeFileSync(join(work,'failure.json'),JSON.stringify({checks,failures,errors},null,2));assert.equal(failures.length,0,'Control gesture regressions');passed=true;
}finally{if(core)await core.stop();if(app)await closeElectron(app);if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
