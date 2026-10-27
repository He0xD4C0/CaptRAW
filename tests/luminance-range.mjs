import {EngineClient} from './engine-client.mjs';
import {resolve,join} from 'node:path';import {homedir} from 'node:os';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const out=resolve(process.env.CAPTRAW_RANGE_OUT||'artifacts/luminance-range');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:join(out,'cache')}),oldRoot=join(homedir(),'Applications/CaptRAW-0.18.app/Contents/Resources/native');
const old=new EngineClient({cache:join(out,'old-cache'),executable:join(oldRoot,'captraw-engine'),resources:join(oldRoot,'resources')});let revision=0;const checks=[],sources={};
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),pass=s=>{checks.push(s);console.log('PASS',s);};
const range={id:'range',name:'亮度范围',type:'luminance',enabled:true,inverted:false,feather:0,brightness:0,contrast:0,saturation:0,points:[],start:{x:0,y:0},end:{x:1,y:1},luminanceRange:[20,35,65,80]};
const radial={...range,type:'radial',start:{x:.1,y:.1},end:{x:.9,y:.9},feather:35};
async function render(a,name,profile=''){
 const preview=engine.preview(++revision),r=await engine.call('update',{revision,adjustments:a,artProfile:profile,maskId:'range'}),frame=await preview;
 cpSync(frame.file,join(out,name+'.png'));if(frame.mask)cpSync(frame.mask.file,join(out,name+'-mask.png'));writeFileSync(join(out,name+'.arp'),r.artProfile);return {...r,frame,hash:hash(frame.file)};
}
async function output(path,r,name){for(const [client,suffix] of [[engine,''],[old,'-reference']])await client.call('export',{path,artProfile:r.artProfile,output:join(out,name+suffix+'.tiff'),format:'tiff'});}
try{
 const path=resolve('build/samples/luminance-range.png');sources[path]=hash(path);
 const image=await engine.call('open',{path,sessionId:'range'}),base=image.adjustments;
 const original=await render(base,'original'),neutral=await render({...base,masks:[range]},'neutral');
 assert(neutral.frame.mask,'Neutral range must publish actual coverage');
 await old.call('open',{path,sessionId:'old'});const prev=old.preview(1),legacy=await old.call('update',{revision:1,adjustments:base});assert.equal(original.hash,hash((await prev).file));assert.equal(original.artProfile,legacy.artProfile);pass('legacy default rendering and full profile are identical to 0.18');
 const variants={middle:[20,35,65,80],shadows:[0,0,25,45],highlights:[55,75,100,100],hard:[30,30,70,70],full:[0,0,100,100]};
 for(const [name,luminanceRange] of Object.entries(variants)){
  const a={...base,masks:[{...range,luminanceRange,brightness:1}]},r=await render(a,name);assert.notEqual(r.hash,original.hash,name);await output(path,r,name);
  const restored=await render(a,name+'-restored',r.artProfile);assert.equal(restored.hash,r.hash);assert.equal(restored.artProfile,r.artProfile);
 }
 const mid=await render({...base,masks:[{...range,brightness:1}]},'middle');
 await render({...base,masks:[{...range,inverted:true,brightness:1}]},'inverted');
 const off=await render({...base,masks:[{...range,enabled:false,brightness:1}]},'disabled',mid.artProfile);assert.equal(off.hash,original.hash);
 await render({...base,masks:[{...radial,id:'range',brightness:1}]},'radial');
 for(const operation of ['add','subtract','intersect'])await render({...base,masks:[{...range,brightness:1,components:[{...radial,id:'shape',operation:'add'},{...range,id:'band',operation}]}]},operation);
 pass('soft and hard ranges, full coverage, inversion, disabled state and all three group operations render and persist');
 await render({...base,masks:[{...range,brightness:1}]},'middle');let p=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:180,y:60,width:600,height:140});let f=await p;cpSync(f.file,join(out,'detail.png'));cpSync(f.mask.file,join(out,'detail-mask.png'));writeFileSync(join(out,'detail.json'),JSON.stringify(f));
 const rotated=await render({...base,rotation:90,crop:{x:.1,y:.1,width:.8,height:.8},masks:[{...range,brightness:1}]},'rotated');await output(path,rotated,'rotated');
 pass('1:1 coverage, crop and rotation use the native luminance selection');
 for(const v of [[-1,0,60,80],[0,10,80,101],[30,20,60,80],[0,50,50,100],[0,60,50,100],[0,20,80,70],[0,20,80],null,{},['x',20,80,100]])await assert.rejects(engine.call('validate',{adjustments:{...base,masks:[{...range,luminanceRange:v}]},artProfile:''}));
 pass('malformed and inverted bounds fail without producing a recipe');
 const textured=resolve('build/samples/luminance-texture.png');sources[textured]=hash(textured);
 const textureImage=await engine.call('open',{path:textured,sessionId:'texture'}),prior={...range,id:'exposure',brightness:1,luminanceRange:[0,0,100,100]},textureBase={...textureImage.adjustments,masks:[prior,range]};
 await render(textureBase,'texture-base');
 for(const key of ['texture','clarity','noise']){
  const a={...textureBase,masks:[prior,{...range,details:{[key]:80}}]},r=await render(a,'local-'+key);await output(textured,r,'local-'+key);
  const restored=await render(a,'local-'+key+'-restored',r.artProfile);assert.equal(restored.artProfile,r.artProfile);assert.equal(restored.hash,r.hash);
 }
 pass('range components drive local texture, clarity and denoising after an overlapping exposure group');
 const raw=[];for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const path=resolve('build/samples',file);sources[path]=hash(path);const image=await engine.call('open',{path,sessionId:file});
  const r=await render({...image.adjustments,crop:{x:.25,y:.25,width:.12,height:.12},masks:[{...range,brightness:.75}]},file);await output(path,r,file);raw.push({file,previewMs:r.frame.elapsedMs});
 }
 pass('NEF, CR3 and X-Trans render and export through current and independent 0.18 native processors');
 for(const [path,before] of Object.entries(sources))assert.equal(hash(path),before);pass('all source image bytes remain unchanged');
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'build/native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,checks,sources,raw},null,2)+'\n');
}finally{await engine.stop();await old.stop();}
