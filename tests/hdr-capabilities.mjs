import assert from 'node:assert/strict';
import {electron,closeElectron} from './electron-background.mjs';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
const out=resolve(process.env.CAPTRAW_HDR_CAPABILITIES_OUT||'artifacts/hdr-capabilities');mkdirSync(out,{recursive:true});const work=mkdtempSync(join(out,'run-'));
const executablePath=process.env.CAPTRAW_APP||join(homedir(),'Applications/CaptRAW-0.63.app/Contents/MacOS/CaptRAW');
let app,complete=false;const report={probeComplete:false,hdrFeatureAccepted:false,physicalDisplayVerified:false,executablePath,scope:'Numeric/capability probe in hidden windows. Float readback and advertised display headroom are not physical HDR luminance evidence.'};
try{
 if(process.platform==='darwin'){
  const script=join(work,'display.swift');writeFileSync(script,`import AppKit
import Foundation
let displays = NSScreen.screens.map { screen -> [String:Any] in
 return ["name":screen.localizedName,"id":screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] ?? 0,"currentEDR":screen.maximumExtendedDynamicRangeColorComponentValue,"potentialEDR":screen.maximumPotentialExtendedDynamicRangeColorComponentValue,"referenceEDR":screen.maximumReferenceExtendedDynamicRangeColorComponentValue]
}
let data=try JSONSerialization.data(withJSONObject:displays,options:[.sortedKeys]);print(String(data:data,encoding:.utf8)!)
`);report.nativeDisplays=JSON.parse(execFileSync('xcrun',['swift','-module-cache-path',join(work,'swift-cache'),script],{encoding:'utf8',maxBuffer:1024*1024}));
 }
 app=await electron.launch({executablePath});const page=await app.firstWindow();
 await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true})));
 report.versions=await app.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}));
 report.displays=await app.evaluate(({screen})=>screen.getAllDisplays().map(d=>({id:d.id,label:d.label,colorSpace:d.colorSpace,colorDepth:d.colorDepth,depthPerComponent:d.depthPerComponent})));
 report.browser=await page.evaluate(async()=>{
  const result={secure:isSecureContext,mediaHDR:matchMedia('(dynamic-range: high)').matches,mediaP3:matchMedia('(color-gamut: p3)').matches,canvas2D:[],webgpu:[]};
  for(const colorSpace of ['srgb','display-p3','srgb-linear','display-p3-linear'])for(const mode of ['standard','extended']){
   const canvas=document.createElement('canvas');canvas.width=4;canvas.height=1;document.body.append(canvas);
   try{
    const context=canvas.getContext('2d',{colorSpace,colorType:'float16',toneMapping:{mode}});
    const data=new Float16Array([.5,.5,.5,1,1,1,1,1,2,2,2,1,4,4,4,1]);context.putImageData(new ImageData(data,4,1,{colorSpace,pixelFormat:'rgba-float16'}),0,0);
    const pixels=context.getImageData(0,0,4,1,{colorSpace,pixelFormat:'rgba-float16'});result.canvas2D.push({colorSpace,mode,attributes:context.getContextAttributes(),pixelFormat:pixels.pixelFormat,values:Array.from(pixels.data)});
   }catch(error){result.canvas2D.push({colorSpace,mode,error:String(error)});}finally{canvas.remove();}
  }
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter){result.gpuUnavailable=true;return result;}
  result.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description};const device=await adapter.requestDevice();
  try{
   const shader=device.createShaderModule({code:`@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(positions[index],0,1);}
@fragment fn fs(@builtin(position) position:vec4f)->@location(0) vec4f {let values=array<f32,4>(0.5,1.0,2.0,4.0);let value=values[min(u32(position.x),3u)];return vec4f(value,value,value,1);}`});
   const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:'rgba16float'}]}});
   for(const colorSpace of ['srgb','srgb-linear'])for(const mode of ['standard','extended']){
    const canvas=document.createElement('canvas');canvas.width=4;canvas.height=1;document.body.append(canvas);const context=canvas.getContext('webgpu');let buffer;device.pushErrorScope('validation');
    try{
     context.configure({device,format:'rgba16float',colorSpace,alphaMode:'opaque',toneMapping:{mode},usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});const texture=context.getCurrentTexture();buffer=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:256},{width:4,height:1});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
     const values=Array.from(new Float16Array(buffer.getMappedRange().slice(0,32)));buffer.unmap();const config=context.getConfiguration();result.webgpu.push({colorSpace,mode,configuration:{format:config.format,colorSpace:config.colorSpace,toneMapping:config.toneMapping},values});
    }catch(error){result.webgpu.push({colorSpace,mode,error:String(error)});}finally{buffer?.destroy();const error=await device.popErrorScope();if(error)result.webgpu.at(-1).validationError=error.message;context.unconfigure();canvas.remove();}
   }
  }finally{device.destroy();}return result;
 });
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));assert(windows.length&&windows.every(w=>!w.visible&&!w.focused&&!w.focusable));report.backgroundWindow=true;report.httpBlocked=true;report.probeComplete=true;complete=true;
 console.log(JSON.stringify({versions:report.versions,nativeDisplays:report.nativeDisplays,canvas2D:report.browser.canvas2D,webgpu:report.browser.webgpu,physicalDisplayVerified:false},null,2));
}finally{if(app)await closeElectron(app);writeFileSync(join(out,'report.json'),JSON.stringify({...report,...(!complete?{work}:{})},null,2)+'\n');if(complete)rmSync(work,{recursive:true,force:true});else console.error('Failure workspace:',work);}
