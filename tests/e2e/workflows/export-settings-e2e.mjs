import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtempSync,rmSync,existsSync,readFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';

const scratch=mkdtempSync(join(tmpdir(),'captraw-export-options-app-')),source=join(scratch,'输出 照片.tiff'),python=resolve('build/qa-venv/bin/python');
let app,page,passed=false;const errors=[],checks=[];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const button=name=>page.getByRole('button',{name,exact:true});
try{
 execFileSync(python,['-c',`from PIL import Image
import sys
a=Image.new('RGB',(480,320));a.putdata([((x*3+y)%256,(y*2+x)%256,(x+y*3)%256) for y in range(320) for x in range(480)]);a.save(sys.argv[1])`,source]);
 const original=hash(source);
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog,BrowserWindow},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});BrowserWindow.getAllWindows()[0].setSize(1100,760);},source);
 await button('打开').click();await page.locator('canvas[data-frame]').waitFor();await page.locator('.rendering').waitFor({state:'hidden'});
 const frame=await page.locator('canvas').getAttribute('data-frame');
 await button('导出').click();const dialog=page.getByRole('dialog',{name:'导出设置'});
 const resolution=page.getByRole('spinbutton',{name:'输出分辨率'}),quality=page.getByRole('spinbutton',{name:'JPEG 质量'}),compression=page.getByRole('combobox',{name:'TIFF 压缩'});
 await expect(resolution).toHaveValue('300');await expect(quality).toHaveValue('12');await expect(compression).toHaveValue('zip');
 for(const [input,value] of [[resolution,'0'],[quality,'13']]){
  await input.scrollIntoViewIfNeeded();await expect(input).toBeInViewport();await input.fill(value);
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByRole('button',{name:'JPEG'})).toBeDisabled();await input.fill(input===resolution?'240':'4');
 }
 await compression.selectOption('none');await expect(page.locator('.export-dimensions')).toContainText('480 × 320');
 checks.push('actual controls, validation and unchanged pixel dimensions');
 for(const [name,label] of [['tiff','TIFF · 16 位'],['jpg','JPEG']]){
  if(name==='jpg')await button('导出').click();
  const output=join(scratch,'导出 结果.'+name);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
  const action=dialog.getByRole('button',{name:label});await action.scrollIntoViewIfNeeded();await expect(action).toBeInViewport();await action.click();
  await expect(page.locator('.job-toast.done')).toContainText('已导出 导出 结果.'+name);assert(existsSync(output));
 }
 const result=execFileSync(python,['-c',`from PIL import Image
import tifffile,sys
from pathlib import Path
d=Path(sys.argv[1])
for ext in ['tiff','jpg']:
 im=Image.open(d/('导出 结果.'+ext));assert im.size==(480,320);assert im.info.get('icc_profile');exif=im.getexif();assert float(exif[282])==240;assert float(exif[283])==240;assert int(exif[296])==2
with tifffile.TiffFile(d/'导出 结果.tiff') as f:assert f.pages[0].compression==1;assert f.asarray().dtype.name=='uint16'
print('JPEG/TIFF actual PPI, ICC, TIFF16/uncompressed and unchanged dimensions: passed')`,scratch],{encoding:'utf8'});
 console.log(result.trim());checks.push('real single-photo exports use the visible codec and PPI settings');
 assert.equal(await page.locator('canvas').getAttribute('data-frame'),frame);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);
 const second=join(scratch,'第二 照片.tiff'),directory=join(scratch,'批量 输出');copyFileSync(source,second);mkdirSync(directory);
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},second);
 await button('打开').click();await expect(page.locator('.film-item')).toHaveCount(2);await expect(page.locator('.document-title')).toContainText('第二 照片.tiff');
 await page.locator('.rendering').waitFor({state:'hidden'});await button('选择全部').click();
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},directory);
 await button('导出').click();await resolution.fill('72');await compression.selectOption('zip');
 await dialog.getByRole('button',{name:'TIFF · 16 位'}).scrollIntoViewIfNeeded();await dialog.getByRole('button',{name:'TIFF · 16 位'}).click();
 await expect(page.locator('.job-toast.done')).toContainText('已导出 2/2');
 console.log(execFileSync(python,['-c',`from pathlib import Path
from PIL import Image
import numpy as np,tifffile,sys
d=Path(sys.argv[1]);files=list(d.glob('*.tiff'));assert len(files)==2
reference=tifffile.imread(d.parent/'导出 结果.tiff')
for p in files:
 im=Image.open(p);e=im.getexif();assert float(e[282])==72 and float(e[283])==72;assert im.info.get('icc_profile')
 with tifffile.TiffFile(p) as f:assert f.pages[0].compression==8;assert np.array_equal(reference,f.asarray())
print('Batch uses current PPI/ZIP settings for both immutable documents; TIFF16 pixels match single export')`,directory],{encoding:'utf8'}).trim());
 checks.push('same visible workflow settings reach every selected batch document without changing TIFF16 pixels');
 assert.equal(hash(source),original);assert.deepEqual(errors,[]);
 const states=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));
 assert(states.every(s=>!s.visible&&!s.focused&&!s.focusable));checks.push('source, recipe and preview unchanged; small-window controls reachable; hidden window');
 passed=true;console.log(JSON.stringify({passed,checks}));
}catch(error){
 if(page)await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});
 console.error(app?electronDiagnostics(app):'',error);throw error;
}finally{
 if(app)await closeElectron(app);if(passed)rmSync(scratch,{recursive:true,force:true});else console.error('Failure retained:',scratch);
}
