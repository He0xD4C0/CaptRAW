import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {resolve,join,dirname} from 'node:path';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,writeFileSync,rmSync,existsSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out=resolve(process.env.CAPTRAW_WB_OUT||'artifacts/white-balance-gui');mkdirSync(out,{recursive:true});
const priorRuns=readdirSync(out,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^run-[A-Za-z0-9]+$/.test(e.name)).map(e=>join(out,e.name));
const work=mkdtempSync(join(out,'run-')),userData=join(work,'user-data');
const executablePath=process.env.CAPTRAW_APP,native=executablePath?resolve(dirname(executablePath),'../Resources/native'):resolve('build/native');
if(executablePath)process.env.CAPTRAW_XMP_BINARY=join(native,'captraw-xmp');
const {readDocument}=await import('./xmp-test.mjs');
const checks=[],errors=[],sources={},deleted=[],pixelsEvidence={};let app,page,complete=false,failure,application;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),passed=name=>{checks.push(name);console.log('PASS',name);};
function fixture(name){const source=resolve('build/samples',name),target=join(work,name);for(const path of [source,source+'.xmp',source+'.arp',source.replace(/\.[^.]+$/,'.xmp')])if(existsSync(path))sources[path]=hash(path);copyFileSync(source,target);return target;}
async function launch(){app=await electron.launch({executablePath,env:{CAPTRAW_E2E_USER_DATA:userData}});page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));application=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,executable:app.getPath('exe')}));if(executablePath){expect(application.version).toBe('0.64.0');expect(application.packaged).toBe(true);}await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});}
async function idle(){await page.locator('.rendering').waitFor({state:'hidden',timeout:120000});await page.waitForFunction(()=>{const f=window.__frames.filter(f=>f.kind!=='detail').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]').dataset.frame===f.url;},{},{timeout:120000});await expect(page.locator('canvas[aria-label="显影预览"]')).toBeVisible();}
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n,{timeout:120000});await idle();}
async function open(path){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve(path));await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(work,name+'.xmp');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await idle();return readDocument(path);}
const pixels=async()=>hashBuffer(await page.locator('canvas[aria-label="显影预览"]').screenshot());
const hashBuffer=b=>createHash('sha256').update(b).digest('hex');
function inventory(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(e=>{const path=join(directory,e.name);return e.isDirectory()?inventory(path):[{path:resolve(path),bytes:statSync(path).size,sha256:hash(path)}];});}
async function compareExport(document,input,detail){
 const engine=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(work,'independent')});
 try{const image=await engine.call('open',{path:input,sessionId:'independent',baselineVersion:4});const snapshot=await engine.call('compose',{path:input,width:image.width,height:image.height,adjustments:document.adjustments,artProfile:document.artProfile});await engine.call('export',{path:input,artProfile:snapshot.artProfile,output:join(work,'independent.tiff'),format:'tiff',colorSpace:'srgb'});}finally{await engine.stop();}
 // Same independent TIFF/ICC/detail assertions as inspect-optics.py, without its unrelated report prerequisites.
 const result=execFileSync(process.env.CAPTRAW_PYTHON||resolve('build/qa-venv/bin/python'),['-c',`import sys,json,io,hashlib
import numpy as np,tifffile
from PIL import Image,ImageCms
from pathlib import Path
work=Path(sys.argv[1]); arrays=[]; result={}
for name in ['desktop.tiff','independent.tiff']:
 with tifffile.TiffFile(work/name) as f:
  a=f.asarray(); assert a.dtype==np.uint16 and f.pages[0].bitspersample==16 and a.ndim==3 and a.shape[2]==3
  icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip(); assert 'sRGB' in icc
  arrays.append(a); result[name]={'shape':list(a.shape),'dtype':str(a.dtype),'icc':icc,'sha256':hashlib.sha256((work/name).read_bytes()).hexdigest()}
assert np.array_equal(*arrays); result['independentMaximumDifference16bit']=0
if (work/'detail.json').exists():
 frame=json.loads((work/'detail.json').read_text()); preview=np.array(Image.open(work/'detail.png').convert('RGB')); region=arrays[0][frame['y']:frame['y']+frame['height'],frame['x']:frame['x']+frame['width']]; assert np.array_equal(preview,np.rint(region.astype(float)/257)); result['detailMaximumDifference8bit']=0
print(json.dumps(result))`,work],{encoding:'utf8',maxBuffer:1024*1024});Object.assign(pixelsEvidence,JSON.parse(result));
}
try{
 await launch();
 const nef=fixture('nikon-d850.NEF');await open(nef);const selector=page.getByRole('combobox',{name:'白平衡',exact:true});
 await expect(selector).toBeVisible();const original=await save('original');expect(original.baselineVersion).toBe(4);expect(original.adjustments.wbMultipliers).toHaveLength(3);
 const wbTemp=page.getByRole('spinbutton',{name:'色温',exact:true});await wbTemp.focus();await wbTemp.press('Tab');expect((await save('focus-only')).adjustments).toEqual(original.adjustments);
 await wbTemp.focus();await wbTemp.press('Escape');expect((await save('escape-only')).adjustments).toEqual(original.adjustments);
 await wbTemp.fill('6500');await wbTemp.press('Escape');expect((await save('cancel-temperature')).adjustments).toEqual(original.adjustments);passed('focus, Tab and Escape preserve exact camera WB and cancel the complete edit');
 const inputProfile=page.getByRole('combobox',{name:'输入配置文件'});await inputProfile.selectOption('matrix');await expect(inputProfile).toHaveValue('matrix');
 const matrixWB=await save('matrix-wb');expect(matrixWB.adjustments.wbMultipliers).toEqual(original.adjustments.wbMultipliers);expect(matrixWB.adjustments.wbMode).toBe('camera');expect(matrixWB.adjustments.temperature).not.toBe(original.adjustments.temperature);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(inputProfile).toHaveValue('auto');expect((await save('profile-undone')).adjustments).toEqual(original.adjustments);passed('profile change preserves fixed coefficients, reprojects coordinates and undoes in one step');
 const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await settle(async()=>{await exposure.fill('0.5');await exposure.press('Tab');});
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},join(work,'original.xmp'));
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toContainText('未保存');await expect(exposure).toHaveValue('0.5');await expect(page.locator('.film-item')).toHaveCount(1);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());passed('opening another recipe cannot replace unsaved edits');
 const originalPacket=readFileSync(join(work,'original.xmp'),'utf8'),invalid=originalPacket.replace(/crs:Temperature="[^"]*"/,'crs:Temperature="invalid"');expect(invalid).not.toBe(originalPacket);writeFileSync(join(work,'invalid.xmp'),invalid);
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},join(work,'invalid.xmp'));
 const canvasBefore=await pixels();await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Temperature 超出');expect(await pixels()).toBe(canvasBefore);await expect(page.locator('.film-item')).toHaveCount(1);passed('invalid recipe is rejected before replacing the current image');
 await settle(()=>selector.selectOption('auto'));const auto=await save('auto');expect(auto.adjustments.wbMode).toBe('auto');expect(auto.adjustments.wbMultipliers).not.toEqual(original.adjustments.wbMultipliers);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(selector).toHaveValue('camera');
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(selector).toHaveValue('auto');passed('automatic WB uses native coefficients and is one undoable action');
 await settle(()=>selector.selectOption('preset:0'));const preset=await save('preset');expect(preset.adjustments.wbMode).toBe('preset:0');expect(preset.adjustments.wbMultipliers).toHaveLength(3);passed('camera-specific preset is visible, applied and saved');
 await settle(()=>selector.selectOption('camera'));expect((await save('camera')).adjustments.wbMultipliers).toEqual(original.adjustments.wbMultipliers);
 const temp=page.getByRole('spinbutton',{name:'色温',exact:true});await settle(async()=>{await temp.fill('6500');await temp.press('Tab');});await expect(selector).toHaveValue('custom');expect((await save('manual')).adjustments.wbMultipliers).toBeNull();passed('manual temperature switches to custom and clears exact coefficients');
 const tint=page.getByRole('spinbutton',{name:'色调',exact:true});await expect(tint).toHaveAttribute('min','-150');await expect(tint).toHaveAttribute('max','150');
 const beforeTint=await pixels();await settle(async()=>{await tint.fill('25');await tint.press('Tab');});expect(await pixels()).not.toBe(beforeTint);
 const tinted=await save('adobe-tint');expect(tinted.adjustments.tint).toBe(25);expect(tinted.adjustments.temperature).toBe(6500);expect(readFileSync(join(work,'adobe-tint.xmp'),'utf8')).toContain('crs:Tint="25"');
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(tint).toHaveValue('25');passed('Adobe Tint range, visible pixel effect, standard XMP and undo/redo work');
 await expect(selector).toBeEnabled();await selector.focus();await page.keyboard.press('i');await expect(page.getByRole('combobox',{name:'取样大小'})).toHaveCount(0);passed('typing in a dropdown does not activate global tools');await expect(selector).toBeEnabled();await settle(()=>selector.selectOption('custom'));
 await page.locator('canvas[aria-label="显影预览"]').click({position:{x:10,y:10}});await page.keyboard.press('i');await expect(page.getByRole('combobox',{name:'取样大小'})).toBeVisible();await page.getByRole('combobox',{name:'取样大小'}).selectOption('25');
 const b=await page.getByTestId('viewport').boundingBox(),frame=await page.evaluate(()=>window.__frames.filter(f=>f.kind==='fit').at(-1));const scale=Math.min((b.width-64)/frame.fullWidth,(b.height-64)/frame.fullHeight);
 await settle(()=>page.mouse.click(b.x+b.width/2+(.6-.5)*frame.fullWidth*scale,b.y+b.height/2+(.6-.5)*frame.fullHeight*scale));
 await expect(selector).toHaveValue('sample');const sampled=await save('sampled');expect(sampled.adjustments.wbMultipliers).toHaveLength(3);
 await page.keyboard.press('Escape');await expect(page.getByRole('combobox',{name:'取样大小'})).toHaveCount(0);passed('I selects the visible eyedropper, 25px sample works, Escape exits');
 await page.waitForFunction(()=>document.querySelector('.film-item.selected img')?.dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);passed('filmstrip thumbnail matches the current preview revision');
 await page.locator('.rendering').waitFor({state:'hidden'});const sampledPixels=await pixels();await page.locator('canvas[aria-label="显影预览"]').screenshot({path:join(work,'before-reopen.png')});pixelsEvidence.beforeReopen={canvas:sampledPixels,frame:await page.evaluate(()=>window.__frames.filter(f=>f.kind==='fit').at(-1)),box:await page.locator('canvas[aria-label="显影预览"]').boundingBox()};copyFileSync(pixelsEvidence.beforeReopen.frame.file,join(work,'before-frame.png'));await closeElectron(app);await launch();await open(join(work,'sampled.xmp'));const restored=await save('restored');expect(restored.adjustments).toEqual(sampled.adjustments);expect(restored.artProfile).toBe(sampled.artProfile);await page.locator('canvas[aria-label="显影预览"]').screenshot({path:join(work,'after-reopen.png')});pixelsEvidence.afterReopen={canvas:await pixels(),frame:await page.evaluate(()=>window.__frames.filter(f=>f.kind==='fit').at(-1)),box:await page.locator('canvas[aria-label="显影预览"]').boundingBox()};copyFileSync(pixelsEvidence.afterReopen.frame.file,join(work,'after-frame.png'));expect(hash(join(work,'after-frame.png'))).toBe(hash(join(work,'before-frame.png')));expect(pixelsEvidence.afterReopen.canvas).toBe(sampledPixels);passed('sampled WB coefficients restore from the saved document');
 await open(fixture('synthetic.dng'));await settle(()=>page.locator('.film-item').filter({hasText:'nikon-d850.NEF'}).locator('.film-open').click());expect((await save('switched')).adjustments).toEqual(sampled.adjustments);passed('current XMP white balance survives filmstrip switching');
 const output=join(work,'desktop.tiff');rmSync(output,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
 await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toContainText('已导出 desktop.tiff',{timeout:180000});expect(existsSync(output)).toBe(true);await compareExport(sampled,nef);passed('restored sampled white balance exports full-resolution ICC TIFF16 equal to an independent installed-core snapshot');
 for(const [path,before] of Object.entries(sources))expect(hash(path),path).toBe(before);expect(hash(nef)).toBe(sources[resolve('build/samples/nikon-d850.NEF')]);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));expect(windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true);expect(errors).toEqual([]);passed('original RAW/sidecars and isolated inputs remain unchanged; all windows stay hidden, unfocused and nonfocusable');
 await page.screenshot({path:join(out,'sampled.png')});copyFileSync(join(work,'sampled.xmp'),join(out,'sampled.xmp'));complete=true;
}catch(e){failure=e.stack||String(e);if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw e;}
finally{
 const diagnostics=app?electronDiagnostics(app):undefined;
 const originalInputProtection=Object.fromEntries(Object.entries(sources).map(([path,before])=>[path,{sha256:hash(path),unchanged:hash(path)===before}]));
 const windowState=app?await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()}))).catch(()=>[]):[];
 for(const [key,file] of [['beforeReopen','before-frame.png'],['afterReopen','after-frame.png']])if(pixelsEvidence[key]){const f=pixelsEvidence[key].frame;pixelsEvidence[key].nativeSHA256=hash(join(work,file));pixelsEvidence[key].frame=Object.fromEntries(['width','height','fullWidth','fullHeight','revision'].map(key=>[key,f[key]]));}
 if(!complete&&existsSync(join(work,'before-frame.png'))&&existsSync(join(work,'after-frame.png')))pixelsEvidence.reopenDifference=JSON.parse(execFileSync(process.env.CAPTRAW_PYTHON||resolve('build/qa-venv/bin/python'),['-c',`import sys,json
from pathlib import Path
from PIL import Image
import numpy as np
work=Path(sys.argv[1]);result={}
for name,a,b in [('native','before-frame.png','after-frame.png'),('visibleCanvas','before-reopen.png','after-reopen.png')]:
 x,y=[np.asarray(Image.open(work/f).convert('RGB')) for f in [a,b]]
 result[name]={'beforeShape':list(x.shape),'afterShape':list(y.shape),'maximumDifference8bit':int(np.abs(x.astype(int)-y).max()) if x.shape==y.shape else None,'changedPixels':int(np.any(x!=y,axis=2).sum()) if x.shape==y.shape else None}
print(json.dumps(result))`,work],{encoding:'utf8'}));
 const runtime={engine:join(native,'captraw-engine'),resources:join(native,'resources'),xmp:process.env.CAPTRAW_XMP_BINARY,engineSHA256:hash(join(native,'captraw-engine')),xmpSHA256:hash(process.env.CAPTRAW_XMP_BINARY||resolve('build/xmp/captraw-xmp'))};
 if(app)await closeElectron(app).catch(e=>{complete=false;failure=(failure||'')+'\n'+String(e);});
 for(const previous of priorRuns){deleted.push(...inventory(previous));rmSync(previous,{recursive:true,force:true});}
 if(complete){deleted.push(...inventory(work));rmSync(work,{recursive:true,force:true});rmSync(join(out,'failure.png'),{force:true});}
 writeFileSync(join(out,'report.json'),JSON.stringify({complete,checkCount:checks.length,plannedCheckGroups:15,checks,errors,application,executablePath,backgroundWindow:true,windowState,runtime,originalInputProtection,sources,pixels:pixelsEvidence,deleted,...(!complete?{work,failure,diagnostics}:{}),limits:['No ACR or CUA operation; no performance or physical-display acceptance.','Independent export uses a fresh process of the same installed 0.64 core, not an independent rendering implementation.'],reproduce:'Set CAPTRAW_APP to the installed 0.64 executable and run this script with its output environment variable. Retained XMP source paths refer to isolated fixture copies; recreate those from the SHA256-matched build/samples originals.'},null,2)+'\n');if(!complete)console.error('Failure workspace:',work);
}
