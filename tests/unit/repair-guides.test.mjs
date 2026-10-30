import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['apps/desktop/src/lib/repairGeometry.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {repairSourcePoint,repairNormalizedPoint,mappedRepairGuide}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const W=641,H=427;
const spot=()=>({id:'spot',name:'Repair',enabled:true,method:'clone',source:{x:.237,y:.364},target:{x:.716,y:.583},radius:37,feather:50,opacity:100,detail:0});
function nativePoint(p,w,h,rotation){
  const q=rotation===90?[1-p.y,p.x]:rotation===180?[1-p.x,1-p.y]:rotation===270?[p.y,1-p.x]:[p.x,p.y];
  return {x:Math.floor(q[0]*(w-1)+.5),y:Math.floor(q[1]*(h-1)+.5)};
}
const nonlinear=p=>({x:p.x+67*Math.sin(p.y/91),y:p.y+.0015*(p.x-300)**2+21*Math.sin(p.x/57)});
function distance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function denseError(center,radius,segments,scale){
  let worst=0;
  for(let i=0;i<8192;i++){
    const angle=i*2*Math.PI/8192,p=nonlinear({x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)});
    let error=Infinity;for(const segment of segments)for(let j=1;j<segment.length;j++)error=Math.min(error,distance(p,segment[j-1],segment[j]));
    worst=Math.max(worst,error*scale);
  }
  return worst;
}

test('recipe conversion uses rotated W-1/H-1 and native lround at every coarse angle',()=>{
  for(const rotation of [0,90,180,270]){
    const [w,h]=rotation%180?[H,W]:[W,H];
    for(const point of [{x:0,y:0},{x:1,y:1},{x:.5,y:.5},spot().source,spot().target]){
      const pixel=repairSourcePoint(point,w,h,rotation);assert.deepEqual(pixel,nativePoint(point,w,h,rotation));
      assert.deepEqual(repairSourcePoint(repairNormalizedPoint(pixel,w,h,rotation),w,h,rotation),pixel);
    }
  }
  assert.deepEqual(repairSourcePoint({x:.5/640,y:1.5/426},W,H,0),{x:1,y:2});
  assert.deepEqual(repairSourcePoint({x:-.5/640,y:-1.5/426},W,H,0),{x:-1,y:-2});
});

test('normalization preserves subpixels and outside coordinates without clipping',()=>{
  const pixel={x:-17.375,y:H+22.125};
  for(const rotation of [0,90,180,270]){
    const q=repairNormalizedPoint(pixel,W,H,rotation);
    assert(q.x<0||q.x>1||q.y<0||q.y>1);
    assert.deepEqual(repairSourcePoint(q,W,H,rotation),{x:-17,y:H+22});
  }
  assert.deepEqual(repairNormalizedPoint({x:320.25,y:213.125},W,H,0),{x:320.25/640,y:213.125/426});
});

test('centers are independent native integer pixels; Canvas half-pixel belongs only to projection',async()=>{
  const s=spot(),calls=[],original=JSON.stringify(s);
  const guide=await mappedRepairGuide(s,H,W,90,1,async points=>{calls.push(points);return points.map(nonlinear);});
  const source=nativePoint(s.source,H,W,90),target=nativePoint(s.target,H,W,90);
  assert.deepEqual(calls[0],[source,target]);assert.deepEqual(guide.source,nonlinear(source));assert.deepEqual(guide.target,nonlinear(target));
  for(const p of [guide.source,guide.target])for(const scale of [.25,.5,3]){
    const offset={x:43,y:-19},css={x:offset.x+(p.x+.5)*scale,y:offset.y+(p.y+.5)*scale};
    assert(Math.abs((css.x-offset.x)/scale-.5-p.x)<1e-10);assert(Math.abs((css.y-offset.y)/scale-.5-p.y)<1e-10);
  }
  assert.equal(JSON.stringify(s),original,'Guide lookup must not alter stored normalized coordinates or parameters');
});

test('both source and target radius/feather contours follow dense nonlinear oracle within .25 CSS px',async t=>{
  for(const rotation of [0,90])for(const scale of [.35,8]){
    const s=spot(),calls=[],[w,h]=rotation?[H,W]:[W,H];
    const guide=await mappedRepairGuide(s,w,h,rotation,scale,async points=>{calls.push(points.length);return points.map(nonlinear);});
    for(const part of ['source','target'])for(const [suffix,radius] of [['Radius',37],['Feather',56]]){
      const segments=guide[part+suffix];assert.equal(segments.length,1);
      assert.deepEqual(segments[0][0],segments[0].at(-1));
      const error=denseError(nativePoint(s[part],w,h,rotation),radius,segments,scale);
      assert(error<=.25,`${part}${suffix}/${rotation}/${scale}: ${error}`);
      t.diagnostic(`${part}${suffix}/${rotation}/${scale}: max CSS error ${error}`);
    }
    assert(calls.every(n=>n>0&&n<=4096));
  }
});

test('radius truncation and rounded float feather match native full-resolution circles',async()=>{
  for(const [radius,feather,inner,outer] of [[3.9,50,3,5],[37,50,37,56],[37,0,37,37],[200,100,200,400],[10,4.9999999,10,11]]){
    const s={...spot(),radius,feather},guide=await mappedRepairGuide(s,W,H,0,1,async points=>points);
    for(const part of ['source','target'])for(const [suffix,r] of [['Radius',inner],['Feather',outer]]){
      const center=guide[part];
      for(const segment of guide[part+suffix])for(const p of segment)assert(Math.abs(Math.hypot(p.x-center.x,p.y-center.y)-r)<1e-9);
    }
    if(!feather)assert.deepEqual(guide.sourceRadius,guide.sourceFeather);
  }
});

test('null centers and interrupted circles never bridge the failed inverse band',async()=>{
  const s=spot(),center=repairSourcePoint(s.source,W,H,0),left=center.x-6,right=center.x+6;
  const guide=await mappedRepairGuide(s,W,H,0,1,async points=>points.map(p=>p.x>=left&&p.x<=right?null:p));
  assert.equal(guide.source,null);assert(guide.target);
  for(const key of ['sourceRadius','sourceFeather']){
    assert(guide[key].length>=2);
    for(const segment of guide[key])assert(segment.every(p=>p.x<left)||segment.every(p=>p.x>right));
  }
  const empty=await mappedRepairGuide(s,W,H,0,1,async points=>points.map(()=>null));
  assert.deepEqual(empty,{source:null,target:null,sourceRadius:[],sourceFeather:[],targetRadius:[],targetFeather:[]});
});

test('cancellation before and during center or contour RPC never publishes a guide',async()=>{
  await assert.rejects(mappedRepairGuide(spot(),W,H,0,1,async()=>assert.fail('must not map'),()=>false),{name:'MaskGuideCancelled'});
  for(const holdAt of [1,2]){
    let alive=true,release,entered,calls=0;const started=new Promise(resolve=>{entered=resolve;});
    const pending=mappedRepairGuide(spot(),W,H,0,1,async points=>{
      if(++calls===holdAt)await new Promise(resolve=>{release=resolve;entered();});return points;
    },()=>alive);
    await started;alive=false;release();await assert.rejects(pending,{name:'MaskGuideCancelled'});
  }
});

test('invalid geometry, malformed results and exhausted budgets fail explicitly',async()=>{
  assert.throws(()=>repairSourcePoint(spot().source,1,H,0),/geometry/);
  assert.throws(()=>repairNormalizedPoint({x:NaN,y:0},W,H,0),/geometry/);
  assert.throws(()=>repairSourcePoint(spot().source,W,H,23),/geometry/);
  for(const patch of [{radius:201},{radius:NaN},{feather:-1},{feather:101}])
    await assert.rejects(mappedRepairGuide({...spot(),...patch},W,H,0,1,async points=>points),/geometry/);
  await assert.rejects(mappedRepairGuide(spot(),W,H,0,1,async()=>[]),/mapping result/);
  await assert.rejects(mappedRepairGuide(spot(),W,H,0,1,async points=>points.map(()=>({x:Infinity,y:0}))),/mapping result/);
  const calls=[];await assert.rejects(mappedRepairGuide(spot(),W,H,0,1e14,async points=>{calls.push(points.length);return points;}),/budget exceeded/);
  assert(calls.includes(4096));assert(calls.every(n=>n<=4096));
});
