import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-linear-native-')),python=resolve('build/qa-venv/bin/python'),binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
if(process.env.CAPTRAW_LINEAR_ENGINE_SHA)assert.equal(sha(binary),process.env.CAPTRAW_LINEAR_ENGINE_SHA);
const fixture=JSON.parse(readFileSync('tests/fixtures/linear-gradient-legacy.json','utf8')),flat=resolve('tests/fixtures/'+fixture.sourceFile),engine=new EngineClient({executable:binary,cache:join(work,'cache'),env:{OMP_NUM_THREADS:'2'}});let passed=false,revision=0;const checks=[];
const py=(code,...args)=>execFileSync(python,['-c',code,...args.map(x=>typeof x==='string'?x:JSON.stringify(x))],{encoding:'utf8',maxBuffer:1024*1024});
const pass=(name,data)=>{checks.push({name,data});console.log('PASS',name,data?JSON.stringify(data):'');};
const leaf=(id,extra={})=>({id,name:id,type:'linear',linearGradientModel:'full-zero-v1',feather:0,enabled:true,inverted:false,initialized:true,points:[],start:{x:.5,y:.75},end:{x:.5,y:.25},operation:'add',...extra});
const group=components=>({id:'gradient',name:'Gradient',type:'linear',feather:0,enabled:true,inverted:false,points:[],start:{x:.5,y:.75},end:{x:.5,y:.25},brightness:1,contrast:0,saturation:0,components});
async function render(a,profile){const wait=engine.preview(++revision,'fit',120000);const result=await engine.call('update',{revision,adjustments:a,artProfile:profile,maskId:a.masks[0].id});return {...result,frame:await wait};}
function coverage(frame,g,W,H){assert(frame.mask);return JSON.parse(py(`import json,sys,numpy as np
from PIL import Image
frame,g,W,H=json.loads(sys.argv[1]),json.loads(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]);plane=frame['mask'];A=np.asarray(Image.open(plane['file']))[:,:,3].astype(float);h,w=A.shape
# Use the native published plane, including the exact detailed crop origin.
y,x=np.mgrid[0:h,0:w];X=plane['x']+x*plane['width']/w;Y=plane['y']+y*plane['height']/h;out=np.zeros((h,w))
for c in g['components']:
 if not c.get('enabled',True):continue
 sx,sy=c['start']['x']*W,c['start']['y']*H;dx=(c['end']['x']-c['start']['x'])*W;dy=(c['end']['y']-c['start']['y'])*H;n=dx*dx+dy*dy
 v=np.clip(1-((X-sx)*dx+(Y-sy)*dy)/n,0,1) if n else np.zeros((h,w))
 if c.get('inverted'):v=1-v
 op=c.get('operation','add');out=out*(1-v) if op=='subtract' else out*v if op=='intersect' else np.maximum(out,v)
if g.get('inverted'):out=1-out
err=np.abs(A-out*255);r={'width':w,'height':h,'maxAlphaCodeError':float(err.max()),'meanAlphaCodeError':float(err.mean()),'minAlpha':float(A.min()),'maxAlpha':float(A.max())};print(json.dumps(r));assert err.max()<=1,r`,frame,g,W,H));}
const linear=p=>p.replace(/(\nOutputProfile=)[^\n]+/,'$1RTv4_Linear_Rec709').replace(/(\nOutputBPC=)[^\n]+/,'$1false');
try{
 assert.equal(sha(flat),fixture.sourceSHA256);const legacy=join(work,'legacy.tif');await engine.call('export',{path:flat,artProfile:fixture.legacyProfile,output:legacy,format:'tiff',colorSpace:'srgb'});
 const digest=py("import hashlib,tifffile,sys;f=tifffile.TiffFile(sys.argv[1]);a=f.asarray();assert a.dtype.name=='uint16';print(hashlib.sha256(a.astype('<u2').tobytes()).hexdigest())",legacy).trim();assert.equal(digest,fixture.legacyPixelSHA256);pass('ae legacy16 pixels remain exact');
 const image=await engine.call('open',{path:flat,sessionId:'small-gradient'}),base={...fixture.legacyAdjustments,masks:[]};
 for(const op of ['single','invert','add','subtract','intersect']){
  const g=group([leaf('first')]);if(op==='invert')g.inverted=true;if(['add','subtract','intersect'].includes(op))g.components.push(leaf('second',{operation:op,start:{x:.2,y:.5},end:{x:.8,y:.5}}));
  const a={...base,masks:[g]},r=await render(a,fixture.baseProfile),m=coverage(r.frame,g,image.width,image.height);pass('actual '+op+' coverage',m);
 }
 const source=resolve(process.env.CAPTRAW_LINEAR_RAW||'build/samples/nikon-d850.NEF'),raw=await engine.call('open',{path:source,sessionId:'raw-gradient',sourceFramePolicy:'active-area-v1'});assert(raw.width*raw.height>40000000,'Use an actual approximately45MP RAW');
 const g=group([leaf('raw')]);let a={...raw.adjustments,crop:null,fineRotation:0,rotation:0,flipHorizontal:false,flipVertical:false,lensCorrections:false,perspective:{...raw.adjustments.perspective,enabled:false},masks:[g]};
 const initial=(await engine.call('compose',{path:source,width:raw.width,height:raw.height,artProfile:raw.artProfile,adjustments:a})).artProfile;const bound=await engine.call('validate',{artProfile:initial,adjustments:a,sourceFrame:raw.sourceFrame,sourcePath:source,bindSourceFrame:true});a={...a,masks:bound.masks};assert.equal(a.masks[0].components[0].geometryReference.version,3);
 const r=await render(a,initial);assert(r.frame.width<raw.width/2);pass('45MP RAW fit coverage',coverage(r.frame,a.masks[0],raw.width,raw.height));
 const roi={x:Math.floor(raw.width/2)-64,y:Math.floor(raw.height/2)-64,width:128,height:128},wait=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,...roi});const detail=await wait;assert.equal(detail.width,128);assert.equal(detail.height,128);pass('true1:1 RAW ROI coverage',coverage(detail,a.masks[0],raw.width,raw.height));
 const zeroA=structuredClone(a);zeroA.masks[0].brightness=0;const zero=(await engine.call('compose',{path:source,width:raw.width,height:raw.height,artProfile:initial,adjustments:zeroA})).artProfile;
 // The full-control ARP uses ART's existing constant1 mask. The candidate remains untouched.
 const full=r.artProfile.replace(/^.*CaptRAWFullZeroV1.*\n/gm,'').replace(/^(.*AreaMaskStrengthEnd_1=).*$/gm,(_,prefix)=>prefix+'100');
 for(const [name,profile]of [['zero',zero],['masked',r.artProfile],['full',full]])await engine.call('export',{path:source,artProfile:linear(profile),output:join(work,name+'.tif'),format:'tiff'});
 const metrics=JSON.parse(py(`import json,sys,numpy as np,tifffile
p,W,H=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]);images=[]
for name in ['zero','masked','full']:
 with tifffile.TiffFile(p+'/'+name+'.tif') as f:
  assert f.pages[0].dtype.name=='uint16' and len(f.pages[0].tags[34675].value)>128;images.append(f.asarray()[:,:,1].astype(float)/65535)
b,m,f=images;assert b.shape==(H,W),b.shape;den=f-b;valid=(b>.02)&(f<.9)&(den>.01);y=np.arange(H)[:,None];expected=np.broadcast_to(np.clip((y/H-.25)/.5,0,1),b.shape);coverage=np.divide(m-b,den,out=np.zeros_like(b),where=valid);err=abs(coverage-expected)[valid];quant=(2/65535)/den[valid];r={'validPixels':int(valid.sum()),'maxCoverageError':float(err.max()),'p99CoverageError':float(np.quantile(err,.99)),'maxQuantizationBound':float(quant.max())};print(json.dumps(r));assert valid.sum()>W*H*.01,r;assert np.all(err<=quant+2e-5),r`,work,raw.width,raw.height));pass('45MP actual linear16 output coverage',metrics);
 writeFileSync(join(work,'result.json'),JSON.stringify({engine:sha(binary),checks},null,2));passed=true;
}finally{await engine.stop();if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
