import {EngineClient} from '../../support/engine-client.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../../..'),out=mkdtempSync(join(tmpdir(),'captraw-repair-test-'));
const python=process.env.CAPTRAW_REPAIR_PYTHON||root+'/build/qa-venv/bin/python',binary=process.env.CAPTRAW_REPAIR_ENGINE||root+'/build/native/captraw-engine';
let passed=false;
execFileSync(python,['-c',String.raw`
import numpy as np,sys
from PIL import Image,ImageDraw
out=sys.argv[1];h,w=192,256;y,x=np.mgrid[:h,:w]
a=np.clip(95+x*.15+y*.08+6*np.sin(y/6)+3*np.cos(x/8),0,255).astype('uint8');a=np.stack([a,a,a],axis=2)
Image.fromarray(a).save(out+'/clean.png')
im=Image.fromarray(a);d=ImageDraw.Draw(im);d.line([(150,65),(190,65),(190,120)],fill=(20,20,20),width=5);im.save(out+'/dust.png')
`,out]);
const engine=new EngineClient({executable:binary,resources:root+'/build/native/resources',cache:out+'/cache'});engine.on('error',()=>{});
const point=(x,y)=>({x:x/255,y:y/191}),path=[point(150,65),point(190,65),point(190,120)];
const spot={id:'stroke',name:'stroke',enabled:true,method:'clone',source:point(70,65),target:path[0],path,radius:10,feather:50,opacity:100,detail:0,sourceMode:'manual'};
const checks=[];let image;
async function output(spots,name,extra={},profile=''){
 const adjustments={...image.adjustments,...extra,spots};
 const composed=await engine.call('compose',{artProfile:profile,adjustments,width:image.width,height:image.height});
 await engine.call('export',{path:out+'/dust.png',artProfile:composed.artProfile,output:out+'/'+name+'.tiff',format:'tiff'});
 return composed.artProfile;
}
try{
 image=await engine.call('open',{path:out+'/dust.png',sessionId:'test'});
 await output([],'neutral');
 const profile=await output([spot],'clone');assert.match(profile,/RepairPath1=/);assert.equal((profile.match(/\nSpot\d+=/g)||[]).length,1);checks.push('one SpotEntry and one persisted continuous path');
 await output([spot],'reopen',{},profile);
 await engine.call('export',{path:out+'/dust.png',artProfile:profile,output:out+'/profile-only.tiff',format:'tiff'});
 await output([{...spot,method:'heal'}],'heal');
 await output([{...spot,opacity:0}],'zero');await output([{...spot,enabled:false}],'disabled');
 await output([{...spot,opacity:50}],'half');
 await output([{...spot,path:[path[0],path[1]],opacity:50}],'single-segment');
 await output([{...spot,path:[path[0],path[1],path[0],path[1]],opacity:50}],'retrace');
 const dense={...spot,path:[path[0],point(170,65),path[1],point(190,90),path[2]]};await output([dense],'dense');
 const pointSpot={...spot,path:undefined,opacity:50};await output([pointSpot],'point');await output([pointSpot,pointSpot],'stacked');
 const previous=process.env.CAPTRAW_REPAIR_PREVIOUS_ENGINE||root+'/build/bundle/native/captraw-engine';
 assert(!readFileSync(previous).equals(readFileSync(binary)),'Legacy appearance requires a distinct previous engine binary');
 const old=new EngineClient({executable:previous,resources:root+'/build/native/resources',cache:out+'/old-cache'});old.on('error',()=>{});
 try{await old.call('export',{path:out+'/dust.png',artProfile:await output([pointSpot],'legacy'),output:out+'/old-point.tiff',format:'tiff'});}finally{await old.stop();}
 for(const rotation of [90,180,270]){
  const profile=await output([spot],'rotate'+rotation,{rotation,fineRotation:7,crop:{x:.05,y:.05,width:.9,height:.9}});
  const stored=profile.match(/\nRepairPath1=([^\n]+)/)[1].split(';').filter(Boolean).map(Number),expected=path.flatMap(p=>rotation===90?[(1-p.y)*191,p.x*255]:rotation===180?[(1-p.x)*255,(1-p.y)*191]:[p.y*191,(1-p.x)*255]);
  assert.equal(stored.length,expected.length);assert(stored.every((v,i)=>Math.abs(v-expected[i])<1e-8));
 }
 for(const edit of [{path:[]},{path:[point(151,65),path[1]]},{path:[path[0],{x:NaN,y:.2}]},{path,retainTexture:true}])await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...image.adjustments,spots:[{...spot,...edit}]}}));
 execFileSync(python,['-c',String.raw`
import numpy as np,tifffile,sys,json
out=sys.argv[1];r=lambda n:tifffile.imread(out+'/'+n+'.tiff').astype(float)
n=r('neutral');c=r('clone');h=r('heal');p=r('point');s=r('stacked')
assert np.array_equal(c,r('reopen'));assert np.array_equal(c,r('profile-only'))
assert np.array_equal(n,r('zero'));assert np.array_equal(n,r('disabled'))
assert np.array_equal(r('legacy'),r('old-point'))
assert np.max(np.abs(c-r('dense')))<=1
assert np.any(c!=h)
# Both legs change, but the empty inner corner remains unchanged: one swept L, no bbox fill.
assert np.any(c[62:69,150:191]!=n[62:69,150:191])
assert np.any(c[65:121,187:194]!=n[65:121,187:194])
assert np.array_equal(c[96:106,151:161],n[96:106,151:161])
# Union is blended only once, unlike two independent half-opacity spots.
assert np.any(p!=s)
assert np.array_equal(r('single-segment'),r('retrace'))
assert np.all(np.isfinite(h))
# Real correction at the blemish center is materially brighter than the defect.
assert h[65,170].mean()>n[65,170].mean()+5000
print(json.dumps({'shape':list(c.shape),'dtype':str(tifffile.imread(out+'/clone.tiff').dtype),'legacyPixelDifference':int(np.max(np.abs(r('legacy')-r('old-point')))),'resamplingDifference':int(np.max(np.abs(c-r('dense')))),'healCenter':h[65,170].mean(),'defectCenter':n[65,170].mean()}))
`,out],{stdio:'inherit'});
 checks.push('connected L domain and no change outside domain','whole-domain Heal removes real blemish','reopen and profile-only export pixel-identical','opacity zero and disabled neutral','dense/endpoint sampling invariant','legacy old-package point pixel-identical','rotated/cropped exports complete','invalid path rejects');
 const independent=new EngineClient({executable:binary,resources:root+'/build/native/resources',cache:out+'/independent-cache'});
 try{await independent.call('export',{path:out+'/dust.png',artProfile:profile,output:out+'/independent.tiff',format:'tiff'});}finally{await independent.stop();}
 execFileSync(python,['-c',"import tifffile,numpy as np,sys; p=sys.argv[1];assert np.array_equal(tifffile.imread(p+'/clone.tiff'),tifffile.imread(p+'/independent.tiff'))",out]);checks.push('fresh independent core pixel-identical');
 const bundled=await build({entryPoints:[root+'/packages/desktop-core/src/documents/xmp.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@captraw/contracts':root+'/packages/contracts/index.ts'}});
 const {encodeAdjustments,decodeAdjustments,XMP}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const sdk=new XMP(root+'/build/xmp/captraw-xmp'),properties=encodeAdjustments({spots:[spot]});
 const unknown={ns:'urn:repair-test',name:'Untouched',node:{items:[{value:'external'}],options:0x600}};
 const written=await sdk.call('write','',[...properties,unknown]);const read=await sdk.call('read',written.packet);
 assert.deepEqual(decodeAdjustments(read.properties).adjustments.spots,[spot]);assert(read.properties.some(p=>p.ns===unknown.ns&&p.name===unknown.name));
 assert.throws(()=>encodeAdjustments({spots:[{...spot,path:[]}]}));checks.push('SDK typed RDF repair path roundtrip and unknown namespace retained','retracing the same domain does not compound opacity');
 const geometryBundle=await build({entryPoints:[root+'/apps/desktop/src/lib/repairGeometry.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {mappedRepairGuide,repairDustPixels}=await import('data:text/javascript;base64,'+Buffer.from(geometryBundle.outputFiles[0].text).toString('base64'));
 const guides=await mappedRepairGuide(spot,256,192,0,1,async p=>p);assert(guides.targetRadius.length>2);assert(guides.targetRadius.flat().some(p=>p.y>120));
 const input=new Uint8ClampedArray(16*16*4).fill(128),before=new Uint8ClampedArray(input);let dust=repairDustPixels(input,16,16,20);assert(dust.every((v,i)=>v===(i%4===3?255:0)));
 input[(8*16+8)*4]=input[(8*16+8)*4+1]=input[(8*16+8)*4+2]=0;dust=repairDustPixels(input,16,16,20);assert.equal(dust[(8*16+8)*4],255);assert.equal(input[0],before[0]);checks.push('continuous source/target contours','display-only dust detection is neutral on flat pixels and detects a dark speck');
 passed=true;console.log(JSON.stringify({passed,checks}));
}finally{await engine.stop();if(passed)rmSync(out,{recursive:true,force:true});else console.error('Repair failure retained at '+out);}
