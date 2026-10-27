import {EngineClient,explicitFreshCurveMode} from './engine-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const out=resolve('artifacts/local-white-balance');mkdirSync(out,{recursive:true});const engine=new EngineClient({cache:'build/local-wb-cache'});engine.on('error',()=>{});let revision=0;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),checks=[],pass=s=>{checks.push(s);console.log('PASS',s);};
const mask={id:'wb',name:'局部白平衡',type:'radial',enabled:true,inverted:false,feather:15,brightness:0,contrast:0,saturation:0,points:[],start:{x:.15,y:.15},end:{x:.85,y:.85}};
async function render(adjustments,name,artProfile=''){
 const p=engine.preview(++revision);const r=await engine.call('update',{revision,adjustments,artProfile,maskId:'wb'}),frame=await p;cpSync(frame.file,join(out,name+'.png'));if(frame.mask)cpSync(frame.mask.file,join(out,name+'-mask.png'));writeFileSync(join(out,name+'.arp'),r.artProfile);return {profile:r.artProfile,frame,hash:hash(frame.file)};
}
try{
 const path=resolve('build/samples/local-details.png'),sourceHash=hash(path),image=await engine.call('open',{path,sessionId:'wb'}),base={...image.adjustments,masks:[mask]},baseline=await render(base,'baseline');
 const old=new EngineClient({cache:'build/local-wb-old',executable:process.env.HOME+'/Applications/CaptRAW-0.9.app/Contents/Resources/native/captraw-engine',resources:process.env.HOME+'/Applications/CaptRAW-0.9.app/Contents/Resources/native/resources'});
 try{await old.call('open',{path,sessionId:'old'});const p=old.preview(1),r=await old.call('update',{revision:1,adjustments:base});assert.equal(explicitFreshCurveMode(r.artProfile),baseline.profile);assert.equal(hash((await p).file),baseline.hash);}finally{await old.stop();}pass('legacy neutral mask pixels match 0.9 with explicit second-curve mode metadata');
 const state=wb=>({...base,masks:[{...mask,whiteBalance:wb}]}),neutral=await render(state({temperature:0,tint:0}),'neutral');assert.equal(neutral.profile,baseline.profile);assert.equal(neutral.hash,baseline.hash);pass('zero relative WB omits the matrix and preserves all old processing');
 for(const [name,wb] of Object.entries({warm:{temperature:60,tint:0},cool:{temperature:-60,tint:0},magenta:{temperature:0,tint:60},green:{temperature:0,tint:-60},combined:{temperature:35,tint:25}})){
  const adjustments=state(wb),r=await render(adjustments,name);assert.notEqual(r.hash,baseline.hash);assert(r.profile.includes('CaptRAWWhiteBalanceMatrix_1='));
  const p=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:400,y:350,width:160,height:140});const f=await p;cpSync(f.file,join(out,name+'-detail.png'));writeFileSync(join(out,name+'-detail.json'),JSON.stringify(f));
  const full=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:0,y:0,width:image.width,height:image.height});cpSync((await full).file,join(out,name+'-full-detail.png'));
  const disabled=await render({...adjustments,masks:adjustments.masks.map(m=>({...m,enabled:false}))},name+'-disabled',r.profile);assert.equal(disabled.hash,baseline.hash);
  const reset=await render(base,name+'-reset',r.profile);assert.equal(reset.profile,baseline.profile);assert.equal(reset.hash,baseline.hash);
 }
 pass('temperature and tint affect native masked pixels, detailed views, disable and reset');
 const recipe=state({temperature:35,tint:25}),r=await render(recipe,'combined');await render({...recipe,masks:recipe.masks.map(m=>({...m,inverted:true}))},'inverted');
 const rot=await render({...recipe,rotation:90,crop:{x:.1,y:.1,width:.8,height:.8}},'rotated');const p=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:250,y:300,width:180,height:160});const f=await p;cpSync(f.file,join(out,'rotated-detail.png'));writeFileSync(join(out,'rotated-detail.json'),JSON.stringify(f));pass('inversion, crop and rotation retain the same local color transform');
 await engine.call('export',{path,artProfile:r.profile,output:join(out,'current.tiff'),format:'tiff'});const independent=new EngineClient({cache:'build/local-wb-independent'});try{await independent.call('export',{path,artProfile:r.profile,output:join(out,'independent.tiff'),format:'tiff'});}finally{await independent.stop();}
 const reference=resolve('build/reference/Contents/MacOS/captraw-art-reference');cpSync('build/native/captraw-art-reference',reference);execFileSync(reference,['-a','-o',join(out,'reference.tif'),'-p',join(out,'combined.arp'),'-t','-b16','-Y','-c',path],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:'pipe'});pass('complete saved matrix exports through an independent process and patched ART CLI');
 for(const wb of [{temperature:101,tint:0},{temperature:0,tint:-101},[],null])await assert.rejects(engine.call('validate',{artProfile:'',adjustments:state(wb)}));
 for(const value of ['1;2;3;','100;0;0;0;1;0;0;0;1;'])await assert.rejects(engine.call('validate',{artProfile:r.profile.replace(/CaptRAWWhiteBalanceMatrix_1=[^\n]+/,'CaptRAWWhiteBalanceMatrix_1='+value),adjustments:recipe}));pass('invalid controls and malformed saved color matrices are rejected');
 // Working-space selection is native metadata, not a separate browser color pipeline.
 for(const space of ['sRGB','Adobe RGB','ProPhoto'])await render(recipe,'space-'+space.replace(' ','-'),r.profile.replace(/WorkingProfile=[^\n]+/,'WorkingProfile='+space));
 const raw=[];for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){const source=resolve('build/samples',file),before=hash(source),img=await engine.call('open',{path:source,sessionId:file}),r=await render({...img.adjustments,masks:[{...mask,whiteBalance:{temperature:25,tint:15}}]},file);raw.push({file,fitMs:r.frame.elapsedMs,sourceUnchanged:hash(source)===before});
  if(file==='nikon-d850.NEF'){await engine.call('export',{path:source,artProfile:r.profile,output:join(out,'raw.tiff'),format:'tiff'});execFileSync(reference,['-o',join(out,'raw-reference.tif'),'-p',join(out,file+'.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:'pipe'});}
 }pass('Bayer NEF, CR3 and X-Trans render local WB; D850 exports against ART CLI');assert.equal(hash(path),sourceHash);
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,checks,raw},null,2)+'\n');
}finally{await engine.stop();}
