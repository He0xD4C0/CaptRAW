import {EngineClient,explicitFreshCurveMode} from '../../support/engine-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const out=resolve('artifacts/local-tone');mkdirSync(out,{recursive:true});const engine=new EngineClient({cache:'build/local-tone-cache'});engine.on('error',()=>{});let revision=0;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),checks=[],pass=s=>{checks.push(s);console.log('PASS',s);};
const zero={highlights:0,shadows:0,whites:0,blacks:0};
const mask={id:'tone',name:'局部明暗',type:'radial',enabled:true,inverted:false,feather:10,brightness:0,contrast:0,saturation:0,points:[],start:{x:.05,y:.15},end:{x:.95,y:.85}};
async function render(adjustments,name,artProfile=''){
 const p=engine.preview(++revision);const r=await engine.call('update',{revision,adjustments,artProfile,maskId:'tone'}),frame=await p;cpSync(frame.file,join(out,name+'.png'));if(frame.mask)cpSync(frame.mask.file,join(out,name+'-mask.png'));writeFileSync(join(out,name+'.arp'),r.artProfile);return {profile:r.artProfile,frame,hash:hash(frame.file)};
}
async function detail(name,x=400,y=350,width=160,height=140){const p=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,x,y,width,height});const f=await p;cpSync(f.file,join(out,name+'-detail.png'));writeFileSync(join(out,name+'-detail.json'),JSON.stringify(f));return f;}
try{
 const path=resolve('build/samples/local-tone.png'),sourceHash=hash(path),image=await engine.call('open',{path,sessionId:'tone'}),base={...image.adjustments,masks:[mask]},baseline=await render(base,'baseline');
 const old=new EngineClient({cache:'build/local-tone-old',executable:process.env.HOME+'/Applications/CaptRAW-0.10.app/Contents/Resources/native/captraw-engine',resources:process.env.HOME+'/Applications/CaptRAW-0.10.app/Contents/Resources/native/resources'});
 try{await old.call('open',{path,sessionId:'old'});let rev=0;for(const [name,a] of [['neutral',base],['legacy-global',{...base,highlights:-45,shadows:40,whites:-20,blacks:25,masks:[{...mask,whiteBalance:{temperature:20,tint:15}}]}]]){const r=await render(a,name),p=old.preview(++rev),previous=await old.call('update',{revision:rev,adjustments:a});assert.equal(r.profile,explicitFreshCurveMode(previous.artProfile));assert.equal(hash((await p).file),r.hash);}
 }finally{await old.stop();}pass('neutral masks and global tone/WB retain 0.10 pixels with explicit second-curve mode metadata');
 const state=tone=>({...base,masks:[{...mask,tone}]}),neutral=await render(state(zero),'neutral');assert.equal(neutral.profile,baseline.profile);assert.equal(neutral.hash,baseline.hash);pass('zero optional tonal controls omit the new field and processing');
 for(const key of Object.keys(zero))for(const sign of [1,-1]){
  const name=key+(sign>0?'-up':'-down'),r=await render(state({...zero,[key]:sign*70}),name);assert.notEqual(r.hash,baseline.hash);assert(r.profile.includes('CaptRAWToneBands_1='));await detail(name);
  const disabled=await render({...base,masks:[{...mask,tone:{...zero,[key]:sign*70},enabled:false}]},name+'-disabled',r.profile);assert.equal(disabled.hash,baseline.hash);
  const reset=await render(base,name+'-reset',r.profile);assert.equal(reset.profile,baseline.profile);assert.equal(reset.hash,baseline.hash);
 }pass('all four signed controls affect actual pixels and fully revert when reset or disabled');
 const combo={...base,masks:[{...mask,tone:{highlights:-45,shadows:55,whites:-30,blacks:20},whiteBalance:{temperature:20,tint:15},brightness:.2,contrast:10}]},r=await render(combo,'combined');await detail('combined');
 const inverted=await render({...combo,masks:combo.masks.map(m=>({...m,inverted:true}))},'inverted');assert.notEqual(inverted.hash,r.hash);
 await render({...combo,rotation:90,crop:{x:.1,y:.1,width:.8,height:.8}},'rotated');await detail('rotated',250,300,180,160);
 const second={...mask,id:'second',brightness:.6,whiteBalance:{temperature:-30,tint:-10},tone:{...zero,highlights:60}},pair={...combo,masks:[...combo.masks,second]},forward=await render(pair,'forward');const backward=await render({...pair,masks:[...pair.masks].reverse()},'backward');assert.notEqual(forward.hash,backward.hash);assert.equal((await render(pair,'repeated',forward.profile)).hash,forward.hash);assert.equal((await render(combo,'removed',forward.profile)).hash,r.hash);pass('ordered overlapping groups, inversion, crop, rotation and repeated updates are stable');
 await engine.call('export',{path,artProfile:r.profile,output:join(out,'current.tiff'),format:'tiff'});const independent=new EngineClient({cache:'build/local-tone-independent'});try{await independent.call('export',{path,artProfile:r.profile,output:join(out,'independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 const reference=resolve('build/reference/Contents/MacOS/captraw-art-reference');cpSync('build/native/captraw-art-reference',reference);const cli=(source,name,profile)=>execFileSync(reference,['-a','-o',join(out,name),'-p',join(out,profile+'.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:'pipe'});cli(path,'reference.tif','combined');pass('complete native profile exports independently and through patched ART CLI');
 for(const tone of [{highlights:101},{shadows:-101},[],null])await assert.rejects(engine.call('validate',{artProfile:'',adjustments:state(tone)}));
 for(const value of ['1;2;3;','101;0;0;0;0;'])await assert.rejects(engine.call('validate',{artProfile:r.profile.replace(/CaptRAWToneBands_1=[^\n]+/,'CaptRAWToneBands_1='+value),adjustments:combo}));pass('invalid controls and malformed saved bands are rejected');
 // Matrix coefficients equal to a curve enum must remain matrix data on load.
 for(const [name,coefficient] of [['matrix-integer','2'],['matrix-neighbor','2.000000001']]){
  const profile=r.profile.replace(/CaptRAWWhiteBalanceMatrix_1=[^\n]+/,'CaptRAWWhiteBalanceMatrix_1='+coefficient+';0;0;0;1;0;0;0;1;');
  await engine.call('export',{path,artProfile:profile,output:join(out,name+'.tiff'),format:'tiff'});
 }
 pass('matrix coefficients are loaded as data without curve sanitization');
 const raw=[];for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){const source=resolve('build/samples',file),before=hash(source),img=await engine.call('open',{path:source,sessionId:file}),r=await render({...img.adjustments,masks:combo.masks},file);raw.push({file,fitMs:r.frame.elapsedMs,sourceUnchanged:hash(source)===before});
  if(file==='nikon-d850.NEF'){const f=await detail('raw',3000,2000,512,384);raw.at(-1).detailMs=f.elapsedMs;const times=[];for(let i=0;i<5;i++){++revision;times.push((await detail('raw-pan',3100+i*20,2050,512,384)).elapsedMs);}raw.at(-1).panP95Ms=times.sort((a,b)=>a-b).at(-1);await engine.call('export',{path:source,artProfile:r.profile,output:join(out,'raw.tiff'),format:'tiff'});cli(source,'raw-reference.tif',file);}
 }pass('Bayer NEF, CR3 and X-Trans render local tone; D850 detail, cached pan and 16-bit export complete');assert.equal(hash(path),sourceHash);assert(raw.every(r=>r.sourceUnchanged));
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,checks,raw},null,2)+'\n');
}finally{await engine.stop();}
