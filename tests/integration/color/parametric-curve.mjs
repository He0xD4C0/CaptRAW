import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
const out=resolve('artifacts/parametric-curve');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:'build/parametric-cache'}),checks=[];let revision=0;
const neutral={highlights:0,lights:0,darks:0,shadows:0,splits:[25,50,75]},mixed={highlights:-35,lights:40,darks:-20,shadows:30,splits:[20,48,80]};
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),pass=s=>{checks.push(s);console.log('PASS',s);};
async function render(adjustments,name,artProfile=''){const preview=engine.preview(++revision,'fit',120000);const result=await engine.call('update',{revision,adjustments,artProfile});const frame=await preview;cpSync(frame.file,join(out,name+'.png'));writeFileSync(join(out,name+'.arp'),result.artProfile);return {...result,frame,hash:hash(frame.file)};}
try{
 const samples=[];
 for(const splits of [[1,2,3],[1,50,99],[97,98,99],[25,50,75]])for(const sign of [-100,100])for(const key of ['highlights','lights','darks','shadows']){
  const settings={...neutral,[key]:sign,splits},r=await engine.call('parametricCurve',settings);
  assert.equal(r.samples.length,513);assert(r.samples.every(Number.isFinite));assert(r.samples.every(v=>v>=-1e-10&&v<=1+1e-10));
  assert(Math.abs(r.samples[0])<1e-10&&Math.abs(r.samples.at(-1)-1)<1e-10);assert(r.samples.some((v,i)=>sign*(v-i/512)>1e-5));samples.push({settings,samples:r.samples});
 }
 assert.deepEqual((await engine.call('parametricCurve',neutral)).samples,Array.from({length:513},(_,i)=>i/512));writeFileSync(join(out,'samples.json'),JSON.stringify(samples));pass('native parametric sampler covers four signed regions and extreme ordered boundaries');
 const path=resolve('build/samples/local-tone.png'),sourceHash=hash(path),img=await engine.call('open',{path,sessionId:'parametric'}),base=img.adjustments,baseline=await render(base,'baseline');
 const old=new EngineClient({cache:'build/parametric-old',executable:process.env.HOME+'/Applications/CaptRAW-0.13.app/Contents/Resources/native/captraw-engine',resources:process.env.HOME+'/Applications/CaptRAW-0.13.app/Contents/Resources/native/resources'});
 try{await old.call('open',{path,sessionId:'old'});const pending=old.preview(1),r=await old.call('update',{revision:1,adjustments:base});assert.equal(r.artProfile,baseline.artProfile);assert.equal(hash((await pending).file),baseline.hash);}finally{await old.stop();}
 const zero=await render({...base,parametricCurve:neutral},'neutral');assert.equal(zero.artProfile,baseline.artProfile);assert.equal(zero.hash,baseline.hash);pass('absent and zero parameters preserve exact 0.13 profiles and preview pixels');
 for(const key of ['highlights','lights','darks','shadows'])for(const sign of [-1,1]){const r=await render({...base,parametricCurve:{...neutral,[key]:sign*70}},key+(sign>0?'-up':'-down'));assert.notEqual(r.hash,baseline.hash);assert(r.artProfile.includes('CaptRAWParametric='));}
 pass('each positive and negative region changes actual pixels');
 const points=[{x:0,y:0},{x:.3,y:.2},{x:.7,y:.8},{x:1,y:1}],a={...base,curve:points,parametricCurve:mixed},combined=await render(a,'combined');
 assert.notEqual(combined.hash,(await render({...base,parametricCurve:mixed},'parametric-only')).hash);
 const pointOnly=await render({...base,curve:points},'point-only');assert.notEqual(combined.hash,pointOnly.hash);
 assert.equal((await render({...a,parametricCurve:neutral},'parametric-reset',combined.artProfile)).hash,pointOnly.hash);
 assert.equal((await render(base,'full-reset',combined.artProfile)).artProfile,baseline.artProfile);
 assert.equal((await render(a,'reload',combined.artProfile)).hash,combined.hash);pass('point and parametric curves compose independently, reset and reload without residue');
 const inherited=baseline.artProfile.replace('Curve2=0;','Curve2=1;0;0;0.5;0.65;1;1;');assert.notEqual(inherited,baseline.artProfile);
 const prior=await render(base,'inherited',inherited),both=await render(a,'inherited-combined',prior.artProfile);assert.deepEqual(both.artProfile.match(/^Curve2=(.*)$/m)[1].split(';').slice(0,-1).map(Number),[1,0,0,.5,.65,1,1]);assert.equal((await render(base,'inherited-reset',both.artProfile)).hash,prior.hash);pass('inherited second point curve remains intact');
 for(const invalid of [null,[],{...neutral,lights:101},{...neutral,shadows:'1'},{...neutral,splits:[0,50,75]},{...neutral,splits:[30,30,80]},{...neutral,splits:[40,20,80]},{...neutral,splits:[1,2]},{...neutral,splits:[1,null,99]}]){
  await assert.rejects(engine.call('parametricCurve',invalid));await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...base,parametricCurve:invalid}}));
 }pass('invalid regions and boundary ordering are rejected at both native interfaces');
 const raw=[];const reference=resolve('build/reference/Contents/MacOS/captraw-art-reference');cpSync('build/native/captraw-art-reference',reference);
 for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const source=resolve('build/samples',file),before=hash(source),image=await engine.call('open',{path:source,sessionId:file}),r=await render({...image.adjustments,curve:points,parametricCurve:mixed},file);
  await engine.call('export',{path:source,artProfile:r.artProfile,output:join(out,file+'.tiff'),format:'tiff'});
  execFileSync(reference,['-a','-o',join(out,file+'-reference.tif'),'-p',join(out,file+'.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:'pipe'});
  if(file==='nikon-d850.NEF'){const pending=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:3000,y:2000,width:512,height:384});const f=await pending;cpSync(f.file,join(out,'raw-detail.png'));writeFileSync(join(out,'raw-detail.json'),JSON.stringify(f));}
  assert.equal(hash(source),before);raw.push({file,fitMs:r.frame.elapsedMs,sourceUnchanged:true});
 }assert.equal(hash(path),sourceHash);pass('NEF, CR3 and X-Trans full TIFF16 plus D850 native 1:1 render');
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,checks,raw},null,2)+'\n');
}finally{await engine.stop();}
