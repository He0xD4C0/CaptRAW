import {BatchExporter,validateBatch} from '@captraw/desktop-core/batch-export';import {EngineClient} from './engine-client.mjs';import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,rmSync,copyFileSync} from 'node:fs';import {resolve,join} from 'node:path';import {homedir} from 'node:os';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const out=resolve(process.env.CAPTRAW_BATCH_OUT||'artifacts/batch-export');mkdirSync(out,{recursive:true});
const binary=process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine'),resources=process.env.CAPTRAW_RESOURCES||resolve('build/native/resources');
const old=join(homedir(),'Applications/CaptRAW-0.21.app/Contents/Resources/native'),reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference')});
const setup=new EngineClient({executable:binary,resources,cache:join(out,'setup')}),checks=[],sources={},pairs=[],snapshots=[];let revision=0,events=[],onJob=()=>{};
const queue=new BatchExporter(binary,resources,join(out,'queue'),job=>{events.push(job);onJob(job);});
const pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const directory=name=>{const p=join(out,name);rmSync(p,{recursive:true,force:true});mkdirSync(p,{recursive:true});return p;};
try{
 for(const [i,file] of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF'].entries()){
  const path=resolve('build/samples',file);sources[path]=hash(path);const image=await reference.call('open',{path,sessionId:file});
  let p=reference.preview(++revision);const stale=await reference.call('update',{revision,adjustments:{...image.adjustments,exposure:-1.1}});await p;
  const artProfile=stale.artProfile.replace('HorizontalFlip=false','HorizontalFlip=true');
  const adjustments={...image.adjustments,exposure:.4+i*.2,contrast:9,saturation:7,rotation:90,crop:{x:.12,y:.14,width:.15,height:.17},curve:[{x:0,y:0},{x:.3,y:.4},{x:.7,y:.78},{x:1,y:1}],texture:2,clarity:3,masks:[{id:'m',name:'亮度范围',type:'luminance',enabled:true,inverted:false,feather:0,brightness:.2,contrast:3,saturation:5,points:[],start:{x:0,y:0},end:{x:1,y:1},luminanceRange:[10,25,65,80]}],spots:[{id:'s',name:'仿制',enabled:true,method:'clone',radius:20,feather:30,opacity:70,detail:0,source:{x:.2,y:.2},target:{x:.3,y:.3}}]};
  p=reference.preview(++revision);const expected=await reference.call('update',{revision,adjustments,artProfile});await p;
  const doc={path,width:image.width,height:image.height,adjustments,artProfile};snapshots.push(doc);
  assert.equal((await setup.call('compose',doc)).artProfile,expected.artProfile);
  const independent=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'independent-'+i)});
  try{await independent.call('export',{path,artProfile:expected.artProfile,output:join(out,`reference-${i}.tiff`),format:'tiff',colorSpace:'prophoto-rgb'});}finally{await independent.stop();}
 }
 pass('compose exactly matches the 0.21 staged profile for NEF, CR3 and RAF, preserving unknown ART fields and current crop/masks/curves over stale profiles');
 const request={documents:snapshots,format:'tiff',colorSpace:'prophoto-rgb'},dest=directory('三种 RAW 输出');
 const sentinel=join(dest,'nikon-d850_CaptRAW.tiff');writeFileSync(sentinel,'keep existing output');
 const results=await queue.run(request,dest);assert.equal(events.at(-1).state,'done');assert.equal(results.length,3);assert(results.every(r=>r.output&&!r.error));assert.equal(readFileSync(sentinel,'utf8'),'keep existing output');
 for(const [i,r]of results.entries())pairs.push({actual:r.output,expected:join(out,`reference-${i}.tiff`)});
 assert(results[0].output.endsWith('_1.tiff'));assert(!readdirSync(dest).some(n=>n.endsWith('.tmp')));pass('three real RAW TIFF16 exports finish with ordered per-file results and collision-safe atomic publication');
 const png=resolve('build/samples/luminance-range.png');sources[png]=hash(png);const image=await setup.call('open',{path:png,sessionId:'png'});const base={path:png,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:image.adjustments};
 const inputs=directory('same-name-input');for(const n of ['一','二']){mkdirSync(join(inputs,n));copyFileSync(png,join(inputs,n,'相同 名称.png'));}
 const docs=['一','二'].map(n=>({...structuredClone(base),path:join(inputs,n,'相同 名称.png')}));
 events=[];const duplicateResult=await queue.run({documents:docs,format:'jpeg',colorSpace:'display-p3'},directory('同名照片'));assert.equal(new Set(duplicateResult.map(r=>r.output)).size,2);assert(duplicateResult.every(r=>r.output));pass('different source folders with the same Chinese basename export to distinct JPEG files');
 const mixed={documents:[docs[0],{...structuredClone(base),path:join(inputs,'missing.NEF')},docs[1]],format:'tiff',colorSpace:'srgb'};
 events=[];const mixedResults=await queue.run(mixed,directory('error-continue'));assert(mixedResults[0].output&&mixedResults[1].error&&mixedResults[2].output);assert.equal(events.at(-1).state,'error');assert.equal(events.at(-1).results.length,3);pass('a missing middle source reports its error while subsequent files continue and completed outputs remain');
 const mutable={documents:[structuredClone(base)],format:'tiff',colorSpace:'srgb'};const expectedProfile=(await setup.call('compose',mutable.documents[0])).artProfile;
 const snapshotDir=directory('snapshot');const pending=queue.run(mutable,snapshotDir);mutable.documents[0].adjustments.exposure=4;mutable.documents[0].path=join(inputs,'missing.png');const captured=await pending;assert(captured[0].output);
 const fresh=new EngineClient({executable:binary,resources,cache:join(out,'snapshot-reference')});try{await fresh.call('export',{path:png,artProfile:expectedProfile,output:join(out,'snapshot-reference.tiff'),format:'tiff',colorSpace:'srgb'});}finally{await fresh.stop();}
 pairs.push({actual:captured[0].output,expected:join(out,'snapshot-reference.tiff')});pass('in-flight batch retains its initial immutable document snapshot');
 let cancelOnce=false;events=[];onJob=job=>{if(job.state==='running'&&job.message.includes('2/3')&&!cancelOnce){cancelOnce=true;queue.cancel();}};
 const cancelled=await queue.run({documents:[base,snapshots[0],snapshots[1]],format:'tiff',colorSpace:'srgb'},directory('cancel-after-first'));onJob=()=>{};
 assert.equal(cancelled.length,1);assert(cancelled[0].output);assert.equal(events.at(-1).state,'cancelled');assert.equal(events.at(-1).results.length,1);assert(!readdirSync(join(out,'cancel-after-first')).some(n=>n.endsWith('.tmp')));pass('cancelling after the first completion retains exactly that file and cleans temporary output');
 const fullRaw={...structuredClone(snapshots[0]),adjustments:{...structuredClone(snapshots[0].adjustments),crop:null}};
 let interrupted=false;onJob=job=>{if(job.state==='running'&&job.message.includes('2/3')&&job.progress>1/3&&!interrupted){interrupted=true;queue.cancel();}};
 const midCancel=await queue.run({documents:[base,fullRaw,snapshots[1]],format:'tiff',colorSpace:'srgb'},directory('cancel-processing'));onJob=()=>{};
 assert(interrupted);assert.equal(midCancel.length,1);assert.equal(events.at(-1).state,'cancelled');assert(!readdirSync(join(out,'cancel-processing')).some(n=>n.endsWith('.tmp')));pass('cancellation during actual full-resolution RAW processing kills the active worker and skips subsequent files');
 let crashed=false;onJob=job=>{if(job.state==='running'&&job.progress>0&&!crashed){crashed=true;queue.worker.child.kill('SIGKILL');}};
 const crashedResults=await queue.run({documents:[fullRaw,base],format:'tiff',colorSpace:'srgb'},directory('worker-crash'));onJob=()=>{};
 assert(crashed&&crashedResults[0].error&&crashedResults[1].output);assert(!readdirSync(join(out,'worker-crash')).some(n=>n.endsWith('.tmp')));pass('an abnormal worker exit becomes a per-file error and the next file succeeds in a fresh process');
 const unavailable=join(out,'unavailable-cache');writeFileSync(unavailable,'not a directory');const fatalEvents=[];
 const broken=new BatchExporter(binary,resources,unavailable,j=>fatalEvents.push(j));await assert.rejects(()=>broken.run({documents:[base],format:'tiff',colorSpace:'srgb'},directory('fatal-output')));
 assert.equal(fatalEvents.at(-1).state,'error');assert.equal(broken.active,false);pass('worker startup or cache failure ends the job with a visible terminal error and releases the export lock');
 const collision=join(out,'atomic-existing.tiff'),temp=join(out,'atomic-new.tmp');writeFileSync(collision,'original');writeFileSync(temp,'new');assert.equal(await setup.call('publish',{temporary:temp,destination:collision}),false);assert.equal(readFileSync(collision,'utf8'),'original');assert.equal(readFileSync(temp,'utf8'),'new');rmSync(collision);assert.equal(await setup.call('publish',{temporary:temp,destination:collision}),true);assert.equal(readFileSync(collision,'utf8'),'new');assert(!existsSync(temp));pass('atomic publication refuses an existing destination without modifying either file');
 for(const invalid of [{...request,format:'png'},{...request,colorSpace:'hdr-pq'},{...request,documents:[base,base]},{...request,documents:[{...base,width:0}]}])assert.throws(()=>validateBatch(invalid));
 await assert.rejects(()=>setup.call('compose',{...base,width:0}),/dimensions/);for(const[path,checksum]of Object.entries(sources))assert.equal(hash(path),checksum);pass('invalid requests and dimensions are rejected; all source image hashes remain unchanged');
}finally{await setup.stop();await reference.stop();queue.shutdown();writeFileSync(join(out,'report.json'),JSON.stringify({checks,sources,pairs,engine:binary},null,2)+'\n');}

