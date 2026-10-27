// Native SAM2 and desktop-side lifecycle tests. No Electron or GUI is launched.
import assert from 'node:assert/strict';
import {Segmenter} from '@captraw/desktop-core/segmentation';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,readdirSync,chmodSync,linkSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';
const root=resolve('.'),out=resolve('artifacts/segmentation-worker'),work=resolve('build/segmentation');mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const binary=join(work,'captraw-segment'),policy=resolve('tests/offline-native.sb');
process.env.CAPTRAW_SANDBOX_PROFILE=policy;
const wrapper=join(out,'offline-worker.sh'),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
writeFileSync(wrapper,`#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(policy)} ${quote(binary)} "$@"\n`);chmodSync(wrapper,0o755);
let revision=0;const cases=[],checks=[],nativeRows=[],hostRows=[];
for(const row of json('artifacts/segmentation/tiny-report.json').cases){
 const path=resolve('artifacts/segmentation-input/inputs',row.input.split('/').at(-1).replace('.jpg','-reference.png'));
 cases.push({name:row.case,path,...json('artifacts/segmentation-input/'+row.case+'-prompts.json')});
}
for(const [i,row]of json('artifacts/segmentation-input/engine-inputs.json').rows.entries()){
 const name='engine-'+['sky','apple','chart-box'][i];cases.push({name,path:row.input,...json('artifacts/segmentation-input/'+name+'-prompts.json')});
}
const request=(c=cases[0],extra={})=>({sessionId:c.name,revision:++revision,path:c.path,imageSha256:hash(c.path),width:c.width,height:c.height,points:structuredClone(c.points),labels:[...c.labels],...extra});
const check=name=>{checks.push(name);console.log('PASS',name);};
const archive=(r,model,name)=>{const saved=structuredClone(r);for(const c of saved.candidates){assert.equal(hash(c.file),c.sha256);const p=join(out,`${model}-${name}-${c.index}.png`);copyFileSync(c.file,p);c.file=p;}return saved;};
for(const model of ['tiny','small']){
 const engine=new EngineClient({executable:binary,resources:join(work,'models',model),cache:join(out,'native-'+model)});engine.on('error',()=>{});
 try{
  assert.equal((await engine.call('info')).cachedImages,0);let previous='';
  for(const c of cases){
   const p=request(c),result=await engine.call('predict',p);assert.equal(result.cached,p.imageSha256===previous);previous=p.imageSha256;
   nativeRows.push({model,name:c.name,request:p,result:archive(result,model,c.name)});
   const repeated=await engine.call('predict',{...p,revision:++revision});assert(repeated.cached);assert.equal(repeated.encodeMs,0);
   assert.deepEqual(repeated.candidates.map(x=>x.sha256),result.candidates.map(x=>x.sha256));
  }
  check(model+': eight cases, three candidates, repeat cache exact');
  const p=request(),first=await engine.call('predict',p),files=first.candidates.map(c=>[c.file,hash(c.file)]);
  for(const bad of [{imageSha256:'0'.repeat(64)},{width:p.width+1},{points:[[p.width+1,0]]},{labels:[1.5]},{points:[],labels:[]},{points:[[1,1]],labels:[2]},{points:[[2,2],[1,1]],labels:[2,3]},{revision:0}])await assert.rejects(engine.call('predict',{...p,...bad}));
  for(const [file,sha]of files)assert.equal(hash(file),sha);
  assert((await engine.call('predict',{...p,revision:++revision})).cached);
  await engine.call('close');assert.equal((await engine.call('info')).cachedImages,0);assert(!(await engine.call('predict',{...p,revision:++revision})).cached);
  check(model+': invalid requests preserve cache and output; close invalidates features');
 }finally{await engine.stop();}
}
let action=()=>{},stages=[];const cache=join(out,'host-cache');
const service=new Segmenter(wrapper,join(work,'models/tiny'),cache,event=>{stages.push(event);action(event);});
try{
 const input=request(),snapshot=structuredClone(input),pending=service.request(input);input.path='/missing';input.points[0][0]=0;
 const first=await pending;assert.equal(first.imageSha256,snapshot.imageSha256);assert.deepEqual(first.candidates.map(c=>c.sha256),nativeRows[0].result.candidates.map(c=>c.sha256));
 const pid=service.processId;assert(pid);const timings=[],residentBytes=[];
 for(let i=0;i<30;++i){const start=performance.now(),r=await service.request(request());timings.push(performance.now()-start);assert(r.cached);assert.equal(service.processId,pid);assert.equal(readdirSync(join(cache,readdirSync(cache)[0])).filter(p=>p.endsWith('.png')).length,3);if(i%5===0)residentBytes.push(Number(execFileSync('/bin/ps',['-o','rss=','-p',String(pid)],{encoding:'utf8'}).trim())*1024);}
 assert(first.candidates.every(c=>!existsSync(c.file)));hostRows.push({warmPromptCount:timings.length,wallMs:timings,p95Ms:[...timings].sort((a,b)=>a-b)[Math.ceil(.95*timings.length)-1],residentBytes});
 check('immutable request snapshot; resident worker; one retained candidate set; 30 warm prompts');
 await service.cancel();assert.equal(readdirSync(cache).length,0);
 // Supersede actual encoding, then replace the queued middle request before it executes.
 let middle,latest;const slow=request(),middleRequest=request(),latestRequest=request(cases[1]);
 action=e=>{if(e.revision===slow.revision&&e.stage==='encode'){middle=service.request(middleRequest);latest=service.request(latestRequest);}};
 await assert.rejects(service.request(slow),{name:'AbortError'});await assert.rejects(middle,{name:'AbortError'});const newest=await latest;action=()=>{};
 assert.equal(newest.revision,latestRequest.revision);assert(newest.cached);assert(!stages.some(s=>s.revision===middleRequest.revision));
 assert.equal(readdirSync(join(cache,readdirSync(cache)[0])).filter(p=>p.endsWith('.png')).length,3);check('superseded in-flight result removed; queued middle request never executes');
 for(const stage of ['encode','decode']){
  await service.cancel();let cancellation,killed;const p=request();
  action=e=>{if(e.revision===p.revision&&e.stage===stage){killed=service.processId;cancellation=service.cancel();}};
  await assert.rejects(service.request(p),{name:'AbortError'});await cancellation;action=()=>{};
  assert(killed);assert.throws(()=>process.kill(killed,0));assert.equal(readdirSync(cache).length,0);
  const next=await service.request(request());assert(!next.cached);assert.notEqual(service.processId,killed);check('cancel during '+stage+': process exits, cache removed, retry starts fresh');
 }
 await service.cancel();let stopping,replacement;const interrupted=request(),replacementRequest=request();
 action=e=>{if(e.revision===interrupted.revision&&e.stage==='encode'){stopping=service.cancel();replacement=service.request(replacementRequest);}};
 await assert.rejects(service.request(interrupted),{name:'AbortError'});await stopping;const replacementResult=await replacement;action=()=>{};
 assert.equal(replacementResult.revision,replacementRequest.revision);assert(replacementResult.candidates.every(c=>existsSync(c.file)));check('request during cancellation survives old worker cleanup');
 const current=await service.request(request()),crashed=service.processId;process.kill(crashed,'SIGKILL');
 // Wait on the actual child event rather than guessing a process-exit delay.
 await service.worker.closed;
 const recovered=await service.request(request());assert.notEqual(service.processId,crashed);assert(!recovered.cached);assert(current.candidates.every(c=>!existsSync(c.file)));check('unexpected worker exit restarts and clears orphaned masks');
 const mutable=join(out,'mutable input.png');copyFileSync(cases[0].path,mutable);const p=request(cases[0],{path:mutable});await service.request(p);
 writeFileSync(mutable,'changed');await assert.rejects(service.request({...p,revision:++revision}),/checksum mismatch/);
 rmSync(mutable);await assert.rejects(service.request({...p,revision:++revision}),/No such file/);
 copyFileSync(cases[0].path,mutable);assert((await service.request({...p,revision:++revision})).cached);rmSync(mutable);check('cached image still checks current file; deletion/change fail and restored input recovers');
 const dup=request();await service.request(dup);await assert.rejects(service.request(dup),/递增/);
 await service.cancel();const early=service.request(request());const done=service.cancel();await assert.rejects(early,{name:'AbortError'});await done;assert.equal(readdirSync(cache).length,0);check('duplicate revision rejected; queued cancellation starts no process');
}finally{await service.dispose();}
await assert.rejects(service.request(request()),/已关闭/);assert.equal(readdirSync(cache).length,0);
// Model bytes are checked against the manifest before parsing; no downloads.
const broken=join(out,'broken-models');mkdirSync(broken,{recursive:true});
for(const name of ['encoder.onnx','decoder.onnx']){const path=join(broken,name);if(!existsSync(path))linkSync(join(work,'models/tiny',name),path);}
copyFileSync(join(work,'models/tiny/manifest.json'),join(broken,'manifest.json'));writeFileSync(join(broken,'preprocess.onnx'),'corrupt');
for(const [name,exe,models,pattern]of [['corrupt-model',wrapper,broken,/checksum mismatch: preprocess/],['missing-executable',join(out,'nonexistent'),join(work,'models/tiny'),/ENOENT/]]){
 const s=new Segmenter(exe,models,join(out,name));try{await assert.rejects(s.request(request()),pattern);}finally{await s.dispose();}
 assert.equal(readdirSync(join(out,name)).length,0);check(name+': actionable error, no hung shutdown');
}
rmSync(broken,{recursive:true});
writeFileSync(join(out,'report.json'),JSON.stringify({offline:true,windowsLaunched:0,binarySHA256:hash(binary),checks,nativeRows,hostRows,stages},null,2)+'\n');console.log('PASS',checks.length,'worker and lifecycle groups');
