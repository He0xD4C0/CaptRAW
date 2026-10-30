// Run against the freshly linked core; never rebuild or focus a desktop window.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
import {encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/xmp';
const root=await mkdtemp(join(tmpdir(),'captraw-geometry-reference-'));
const python=resolve('build/qa-venv/bin/python'),path=join(root,'image.png');
let engine,passed=false,revision=0;
const rotate=(p,r)=>r===90?{x:1-p.y,y:p.x}:r===180?{x:1-p.x,y:1-p.y}:r===270?{x:p.y,y:1-p.x}:p;
const near=(a,b)=>assert(Math.hypot(a.x-b.x,a.y-b.y)<.02,JSON.stringify({a,b}));
try{
 execFileSync(python,['-c',"from PIL import Image;import sys;Image.new('RGB',(1024,768),(96,96,96)).save(sys.argv[1])",path]);
 engine=new EngineClient({cache:join(root,'cache')});engine.on('error',e=>{throw Error(JSON.stringify(e));});
 const image=await engine.call('open',{path,sessionId:'geometry-reference'});
 const update=async(artProfile,adjustments)=>{
  const waiting=engine.preview(++revision);
  const result=await engine.call('update',{revision,artProfile,adjustments,maskId:adjustments.masks[0]?.id||''});
  return {...result,adjustments,frame:await waiting};
 };
 const authored=await update(image.artProfile,{...image.adjustments,fineRotation:0,lensCorrections:false,lensManualDistortion:12,
  perspective:{enabled:true,horizontal:9,vertical:-6,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1}});
 const at={x:338,y:353};
 const request=(from,to,points,geometryReference,referenceAngle)=>engine.call('coordinates',{sessionId:image.id||'geometry-reference',revision,from,to,points,geometryReference,referenceAngle});
 const reference=await request('display','reference',[at],'current');
 assert.equal(reference.geometryReference?.version,3,'fresh core must return a bound reference');near(reference.points[0],at);
 const source=(await request('display','source',[at])).points[0];
 const mask={id:'anchor',name:'anchor',type:'radial',enabled:true,inverted:false,feather:0,brightness:.5,contrast:0,saturation:0,
  initialized:true,points:[],start:{x:at.x/1024-.045,y:at.y/768-.045},end:{x:at.x/1024+.045,y:at.y/768+.045},
  referenceAngle:reference.referenceAngle,geometryReference:reference.geometryReference};
 assert.deepEqual(decodeAdjustments(encodeAdjustments({masks:[mask]})).adjustments.masks[0].geometryReference,reference.geometryReference,'typed RDF preserves reference');
 for(const rotation of [0,90,180,270]){
  const adjustments={...authored.adjustments,rotation,fineRotation:0,lensManualDistortion:-22,masks:[mask],
   perspective:{enabled:true,horizontal:-18,vertical:14,angle:2,shear:1,focalLength:0,cropFactor:1,aspect:1}};
  const moved=await update(authored.artProfile,adjustments);
  assert(moved.artProfile.includes('CaptRAWGeometryReferenceV1'),'ARP stores leaf snapshot');
  const w=moved.frame.fullWidth,h=moved.frame.fullHeight;
  const raw=rotate({x:source.x/1023,y:source.y/767},rotation),anchor=rotate({x:at.x/1024,y:at.y/768},rotation);
  const expected=(await request('source','display',[{x:raw.x*(w-1),y:raw.y*(h-1)}])).points[0];
  const mapped=(await request('reference','display',[{x:anchor.x*w,y:anchor.y*h}],reference.geometryReference)).points[0];near(mapped,expected);
  const back=(await request('display','reference',[mapped],reference.geometryReference)).points[0];near(back,{x:anchor.x*w,y:anchor.y*h});
  const legacy=await request('display','reference',[expected],undefined,0);
  assert.equal(legacy.geometryReference,undefined,'legacy request remains angle-only');
  const sample=frame=>{
   assert(frame.mask,'mask coverage is visible to preview consumer');
   const x=(expected.x-(frame.mask.x||0))/frame.mask.width;
   const y=(expected.y-(frame.mask.y||0))/frame.mask.height;
   const value=Number(execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]).getchannel('A');print(im.getpixel((round(float(sys.argv[2])*im.width),round(float(sys.argv[3])*im.height))))",frame.mask.file,String(x),String(y)],{encoding:'utf8'}));
   assert(value>180,`coverage lost content anchor: rotation=${rotation}, value=${value}`);
  };
  sample(moved.frame);
  const detail=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:0,y:0,width:w,height:h});sample(await detail);
  const reload=await update(moved.artProfile,adjustments);sample(reload.frame);
 }
 passed=true;console.log('authoring reference: same-angle perspective/distortion, coarse rotations, fit/detail, ARP reload, typed RDF passed');
}finally{
 await engine?.stop();
 if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained latest failure:',root);
}
