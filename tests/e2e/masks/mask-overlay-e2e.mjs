import {expect} from '@playwright/test';
import {electron} from '../../support/electron-background.mjs';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=resolve(process.env.CAPTRAW_MASK_OVERLAY_OUT||'artifacts/mask-overlay-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});}
async function checkImage(locator){await expect(locator).toBeVisible();const url=await locator.getAttribute('href');expect(await page.evaluate(url=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0);image.onerror=()=>resolve(false);image.src=url;}),url)).toBe(true);}
try{
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve('build/samples/nikon-d850.NEF'));
 await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await settle(()=>page.getByRole('button',{name:'径向',exact:true}).click());
 const viewport=page.getByTestId('viewport'),b=await viewport.boundingBox();
 await settle(async()=>{await page.mouse.move(b.x+b.width*.25,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.55,b.y+b.height*.65,{steps:8});await page.mouse.up();});
 await settle(async()=>{const input=page.getByRole('spinbutton',{name:'羽化',exact:true});await input.fill('15');await input.press('Tab');});
 await checkImage(page.getByTestId('mask-coverage'));await viewport.screenshot({path:resolve(out,'overlay-on.png')});
 await settle(()=>page.keyboard.press('y'));await expect(page.getByTestId('mask-coverage')).toHaveCount(0);await viewport.screenshot({path:resolve(out,'overlay-off.png')});
 await settle(()=>page.keyboard.press('y'));await checkImage(page.getByTestId('mask-coverage'));
 await page.getByRole('button',{name:'1:1',exact:true}).click();await checkImage(page.getByTestId('mask-detail-coverage'));
 const before=await page.getByTestId('mask-detail-coverage').getAttribute('href');
 await page.keyboard.down('Space');await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.5+80,b.y+b.height*.5+50,{steps:6});await page.mouse.up();await page.keyboard.up('Space');
 await expect.poll(()=>page.getByTestId('mask-detail-coverage').getAttribute('href')).not.toBe(before);await checkImage(page.getByTestId('mask-detail-coverage'));
 const frame=await page.evaluate(()=>window.__frames.filter(f=>f.kind==='detail').at(-1));expect(frame.mask.x).toBe(frame.x);expect(frame.mask.y).toBe(frame.y);expect(frame.mask.width).toBe(frame.width);expect(frame.mask.height).toBe(frame.height);
 await page.screenshot({path:resolve(out,'detail.png')});
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByTestId('mask-coverage')).toHaveCount(0);await expect(page.getByTestId('mask-detail-coverage')).toHaveCount(0);
 expect(errors).toEqual([]);writeFileSync(resolve(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,nativeOverlayLoaded:true,YTogglesOverlay:true,detailTracksViewport:true,editModeHidesOverlay:true,detailFrame:frame,errors},null,2)+'\n');console.log('Native coverage overlay, visibility, 1:1 and pan verified in actual GUI');
}catch(e){await page.screenshot({path:resolve(out,'failure.png')});throw e;}
finally{await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await app.close();}
