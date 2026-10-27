import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {XMP} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const out=resolve(process.env.CAPTRAW_MASK_REFERENCE_GUI_OUT||'artifacts/mask-reference-gui');mkdirSync(out,{recursive:true});
const fixture=resolve(process.env.CAPTRAW_MASK_REFERENCE_OUT||'artifacts/mask-reference');
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'))),core=new EngineClient({cache:join(out,'core')});
const document=await documents.read(join(fixture,'编辑 文档.xmp'));
const source=join(fixture,'source.png'),sourceHash=createHash('sha256').update(readFileSync(source)).digest('hex');
const shape=document.adjustments.masks[0].components[2];
const standalone={...shape,type:'radial',id:'standalone',name:'参考角蒙版',brightness:.5,contrast:0,saturation:0};delete standalone.operation;
const sourceAdjustments={...document.adjustments,masks:[standalone]};
const sourceProfile=(await core.call('compose',{path:source,width:1024,height:768,artProfile:document.artProfile,adjustments:sourceAdjustments})).artProfile;
const sourceFile=join(out,'source.xmp');writeFileSync(sourceFile,await documents.serialize({...document,source:{...document.source,path:source},artProfile:sourceProfile,adjustments:sourceAdjustments}));
const targetPath=join(fixture,'target.png'),targetFile=join(out,'target.xmp');
const targetAdjustments={...document.adjustments,masks:[]},targetProfile=sourceProfile.replace(/(\[Rotation\][^[]*?\nDegree=)[^\n]*/,'$1-11');
expect(targetProfile).not.toBe(sourceProfile);
writeFileSync(targetFile,await documents.serialize({...document,source:{...document.source,path:targetPath},artProfile:targetProfile,adjustments:targetAdjustments}));
const app=await electron.launch(),page=await app.firstWindow(),checks=[],errors=[];let passed=false;
page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
const pass=name=>{checks.push(name);console.log('PASS',name);};
await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(out,name+'.xmp');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);return documents.read(path);}
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex');
try{
 await open(sourceFile);await page.getByRole('button',{name:'蒙版 M',exact:true}).click();
 await page.getByRole('button',{name:'参考角蒙版',exact:true}).click();
 await page.getByRole('combobox',{name:'组件运算'}).selectOption('intersect');
 await settle(()=>page.getByRole('button',{name:'相交亮度范围',exact:true}).click());
 const grouped=await save('grouped');expect(grouped.adjustments.masks[0].components[0].referenceAngle).toBe(7);
 pass('visible standalone-to-group operation retains the spatial leaf reference');
 await page.getByRole('button',{name:'预设',exact:true}).click();await page.getByRole('button',{name:'创建预设',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'创建预设'});await dialog.getByRole('textbox',{name:'预设名称',exact:true}).fill('参考角保留');
 await dialog.getByRole('button',{name:'全不选',exact:true}).click();await dialog.getByRole('checkbox',{name:'蒙版（替换目标蒙版）',exact:true}).check();
 await dialog.getByRole('button',{name:'保存预设',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'参考角保留',exact:true})).toBeVisible();
 await open(targetFile);await page.getByRole('button',{name:'预设',exact:true}).click();const before=await pixels();
 await page.getByRole('button',{name:'参考角保留',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'应用预设'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeEnabled();
 await expect.poll(pixels).not.toBe(before);const after=await pixels();
 const applied=await save('applied');expect(applied.adjustments.masks[0].components[0].referenceAngle).toBe(7);expect(applied.artProfile).toMatch(/\[Rotation\][^[]*\nDegree=-11\n/);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());expect(await pixels()).toBe(before);
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());expect(await pixels()).toBe(after);
 pass('visible preset capture/application keeps the reference on a different target angle, with exact undo/redo pixels');
 const output=join(out,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
 await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 await core.call('export',{path:targetPath,artProfile:applied.artProfile,output:join(out,'native.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',String.raw`
import tifffile,numpy as np,sys,json
from pathlib import Path
p=Path(sys.argv[1]);a=tifffile.imread(p/'desktop.tiff');b=tifffile.imread(p/'native.tiff')
assert a.dtype==np.uint16 and np.array_equal(a,b)
(p/'pixels.json').write_text(json.dumps(dict(bits=16,shape=list(a.shape),maxDifference=0))+'\n')
`,out]);
 await save('before-close');await page.getByRole('button',{name:'关闭当前文件',exact:true}).click();await open(join(out,'applied.xmp'));expect(await pixels()).toBe(after);
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await page.getByRole('button',{name:'参考角蒙版',exact:true}).click();
 await page.screenshot({path:join(out,'workbench.png')});
 pass('GUI TIFF16 matches independent native pixels and closing/reopening XMP preserves displayed output');
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(sourceHash);expect(errors).toEqual([]);passed=true;
}catch(error){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally{await closeElectron(app);await core.stop();writeFileSync(join(out,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks,errors,backgroundWindow:true,installed:!!process.env.CAPTRAW_APP},null,2)+'\n');}
