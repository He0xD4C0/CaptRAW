import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {mkdtempSync,writeFileSync,existsSync,rmSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CT,encode,property} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
const work=mkdtempSync(join(tmpdir(),'captraw-effects-gui-')),python=resolve('build/qa-venv/bin/python'),fresh=join(work,'新照片 fresh.tif'),legacy=join(work,'旧照片 legacy.tif');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),checks=[];let app,page,success=false;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function launch(){app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(30000);await page.evaluate(()=>{window.__effectsFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__effectsFrames.push(e.frame);});});}
async function ready(){await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});}
async function settle(action){const n=await page.evaluate(()=>window.__effectsFrames.length);await action();await page.waitForFunction(n=>window.__effectsFrames.length>n,n);await ready();await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__effectsFrames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').first().evaluate(c=>c.toDataURL())).digest('hex');
async function number(name,value){console.log('EDIT',name,value);const before=await pixels();const input=page.getByRole('spinbutton',{name,exact:true});await input.scrollIntoViewIfNeeded();await expect(input).toBeVisible();await expect(input).toBeEnabled();await settle(async()=>{await input.fill(String(value));await input.press('Tab');});await expect.poll(pixels).not.toBe(before);}
async function save(path){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();return documents.read(path);}
const pass=s=>{checks.push(s);console.log('PASS',s);};
try{
 execFileSync(python,['-c',`import numpy as np,tifffile,sys
y,x=np.mgrid[0:384,0:512];a=np.stack([12000+x*70+3000*np.sin(y/8),14000+x*65+y*10,17000+x*60+y*8],axis=-1)
tifffile.imwrite(sys.argv[1],np.clip(a,0,65535).astype(np.uint16),photometric='rgb')`,fresh]);copyFileSync(fresh,legacy);
 const core=new EngineClient({cache:join(work,'fixture-cache')});try{
  const image=await core.call('open',{path:legacy,sessionId:'legacy',effectsDefaults:'legacy'}),a={...image.adjustments,grain:25,vignette:-25};
  const composed=await core.call('compose',{path:legacy,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:a});
  const packet=await documents.serialize({engineVersion:'CaptRAW-27_ART-1.26.10_LibRaw-3b20539',source:{path:legacy,size:readFileSync(legacy).length,sha256:hash(legacy)},artProfile:composed.artProfile,adjustments:a});
  writeFileSync(join(work,'旧照片 legacy.xmp'),(await xmp.call('write',packet,[property(CT,'EngineVersion',encode('CaptRAW-27_ART-1.26.10_LibRaw-3b20539'))])).packet);
 }finally{await core.stop();}
 await launch();await open(fresh);
 await expect(page.getByRole('button',{name:'更新颗粒处理',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'更新晕影处理',exact:true})).toHaveCount(0);
 await expect(page.getByRole('spinbutton',{name:'颗粒大小',exact:true})).toBeDisabled();pass('新照片完整模型默认可用，无需启用步骤');
 await number('颗粒',35);const grain=await pixels();await number('颗粒大小',80);expect(await pixels()).not.toBe(grain);const large=await pixels();await number('颗粒粗糙度',85);expect(await pixels()).not.toBe(large);pass('大小和粗糙度通过可见控件改变真实画布');
 await number('晕影',-50);await number('晕影中点',25);await number('晕影圆度',30);await number('晕影羽化',70);await number('晕影高光',60);
 await settle(()=>page.getByRole('combobox',{name:'晕影样式',exact:true}).selectOption('paint-overlay'));await expect(page.getByRole('spinbutton',{name:'晕影高光',exact:true})).toBeDisabled();pass('全部晕影子项可操作，绘画叠加正确禁用高光');
 const edited=await pixels(),saved=await save(join(work,'新照片 fresh.xmp'));assert.equal(saved.adjustments.grainSize,80);assert.equal(saved.adjustments.grainRoughness,85);assert.equal(saved.adjustments.postCropVignetteStyle,'paint-overlay');
 await closeElectron(app);app=null;await launch();await open(fresh);await expect.poll(pixels).toBe(edited);pass('完整模型旁车保存后重启，参数与画布恢复');
 const output=join(work,'gui-output.tif');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
 await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:/TIFF · 16 位/}).click();await expect.poll(()=>existsSync(output),{timeout:60000}).toBe(true);await expect(page.locator('.job-toast')).toHaveClass(/completed|success|done/, {timeout:60000});
 const reference=join(work,'reference.tif'),referenceCore=new EngineClient({cache:join(work,'reference-cache')});try{await referenceCore.call('export',{path:fresh,artProfile:saved.artProfile,output:reference,format:'tiff',colorSpace:'srgb'});}finally{await referenceCore.stop();}
 execFileSync(python,['-c',`import tifffile,numpy as np,sys
with tifffile.TiffFile(sys.argv[1]) as f:assert f.pages[0].dtype.name=='uint16' and 34675 in f.pages[0].tags
assert np.array_equal(tifffile.imread(sys.argv[1]),tifffile.imread(sys.argv[2]))`,output,reference]);pass('实际菜单导出TIFF16/ICC，像素与保存配方的独立核心输出一致');
 await open(legacy);const old=await pixels();await expect(page.getByRole('button',{name:'更新颗粒处理',exact:true})).toBeVisible();await expect(page.getByRole('spinbutton',{name:'颗粒大小',exact:true})).toBeDisabled();
 await page.getByRole('spinbutton',{name:'晕影中点',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('spinbutton',{name:'晕影中点',exact:true})).toBeVisible();await expect(page.getByRole('spinbutton',{name:'晕影中点',exact:true})).toBeDisabled();pass('27版非零旧XMP保留旧模型，完整子控件可找到');
 await settle(()=>page.getByRole('button',{name:'更新颗粒处理',exact:true}).click());await expect.poll(pixels).not.toBe(old);await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect.poll(pixels).toBe(old);
 await settle(()=>page.getByRole('button',{name:'更新晕影处理',exact:true}).click());await expect.poll(pixels).not.toBe(old);await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect.poll(pixels).toBe(old);pass('两种处理更新分别可撤销，精确恢复旧画布');
 assert(!(await page.locator('body').innerText()).includes('ACR 18.7 效果等效尚待验收'));success=true;
}catch(error){if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await closeElectron(app);if(success){rmSync(work,{recursive:true,force:true});console.log(JSON.stringify({hidden:true,checks}));}else console.error('Failure retained:',work);}
