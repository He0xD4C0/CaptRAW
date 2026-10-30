import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {XMP,CRS,property,text} from '@captraw/desktop-core/documents';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const work=mkdtempSync(join(tmpdir(),'captraw-point-curve-gesture-')),xmp=new XMP(resolve('build/xmp/captraw-xmp'));
const checks=[],failures=[],errors=[],observations=[];let app,page,passed=false;
const channels=[['红','redCurve'],['绿','greenCurve'],['蓝','blueCurve']],fractional=[{x:.125,y:.0625},{x:.375,y:.5625},{x:.875,y:.9375}];
const button=name=>page.getByRole('button',{name,exact:true}),curve=()=>page.getByLabel('多点色调曲线',{exact:true}),output=()=>page.getByRole('spinbutton',{name:'曲线输出',exact:true});
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__pointFrames.filter(f=>f.kind==='fit').at(-1)?.url);}
const latest=()=>app.evaluate(()=>globalThis.__pointUpdates.at(-1)?.adjustments);
async function pixels(){return createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex');}
async function start(name,channel='红',legacy=false,redo=true){
 const dir=join(work,name);mkdirSync(dir);const source=join(dir,'稀疏曲线.png');execFileSync(resolve('build/qa-venv/bin/python'),['-c',"from PIL import Image\nimport sys\nim=Image.new('RGB',(320,240));im.putdata([(50+x%100,60+y%90,80+(x+y)%80) for y in range(240) for x in range(320)]);im.save(sys.argv[1])",source]);
 const values=legacy?fractional:[{x:0,y:0},{x:1,y:1}];const packet=(await xmp.call('write','',[property(CRS,'ToneCurvePV2012',{options:0x600,items:values.map(p=>text(`${p.x*255}, ${p.y*255}`))})])).packet;assert(!/ToneCurvePV2012(?:Red|Green|Blue)/.test(packet));writeFileSync(source.replace('.png','.xmp'),packet);
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(dir,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__pointFrames=[];window.__pointPointerCancel=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__pointFrames.push(e.frame);});window.addEventListener('pointercancel',e=>window.__pointPointerCancel.push({trusted:e.isTrusted,type:e.pointerType}));});
 await app.evaluate(({ipcMain,dialog},path)=>{globalThis.__pointUpdates=[];const update=ipcMain._invokeHandlers.get('image:update');ipcMain.removeHandler('image:update');ipcMain.handle('image:update',(...args)=>{globalThis.__pointUpdates.push(structuredClone(args[1]));return update(...args);});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
 await button('打开').click();await idle();await page.locator('.curve-channel-bar').getByRole('button',{name:channel,exact:true}).click();await idle();
 if(redo){const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await exposure.scrollIntoViewIfNeeded();await exposure.fill('0.5');await exposure.press('Tab');await idle();await button('撤销').click();await idle();await expect(button('重做')).toBeEnabled();}
 return {adjustments:await latest(),pixels:await pixels()};
}
async function restored(before,redo=true){await idle();assert.deepEqual(await latest(),before.adjustments,'Esc restores the complete object including omitted channel fields');expect(await pixels()).toBe(before.pixels);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();if(redo){await expect(button('重做')).toBeEnabled();await button('重做').click();await idle();await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.5');}}
async function location(p){await curve().scrollIntoViewIfNeeded();await expect(curve()).toBeInViewport();const b=await curve().boundingBox();return {x:b.x+Math.max(1,Math.min(b.width-1,p.x*b.width)),y:b.y+Math.max(1,Math.min(b.height-1,(1-p.y)*b.height))};}
async function pointer(from,to,mode='escape'){
 const before=await latest(),a=await location(from),b=await location(to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await idle();assert.notDeepEqual(await latest(),before,'The real drag must change the document before cancellation');
 if(mode==='escape'){await page.keyboard.press('Escape');await idle();const c=await location({x:.63,y:.72});await page.mouse.move(c.x,c.y,{steps:8});await idle();}
 await page.mouse.up();await idle();
}
async function run(name,test){try{await test();assert.deepEqual(errors,[]);checks.push(name);console.log('PASS',name);}catch(error){failures.push({name,error:String(error),updates:app?await app.evaluate(()=>globalThis.__pointUpdates):[]});console.error('FAIL',name,String(error));if(page)await page.screenshot({path:join(work,name+'-failure.png')}).catch(()=>{});}finally{if(page)await page.mouse.up().catch(()=>{});if(app)await closeElectron(app);app=null;page=null;}}
try{
 console.log('Testing main:',createHash('sha256').update(readFileSync('apps/desktop/dist/electron/main.cjs')).digest('hex'));
 await run('sparse-import-shape-observation',async()=>{const before=await start('sparse-import-shape-observation');const shape=Object.fromEntries(channels.map(([,field])=>[field,{present:Object.hasOwn(before.adjustments,field),value:before.adjustments[field]}]));observations.push({sparseXMPHydration:shape});console.log('Sparse XMP hydration:',JSON.stringify(shape));});
 for(const [channel,field] of channels){
  await run(field+'-numeric-escape',async()=>{const before=await start(field+'-numeric-escape',channel);await curve().scrollIntoViewIfNeeded();await curve().focus();await curve().press('+');await expect(output()).toBeEnabled();await output().fill('80');await idle();await output().press('Escape');await restored(before);});
  await run(field+'-add-escape-held',async()=>{const before=await start(field+'-add-escape-held',channel);await pointer({x:.4,y:.6},{x:.5,y:.7});await restored(before);});
  await run(field+'-drag-escape-held',async()=>{const before=await start(field+'-drag-escape-held',channel);await pointer({x:0,y:0},{x:.2,y:.3});await restored(before);});
 }
 await run('trusted-pointercancel-no-late-commit',async()=>{
  const before=await start('trusted-pointercancel-no-late-commit');const a=await location({x:.4,y:.6}),b=await location({x:.5,y:.7}),cdp=await page.context().newCDPSession(page);
  try{await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...a}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,...b}]});await idle();assert.notDeepEqual(await latest(),before.adjustments,'Touch must edit the document before its real pointercancel');await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await idle();assert((await page.evaluate(()=>window.__pointPointerCancel)).some(e=>e.trusted&&e.type==='touch'));await page.mouse.move(b.x+20,b.y+10);await page.mouse.up();await restored(before);}finally{await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});await cdp.detach();}
 });
 await run('fractional-coordinates-focus-and-escape',async()=>{const before=await start('fractional-coordinates-focus-and-escape','RGB',true),p=await location(fractional[1]);await page.mouse.click(p.x,p.y);const input=page.getByRole('spinbutton',{name:'曲线输入',exact:true});await expect(input).toHaveValue('95.625');await expect(output()).toHaveValue('143.4375');await input.focus();await input.press('Tab');await expect(input).toHaveValue('95.625');await output().fill('110');await idle();await output().press('Escape');await expect(output()).toHaveValue('143.4375');await restored(before);});
 await run('fractional-drag-one-history',async()=>{const before=await start('fractional-drag-one-history','RGB',true,false);await pointer(fractional[1],{x:.43,y:.65},'commit');const after=await latest(),afterPixels=await pixels();assert.notDeepEqual(after.curve,before.adjustments.curve);expect(afterPixels).not.toBe(before.pixels);await button('撤销').click();await idle();assert.deepEqual(await latest(),before.adjustments);expect(await pixels()).toBe(before.pixels);await expect(button('撤销')).toBeDisabled();await button('重做').click();await idle();assert.deepEqual(await latest(),after);expect(await pixels()).toBe(afterPixels);await expect(button('重做')).toBeDisabled();});
 console.log(JSON.stringify({checks,failures:failures.map(({name,error})=>({name,error})),observations,errors}));assert.equal(failures.length,0,'Point curve gestures');passed=true;
}finally{if(app)await closeElectron(app);if(passed)rmSync(work,{recursive:true,force:true});else{writeFileSync(join(work,'failure.json'),JSON.stringify({checks,failures,observations,errors},null,2));console.error('Failure retained:',work);}}
