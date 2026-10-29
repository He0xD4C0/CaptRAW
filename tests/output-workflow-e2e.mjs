import {readDocument} from './xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {DEFAULT_EXPORT_OPTIONS} from '@captraw/contracts/export-options';
import {readFileSync,writeFileSync,mkdirSync,rmSync,copyFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out=resolve(process.env.CAPTRAW_OUTPUT_E2E_OUT||'artifacts/output-workflow-gui');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,checks=[],errors=[],outputs=[];let app,page,pixelVerification,passed=false;
const source=resolve('build/samples/luminance-range.png'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source),pass=s=>{checks.push(s);console.log('PASS',s);};
const second=join(out,'照片 二.png');copyFileSync(source,second);rmSync(second.replace(/\.[^.]+$/,'.xmp'),{force:true});
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(out,name+'.xmp');rmSync(path,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);await settle(()=>page.getByRole('button',{name:'保存',exact:true}).click());await expect.poll(()=>existsSync(path)).toBe(true);return (await readDocument(path));}
async function menu(){await page.getByRole('button',{name:'导出',exact:true}).click();await expect(page.getByRole('dialog',{name:'导出设置'})).toBeVisible();}
async function installCancelFeedbackGate(){
 await app.evaluate(({BrowserWindow,ipcMain})=>{
  const contents=BrowserWindow.getAllWindows()[0].webContents,send=contents.send,cancel=ipcMain._invokeHandlers.get('job:cancel');
  const state=globalThis.__outputCancelFeedback={jobId:null,calls:0,rpcResolved:false,terminal:null};
  contents.send=function(channel,event,...rest){
   if(channel==='engine:event'&&event?.event==='job'){
    if(event.job.state==='running'&&state.jobId===null)state.jobId=event.job.id;
    if(event.job.id===state.jobId&&event.job.state!=='running'){state.terminal=[channel,event,...rest];return;}
   }
   return send.call(this,channel,event,...rest);
  };
  ipcMain.removeHandler('job:cancel');ipcMain.handle('job:cancel',async(...args)=>{state.calls++;const result=await cancel(...args);state.rpcResolved=true;return result;});
  state.release=()=>{const terminal=state.terminal;state.terminal=null;if(terminal)send.call(contents,...terminal);};
  state.restore=()=>{contents.send=send;ipcMain.removeHandler('job:cancel');ipcMain.handle('job:cancel',cancel);state.release();};
 });
}
async function exportFile(name,dimensions,format='tiff',cancel=false){
 const path=join(out,name+(format==='tiff'?'.tiff':'.jpg'));if(!cancel)rmSync(path,{force:true});
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);
 if(cancel)await installCancelFeedbackGate();
 try{
  await menu();await page.getByRole('button',{name:format==='tiff'?'TIFF · 16 位':'JPEG',exact:false}).click();
  if(cancel){
   await page.locator('.job-toast.running').getByRole('button',{name:'取消',exact:true}).click();
   const pending=page.locator('.job-toast.running').getByRole('button',{name:'正在取消…',exact:true});
   await expect(pending).toBeVisible();await expect(pending).toBeDisabled();
   await expect.poll(()=>app.evaluate(()=>globalThis.__outputCancelFeedback.rpcResolved)).toBe(true);
   // The real cancellation RPC has returned, but its real terminal Job event is
   // held in main. UI must still show a disabled pending action at this boundary.
   await expect(pending).toBeDisabled();await expect(page.locator('.job-toast.cancelled')).toHaveCount(0);
   await pending.click({force:true});expect(await app.evaluate(()=>globalThis.__outputCancelFeedback.calls)).toBe(1);
   await expect.poll(()=>app.evaluate(()=>globalThis.__outputCancelFeedback.terminal?.[1]?.job.state)).toBe('cancelled');
   await app.evaluate(()=>globalThis.__outputCancelFeedback.release());await expect(page.locator('.job-toast.cancelled')).toBeVisible();
   await expect(page.locator('.job-toast').getByRole('button',{name:'正在取消…',exact:true})).toHaveCount(0);
  }else{await expect(page.locator('.job-toast.done')).toContainText('已导出 '+name,{timeout:120000});outputs.push({path,dimensions});}
  return path;
 }finally{if(cancel)await app.evaluate(()=>globalThis.__outputCancelFeedback?.restore?.());}
}
try{
 app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 if(process.argv.includes('--cancel-only')){
  const original=resolve('build/samples/nikon-d850.NEF'),originalHash=hash(original),raw=join(out,'取消 原片.NEF');copyFileSync(original,raw);await open(raw);
  const frame=await page.locator('canvas').getAttribute('data-frame');await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
  await menu();await page.getByRole('combobox',{name:'输出尺寸方式'}).selectOption('long-edge');await page.getByRole('spinbutton',{name:'输出像素'}).fill('512');await page.keyboard.press('Escape');
  const sentinel=join(out,'取消.tiff');writeFileSync(sentinel,'keep');await exportFile('取消',[],'tiff',true);
  expect(readFileSync(sentinel,'utf8')).toBe('keep');expect(readdirSync(out).some(n=>n.startsWith('取消.tiff.')&&n.endsWith('.tmp'))).toBe(false);
  expect(hash(original)).toBe(originalHash);expect(hash(raw)).toBe(originalHash);expect(await page.locator('canvas').getAttribute('data-frame')).toBe(frame);
  await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();expect(errors).toEqual([]);
  const states=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));expect(states.length>0&&states.every(s=>!s.visible&&!s.focused&&!s.focusable)).toBe(true);
  pass('real GUI export cancellation shows disabled pending feedback until the real terminal Job, calls cancel once, preserves destination/source/preview/history and stays hidden');passed=true;
 }else{
 await open(source);const before=await save('before'),frame=await page.locator('canvas').getAttribute('data-frame');
 await menu();await expect(page.getByRole('combobox',{name:'输出色彩空间'})).toBeFocused();const mode=page.getByRole('combobox',{name:'输出尺寸方式'}),pixels=page.getByRole('spinbutton',{name:'输出像素'}),sharp=page.getByRole('checkbox',{name:'输出锐化'});
 await expect(mode).toHaveValue('original');await expect(sharp).not.toBeChecked();await expect(page.locator('.export-dimensions')).toContainText('1024 × 256');await mode.selectOption('long-edge');await pixels.fill('512');await expect(page.locator('.export-dimensions')).toContainText('512 × 128');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'导出设置'})).toHaveCount(0);await expect(page.getByRole('button',{name:'导出',exact:true})).toBeFocused();pass('visible defaults preserve original size; long-edge dimensions update and Escape restores export focus');
 await menu();await pixels.fill('');await expect(page.getByRole('alert')).toContainText('整数');await expect(page.getByRole('button',{name:'TIFF · 16 位'})).toBeDisabled();await pixels.fill('1');await expect(page.getByRole('alert')).toContainText('至少 1');await pixels.fill('512');await sharp.check();await page.getByRole('spinbutton',{name:'输出锐化半径'}).fill('0');await expect(page.getByRole('button',{name:'JPEG'})).toBeDisabled();await page.getByRole('spinbutton',{name:'输出锐化半径'}).fill('1');await page.getByRole('spinbutton',{name:'输出锐化数量'}).fill('180');await expect(page.getByRole('alert')).toHaveCount(0);pass('invalid and empty numeric fields disable export with inline errors until corrected');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await expect(mode).toBeInViewport();await expect(page.getByRole('spinbutton',{name:'输出锐化半径'})).toBeInViewport();await expect(page.getByRole('button',{name:'TIFF · 16 位'})).toBeInViewport();await page.screenshot({path:join(out,'output-options.png')});await page.locator('.stage-meta').click();expect(await page.locator('canvas').getAttribute('data-frame')).toBe(frame);await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);pass('small hidden window keeps controls and export buttons reachable without changing preview or dirty state');
 await exportFile('缩放 锐化',[512,128]);await exportFile('缩放 锐化',[512,128],'jpeg');const after=await save('after');expect(after.adjustments).toEqual(before.adjustments);expect(after.artProfile).toBe(before.artProfile);pass('single TIFF16 and JPEG use current size/sharpening while the complete editing recipe remains unchanged');
 await settle(()=>page.getByRole('button',{name:'顺时针旋转 90 度'}).click());await menu();await mode.selectOption('short-edge');await pixels.fill('128');await expect(page.locator('.export-dimensions')).toContainText('128 × 512');await pixels.fill('500');await expect(page.locator('.export-dimensions')).toContainText('256 × 1024');await page.getByRole('checkbox',{name:'不放大'}).uncheck();await expect(page.locator('.export-dimensions')).toContainText('500 × 2000');await page.getByRole('checkbox',{name:'不放大'}).check();await pixels.fill('128');await page.keyboard.press('Escape');await exportFile('旋转 短边',[128,512]);pass('short edge follows portrait rotation and no-upscale changes the calculated dimensions correctly');
 await menu();await mode.selectOption('bounds');await pixels.fill('300');await page.getByRole('spinbutton',{name:'输出高度'}).fill('200');await expect(page.locator('.export-dimensions')).toContainText('50 × 200');await page.keyboard.press('Escape');await exportFile('边界框',[50,200]);await menu();await mode.selectOption('long-edge');await pixels.fill('512');await sharp.uncheck();await page.keyboard.press('Escape');pass('bounds preserve the rotated aspect ratio and sharpening can be disabled independently');
 await save('rotated');await open(second);await page.getByRole('button',{name:'选择全部',exact:true}).click();const batch=join(out,'批量 输出');rmSync(batch,{recursive:true,force:true});mkdirSync(batch);await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},batch);await menu();await expect(page.getByRole('dialog',{name:'导出设置'})).toContainText('每张按自身裁切比例计算');await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toContainText('已导出 2/2');outputs.push({path:join(batch,'luminance-range_CaptRAW.tiff'),dimensions:[128,512]},{path:join(batch,'照片 二_CaptRAW.tiff'),dimensions:[512,128]});pass('batch applies one workflow setting to each photo independently, retaining its own rotation and aspect ratio');
 const raw=resolve('build/samples/nikon-d850.NEF'),rawHash=hash(raw);await open(raw);const recipe=await save('raw-before');const sentinel=join(out,'取消.tiff');writeFileSync(sentinel,'keep');await exportFile('取消',[],'tiff',true);expect(readFileSync(sentinel,'utf8')).toBe('keep');expect(readdirSync(out).some(n=>n.startsWith('取消.tiff.')&&n.endsWith('.tmp'))).toBe(false);pass('real GUI cancellation disables its pending action immediately and stays pending after RPC return until the actual terminal Job; destination and temporary-output protection remain intact');
 // Historical 0.24 comparisons remain historical evidence. This run checks the current
 // desktop export against the saved typed ART profile in a fresh same-package core.
 await exportFile('真实 RAW',[512,341]);const nativeRoot=executablePath?resolve(executablePath,'../../Resources/native'):resolve('build/native'),ref=new EngineClient({executable:join(nativeRoot,'captraw-engine'),resources:join(nativeRoot,'resources'),cache:join(out,'independent')});
 const referenceOptions=structuredClone(DEFAULT_EXPORT_OPTIONS);referenceOptions.size={...referenceOptions.size,mode:'long-edge',width:512};referenceOptions.sharpen={enabled:false,amount:180,radius:1};
 const reference=join(out,'raw-reference.tiff');try{await ref.call('export',{path:raw,artProfile:recipe.artProfile,options:referenceOptions,format:'tiff',colorSpace:'srgb',output:reference});}finally{await ref.stop();}outputs.at(-1).reference=reference;expect((await save('raw-after')).artProfile).toBe(recipe.artProfile);expect(hash(raw)).toBe(rawHash);pass('real RAW resize reaches the installed pipeline; a fresh same-package core reads the saved typed ART profile and export options as the integration oracle');
 pixelVerification=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import sys,json,hashlib,numpy as np,tifffile
from PIL import Image
items=json.loads(sys.argv[1]);verified=[]
for item in items:
 p=item['path'];im=Image.open(p);assert list(im.size)==item['dimensions'],(p,im.size,item['dimensions']);icc=im.info.get('icc_profile');assert icc,p
 if p.endswith('.tiff'):
  with tifffile.TiffFile(p) as t:
   a=t.asarray();assert a.dtype==np.uint16;assert t.pages[0].bitspersample==16
 else:assert im.format=='JPEG'
 if item.get('reference'):
  b=tifffile.imread(item['reference']);assert b.dtype==np.uint16 and np.array_equal(a,b),p
  with tifffile.TiffFile(item['reference']) as t:assert t.pages[0].tags[34675].value==icc
  assert np.unique(a).size>256 and np.any(a%257),p
 verified.append(dict(path=p,dimensions=list(im.size),sha256=hashlib.sha256(open(p,'rb').read()).hexdigest(),iccSHA256=hashlib.sha256(icc).hexdigest(),**({'maximumDifference16bit':0} if item.get('reference') else {})))
print(json.dumps(dict(outputs=verified,scope='same-package fresh-core integration consistency; no renewed 0.24 or Adobe parity claim')))
`,JSON.stringify(outputs)],{encoding:'utf8'}));
 const invalid=await page.evaluate(async()=>{try{await window.captraw.export({document:{path:'/unused.nef',width:1,height:1,artProfile:'',adjustments:{}},format:'tiff',colorSpace:'srgb',options:{size:{mode:'bounds',width:0,height:10,dontEnlarge:true},sharpen:{enabled:false,amount:80,radius:.5}}});return '';}catch(e){return String(e);}});expect(invalid).toContain('输出尺寸');expect(errors).toEqual([]);expect(hash(source)).toBe(sourceHash);
 const states=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));expect(states.every(s=>!s.visible&&!s.focused&&!s.focusable)).toBe(true);pass('host rejects invalid options before a native dialog; sources and hidden window policy remain intact without renderer errors');passed=true;
 }
}catch(e){if(page)await page.screenshot({path:join(out,'failure.png')});throw e;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({passed,checks,errors,outputs,pixelVerification,referenceScope:'current same-package core with saved typed ART profile and export options; historical 0.24 comparison is not rerun',sourceHash,packaged:!!executablePath,backgroundWindow:true},null,2)+'\n');if(app){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await app.close().catch(()=>{});}}
