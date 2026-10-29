import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const work=mkdtempSync(join(tmpdir(),'captraw-parametric-gesture-')),checks=[],failures=[],errors=[];
const labels=['阴影分界','中间调分界','高光分界'],defaults=[25,50,75];
let app,page,passed=false;
const button=name=>page.getByRole('button',{name,exact:true}),input=i=>page.getByRole('spinbutton',{name:labels[i]+'百分比',exact:true});
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__parametricFrames.filter(f=>f.kind==='fit').at(-1)?.url);await expect(page.getByRole('img',{name:'参数曲线映射',exact:true})).toHaveAttribute('data-ready','true');}
const latest=()=>app.evaluate(()=>globalThis.__parametricUpdates.at(-1)?.adjustments);
async function pixels(){return createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex');}
async function launch(name,redo=false){
 const dir=join(work,name);mkdirSync(dir);const source=join(dir,'曲线原片.png');
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',"from PIL import Image\nimport sys\nim=Image.new('RGB',(320,240));im.putdata([(50+x%100,60+y%90,80+(x+y)%80) for y in range(240) for x in range(320)]);im.save(sys.argv[1])",source]);
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(dir,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(String(error)));
 await page.evaluate(()=>{window.__parametricFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__parametricFrames.push(e.frame);});});
 await app.evaluate(({ipcMain,dialog},path)=>{const update=ipcMain._invokeHandlers.get('image:update');globalThis.__parametricUpdates=[];ipcMain.removeHandler('image:update');ipcMain.handle('image:update',(...args)=>{globalThis.__parametricUpdates.push(structuredClone(args[1]));return update(...args);});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
 await button('打开').click();await expect(button('打开')).toBeEnabled();await button('参数').scrollIntoViewIfNeeded();await button('参数').click();await idle();
 if(redo){const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await exposure.scrollIntoViewIfNeeded();await exposure.fill('0.5');await exposure.press('Tab');await idle();await button('撤销').click();await idle();await expect(button('重做')).toBeEnabled();}
 assert(!Object.hasOwn(await latest(),'parametricCurve'));return {adjustments:await latest(),pixels:await pixels()};
}
async function verifyCancel(before){
 await idle();const state={adjustments:await latest(),dirty:await page.locator('.document-title .dirty-dot').count(),undo:await button('撤销').isEnabled(),redo:await button('重做').isEnabled()};console.log('Cancelled parametric state:',JSON.stringify({parametricCurve:state.adjustments.parametricCurve,dirty:state.dirty,undo:state.undo,redo:state.redo}));
 assert.deepEqual(state.adjustments,before.adjustments,'Esc restores omitted parametricCurve and the complete adjustment state');expect(state.dirty).toBe(0);expect(state.undo).toBe(false);expect(state.redo).toBe(true);expect(await pixels()).toBe(before.pixels);
 for(let i=0;i<3;i++)await expect(input(i)).toHaveValue(String(defaults[i]));
 await button('重做').click();await idle();await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.5');
}
async function drag(i,cancel=false){
 const thumb=page.getByRole('slider',{name:labels[i],exact:true});await thumb.scrollIntoViewIfNeeded();await expect(thumb).toBeInViewport();const root=page.locator('.curve-splits'),box=await root.boundingBox(),start=await thumb.boundingBox();assert(box&&start);
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*[.35,.6,.86][i],box.y+box.height/2,{steps:8});await idle();
 if(cancel){await page.keyboard.press('Escape');await idle();await page.mouse.move(box.x+box.width*[.42,.65,.94][i],box.y+box.height/2,{steps:8});await idle();}
 await page.mouse.up();await idle();
}
async function run(name,test){try{await test();assert.deepEqual(errors,[]);checks.push(name);console.log('PASS',name);}catch(error){failures.push({name,error:String(error),updates:app?await app.evaluate(()=>globalThis.__parametricUpdates):[]});console.error('FAIL',name,String(error));if(page)await page.screenshot({path:join(work,name+'-failure.png')}).catch(()=>{});}finally{if(page)await page.mouse.up().catch(()=>{});if(app)await closeElectron(app);app=null;page=null;}}
try{
 console.log('Testing existing main:',createHash('sha256').update(readFileSync('apps/desktop/dist/electron/main.cjs')).digest('hex'));
 for(let i=0;i<3;i++)await run(`numeric-escape-${i}`,async()=>{const before=await launch(`numeric-escape-${i}`,true);await input(i).scrollIntoViewIfNeeded();await expect(input(i)).toBeInViewport();await input(i).fill(String([34,61,86][i]));await idle();await input(i).press('Escape');await verifyCancel(before);});
 for(let i=0;i<3;i++)await run(`slider-held-escape-${i}`,async()=>{const before=await launch(`slider-held-escape-${i}`,true);await drag(i,true);await verifyCancel(before);});
 await run('slider-one-history',async()=>{const before=await launch('slider-one-history');await drag(0);const after=await latest();assert(Object.hasOwn(after,'parametricCurve'));assert.notEqual(after.parametricCurve.splits[0],25);await button('撤销').click();await idle();assert.deepEqual(await latest(),before.adjustments);await expect(button('撤销')).toBeDisabled();await button('重做').click();await idle();assert.deepEqual(await latest(),after);await expect(button('重做')).toBeDisabled();});
 await run('numeric-one-history',async()=>{const before=await launch('numeric-one-history');await input(1).scrollIntoViewIfNeeded();await input(1).fill('61');await input(1).press('Enter');await idle();await expect(input(1)).toHaveValue('61');const after=await latest();assert.equal(after.parametricCurve.splits[1],61);await button('撤销').click();await idle();assert.deepEqual(await latest(),before.adjustments);await expect(button('撤销')).toBeDisabled();await button('重做').click();await idle();assert.deepEqual(await latest(),after);await expect(button('重做')).toBeDisabled();});
 console.log(JSON.stringify({checks,failures:failures.map(({name,error})=>({name,error})),errors}));assert.equal(failures.length,0,'Parametric gesture regressions');passed=true;
}finally{if(app)await closeElectron(app);if(passed)rmSync(work,{recursive:true,force:true});else{writeFileSync(join(work,'failure.json'),JSON.stringify({checks,failures,errors},null,2));console.error('Failure retained:',work);}}
