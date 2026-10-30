// Serial 45 MP execution/cancellation evidence; run after the coordinated build.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {EngineClient} from '../../support/engine-client.mjs';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {BrushPreparation} from '@captraw/desktop-core/brush';
const option=(name,fallback)=>{const value=Number(process.argv.find(arg=>arg.startsWith('--'+name+'='))?.split('=')[1]??fallback);if(!Number.isInteger(value)||value<0||value>32)throw new Error('Invalid benchmark '+name);return value;};
const strokeCount=option('strokes',1),updates=option('updates',0);assert(strokeCount>=1);
const root=await mkdtemp(join(tmpdir(),'captraw-brush-45mp-')),python=resolve('build/qa-venv/bin/python'),path=join(root,'source.png');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const sha=b=>createHash('sha256').update(b).digest('hex'),engineSHA=sha(await readFile(binary));
if(process.env.CAPTRAW_BRUSH_ENGINE_SHA256)assert.equal(engineSHA,process.env.CAPTRAW_BRUSH_ENGINE_SHA256);
let core,service,passed=false,timer,started;const original=NativeEngine.prototype.call,metrics={width:8256,height:5504,engineSHA,peakWorkerRSSMiB:0};
try{
 execFileSync(python,['-c',"from PIL import Image,ImageDraw;import sys;im=Image.new('RGB',(8256,5504),(180,50,35));ImageDraw.Draw(im).rectangle((4128,0,8255,5503),fill=(30,145,190));im.save(sys.argv[1])",path]);const sourceSHA=sha(await readFile(path));
 core=new EngineClient({cache:join(root,'controller'),executable:binary,resources});const image=await core.call('open',{path,sessionId:'large-brush',effectsDefaults:'legacy',sourceFramePolicy:'active-area-v1'});
 let wait=core.preview(1,undefined,120000);const initial=await core.call('update',{revision:1,artProfile:image.artProfile,adjustments:image.adjustments});await wait;
 const ref=(await core.call('coordinates',{sessionId:image.id,revision:1,from:'display',to:'reference',points:[{x:3302,y:2752}],geometryReference:'current'})).geometryReference;
 const stroke={id:'complete',gestureId:'large',operation:'paint',flow:35,density:65,feather:30,canvas:{width:8256,height:5504},points:[{x:.35,y:.5,radius:.12},{x:.45,y:.5,radius:.12}],geometryReference:ref,autoMask:{model:'art-deltae-seed-v1',tolerance:10}};
 const mask=s=>({id:'mask',name:'large',type:'brush',enabled:true,inverted:false,initialized:true,feather:30,brightness:1,contrast:0,saturation:0,points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},brush:{version:1,strokes:Array.isArray(s)?s:[s]}});
 // Native validation of a 100 MP vector canvas does not allocate a 100 MP RGB fixture.
 const largeVector={...stroke,canvas:{width:10000,height:10000},autoMask:false};
 const validation=await core.call('compose',{width:10000,height:10000,path,artProfile:initial.artProfile,adjustments:{...image.adjustments,masks:[mask(largeVector)]}});assert(validation.artProfile.includes('CaptRAWBrushProgramV1'));
 service=new BrushPreparation(binary,resources,join(root,'tasks'),()=>core);
 NativeEngine.prototype.call=function(method,p){const result=original.call(this,method,p);if(method==='prepareBrush')started?.();return result;};
 timer=setInterval(()=>{for(const job of service.jobs.values()){const pid=job.worker?.child.pid;if(!pid)continue;try{const rss=Number(execFileSync('/bin/ps',['-o','rss=','-p',String(pid)],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));metrics.peakWorkerRSSMiB=Math.max(metrics.peakWorkerRSSMiB,rss/1024);}catch{}}},100);
 let time=performance.now();const result=await service.prepare(image,{id:'complete',sessionId:image.id,revision:1,stroke},image.adjustments,initial.artProfile,async()=>{});metrics.prepareMilliseconds=Math.round(performance.now()-time);assert(result?.coverage);metrics.assetBytes=(await stat(result.coverage.path)).size;assert(metrics.assetBytes<=256*1024*1024);
 const strokes=[result];metrics.preparationMilliseconds=[metrics.prepareMilliseconds];
 for(let i=1;i<strokeCount;++i){
  const next={...stroke,id:'actual-stroke-'+i,gestureId:'actual-gesture-'+i,points:stroke.points.map(p=>({...p,x:p.x+i*.007}))};time=performance.now();
  const prepared=await service.prepare(image,{id:next.id,sessionId:image.id,revision:1,stroke:next},image.adjustments,initial.artProfile,async()=>{});assert(prepared?.coverage);metrics.preparationMilliseconds.push(Math.round(performance.now()-time));strokes.push(prepared);
 }
 metrics.actualAutoMaskStrokeCount=strokes.length;service.adopt({...image.adjustments,masks:[mask(strokes)]});
 time=performance.now();wait=core.preview(2,undefined,120000);await core.call('update',{revision:2,artProfile:initial.artProfile,adjustments:{...image.adjustments,masks:[mask(strokes)]},maskId:'mask'});const frame=await wait;metrics.replayMilliseconds=Math.round(performance.now()-time);assert(frame.mask);
 if(updates){
  metrics.repeatedUpdatesMilliseconds=[];
  for(let i=0;i<updates;++i){const revision=3+i;time=performance.now();wait=core.preview(revision,undefined,120000);await core.call('update',{revision,artProfile:initial.artProfile,adjustments:{...image.adjustments,masks:[{...mask(strokes),brightness:.5+i*.1}]},maskId:'mask'});await wait;metrics.repeatedUpdatesMilliseconds.push(Math.round(performance.now()-time));}
  metrics.repeatedUpdateP95Milliseconds=[...metrics.repeatedUpdatesMilliseconds].sort((a,b)=>a-b)[Math.ceil(.95*updates)-1];
 }
 let signal;const entered=new Promise(done=>{signal=done;});started=signal;
 const cancelStroke={...stroke,id:'cancel',points:[{x:.35,y:.5,radius:1.4},{x:.6,y:.5,radius:1.4}]};
 const pending=service.prepare(image,{id:'cancel',sessionId:image.id,revision:2+updates,stroke:cancelStroke},image.adjustments,initial.artProfile,async()=>{});
 await Promise.race([entered,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(Error('45 MP prepare did not start')),120000);entered.finally(()=>clearTimeout(timeout));})]);await new Promise(done=>setTimeout(done,200));
 time=performance.now();await service.cancel('cancel');assert.equal(await pending,null);metrics.cancelMilliseconds=Math.round(performance.now()-time);
 assert.deepEqual(await readdir(join(root,'tasks','brush')),[]);const assets=await readdir(join(root,'tasks','document-assets'));assert.deepEqual(assets.sort(),[...new Set(strokes.map(s=>s.coverage.sha256+'.png'))].sort());assert.equal(sha(await readFile(result.coverage.path)),result.coverage.sha256);assert.equal(sha(await readFile(path)),sourceSHA);assert.equal(sha(await readFile(binary)),engineSHA);
 passed=true;console.log(JSON.stringify({metrics,evidence:['45 MP real native preparation and scalar replay','cancel while a real full-resolution prepare RPC is running','no staging or late unadopted assets','100 MP vector canvas accepted by native compose'],limits:['Synthetic 45 MP PNG source; this does not prove a particular camera RAW decoder or ACR equivalence. RSS samples exclude GPU allocation.']},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),metrics,diagnostics:core?.diagnostics},null,2));throw error;}
finally{clearInterval(timer);NativeEngine.prototype.call=original;await service?.cancel();await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained latest 45 MP brush failure:',root);}
