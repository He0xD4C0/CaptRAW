import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['apps/desktop/src/maskGeometry.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {mappedMaskGuide,MaskGuideCancelled}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const mask=(type='radial')=>({id:'leaf',name:'Guide',type,enabled:true,inverted:false,feather:0,points:[],start:{x:.17,y:.23},end:{x:.81,y:.76}});
const W=641,H=427;
function reference(m,t,rotation=0){
  let x,y;
  if(m.type==='linear'){x=m.start.x+(m.end.x-m.start.x)*t;y=m.start.y+(m.end.y-m.start.y)*t;}
  else{x=(m.start.x+m.end.x)/2+Math.abs(m.end.x-m.start.x)/2*Math.cos(t*2*Math.PI);y=(m.start.y+m.end.y)/2+Math.abs(m.end.y-m.start.y)/2*Math.sin(t*2*Math.PI);}
  if(rotation===90)[x,y]=[1-y,x];
  return {x:x*W,y:y*H};
}
const nonlinear=p=>({x:p.x+80*Math.sin(p.y/110),y:p.y+.0012*(p.x-300)**2+18*Math.sin(p.x/60)});
function distance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function denseError(m,guide,oracle,rotation,scale){
  let worst=0;
  for(let i=0;i<=12000;i++){
    const p=oracle(reference(m,i/12000,rotation));let error=Infinity;
    for(const segment of guide.segments)for(let j=1;j<segment.length;j++)error=Math.min(error,distance(p,segment[j-1],segment[j]));
    worst=Math.max(worst,error*scale);
  }
  return worst;
}

test('nonlinear radial and linear contours satisfy dense CSS error at fit and zoom',async t=>{
  for(const type of ['radial','linear'])for(const rotation of [0,90])for(const scale of [.35,8]){
    const m=mask(type),calls=[];
    const guide=await mappedMaskGuide(m,W,H,rotation,scale,async points=>{calls.push(points.length);return points.map(nonlinear);});
    assert(calls.every(n=>n>0&&n<=4096));assert.equal(guide.segments.length,1);
    const error=denseError(m,guide,nonlinear,rotation,scale);assert(error<=.25,`${type}/${rotation}/${scale}: ${error}`);
    t.diagnostic(`${type}/${rotation}/${scale}: max CSS error ${error}`);
  }
});

test('handles map separately, use W/H after coarse rotation, and preserve off-image results',async()=>{
  const m=mask(),inputs=[],oracle=p=>({x:p.x-900,y:p.y+p.x*p.x/100});
  const guide=await mappedMaskGuide(m,W,H,90,1,async points=>{inputs.push(...points);return points.map(oracle);});
  const expected=[m.start,m.end,{x:(m.start.x+m.end.x)/2,y:(m.start.y+m.end.y)/2}].map(p=>({x:(1-p.y)*W,y:p.x*H}));
  assert.deepEqual(inputs.slice(0,3),expected);assert.deepEqual(guide.handles,expected.map(oracle));
  assert.notEqual(guide.handles[2].y,(guide.handles[0].y+guide.handles[1].y)/2);
  assert(guide.handles.every(p=>p.x<0));
  assert.deepEqual(guide.segments[0][0],guide.segments[0].at(-1));
});

test('nulls split contours without bridging inverse failures, including null handles',async()=>{
  const m=mask('linear');m.start={x:0,y:.5};m.end={x:1,y:.5};
  const guide=await mappedMaskGuide(m,W,H,0,1,async points=>points.map(p=>p.x>=W*.4&&p.x<=W*.6?null:p));
  assert.equal(guide.handles[2],null);assert.equal(guide.segments.length,2);
  for(const segment of guide.segments)assert(segment.every(p=>p.x<W*.4)||segment.every(p=>p.x>W*.6));
  const empty=await mappedMaskGuide(m,W,H,0,1,async points=>points.map(()=>null));
  assert.deepEqual(empty,{handles:[null,null,null],segments:[]});
});

test('quarter probes detect a linear-curve inflection hidden at initial midpoints',async()=>{
  const m=mask('linear');m.start={x:0,y:.5};m.end={x:1,y:.5};
  const oracle=p=>({x:p.x,y:p.y+20*Math.sin(16*Math.PI*p.x/W)});
  const guide=await mappedMaskGuide(m,W,H,0,2,async points=>points.map(oracle));
  assert(denseError(m,guide,oracle,0,2)<=.25);
});

test('cancellation before and during an awaited batch never returns a guide',async()=>{
  await assert.rejects(mappedMaskGuide(mask(),W,H,0,1,async()=>{assert.fail('must not map');},()=>false),MaskGuideCancelled);
  let live=true,release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const pending=mappedMaskGuide(mask(),W,H,0,1,points=>new Promise(resolve=>{release=()=>resolve(points);entered();}),()=>live);
  await started;live=false;release();await assert.rejects(pending,MaskGuideCancelled);
});

test('finite budget fails explicitly and large batches never exceed RPC limits',async()=>{
  const calls=[];
  await assert.rejects(mappedMaskGuide(mask(),W,H,0,1e14,async points=>{calls.push(points.length);return points;}),/budget exceeded/);
  assert(calls.includes(4096));assert(calls.every(n=>n<=4096));
});

test('malformed mapper responses and nonfinite geometry fail explicitly',async()=>{
  await assert.rejects(mappedMaskGuide(mask(),W,H,0,1,async()=>[]),/mapping result/);
  await assert.rejects(mappedMaskGuide(mask(),W,H,0,1,async points=>points.map(()=>({x:NaN,y:0}))),/mapping result/);
  await assert.rejects(mappedMaskGuide(mask(),W,H,0,0,async points=>points),/geometry/);
});
