import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
const out=resolve(process.env.CAPTRAW_FLOAT_E2E_OUT||'artifacts/float-preview-e2e');mkdirSync(out,{recursive:true});const work=mkdtempSync(join(out,'run-'));
const source=resolve(process.env.CAPTRAW_FLOAT_SOURCE||'build/samples/nikon-d850.NEF'),input=join(work,'浮点 预览.NEF'),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),sourceHash=hash(source),checks=[],frames=[],errors=[];copyFileSync(source,input);
let app,page,complete=false;const pass=message=>{checks.push(message);console.log('PASS',message);};
async function rendered(){await page.locator('.rendering').waitFor({state:'hidden',timeout:120000});await page.waitForFunction(()=>{const frame=window.__floatFrames.filter(f=>f.kind!=='detail').at(-1);return frame&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===frame.url;},{},{timeout:120000});}
async function inspect(kind='fit'){
 const frame=await page.evaluate(kind=>window.__floatFrames.filter(f=>f.kind===kind).at(-1),kind);expect(frame.linear).toBeTruthy();expect(frame.linear.width).toBe(frame.width);expect(frame.linear.height).toBe(frame.height);
 const result=await page.evaluate(async frame=>{
  const response=await fetch(frame.linear.url);if(!response.ok)throw new Error('Float frame fetch failed');const data=await response.arrayBuffer();if(data.byteLength!==frame.width*frame.height*8)throw new Error('Incorrect float frame size');const values=new Float16Array(data);if(!values.every(Number.isFinite))throw new Error('Invalid float pixels');
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter');const device=await adapter.requestDevice();let texture,buffer;device.pushErrorScope('validation');
  try{
   texture=device.createTexture({size:[frame.width,frame.height],format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});device.queue.writeTexture({texture},data,{bytesPerRow:frame.width*8},{width:frame.width,height:frame.height});
   const stride=Math.ceil(frame.width*8/256)*256;buffer=device.createBuffer({size:stride*frame.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride,rowsPerImage:frame.height},{width:frame.width,height:frame.height});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
   const padded=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(data.byteLength);for(let row=0;row<frame.height;row++)pixels.set(padded.subarray(row*stride,row*stride+frame.width*8),row*frame.width*8);buffer.unmap();const error=await device.popErrorScope();if(error)throw new Error(error.message);
   return {url:frame.linear.url,bytes:data.byteLength,nativeSHA256:await digest(data),gpuSHA256:await digest(pixels),encoding:frame.linear.encoding,colorSpace:frame.linear.colorSpace};
  }finally{buffer?.destroy();texture?.destroy();device.destroy();}
 },frame);
 expect(result.nativeSHA256).toBe(hash(frame.linear.file));expect(result.gpuSHA256).toBe(result.nativeSHA256);frames.push({kind,revision:frame.revision,width:frame.width,height:frame.height,...result});return frame;
}
try{
 app=await electron.launch({executablePath:process.env.CAPTRAW_APP});page=await app.firstWindow();page.on('pageerror',error=>errors.push(String(error)));await page.getByRole('button',{name:'打开',exact:true}).waitFor();
 await app.evaluate(({ipcMain,session})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true}));
  // This transport-only probe requests the optional SDR attachment; HDR controls have a separate GUI test.
  const handler=ipcMain._invokeHandlers.get('image:update');global.__floatTransport=true;ipcMain.removeHandler('image:update');ipcMain.handle('image:update',(event,p)=>handler(event,{...p,linearPreview:global.__floatTransport}));
 });
 await page.evaluate(()=>{window.__floatFrames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__floatFrames.push(event.frame);});});
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},input);await page.getByRole('button',{name:'打开',exact:true}).click();await rendered();await inspect();pass('visible file opening produces native Float16 frames through the production private protocol and lossless WebGPU upload');
 const before=await page.evaluate(()=>window.__floatFrames.length);await page.getByRole('spinbutton',{name:'曝光',exact:true}).fill('1');await page.getByRole('spinbutton',{name:'曝光',exact:true}).press('Tab');await page.waitForFunction(count=>window.__floatFrames.length>count,before);await rendered();const adjusted=await inspect();expect(adjusted.revision).toBeGreaterThan(1);pass('a visible exposure edit publishes a new matching float revision through the production workbench');
 await page.getByRole('button',{name:'1:1',exact:true}).click();await page.waitForFunction(()=>window.__floatFrames.some(f=>f.kind==='detail'),{},{timeout:120000});await inspect('detail');pass('visible 1:1 zoom delivers matching detail float pixels through the real desktop protocol');
 await page.screenshot({path:join(out,'workbench.png')});
 await app.evaluate(()=>{global.__floatTransport=false;});const count=await page.evaluate(()=>window.__floatFrames.length);await page.getByRole('spinbutton',{name:'曝光',exact:true}).fill('0');await page.getByRole('spinbutton',{name:'曝光',exact:true}).press('Tab');await page.waitForFunction(count=>window.__floatFrames.length>count,count);await rendered();expect(await page.evaluate(()=>window.__floatFrames.filter(f=>f.kind!=='detail').at(-1).linear)).toBeNull();pass('disabling the optional native transport publishes no float attachment on the next visible edit');
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await page.getByRole('button',{name:'关闭当前文件',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);expect(hash(source)).toBe(sourceHash);expect(hash(input)).toBe(sourceHash);expect(errors).toEqual([]);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>[w.isVisible(),w.isFocused(),w.isFocusable()]));expect(windows.every(v=>v.every(x=>!x))).toBe(true);pass('close/discard works with float transport; RAW bytes are unchanged and every window remains hidden and unfocused');complete=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{if(app)await closeElectron(app);writeFileSync(join(out,'report.json'),JSON.stringify({complete,checks,frames,errors,sourceHash,executablePath:process.env.CAPTRAW_APP||null,backgroundWindow:true,httpBlocked:true,nativeWorkerSandboxed:false,testOnlyTransportRequest:true,hdrFeatureAccepted:false,physicalDisplayVerified:false,scope:'Real editing controls plus optional native float frame forwarding requested by a test-only IPC wrapper. This is not an end-user HDR processing control, physical HDR display or installed-package acceptance.',...(!complete?{work}:{})},null,2)+'\n');if(complete){rmSync(work,{recursive:true,force:true});rmSync(join(out,'failure.png'),{force:true});rmSync(join(out,'workbench-sdr.png'),{force:true});}else console.error('Failure workspace:',work);}
