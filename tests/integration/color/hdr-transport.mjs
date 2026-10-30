import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {electron,closeElectron} from '../../support/electron-background.mjs';
const out=resolve(process.env.CAPTRAW_HDR_TRANSPORT_OUT||'artifacts/hdr-research/transport');mkdirSync(out,{recursive:true});const work=mkdtempSync(join(out,'run-'));
const inputs=(process.env.CAPTRAW_HDR_TRANSPORT_INPUTS||'artifacts/hdr-research/native/linear-rec709-hdr-f16.tif,artifacts/hdr-research/native-raw/linear-rec709-hdr-f16.tif').split(',').map(path=>resolve(path));
const python=resolve('build/qa-venv/bin/python'),checks=[],hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
let app,complete=false;const report={probeComplete:false,hdrFeatureAccepted:false,physicalDisplayVerified:false,scope:'Actual ART float TIFF pixels through a temporary private protocol and WebGPU in a hidden installed application. This is a transport experiment, not the product preview path or physical luminance acceptance.',checks};
try{
 const samples=JSON.parse(execFileSync(python,['-c',`import tifffile,numpy as np,json,sys,os,io
from PIL import ImageCms
root=sys.argv[1];samples=[]
for i,path in enumerate(sys.argv[2:]):
 a=tifffile.imread(path);assert a.dtype==np.float16 and a.ndim==3 and a.shape[2]==3 and np.isfinite(a).all()
 with tifffile.TiffFile(path) as t:icc=t.pages[0].tags[34675].value
 assert ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip()=='Linear Rec.709'
 rgba=np.ones((*a.shape[:2],4),dtype='<f2');rgba[:,:,:3]=a;name='photo-'+str(i);rgba.tofile(os.path.join(root,name+'.bin'));samples.append(dict(name=name,width=a.shape[1],height=a.shape[0],path=path))
values=np.array([-.25,0,.0031308,.18,1,2,4],dtype='<f2');a=np.ones((1,len(values),4),dtype='<f2');a[:,:,:3]=values[None,:,None];a.tofile(os.path.join(root,'transfer-control.bin'));samples.append(dict(name='transfer-control',width=len(values),height=1))
print(json.dumps(samples))`,work,...inputs],{encoding:'utf8'}));
 report.sources=inputs.map(path=>({path,sha256:hash(path)}));
 const cases=samples.flatMap(sample=>[
  {...sample,id:sample.name+'-standard',mode:'standard',outputWidth:sample.width,outputHeight:sample.height},
  {...sample,id:sample.name+'-extended',mode:'extended',outputWidth:sample.width,outputHeight:sample.height},
  ...(sample.height>1?[{...sample,id:sample.name+'-fit',mode:'extended',outputWidth:Math.round(sample.width/2),outputHeight:Math.round(sample.height/2)}]:[])
 ]);
 report.executablePath=process.env.CAPTRAW_APP||join(homedir(),'Applications/CaptRAW-0.63.app/Contents/MacOS/CaptRAW');
 app=await electron.launch({executablePath:report.executablePath});await app.firstWindow();const pendingPage=app.waitForEvent('window');
 await app.evaluate(async({BrowserWindow,session},options)=>{
  const fs=process.getBuiltinModule('fs/promises');global.__hdrRequests=[];global.__hdrProtocolErrors=[];
  const partition='hdr-transport-'+Date.now(),probeSession=session.fromPartition(partition);
  probeSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true}));
  // Test-only allowlist in an isolated in-memory session; the product handler stays intact.
  const files=new Map(options.samples.map(s=>['captraw://app/__hdr_probe__/'+s.name,{path:options.work+'/'+s.name+'.bin',method:'GET',bytes:s.width*s.height*8}]));
  for(const test of options.cases)files.set('captraw://app/__hdr_probe__/'+test.id+'.out',{path:options.work+'/'+test.id+'.out',method:'POST',bytes:test.outputWidth*test.outputHeight*8});
  probeSession.protocol.handle('captraw',async request=>{
   try{
   if(request.url==='captraw://app/__hdr_probe__/index.html'&&request.method==='GET')return new Response('<!doctype html><html><head><title>HDR transport experiment</title></head><body></body></html>',{headers:{'Content-Type':'text/html'}});
   const file=files.get(request.url);if(!file||request.method!==file.method)return new Response('Not found',{status:404});
   if(request.method==='GET'){const data=await fs.readFile(file.path);global.__hdrRequests.push({url:request.url,method:'GET',bytes:data.length});return new Response(data,{headers:{'Content-Type':'application/octet-stream'}});}
   const data=new Uint8Array(await request.arrayBuffer());if(data.byteLength!==file.bytes)return new Response('Invalid frame size',{status:400});await fs.writeFile(file.path,data);global.__hdrRequests.push({url:request.url,method:'POST',bytes:data.length});return new Response('ok');
   }catch(error){global.__hdrProtocolErrors.push(String(error));return new Response(String(error),{status:500});}
  });
  const probe=new BrowserWindow({show:false,focusable:false,webPreferences:{partition,backgroundThrottling:false,contextIsolation:true,sandbox:true,nodeIntegration:false}});await probe.loadURL('captraw://app/__hdr_probe__/index.html');
 },{samples,cases,work});
 const page=await pendingPage;report.pageURL=page.url();report.console=[];page.on('console',message=>{if(message.type()==='error')report.console.push(message.text());});
 report.versions=await app.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome}));
 report.gpu=await page.evaluate(async({samples,cases})=>{
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter');const device=await adapter.requestDevice();
  const errors=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));const textures=new Map(),results=[];
  try{
   const shader=device.createShaderModule({code:`@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> targetSize: vec2f;
@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(positions[index],0,1);}
fn encode(v:vec3f)->vec3f {let a=abs(v);return sign(v)*select(1.055*pow(a,vec3f(1.0/2.4))-0.055,12.92*a,a<=vec3f(0.0031308));}
fn load(p:vec2i)->vec3f {return textureLoad(source,clamp(p,vec2i(0),vec2i(textureDimensions(source))-1),0).rgb;}
@fragment fn fs(@builtin(position) position:vec4f)->@location(0) vec4f {
 let p=position.xy*vec2f(textureDimensions(source))/targetSize-0.5;let base=vec2i(floor(p));let f=fract(p);
 let top=mix(load(base),load(base+vec2i(1,0)),f.x);let bottom=mix(load(base+vec2i(0,1)),load(base+vec2i(1,1)),f.x);
 return vec4f(encode(mix(top,bottom,f.y)),1);
}`});
   const info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(info.messages.map(m=>m.message).join('\n'));
   const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:'rgba16float'}]}});
   for(const sample of samples){const response=await fetch('captraw://app/__hdr_probe__/'+sample.name);if(!response.ok)throw new Error('Frame fetch failed');const pixels=await response.arrayBuffer();if(pixels.byteLength!==sample.width*sample.height*8)throw new Error('Invalid input size');const texture=device.createTexture({size:[sample.width,sample.height],format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});device.queue.writeTexture({texture},pixels,{bytesPerRow:sample.width*8},{width:sample.width,height:sample.height});textures.set(sample.name,texture);}
   for(const test of cases){
    const canvas=document.createElement('canvas');canvas.width=test.outputWidth;canvas.height=test.outputHeight;document.body.append(canvas);const context=canvas.getContext('webgpu');let buffer,uniform;
    device.pushErrorScope('validation');
    try{
     context.configure({device,format:'rgba16float',colorSpace:'srgb',alphaMode:'opaque',toneMapping:{mode:test.mode},usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
     uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(uniform,0,new Float32Array([canvas.width,canvas.height]));
     const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:textures.get(test.name).createView()},{binding:1,resource:{buffer:uniform}}]});
     const texture=context.getCurrentTexture(),stride=Math.ceil(canvas.width*8/256)*256;buffer=device.createBuffer({size:stride*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride,rowsPerImage:canvas.height},{width:canvas.width,height:canvas.height});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
     const padded=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(canvas.width*canvas.height*8);for(let row=0;row<canvas.height;row++)pixels.set(padded.subarray(row*stride,row*stride+canvas.width*8),row*canvas.width*8);buffer.unmap();
     const response=await fetch('captraw://app/__hdr_probe__/'+test.id+'.out',{method:'POST',body:pixels});if(!response.ok)throw new Error('Readback write failed');const config=context.getConfiguration();results.push({id:test.id,format:config.format,colorSpace:config.colorSpace,toneMapping:config.toneMapping});
    }finally{buffer?.destroy();uniform?.destroy();context.unconfigure();canvas.remove();const error=await device.popErrorScope();if(error)errors.push(test.id+': '+error.message);}
   }
   return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},results,errors};
  }finally{for(const texture of textures.values())texture.destroy();device.destroy();}
 },{samples,cases});
 assert.deepEqual(report.gpu.errors,[]);assert(cases.every(test=>report.gpu.results.some(result=>result.id===test.id&&result.toneMapping.mode===test.mode)));checks.push('private binary transport and both WebGPU presentation modes complete without GPU validation errors');
 writeFileSync(join(work,'cases.json'),JSON.stringify(cases));
 report.pixels=JSON.parse(execFileSync(python,['-c',`import numpy as np,json,sys,os
root=sys.argv[1];cases=json.load(open(os.path.join(root,'cases.json')));result=[]
for test in cases:
 a=np.fromfile(os.path.join(root,test['name']+'.bin'),dtype='<f2').reshape(test['height'],test['width'],4).astype(np.float64)
 w,h=test['outputWidth'],test['outputHeight'];x=(np.arange(w)+.5)*a.shape[1]/w-.5;y=(np.arange(h)+.5)*a.shape[0]/h-.5;x0=np.floor(x).astype(int);y0=np.floor(y).astype(int);fx=(x-x0)[None,:,None];fy=(y-y0)[:,None,None]
 def load(dx,dy):return a[np.clip(y0+dy,0,a.shape[0]-1)[:,None],np.clip(x0+dx,0,a.shape[1]-1)[None,:],:3]
 linear=(load(0,0)*(1-fx)+load(1,0)*fx)*(1-fy)+(load(0,1)*(1-fx)+load(1,1)*fx)*fy
 absolute=np.abs(linear);expected=np.sign(linear)*np.where(absolute<=.0031308,12.92*absolute,1.055*absolute**(1/2.4)-.055)
 actual=np.fromfile(os.path.join(root,test['id']+'.out'),dtype='<f2').reshape(h,w,4);assert np.isfinite(actual).all() and np.all(actual[:,:,3]==1)
 delta=np.abs(actual[:,:,:3].astype(np.float64)-expected);ulp=np.spacing(np.maximum(np.abs(expected),2**-14).astype(np.float16)).astype(np.float64)
 assert np.all(delta<=ulp*2), (test['id'],float(delta.max()),float(np.max(delta/ulp)))
 assert np.max(actual[:,:,:3])>1, test['id']
 if test['name']=='transfer-control':assert actual[0,0,0]<0 and actual[0,1,0]==0 and abs(float(actual[0,4,0])-1)<=2*np.spacing(np.float16(1))
 result.append(dict(id=test['id'],shape=list(actual.shape),maximumDifference=float(delta.max()),maximumHalfULPs=float(np.max(delta/ulp)),overWhiteChannels=int((actual[:,:,:3]>1).sum()),minimum=float(actual[:,:,:3].min()),maximum=float(actual[:,:,:3].max())))
for name in set(t['name'] for t in cases):
 assert open(os.path.join(root,name+'-standard.out'),'rb').read()==open(os.path.join(root,name+'-extended.out'),'rb').read()
print(json.dumps(result))`,work],{encoding:'utf8',maxBuffer:1024*1024}));
 checks.push('actual photo and signed transfer controls match independent CPU extended-sRGB encoding within two half-float ULPs, including linear-light fit interpolation');
 checks.push('standard and extended buffer readbacks are identical: numeric headroom alone cannot validate physical HDR presentation');
 report.requests=await app.evaluate(()=>global.__hdrRequests);assert.equal(report.requests.length,samples.length+cases.length);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>[w.isVisible(),w.isFocused(),w.isFocusable()]));assert(windows.length&&windows.every(values=>values.every(v=>!v)));report.backgroundWindow=true;report.httpBlocked=true;complete=true;report.probeComplete=true;console.log(JSON.stringify({checks,pixels:report.pixels,physicalDisplayVerified:false},null,2));
}finally{if(app){report.protocolErrors=await app.evaluate(()=>global.__hdrProtocolErrors);report.requests=await app.evaluate(()=>global.__hdrRequests);await closeElectron(app);}writeFileSync(join(out,'report.json'),JSON.stringify({...report,...(!complete?{work}:{})},null,2)+'\n');if(complete)rmSync(work,{recursive:true,force:true});else console.error('Failure workspace:',work);}
