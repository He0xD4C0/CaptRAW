import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {XMP,CRS,property,text,encodeAdjustments,lookup} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {POINT_CURVE_PRESETS} from '@captraw/contracts';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const work=mkdtempSync(join(tmpdir(),'captraw-point-curve-presets-gui-')),files=['来源','目标','未选'].map(n=>join(work,n+'.png')),checks=[],errors=[];
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),initial=[],hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let app,page,passed=false;
const side=i=>files[i].replace('.png','.xmp'),button=name=>page.getByRole('button',{name,exact:true}),photo=i=>page.locator('.film-item').filter({hasText:basename(files[i])});
async function idle(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.waitForTimeout(180);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__curvePresetFrames.filter(f=>f.kind==='fit').at(-1)?.url);await expect(page.getByRole('alert')).toHaveCount(0);}
async function select(i){await photo(i).locator('.film-open').click();await idle();}
async function selected(){await select(0);await photo(1).locator('.film-open').click({modifiers:['Meta']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);}
async function preset(name){const field=page.getByRole('combobox',{name:'点曲线预设',exact:true});await field.scrollIntoViewIfNeeded();await expect(field).toBeInViewport();await field.selectOption(name);await idle();}
async function save(){await button('保存所选…').click();const d=page.getByRole('dialog',{name:'保存照片编辑',exact:true});await expect(d.getByRole('button',{name:'返回编辑',exact:true})).toBeEnabled();await d.getByRole('button',{name:'返回编辑',exact:true}).click();await idle();}
async function read(i){const properties=(await xmp.read(side(i))).properties;return {doc:await documents.read(side(i)),name:lookup(properties,CRS,'ToneCurveName2012')?.value,refine:lookup(properties,CRS,'CurveRefineSaturation')?.value};}
async function preserved(i){const v=await read(i);for(const key of ['redCurve','greenCurve','blueCurve','exposure'])assert.deepEqual(v.doc.adjustments[key],initial[i].adjustments[key]);assert.equal(v.refine,String([50,0,100][i]));return v;}
async function pixels(){return page.locator('canvas').evaluate(c=>c.toDataURL());}
function pass(message){checks.push(message);console.log('PASS',message);}
try{
 for(let i=0;i<3;i++){
  execFileSync(resolve('build/qa-venv/bin/python'),['-c',"from PIL import Image\nimport sys\nim=Image.new('RGB',(320,240));im.putdata([(50+x%100,60+y%90,80+(x+y)%80) for y in range(240) for x in range(320)]);im.save(sys.argv[1])",files[i]]);
  const state={incrementalTemperature:0,incrementalTint:0,relativeWBModel:'art-ctl-v1',exposure:i*.1,curve:i===0?POINT_CURVE_PRESETS['Medium Contrast']:i===2?POINT_CURVE_PRESETS['Strong Contrast']:[{x:0,y:0},{x:.5,y:.6},{x:1,y:1}],redCurve:[{x:0,y:0},{x:.375,y:i===0?.5625:.4375},{x:1,y:1}],greenCurve:POINT_CURVE_PRESETS.Linear,blueCurve:POINT_CURVE_PRESETS.Linear,...(i===0?{curveName:'Medium Contrast'}:i===2?{curveName:'Strong Contrast'}:{})};
  writeFileSync(side(i),(await xmp.call('write','',[...encodeAdjustments(state),property(CRS,'CurveRefineSaturation',text([50,0,100][i]))])).packet);initial.push(await documents.read(side(i)));
 }
 const originals=files.map(hash),unselected=hash(side(2));app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__curvePresetFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__curvePresetFrames.push(e.frame);});});
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});dialog.showMessageBox=async()=>({response:1});},files);await button('打开').click();await idle();
 await selected();await preset('Medium Contrast');await save();for(const i of [0,1]){const v=await preserved(i);assert.deepEqual(v.doc.adjustments.curve,POINT_CURVE_PRESETS['Medium Contrast']);assert.equal(v.name,'Medium Contrast');}assert.equal(hash(side(2)),unselected);
 pass('Medium updates a different selected target even when the active source is already Medium, preserving channels/refine/unselected photo');
 await button('撤销').click();await idle();await save();assert.deepEqual((await read(1)).doc.adjustments.curve,initial[1].adjustments.curve);await expect(button('撤销')).toBeDisabled();await button('重做').click();await idle();await save();assert.equal((await read(1)).name,'Medium Contrast');
 pass('one selected-target transaction supports one-step Undo/Redo with an unchanged active source');
 await preset('Strong Contrast');await save();for(const i of [0,1]){const v=await preserved(i);assert.equal(v.name,'Strong Contrast');assert.deepEqual(v.doc.adjustments.curve,POINT_CURVE_PRESETS['Strong Contrast']);}
 pass('Strong persists the sealed ACR points and name per photo without changing other channels or existing refine');
 const curve=page.getByLabel('多点色调曲线',{exact:true}),out=page.getByRole('spinbutton',{name:'曲线输出',exact:true});await curve.scrollIntoViewIfNeeded();await curve.focus();await curve.press('+');await out.fill('12');await out.press('Tab');await idle();await save();assert.equal((await read(0)).name,'Custom');
 await button('撤销').click();await idle();const before=await pixels();await save();assert.equal((await read(0)).name,'Strong Contrast');await expect(button('重做')).toBeEnabled();await out.fill('20');await idle();await out.press('Escape');await idle();assert.equal(await pixels(),before);await expect(button('重做')).toBeEnabled();await save();assert.equal((await read(0)).name,'Strong Contrast');await button('重做').click();await idle();await save();assert.equal((await read(0)).name,'Custom');
 pass('point edits become Custom; numeric Esc restores named-preset metadata, exact pixels and existing redo');
 await select(0);await preset('Medium Contrast');await button('复制设置…').click();const copy=page.getByRole('dialog',{name:'复制编辑设置',exact:true});await copy.getByRole('button',{name:'全不选',exact:true}).click();await copy.getByRole('checkbox',{name:'点曲线与参数曲线',exact:true}).check();await copy.getByRole('button',{name:'复制所选设置',exact:true}).click();await expect(copy).toHaveCount(0);await select(1);await button('粘贴设置').click();await idle();await button('保存').click();await idle();const synced=await read(1);assert.equal(synced.name,'Medium Contrast');assert.equal(synced.refine,'0');assert.deepEqual(synced.doc.adjustments.curve,POINT_CURVE_PRESETS['Medium Contrast']);
 pass('real curves-only copy/paste synchronization carries points and known name while retaining target refine');
 await closeElectron(app);app=null;app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'restart-userdata')}});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.evaluate(()=>{window.__curvePresetFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__curvePresetFrames.push(e.frame);});});await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},files[1]);await button('打开').click();await idle();await expect(page.getByRole('combobox',{name:'点曲线预设',exact:true})).toContainText('中对比度');for(let i=0;i<3;i++)assert.equal(hash(files[i]),originals[i]);assert.equal(hash(side(2)),unselected);assert.deepEqual(errors,[]);
 pass('a fresh App restores the known curve name; original images and the unselected sidecar remain unchanged');passed=true;console.log(JSON.stringify({checks,errors}));
}catch(error){if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});writeFileSync(join(work,'failure.json'),JSON.stringify({error:String(error),checks,errors},null,2));throw error;}finally{if(app)await closeElectron(app);if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
