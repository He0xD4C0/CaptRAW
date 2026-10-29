import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';import {captureSourceIdentity} from '../packages/desktop-core/dist/source-identity.js';import {Synchronizer} from '@captraw/desktop-core/synchronize';import {Presets} from '@captraw/desktop-core/presets';import {XMP} from '@captraw/desktop-core/xmp';import {Documents} from '@captraw/desktop-core/documents';
const work=mkdtempSync(join(tmpdir(),'captraw-gradient-geometry-')),python=resolve('build/qa-venv/bin/python'),binary=resolve('build/native/captraw-engine'),resources=resolve('build/native/resources'),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');if(process.env.CAPTRAW_LINEAR_ENGINE_SHA)assert.equal(sha(binary),process.env.CAPTRAW_LINEAR_ENGINE_SHA);
const core=new EngineClient({cache:join(work,'core'),env:{OMP_NUM_THREADS:'2'}}),sync=new Synchronizer(binary,resources,join(work,'sync'),()=>{}),xmp=new XMP(resolve('build/xmp/captraw-xmp')),docs=new Documents(xmp),store=new Presets(join(work,'presets'),core,join(work,'preset-cache'),xmp);let passed=false,revision=0;const checks=[];
const py=(s,...args)=>execFileSync(python,['-c',s,...args.map(x=>typeof x==='string'?x:JSON.stringify(x))],{encoding:'utf8',maxBuffer:1024*1024});
const pass=(name,data)=>{checks.push({name,data});console.log('PASS',name,data?JSON.stringify(data):'');};
const leaf={id:'fullzero',name:'Full Zero',type:'linear',linearGradientModel:'full-zero-v1',feather:0,enabled:true,inverted:false,initialized:true,points:[],start:{x:.5,y:.8},end:{x:.5,y:.2},operation:'add'};
const group={...leaf,id:'gradient',linearGradientModel:undefined,brightness:.5,contrast:0,saturation:0,components:[leaf]};
async function render(a,p){const wait=core.preview(++revision,'fit',120000);const result=await core.call('update',{revision,adjustments:a,artProfile:p,maskId:a.masks[0].id});return {...result,frame:await wait};}
async function inspect(frame,a,image){
 const c=a.masks[0].components[0],ts=[0,.25,.5,.75,1],reference=c.geometryReference;assert.equal(reference.version,3);
 const rotate=(p,r)=>r===90?{x:1-p.y,y:p.x}:r===180?{x:1-p.x,y:1-p.y}:r===270?{x:p.y,y:1-p.x}:p;
 const angle=(a.rotation%360+360)%360,fw=frame.fullWidth,fh=frame.fullHeight;
 const points=ts.map(t=>{const p=rotate({x:c.start.x+(c.end.x-c.start.x)*t,y:c.start.y+(c.end.y-c.start.y)*t},angle);return {x:p.x*fw,y:p.y*fh};});
 const mapped=await core.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points,geometryReference:reference});assert(mapped.points.every(Boolean));
 const picked=JSON.parse(py(`from PIL import Image
import json,sys
f,points=json.loads(sys.argv[1]),json.loads(sys.argv[2]);p=f['mask'];im=Image.open(p['file']);a=im.getchannel('A');out=[]
for q in points:
 x=round((q['x']-p['x'])*im.width/p['width']);y=round((q['y']-p['y'])*im.height/p['height']);assert 0<=x<im.width and 0<=y<im.height,(q,p,im.size)
 out.append({'x':p['x']+x*p['width']/im.width,'y':p['y']+y*p['height']/im.height,'alpha':a.getpixel((x,y))})
print(json.dumps(out))`,frame,mapped.points));
 const inverse=await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:picked.map(({x,y})=>({x,y})),geometryReference:reference});assert(inverse.points.every(Boolean));
 const sx=c.start.x*image.width,sy=c.start.y*image.height,dx=(c.end.x-c.start.x)*image.width,dy=(c.end.y-c.start.y)*image.height,den=dx*dx+dy*dy;
 const errors=inverse.points.map((p,i)=>{const q=rotate({x:p.x/fw,y:p.y/fh},(360-angle)%360);return Math.abs(picked[i].alpha-255*Math.max(0,Math.min(1,1-((q.x*image.width-sx)*dx+(q.y*image.height-sy)*dy)/den)));});assert(Math.max(...errors)<=1,JSON.stringify({picked,inverse,errors}));return {alpha:picked.map(p=>p.alpha),maxAlphaCodeError:Math.max(...errors)};
}
try{
 const path=resolve('build/samples/nikon-d850.NEF'),identity=await captureSourceIdentity(path),raw=await core.call('open',{path,sessionId:'geometry-raw',sourceFramePolicy:'active-area-v1'});assert(raw.width*raw.height>40000000);raw.sourceIdentity=identity;
 let a={...raw.adjustments,crop:null,rotation:0,fineRotation:0,flipHorizontal:false,flipVertical:false,lensCorrections:false,perspective:{...raw.adjustments.perspective,enabled:false},masks:[group]};const neutral=(await core.call('compose',{path,width:raw.width,height:raw.height,artProfile:raw.artProfile,adjustments:a})).artProfile;
 a={...a,masks:(await core.call('validate',{adjustments:a,artProfile:neutral,sourceFrame:raw.sourceFrame,sourcePath:path,bindSourceFrame:true})).masks};let sourceProfile;
 for(const [name,change]of [['base',{}],['crop',{crop:{x:.08,y:.08,width:.84,height:.84}}],['perspective',{perspective:{...a.perspective,enabled:true,manualModel:'art-perspective-v1',horizontal:8,vertical:-6,aspect:1.04,scale:1.05,offsetX:.01,offsetY:-.01,constrainCrop:false}}],['rotation90',{rotation:90}]]){
  const current={...a,...change},r=await render(current,neutral);if(name==='base')sourceProfile=r.artProfile;pass('45MP v3 '+name+' Full/Zero anchors',await inspect(r.frame,current,raw));
 }
 const source={image:raw,adjustments:a,profile:sourceProfile},targetPath=resolve('tests/fixtures/linear-gradient-uniform.tif'),image=await core.call('open',{path:targetPath,sessionId:'target',sourceFramePolicy:'active-area-v1'});image.sourceIdentity=await captureSourceIdentity(targetPath);const target={image,adjustments:{...image.adjustments,crop:null},profile:image.artProfile};
 const copied=await sync.run({source,targets:[target],groups:['masks']});assert.equal(copied.length,1);assert.equal(copied[0].adjustments.masks[0].components[0].linearGradientModel,'full-zero-v1');let r=await render(copied[0].adjustments,copied[0].profile);pass('v3 real cross-source synchronizer coverage',await inspect(r.frame,copied[0].adjustments,image));
 const preset=await store.create({name:'Full Zero',group:'Gradient tests',groups:['masks'],adjustments:a,artProfile:sourceProfile,sourcePath:path,sourceFrame:raw.sourceFrame,sourceIdentity:identity}),exported=join(work,'gradient.xmp');await store.exportFile(preset.id,exported);const saved=await docs.read(exported);assert.equal(saved.adjustments.masks[0].components[0].linearGradientModel,'full-zero-v1');const imported=await store.importFile(exported),applied=await store.apply(imported.id,target,sync);assert.equal(applied.length,1);r=await render(applied[0].adjustments,applied[0].profile);pass('preset SDK export/import and cross-source coverage',await inspect(r.frame,applied[0].adjustments,image));
 assert.equal(sha(path),identity.sha256);writeFileSync(join(work,'result.json'),JSON.stringify({checks,engine:sha(binary)},null,2));passed=true;
}finally{sync.cancel();await core.stop();if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
