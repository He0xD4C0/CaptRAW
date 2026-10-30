import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';

const out=resolve(process.env.CAPTRAW_COORDINATES_OUT||'artifacts/coordinates');mkdirSync(out,{recursive:true});
const python=resolve('build/qa-venv/bin/python'),path=join(out,'target.png');
execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw,TiffImagePlugin
import sys
image=Image.new('RGB',(1024,768),(96,96,96));ImageDraw.Draw(image).rectangle((360,280,408,328),fill=(40,100,180))
exif=Image.Exif();exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
image.save(sys.argv[1],exif=exif)
`,path]);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),sourceHash=hash(path);
const engine=new EngineClient({cache:join(out,'cache')}),errors=[],rows=[],checks=[];let sessionId='coordinates',revision=0,passed=false;
engine.on('error',e=>errors.push(e));
const section=(profile,name,body)=>{const start=profile.indexOf('['+name+']');assert(start>=0);const end=profile.indexOf('\n[',start);return profile.slice(0,start)+'['+name+']\n'+body+'\n'+(end<0?'':profile.slice(end));};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const map=(from,to,points,referenceAngle)=>engine.call('coordinates',{sessionId,revision,from,to,points,...(referenceAngle===undefined?{}:{referenceAngle})});
try{
 await assert.rejects(map('display','source',[{x:0,y:0}]),/No image is open/);checks.push('closed request rejected');
 const image=await engine.call('open',{path,sessionId});
 for(const rotation of [0,90,180,270])for(const angle of [-17,23])for(const fill of [false,true]){
  const perspective=rotation===90||rotation===270,reference=fill?-13.25:0;
  let profile=section(image.artProfile,'Rotation',`Enabled=true\nDegree=${angle}\nCaptRAWMaskCoordinates=${fill}\nCaptRAWMaskReferenceDegree=${reference}`);
  profile=section(profile,'Common Properties for Transformations',`AutoFill=${fill}`);
  profile=section(profile,'Perspective',`Enabled=${perspective}\nHorizontal=25\nVertical=-15\nAngle=2\nShear=3\nFocalLength=10\nCropFactor=1.5\nAspect=1\nControlLines=`);
  const adjustments={...image.adjustments,perspective:undefined,rotation,crop:{x:.1,y:.1,width:.8,height:.8},lensCorrections:true,lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true}};
  const pending=engine.preview(++revision);const result=await engine.call('update',{revision,artProfile:profile,adjustments});const frame=await pending;
  assert(result.lensStatus.distortion&&result.lensStatus.ca);
  const target=JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a=np.asarray(Image.open(sys.argv[1])).astype(float);y,x=np.where((a[:,:,2]>a[:,:,0]+35)&(a[:,:,2]>a[:,:,1]+25));assert len(x)>30
print(json.dumps(dict(x=float(x.mean()),y=float(y.mean()))))
`,frame.file],{encoding:'utf8'}));
  assert.equal(frame.width,frame.fullWidth);assert.equal(frame.height,frame.fullHeight);
  const sourcePoint=rotation===90?{x:767-304,y:384}:rotation===180?{x:1023-384,y:767-304}:rotation===270?{x:304,y:1023-384}:{x:384,y:304};
  const source=await map('display','source',[target]);assert(source.points[0]);
  const markerError=distance(source.points[0],sourcePoint);assert(markerError<1,JSON.stringify({rotation,angle,fill,markerError}));
  const projected=await map('source','display',[sourcePoint]);assert(projected.points[0]);assert(distance(projected.points[0],target)<1);
  const points=[{x:-12.5,y:7},{x:frame.fullWidth+12.5,y:frame.fullHeight-7}];
  for(let y=0;y<=12;y++)for(let x=0;x<=16;x++)points.push({x:(frame.fullWidth-1)*x/16,y:(frame.fullHeight-1)*y/12});
  const started=performance.now(),mapped=await map('display','source',points),mappingMs=performance.now()-started;
  assert(mapped.points.every(Boolean));assert.equal(mapped.width,frame.fullWidth);assert.equal(mapped.height,frame.fullHeight);
  const returned=await map('source','display',mapped.points);assert(returned.points.every(Boolean));
  const roundtripError=Math.max(...points.map((p,i)=>distance(p,returned.points[i])));assert(roundtripError<.01);
  assert.deepEqual((await map('display','display',points)).points,points);
  assert.deepEqual((await map('display','reference',points,angle)).points,points);
  const defaults=await map('display','reference',points);assert.equal(defaults.referenceAngle,fill?reference:angle);
  if(!fill)assert.deepEqual(defaults.points,points);
  for(const explicit of [0,-13.25,angle]){
   const ref=await map('display','reference',points,explicit);assert(ref.points.every(Boolean));
   const via=await map('reference','source',ref.points,explicit);assert(via.points.every(Boolean));
   assert(Math.max(...via.points.map((p,i)=>distance(p,mapped.points[i])))<.01);
   const back=await map('reference','display',ref.points,explicit);assert(back.points.every(Boolean));
   assert(Math.max(...back.points.map((p,i)=>distance(p,points[i])))<.02);
  }
  assert.equal((await engine.call('save')).artProfile,result.artProfile,'coordinate lookup changed the edit');
  rows.push({rotation,angle,fill,perspective,reference,markerError,roundtripError,mappingMs,points:points.length});
  console.log('PASS',rotation,angle,fill,markerError,roundtripError);
 }
 const request={sessionId,revision,from:'display',to:'source',points:[{x:0,y:0}]};
 for(const input of [{revision:revision-1},{revision:revision+.5},{sessionId:'stale'},{from:'normalized'},{to:'sensor'},
   {points:[]},{points:Array(4097).fill({x:0,y:0})},{points:[{x:null,y:0}]},{points:[{x:'1',y:0}]},{points:[{x:1e8,y:0}]},
   {referenceAngle:46},{referenceAngle:-46},{referenceAngle:null}])await assert.rejects(engine.call('coordinates',{...request,...input}));
 checks.push('stale session/revision, invalid spaces, oversized and malformed input rejected');
 await engine.call('close');sessionId='reopened';await engine.call('open',{path,sessionId});
 const waiting=engine.preview(++revision);await engine.call('update',{revision,adjustments:image.adjustments});await waiting;
 const point={x:-12,y:800};assert.deepEqual((await map('display','source',[point])).points,[point]);
 await assert.rejects(engine.call('coordinates',{...request,revision}),/Stale coordinate request/);
 checks.push('reopen clears prior geometry and preserves off-image identity coordinates');
 assert.equal(hash(path),sourceHash);assert.deepEqual(errors,[]);passed=true;
}finally{
 await engine.stop();writeFileSync(join(out,'report.json'),JSON.stringify({passed,sourceHash,rows,checks,errors,scope:'Native coordinate API; no arbitrary-angle UI acceptance'},null,2)+'\n');
}
