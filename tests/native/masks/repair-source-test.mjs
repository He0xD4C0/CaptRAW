import {EngineClient} from '../../support/engine-client.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../../..'),out=mkdtempSync(join(tmpdir(),'captraw-repair-source-'));
const executable=process.env.CAPTRAW_REPAIR_ENGINE||join(root,'build/native/captraw-engine');
const engine=new EngineClient({executable,resources:join(root,'build/native/resources'),cache:join(out,'cache')});
engine.on('error',()=>{});
let passed=false,revision=0;
const checks=[];
try{
 execFileSync(process.env.CAPTRAW_REPAIR_PYTHON||join(root,'build/qa-venv/bin/python'),['-c',
  "from PIL import Image\nimport sys\na=Image.new('RGB',(320,240));a.putdata([(70+x//4,85+y//4,90+(x+y)%31) for y in range(240) for x in range(320)]);a.save(sys.argv[1])",join(out,'source.png')]);
 const request={sessionId:'headless',revision:1,path:[{x:.55,y:.4},{x:.65,y:.45}],radius:8,feather:50,seed:0};
 await assert.rejects(engine.call('repairSource',request));
 const image=await engine.call('open',{path:join(out,'source.png'),sessionId:'headless'});
 await assert.rejects(engine.call('repairSource',request));
 for(const rotation of [0,90,180,270]){
  const wait=engine.preview(++revision);
  await engine.call('update',{revision,artProfile:image.artProfile,adjustments:{...image.adjustments,rotation,fineRotation:7}});await wait;
  const frozen={...request,revision},before=(await engine.call('save')).artProfile;
  const first=await engine.call('repairSource',frozen),again=await engine.call('repairSource',frozen);
  assert.deepEqual(first,again);assert.equal(first.sessionId,'headless');assert.equal(first.revision,revision);
  assert([first.source.x,first.source.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  assert(Math.abs(first.source.x-frozen.path[0].x-first.offset.x)<1e-12);
  assert(Math.abs(first.source.y-frozen.path[0].y-first.offset.y)<1e-12);
  for(const p of frozen.path)assert([p.x+first.offset.x,p.y+first.offset.y].every(v=>v>=0&&v<=1));
  const next=await engine.call('repairSource',{...frozen,seed:1,exclude:first.source});assert.notDeepEqual(next.source,first.source);
  assert.equal((await engine.call('save')).artProfile,before);
  checks.push(rotation+': headless deterministic source/offset, explicit re-search, source bounds and unchanged recipe');
 }
 for(const change of [{sessionId:'other'},{revision:revision-1},{revision:revision+.5},{path:[]},{path:Array(32769).fill({x:.5,y:.5})},
  {path:[{x:-.1,y:.4}]},{path:[{x:null,y:.4}]},{radius:1},{radius:201},{feather:101},{seed:-1},{seed:1.5},{seed:1e20},{exclude:{x:2,y:.5}}])
  await assert.rejects(engine.call('repairSource',{...request,revision,...change}));
 checks.push('stale identity and malformed source search rejected');
 const before=engine.preview(++revision,'before');await engine.call('before',{revision});await before;
 await assert.rejects(engine.call('repairSource',{...request,revision}));checks.push('before-state search rejected');
 await engine.call('close');await assert.rejects(engine.call('repairSource',{...request,revision}));checks.push('closed session rejected');
 passed=true;console.log(JSON.stringify({passed,scope:'native Engine.call only; no renderer or Electron',checks}));
}finally{await engine.stop();if(passed)rmSync(out,{recursive:true,force:true});else console.error('Repair-source failure retained at '+out);}
