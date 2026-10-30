import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {mkdtempSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readDocument} from '../../support/xmp-test.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-crop-ratios-')),source=join(work,'照片 ratio.tif'),sidecar=join(work,'照片 ratio.xmp'),checks=[];
const python=resolve('build/qa-venv/bin/python'),key='captraw.crop-ratios.v1';let app,page,success=false;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const pass=s=>{checks.push(s);console.log('PASS',s);};
const button=name=>page.getByRole('button',{name,exact:true});
const menu=()=>page.getByRole('combobox',{name:'裁切比例',exact:true});
const dialog=()=>page.getByRole('dialog');
async function launch(){app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.evaluate(()=>{window.__ratioFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__ratioFrames.push(e.frame);});});}
async function ready(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});}
async function settle(action){const count=await page.evaluate(()=>window.__ratioFrames.length);await action();await page.waitForFunction(n=>window.__ratioFrames.length>n,count);await ready();}
async function open(){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);await settle(()=>button('打开').click());await button('裁切 C').click();await expect(menu()).toBeInViewport();}
async function save(){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await button('保存').click();await expect.poll(()=>existsSync(sidecar)).toBe(true);await ready();return readDocument(sidecar);}
async function snapshot(){await save();return readFileSync(sidecar,'utf8');}
async function doc(){return (await save()).adjustments;}
async function create(name,width,height,apply=true){await button('自定义比例…').click();await dialog().getByRole('textbox',{name:'比例名称'}).fill(name);await dialog().getByRole('spinbutton',{name:'比例宽'}).fill(String(width));await dialog().getByRole('spinbutton',{name:'比例高'}).fill(String(height));if(apply==='library-only'){await dialog().getByRole('button',{name:'创建并应用'}).click();await expect(dialog()).toHaveCount(0);}else if(apply)await settle(()=>dialog().getByRole('button',{name:'创建并应用'}).click());}
async function frameRatio(expected){await expect.poll(async()=>{const b=await page.getByTestId('crop-frame').boundingBox();return b?Math.abs(b.width-expected*b.height):Infinity;}).toBeLessThan(2);}
async function userOption(name){return menu().locator('option').filter({hasText:name}).getAttribute('value');}
async function checkRatio(display){const a=await doc(),canonical=a.rotation%180?1/display:display;expect(a.cropAspect).toBeCloseTo(canonical,10);expect(a.crop.width*1200/(a.crop.height*800)).toBeCloseTo(canonical,10);await expect(page.getByRole('checkbox',{name:'锁定裁切比例'})).toBeChecked();await frameRatio(display);return a;}
try{
 execFileSync(python,['-c',`import numpy as np,tifffile,sys
y,x=np.mgrid[0:800,0:1200];a=np.stack([10000+x*35,15000+y*42,17000+x*20+y*13],-1).astype(np.uint16)
tifffile.imwrite(sys.argv[1],a,photometric='rgb')`,source]);const original=hash(source);
 await launch();await open();const base=await doc();await expect(button('撤销')).toBeDisabled();
 await create('取消 R 比例',13,9,false);await dialog().getByRole('spinbutton',{name:'比例宽'}).fill('0');await dialog().getByRole('button',{name:'创建并应用'}).click();await expect(dialog().getByRole('alert')).toBeVisible();await expect(button('撤销')).toBeDisabled();await dialog().getByRole('spinbutton',{name:'比例宽'}).fill('-1');await dialog().getByRole('button',{name:'创建并应用'}).click();await expect(dialog()).toBeVisible();await page.keyboard.press('Escape');expect(await doc()).toEqual(base);await expect(button('撤销')).toBeDisabled();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();pass('非法宽高与Esc取消不改文档、历史或比例库');
 await create('展厅',13,9);const custom=await checkRatio(13/9);expect(await menu().inputValue()).toMatch(/^user:/);expect((await snapshot()).includes('展厅')).toBe(false);pass('命名13:9通过原cropAspect/fitCropAspect形成真实裁框，比例库不入XMP');
 await button('管理比例…').click();expect(await dialog().getByRole('button',{name:/删除/}).count()).toBe(1);await dialog().getByRole('button',{name:'重命名 展厅'}).click();await dialog().getByRole('textbox',{name:'比例名称'}).fill('海报');await dialog().getByRole('button',{name:'保存名称'}).click();await dialog().getByRole('button',{name:'完成',exact:true}).click();expect(await doc()).toEqual(custom);await settle(()=>button('撤销').click());expect(await doc()).toEqual(base);await settle(()=>button('重做').click());expect(await doc()).toEqual(custom);expect(await userOption('海报')).toBeTruthy();pass('重命名只改偏好，单步撤销/重做仍只对应裁切');
 await button('管理比例…').click();await dialog().getByRole('button',{name:'重命名 海报'}).click();await dialog().getByRole('textbox',{name:'比例名称'}).fill('1 : 1');await dialog().getByRole('button',{name:'保存名称'}).click();await expect(dialog().getByRole('alert')).toBeVisible();await dialog().getByRole('button',{name:'取消'}).click();await dialog().getByRole('button',{name:'完成',exact:true}).click();expect(await userOption('海报')).toBeTruthy();expect(await doc()).toEqual(custom);pass('内置名称不可覆盖，重命名取消保留原库项和文档');
 await button('管理比例…').click();await dialog().getByRole('button',{name:'删除 海报'}).click();await dialog().getByRole('button',{name:'完成',exact:true}).click();expect(await doc()).toEqual(custom);expect(await menu().inputValue()).toBe('custom');await menu().selectOption('custom');expect(await doc()).toEqual(custom);pass('删除已选库项不改裁切；当前无库比例仍可显示和选择');
 await create('海报13x9',13,9,'library-only');expect(await doc()).toEqual(custom);await create('影院21x9',21,9);await checkRatio(21/9);await settle(async()=>menu().selectOption(await userOption('海报13x9')));
 await settle(()=>button('切换裁切横竖 X').click());await checkRatio(9/13);await settle(()=>page.keyboard.press('r'));await checkRatio(13/9);await settle(()=>page.keyboard.press('x'));await checkRatio(9/13);pass('横竖切换与90度旋转维持实际显示比例和canonical锁定');
 await settle(async()=>menu().selectOption(await userOption('影院21x9')));const cinema=await checkRatio(21/9);await settle(()=>page.getByRole('checkbox',{name:'锁定裁切比例'}).uncheck());expect((await doc()).cropAspect).toBeNull();await settle(()=>page.getByRole('checkbox',{name:'锁定裁切比例'}).check());await checkRatio(21/9);pass('旋转后选择用户比例、解锁及重新锁定保持正确几何');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));for(const name of ['自定义比例…','管理比例…'])await expect(button(name)).toBeInViewport();await expect(menu()).toBeInViewport();await button('管理比例…').click();await expect(dialog()).toBeInViewport();await dialog().getByRole('button',{name:'完成',exact:true}).click();pass('1100x760隐藏窗口控件与管理弹窗均在可见范围');
 await save();await closeElectron(app);app=null;await launch();await open();await checkRatio(21/9);expect(await userOption('海报13x9')).toBeTruthy();expect(await userOption('影院21x9')).toBeTruthy();const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);expect(stored.version).toBe(1);expect(stored.ratios).toHaveLength(2);pass('重启恢复用户比例库与XMP所选比例，二者分别持久化');
 await button('管理比例…').click();for(const name of ['海报13x9','影院21x9'])await dialog().getByRole('button',{name:'删除 '+name}).click();await dialog().getByRole('button',{name:'完成',exact:true}).click();await save();await closeElectron(app);app=null;await launch();await open();await checkRatio(21/9);expect(await menu().inputValue()).toBe('custom');expect(await menu().locator('optgroup').count()).toBe(0);pass('无比例库重开自定义XMP仍显示、锁定并可选择当前比值');
 await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();const output=join(work,'裁切 output.tif');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);await button('导出').click();await page.getByRole('button',{name:/TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:60000});const result=JSON.parse(execFileSync(python,['-c',`import tifffile,json,sys
with tifffile.TiffFile(sys.argv[1]) as f:
 p=f.pages[0];assert p.dtype.name=='uint16' and 34675 in p.tags;h,w=p.shape[:2];assert abs(w/h-21/9)<.01;print(json.dumps(dict(width=w,height=h)))`,output],{encoding:'utf8'}));assert.equal(hash(source),original);pass('旋转后自定义比例TIFF16输出尺寸/ICC正确，原图不变');
 success=true;console.log(JSON.stringify({hidden:true,checks,output:result}));
}catch(error){if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await closeElectron(app);if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
