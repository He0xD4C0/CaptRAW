import {readDocument} from '../../support/xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const out=resolve(process.env.CAPTRAW_EXPORT_E2E_OUT||'artifacts/export-colors-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[];let app,page;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),pass=s=>{checks.push(s);console.log('PASS',s);};
const source=resolve('build/samples/export-wide-gamut.tiff'),raw=resolve('build/samples/nikon-d850.NEF'),sourceHash=hash(source),rawHash=hash(raw);
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(out,name+'.xmp');rmSync(path,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);await settle(()=>page.getByRole('button',{name:'保存',exact:true}).click());return (await readDocument(path));}
async function menu(){await page.getByRole('button',{name:'导出',exact:true}).click();await expect(page.getByRole('dialog',{name:'导出设置'})).toBeVisible();}
async function exportFile(space,name,format='tiff',cancel=false){
 const path=join(out,name+(format==='tiff'?'.tiff':'.jpg'));if(!cancel)rmSync(path,{force:true});
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async(_win,opts)=>{globalThis.__exportDialog=opts;return {canceled:false,filePath:file};};},path);
 await menu();await page.getByRole('combobox',{name:'输出色彩空间'}).selectOption(space);
 await page.getByRole('button',{name:format==='tiff'?'TIFF · 16 位':'JPEG',exact:false}).click();
 if(cancel){await page.locator('.job-toast.running').getByRole('button',{name:'取消'}).click();await expect(page.locator('.job-toast.cancelled')).toBeVisible();}
 else await expect(page.locator('.job-toast.done')).toContainText('已导出 '+name+(format==='tiff'?'.tiff':'.jpg'),{timeout:120000});
 return {path,options:await app.evaluate(()=>globalThis.__exportDialog)};
}
try{
 app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await open(source);const before=await save('before');const canvas=page.locator('canvas[aria-label="显影预览"]'),previewPixels=await canvas.evaluate(c=>c.toDataURL());
 await menu();const choice=page.getByRole('combobox',{name:'输出色彩空间'});await expect(choice).toHaveValue('srgb');await expect(choice.locator('option')).toHaveCount(5);await expect(choice).toBeFocused();
 await choice.selectOption('prophoto-rgb');await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.outputProfile==='prophoto-rgb');expect(await canvas.evaluate(c=>c.toDataURL())).not.toBe(previewPixels);await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'导出设置'})).toHaveCount(0);await expect(page.getByRole('button',{name:'导出',exact:true})).toBeFocused();await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.outputProfile==='');expect(await canvas.evaluate(c=>c.toDataURL())).toBe(previewPixels);pass('visible export color selector exposes five SDR spaces, previews the target gamut and Escape restores focus and pixels');
 await menu();await expect(choice).toHaveValue('prophoto-rgb');await page.locator('.stage-meta').click();await expect(page.getByRole('dialog',{name:'导出设置'})).toHaveCount(0);await page.waitForFunction(()=>document.querySelector('canvas[aria-label="显影预览"]')?.dataset.outputProfile==='');expect(await canvas.evaluate(c=>c.toDataURL())).toBe(previewPixels);pass('outside click closes export options without changing edits and restores the unproved preview');
 for(const [space,label] of Object.entries({'srgb':'sRGB','adobe-rgb':'Adobe RGB (1998)','prophoto-rgb':'ProPhoto RGB','display-p3':'Display P3','rec2020':'Rec. 2020'})){
  const r=await exportFile(space,space);expect(r.options.filters[0].name).toContain(label);expect(existsSync(r.path)).toBe(true);
 }
 const after=await save('after');expect(after.adjustments).toEqual(before.adjustments);expect(after.artProfile).toBe(before.artProfile);pass('all five TIFF16 choices reach export and leave the complete editing recipe unchanged');
 await exportFile('adobe-rgb','adobe-rgb','jpeg');pass('JPEG export accepts the selected ICC space through the same visible workflow');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await menu();await expect(choice).toBeInViewport();await expect(page.getByRole('button',{name:'TIFF · 16 位'})).toBeInViewport();await page.screenshot({path:join(out,'export-options.png')});await page.keyboard.press('Escape');pass('export options and format buttons remain reachable in the small hidden window');
 const invalid=await page.evaluate(async()=>{try{await window.captraw.export({document:{path:'/unused.nef',width:1,height:1,artProfile:'',adjustments:{}},format:'tiff',colorSpace:'hdr-pq'});return '';}catch(e){return String(e);}});expect(invalid).toContain('不支持的导出格式或色彩空间');pass('host rejects unsupported spaces before native dialog or export');
 await open(raw);const recipe=await save('真实 RAW 输出');const target=join(out,'取消输出.tiff');writeFileSync(target,'existing output sentinel');await exportFile('prophoto-rgb','取消输出','tiff',true);expect(readFileSync(target,'utf8')).toBe('existing output sentinel');expect(readdirSync(out).filter(n=>n.startsWith('取消输出.tiff.')&&n.endsWith('.tmp'))).toEqual([]);pass('cancel preserves an existing output and removes temporary files');
 await exportFile('prophoto-rgb','真实 RAW');
 const independent=new EngineClient({cache:join(out,'independent-cache'),executable:executablePath?resolve(executablePath,'../../Resources/native/captraw-engine'):undefined,resources:executablePath?resolve(executablePath,'../../Resources/native/resources'):undefined});
 try{await independent.call('export',{path:raw,artProfile:recipe.artProfile,output:join(out,'raw-independent.tiff'),format:'tiff',colorSpace:'prophoto-rgb'});}finally{await independent.stop();}
 expect(hash(source)).toBe(sourceHash);expect(hash(raw)).toBe(rawHash);expect(errors).toEqual([]);pass('real RAW retry exports full-resolution ProPhoto TIFF without changing source files or causing runtime errors');
}catch(e){if(page)await page.screenshot({path:join(out,'failure.png')});throw e;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({backgroundWindow:true,packaged:!!executablePath,checks,errors,sourceHash,rawHash},null,2)+'\n');if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await app.close().catch(()=>{});}}
