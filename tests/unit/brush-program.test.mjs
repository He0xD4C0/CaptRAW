import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,link} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateBrushPrograms,ENGINE_VERSION} from '@captraw/contracts';
import {encodeAdjustments,decodeAdjustments,CT,CRS,readExtension} from '@captraw/desktop-core/documents';
import {BrushPreparation} from '@captraw/desktop-core/editing';
const stroke=()=>({id:'stroke',gestureId:'gesture',operation:'paint',flow:27,density:63,feather:30,canvas:{width:40,height:30},points:[{x:.4,y:.5,radius:.2},{x:.6,y:.5,radius:.2}],geometryReference:{version:1,data:'opaque-native-transform'},autoMask:false});
const mask=s=>({id:'mask',name:'画笔',type:'brush',enabled:true,inverted:false,feather:30,points:[],start:{x:.5,y:.5},end:{x:.5,y:.5},brightness:1,contrast:0,saturation:0,brush:{version:1,strokes:[s]}});
test('versioned brush parameters use typed vendor RDF and preserve absent legacy fields',()=>{
 const legacy=mask(stroke());delete legacy.brush;legacy.points=[{x:.2,y:.5,radius:.3,erase:false}];
 assert.deepEqual(decodeAdjustments(encodeAdjustments({masks:[legacy]})).adjustments.masks,[legacy]);
 const m=mask(stroke()),properties=encodeAdjustments({masks:[m]});assert.deepEqual(decodeAdjustments(properties).adjustments.masks,[m]);
 assert.deepEqual(readExtension(properties,'ARTAdjustments').masks[0].brush,m.brush);
 assert(properties.some(p=>p.ns===CT&&p.name==='ARTAdjustments'&&p.node.fields));
 assert(!properties.some(p=>p.ns===CRS&&/flow|density|dabs/i.test(p.name)));
});
test('AutoMask requires frozen coverage, and parameters and dimensions are validated',()=>{
 const s=stroke();s.autoMask={model:'art-deltae-seed-v1',tolerance:10,seed:{l:50,c:20,h:30,point:{x:.4,y:.5}}};
 assert.throws(()=>validateBrushPrograms([mask(s)]),/覆盖率/);
 s.coverage={path:'captraw-mask:'+'a'.repeat(64),sha256:'a'.repeat(64),width:40,height:30};assert.doesNotThrow(()=>validateBrushPrograms([mask(s)]));
 for(const change of [{flow:-1},{density:101},{flow:NaN},{operation:'add'},{coverage:{...s.coverage,width:41}},{autoMask:{...s.autoMask,seed:undefined}}])assert.throws(()=>validateBrushPrograms([mask({...s,...change})]));
 assert.throws(()=>validateBrushPrograms([mask({...s,points:[{x:.4,y:.5,radius:.2,erase:true}]})]));
});
test('vector authoring canvas accepts 100 MP and retains the existing 512 MP image budget',()=>{
 assert.doesNotThrow(()=>validateBrushPrograms([mask({...stroke(),canvas:{width:10000,height:10000}})]));
 assert.doesNotThrow(()=>validateBrushPrograms([mask({...stroke(),canvas:{width:32000,height:16000}})]));
 assert.throws(()=>validateBrushPrograms([mask({...stroke(),canvas:{width:32000,height:16001}})]),/画布/);
});

// This fake protocol isolates lease/cancellation tests. It makes no pixel claims.
async function fixture(run){
 const root=await mkdtemp(join(tmpdir(),'captraw-brush-service-'));let passed=false,service;
 try{
  const binary=join(root,'worker.mjs');await writeFile(binary,`#!/usr/bin/env node
import {createInterface} from 'node:readline';import {writeFile} from 'node:fs/promises';
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');send({event:'ready',engineVersion:${JSON.stringify(ENGINE_VERSION)}});
createInterface({input:process.stdin}).on('line',async line=>{const q=JSON.parse(line);try{let result={};if(q.method==='prepareBrush'){if(q.params.stroke.flow===0){await writeFile(q.params.output+'.started','');await new Promise(()=>{});}await writeFile(q.params.output,Buffer.from('frozen-unit-coverage'));result={width:40,height:30,seed:{l:50,c:20,h:30,point:{x:.4,y:.5}}};}send({id:q.id,result});}catch(e){send({id:q.id,error:String(e)});}});
`,{mode:0o700});
  let hold,entered;const gate=()=>new Promise(done=>{hold=done;}),publishing=()=>new Promise(done=>{entered=done;});
  const core={async call(method,p){assert.equal(method,'publish');try{await link(p.temporary,p.destination);}catch(e){if(e.code==='EEXIST')return false;throw e;}if(entered){entered();await gate();}await rm(p.temporary,{force:true});return true;}};
  service=new BrushPreparation(binary,root,root,()=>core);
  const image={id:'session',path:join(root,'source.png')},a={masks:[]},request=id=>({id,sessionId:image.id,revision:1,stroke:{...stroke(),id,autoMask:{model:'art-deltae-seed-v1',tolerance:10}}});
  await run({root,service,image,a,request,publishing,release:()=>hold?.()});passed=true;
 }finally{await service?.cancel();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained latest brush service failure:',root);}
}
const check=async()=>{};
test('cancel before worker completion removes staging and returns no stroke',()=>fixture(async({root,service,image,a,request})=>{
 const r=request('cancel');r.stroke.flow=0;
 const run=service.prepare(image,r,a,'',check);let started=false;
 for(let i=0;i<200&&!started;++i){for(const dir of await readdir(join(root,'brush')).catch(()=>[]))started=!!await readFile(join(root,'brush',dir,'coverage.png.started')).then(()=>true,()=>false);if(!started)await new Promise(done=>setTimeout(done,10));}
 assert(started,'The real child protocol must enter preparation before cancellation');await service.cancel(r.id);assert.equal(await run,null);
 assert.deepEqual(await readdir(join(root,'brush')).catch(()=>[]),[]);assert.deepEqual(await readdir(join(root,'document-assets')).catch(()=>[]),[]);
}));
test('cancel during atomic publication cleans the late asset',()=>fixture(async({root,service,image,a,request,publishing,release})=>{
 const atPublish=publishing(),run=service.prepare(image,request('late'),a,'',check);await atPublish;
 const cancel=service.cancel('late');release();await cancel;assert.equal(await run,null);assert.deepEqual(await readdir(join(root,'document-assets')),[]);
}));
test('source validation failure propagates and publishes no asset',()=>fixture(async({root,service,image,a,request})=>{
 await assert.rejects(service.prepare(image,request('changed'),a,'',check,async()=>{throw new Error('source changed');}),/source changed/);
 assert.deepEqual(await readdir(join(root,'brush')),[]);assert.deepEqual(await readdir(join(root,'document-assets')),[]);
}));
test('cancelling a delivered but unadopted result removes its lease asset',()=>fixture(async({root,service,image,a,request})=>{
 const result=await service.prepare(image,request('delivered'),a,'',check);assert((await readFile(result.coverage.path)).length);
 await service.cancel('delivered');assert.deepEqual(await readdir(join(root,'document-assets')),[]);assert.deepEqual(await readdir(join(root,'brush')),[]);
}));
test('shared leases and adoption keep immutable assets alive, without transient directories',()=>fixture(async({root,service,image,a,request})=>{
 const first=await service.prepare(image,request('first'),a,'',check),second=await service.prepare(image,request('second'),a,'',check);
 assert.equal(first.coverage.path,second.coverage.path);await service.cancel('first');assert((await readFile(second.coverage.path)).length);
 service.adopt({masks:[mask(second)]});await service.cancel('second');service.adopt({masks:[]});await service.cancel();assert((await readFile(second.coverage.path)).length);
 assert.deepEqual(await readdir(join(root,'brush')),[]);
}));
test('Undo before the first rendered update keeps the completed lease available to Redo',()=>fixture(async({service,image,a,request})=>{
 const result=await service.prepare(image,request('history-before-render'),a,'',check);
 service.adopt({masks:[]});await service.invalidate();assert((await readFile(result.coverage.path)).length);
 service.adopt({masks:[mask(result)]});await service.cancel(result.id);assert((await readFile(result.coverage.path)).length);
}));
test('session completion cannot delete assets held by an independent export snapshot',()=>fixture(async({service,image,a,request})=>{
 const result=await service.prepare(image,request('export-snapshot'),a,'',check),snapshot=structuredClone({masks:[mask(result)]});
 service.adopt(snapshot);service.adopt({masks:[]});await service.invalidate();await service.cancel();
 assert((await readFile(snapshot.masks[0].brush.strokes[0].coverage.path)).length);
}));
