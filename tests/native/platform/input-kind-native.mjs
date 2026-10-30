import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const capture=process.argv.includes('--capture');
const scratch=capture?await mkdtemp(join(tmpdir(),'captraw-input-kind-')):process.env.CAPTRAW_INPUT_KIND_SCRATCH;
if(!scratch)throw new Error('Capture the current baseline with --capture, then set CAPTRAW_INPUT_KIND_SCRATCH.');
if(capture)execFileSync('build/qa-venv/bin/python',['tests/fixtures/generators/input-kind-fixtures.py',scratch],{stdio:'inherit'});
const fixtures=JSON.parse(await readFile(join(scratch,'fixtures.json'))),engine=new EngineClient({cache:join(scratch,capture?'old-cache':'new-cache')});engine.on('error',()=>{});
async function inspect(row,index){
 const id='input-kind-'+index;let timer,listener;
 const preview=new Promise(resolve=>{
  listener=({frame})=>{if(frame.sessionId===id&&frame.kind==='fit'){clearTimeout(timer);engine.off('preview',listener);resolve(frame);}};
  engine.on('preview',listener);timer=setTimeout(()=>{engine.off('preview',listener);resolve(null);},60000);
 });
 try{
  const image=await engine.call('open',{path:row.path,sessionId:id});
  const rendered=await engine.call('update',{revision:index+1,adjustments:image.adjustments,artProfile:image.artProfile});
  const frame=await preview;
  assert(frame,'successful decode did not produce a real preview: '+row.path);
  return {image,renderedProfile:rendered.artProfile,previewHash:hash(await readFile(frame.file)),previewSize:[frame.width,frame.height]};
 }finally{clearTimeout(timer);engine.off('preview',listener);}
}
let passed=false;
try{
 const before=Object.fromEntries(await Promise.all(fixtures.map(async row=>[row.path,hash(await readFile(row.path))])));
 if(capture){
  const records=[];
  for(const [index,row] of fixtures.entries()){
   try{records.push(await inspect(row,index));console.log('BASELINE opened',row.path);}catch(error){if(!row.historical)throw error;assert.match(error.message,/错误码 -2/);records.push({error:error.message});console.log('BASELINE historical decoder boundary',row.path,error.message);}
  }
  await writeFile(join(scratch,'baseline.json'),JSON.stringify({before,records}));console.log('INPUT_KIND_BASELINE',scratch);
 }else{
  const baseline=JSON.parse(await readFile(join(scratch,'baseline.json')));assert.deepEqual(before,baseline.before);
  let classified=0,historicalBoundaries=0;
  for(const [index,row] of fixtures.entries()){
   let actual;try{actual=await inspect(row,index);}catch(error){
    if(!row.historical||!baseline.records[index].error)throw error;
    assert.equal(error.message,baseline.records[index].error);historicalBoundaries++;
    console.log('PASS historical primary is LinearRaw; existing decoder rejection unchanged',JSON.stringify(row.evidence));continue;
   }
   assert.equal(actual.image.inputKind,row.expected,row.path);classified++;
   if(!baseline.records[index].error){
    const {inputKind,...oldProjection}=actual.image;assert.deepEqual(oldProjection,baseline.records[index].image,'classification changed another open field or recipe: '+row.path);
    assert.equal(actual.renderedProfile,baseline.records[index].renderedProfile,'rendered recipe changed: '+row.path);
    assert.equal(actual.previewHash,baseline.records[index].previewHash,'preview pixels changed: '+row.path);assert.deepEqual(actual.previewSize,baseline.records[index].previewSize);
   }
   console.log('PASS decoded inputKind, unchanged open recipe and preview',row.expected,row.path);
  }
  assert.deepEqual(Object.fromEntries(await Promise.all(fixtures.map(async row=>[row.path,hash(await readFile(row.path))]))),before);
  console.log('PASS input classification acceptance',JSON.stringify({classified,historicalBoundaries,allSourceHashesUnchanged:true}));passed=true;
 }
}catch(error){console.error('Retained failure:',scratch);throw error;}finally{await engine.stop();if(passed){await rm(scratch,{recursive:true,force:true});console.log('PASS scratch removed');}}
