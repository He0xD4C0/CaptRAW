import type {PreviewFrame} from '@captraw/contracts';
export interface ImageRect {x:number;y:number;width:number;height:number}
export interface LinearPane {frame:PreviewFrame;detail?:PreviewFrame;destination:ImageRect;clip:ImageRect;actual:boolean}
interface CachedTexture {texture?:GPUTexture;promise:Promise<GPUTexture>;abort:AbortController}
const shader=`struct Params {destination:vec4f,options:vec4f,clip:vec4f,}
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;
@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(positions[index],0,1);}
fn load(p:vec2i)->vec3f {return textureLoad(source,clamp(p,vec2i(0),vec2i(textureDimensions(source))-1),0).rgb;}
fn encode(v:vec3f)->vec3f {let a=abs(v);return sign(v)*select(1.055*pow(a,vec3f(1.0/2.4))-0.055,12.92*a,a<=vec3f(0.0031308));}
@fragment fn fs(@builtin(position) position:vec4f)->@location(0) vec4f {
 if(any(position.xy<params.clip.xy)||any(position.xy>=params.clip.zw)){discard;}
 let p=(position.xy-params.destination.xy)/params.destination.zw*vec2f(textureDimensions(source))-0.5;
 if(params.options.x>0.5){return vec4f(encode(load(vec2i(floor(p+0.5)))),1);}
 let base=vec2i(floor(p));let f=fract(p);let top=mix(load(base),load(base+vec2i(1,0)),f.x);let bottom=mix(load(base+vec2i(0,1)),load(base+vec2i(1,1)),f.x);
 return vec4f(encode(mix(top,bottom,f.y)),1);
}`;
const intersection=(a:ImageRect,b:ImageRect):ImageRect=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};};
// Floating image pixels only. Guides and masks remain in the existing overlay layers.
export class LinearCanvas {
 private cache=new Map<string,CachedTexture>();private disposed=false;private serial=0;
 private constructor(private canvas:HTMLCanvasElement,private context:GPUCanvasContext,private device:GPUDevice,private pipeline:GPURenderPipeline){}
 static async create(canvas:HTMLCanvasElement,lost:(message:string)=>void){
  if(!navigator.gpu)throw new Error('当前图形环境没有 WebGPU。');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('无法初始化图形设备。');const device=await adapter.requestDevice();
  let configured:GPUCanvasContext|undefined;
  try{
   const context=canvas.getContext('webgpu');if(!context||!('configure' in context))throw new Error('无法创建浮点画布。');
   context.configure({device,format:'rgba16float',colorSpace:'srgb',alphaMode:'premultiplied',toneMapping:{mode:'extended'},usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   configured=context;
   if(context.getConfiguration()?.toneMapping?.mode!=='extended')throw new Error('当前图形环境不接受扩展范围画布。');
   const module=device.createShaderModule({code:shader}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(info.messages.map(m=>m.message).join('\n'));
   const pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float'}]}}),renderer=new LinearCanvas(canvas,context,device,pipeline);
   void device.lost.then(info=>{if(!renderer.disposed)lost(info.message||'图形设备已断开。');});device.addEventListener('uncapturederror',event=>{event.preventDefault();if(!renderer.disposed)lost(event.error.message);});return renderer;
  }catch(error){if(configured?.getConfiguration()?.device===device)configured.unconfigure();device.destroy();throw error;}
 }
 private texture(frame:PreviewFrame){
  const plane=frame.linear;if(!plane||plane.encoding!=='rgba16float-le'||plane.colorSpace!=='rec709-linear'||plane.width!==frame.width||plane.height!==frame.height||plane.rowBytes!==frame.width*8)throw new Error('浮点帧描述无效。');
  const existing=this.cache.get(plane.url);if(existing)return existing.promise;
  const abort=new AbortController();const promise=(async()=>{
   const response=await fetch(plane.url,{signal:abort.signal});if(!response.ok)throw new Error('浮点预览已失效，请重试。');const pixels=await response.arrayBuffer();if(pixels.byteLength!==plane.rowBytes*plane.height)throw new Error('浮点帧大小不匹配。');
   if(this.disposed||abort.signal.aborted)throw new DOMException('Cancelled','AbortError');const texture=this.device.createTexture({size:[plane.width,plane.height],format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
   this.device.queue.writeTexture({texture},pixels,{bytesPerRow:plane.rowBytes},{width:plane.width,height:plane.height});return texture;
  })();const entry:CachedTexture={abort,promise};void promise.then(texture=>{if(this.disposed||abort.signal.aborted)texture.destroy();else entry.texture=texture;},()=>{});this.cache.set(plane.url,entry);return promise;
 }
 async draw(panes:LinearPane[],width:number,height:number,dpr:number){
  if(this.disposed)return false;
  const serial=++this.serial,urls=new Set(panes.flatMap(p=>[p.frame.linear?.url,p.actual?p.detail?.linear?.url:undefined]).filter((url):url is string=>!!url));
  for(const [url,entry] of this.cache)if(!urls.has(url)){entry.abort.abort();entry.texture?.destroy();this.cache.delete(url);}
  try{
   const textures=await Promise.all(panes.map(async pane=>({pane,fit:await this.texture(pane.frame),detail:pane.actual&&pane.detail?.linear?await this.texture(pane.detail):undefined})));
   if(this.disposed||serial!==this.serial||this.context.getConfiguration()?.device!==this.device)return false;const pixelWidth=Math.max(1,Math.round(width*dpr)),pixelHeight=Math.max(1,Math.round(height*dpr));if(this.canvas.width!==pixelWidth)this.canvas.width=pixelWidth;if(this.canvas.height!==pixelHeight)this.canvas.height=pixelHeight;
   const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]}),buffers:GPUBuffer[]=[];pass.setPipeline(this.pipeline);
   const draw=(texture:GPUTexture,destination:ImageRect,clip:ImageRect,nearest:boolean)=>{
    clip=intersection(intersection(destination,clip),{x:0,y:0,width,height});if(clip.width<=0||clip.height<=0)return;
    const uniform=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(uniform);
    this.device.queue.writeBuffer(uniform,0,new Float32Array([destination.x*dpr,destination.y*dpr,destination.width*dpr,destination.height*dpr,nearest?1:0,0,0,0,clip.x*dpr,clip.y*dpr,(clip.x+clip.width)*dpr,(clip.y+clip.height)*dpr]));
    pass.setBindGroup(0,this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:uniform}}]}));pass.draw(3);
   };
   for(const {pane,fit,detail} of textures){draw(fit,pane.destination,pane.clip,false);if(detail&&pane.detail){const f=pane.detail,scaleX=pane.destination.width/pane.frame.fullWidth,scaleY=pane.destination.height/pane.frame.fullHeight;draw(detail,{x:pane.destination.x+(f.x||0)*scaleX,y:pane.destination.y+(f.y||0)*scaleY,width:f.width*scaleX,height:f.height*scaleY},pane.clip,true);}}
   pass.end();this.device.queue.submit([encoder.finish()]);for(const buffer of buffers)buffer.destroy();return true;
  }catch(error){if(this.disposed||serial!==this.serial)return false;throw error;}
 }
 destroy(){this.disposed=true;++this.serial;for(const entry of this.cache.values()){entry.abort.abort();entry.texture?.destroy();}this.cache.clear();if(this.context.getConfiguration()?.device===this.device)this.context.unconfigure();this.device.destroy();}
}
