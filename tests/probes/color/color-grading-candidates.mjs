// Research only: run a pinned candidate kernel; nothing is linked into the product.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';import {homedir} from 'node:os';import {createHash} from 'node:crypto';import {electron} from '../../support/electron-background.mjs';
const root=resolve('build/grading-research'),out=resolve('artifacts/color-grading-candidates');mkdirSync(root,{recursive:true});mkdirSync(out,{recursive:true});
const commit='a4f2cf5cb867fa1def9f6d5ca2a16654b56fb8a8';
async function source(file,remote,expected){const path=join(root,file);if(!existsSync(path)){const r=await fetch(`https://raw.githubusercontent.com/CyberTimon/RapidRAW/${commit}/${remote}`);assert(r.ok);writeFileSync(path,Buffer.from(await r.arrayBuffer()));}const text=readFileSync(path,'utf8');assert.equal(createHash('sha256').update(text).digest('hex'),expected);return text;}
const text=await source('rapidraw-shader.wgsl','src-tauri/src/shaders/shader.wgsl','4830dbc2d62b6b9852359fcc99a60c22ae65636f0032671e8b421dcfc88d4d24');
await source('RapidRAW-LICENSE','LICENSE','8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef');
function extract(marker){const start=text.indexOf(marker);assert(start>=0);let i=text.indexOf('{',start)+1,depth=1;for(;depth&&i<text.length;i++){if(text[i]==='{')depth++;if(text[i]==='}')depth--;}assert.equal(depth,0);return text.slice(start,i);}
const code=[extract('struct ColorGradeSettings'),text.match(/const LUMA_COEFF = .*;/)[0],...['get_luma','hsv_to_rgb','apply_color_grading'].map(n=>extract('fn '+n+'('))].join('\n')+`
@group(0) @binding(0) var<storage,read_write> output:array<vec4<f32>>;
@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3<u32>){
 let values=array<f32,9>(0.0,0.09999,0.1,0.10001,0.25,0.49999,0.5,0.50001,1.0);
 let mode=id.x/9u;let value=values[id.x%9u];let neutral=ColorGradeSettings(0,0,0,0);
 let blue=ColorGradeSettings(240,1,0,0);let red=ColorGradeSettings(0,1,0,0);
 var s=neutral;var m=neutral;var h=neutral;var g=neutral;var blend=0.5;
 if(mode==1u){s=blue;}if(mode==2u){h=red;}if(mode==3u){g=blue;}
 if(mode>=4u){s=blue;h=red;blend=f32(mode-4u)*0.5;}
 output[id.x]=vec4<f32>(apply_color_grading(vec3<f32>(value),s,m,h,g,blend,0.0),1.0);
}`;
const executablePath=process.env.CAPTRAW_APP||join(homedir(),'Applications/CaptRAW-0.16.app/Contents/MacOS/CaptRAW');const app=await electron.launch({executablePath,args:[]});let result;
try{const page=await app.firstWindow();result=await page.evaluate(async code=>{
 if(!navigator.gpu)throw new Error('WebGPU unavailable');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('WebGPU adapter unavailable');const device=await adapter.requestDevice();const shader=device.createShaderModule({code});const messages=await shader.getCompilationInfo();if(messages.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(messages.messages));
 device.pushErrorScope('validation');const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'probe'}});const size=63*16,output=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:output}}]});const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(63);pass.end();encoder.copyBufferToBuffer(output,0,read,0,size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const pixels=Array.from(new Float32Array(read.getMappedRange()));read.unmap();const error=await device.popErrorScope();if(error)throw new Error(error.message);const backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device};output.destroy();read.destroy();device.destroy();return {pixels,backend};
},code);}finally{await app.close();}
const values=[0,.09999,.1,.10001,.25,.49999,.5,.50001,1],modes=['neutral','blue-shadows','red-highlights','blue-global','blue-red-blending-0','blue-red-blending-50','blue-red-blending-100'];const cases=modes.map((name,mode)=>({name,pixels:values.map((input,i)=>({input,output:result.pixels.slice((mode*9+i)*4,(mode*9+i)*4+3)}))}));
for(const p of cases[0].pixels)p.output.forEach(v=>assert(Math.abs(v-p.input)<1e-6));
assert(cases[1].pixels[0].output.some(v=>v>0.001));assert(cases[3].pixels[0].output.some(v=>v>0.001));assert(cases[3].pixels.at(-1).output.some(v=>v<.999));
const report={candidate:'RapidRAW',version:'1.6.7',commit,sourceSHA256:'4830dbc2d62b6b9852359fcc99a60c22ae65636f0032671e8b421dcfc88d4d24',license:'AGPL-3.0 (repository LICENSE)',scope:'Unmodified extracted WGSL kernel; not full RapidRAW application or ACR pixel equivalence',backgroundWindow:true,backend:result.backend,allOutputsFinite:result.pixels.every(Number.isFinite),equalSmoothstepEdgesAtZeroBlending:true,cases,passesACREndpointGate:false,reason:'Tint alone changes black/white despite zero luminance. Blending=0 also supplies equal smoothstep edges in pinned source.'};writeFileSync(join(out,'rapidraw.json'),JSON.stringify(report,null,2)+'\n');console.log('Verified candidate rejection:',report.reason);
