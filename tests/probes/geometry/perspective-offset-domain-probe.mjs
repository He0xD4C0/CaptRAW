// Isolated ARP range experiment. No production/schema edits or shared build.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {EngineClient} from '../../support/engine-client.mjs';
const run=promisify(execFile),root=await mkdtemp(join(tmpdir(),'captraw-offset-domain-')),binary=resolve('build/native/captraw-engine'),path=resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif'),sha=b=>createHash('sha256').update(b).digest('hex');
const cohort=Object.fromEntries(await Promise.all([binary,path].map(async p=>[p,sha(await readFile(p))])));let core,worker,passed=false,revision=0;
const replace=(profile,key,value)=>{const start=profile.indexOf('[Perspective]\n');assert(start>=0);let end=profile.indexOf('\n[',start+1);if(end<0)end=profile.length;const group=profile.slice(start,end),pattern=new RegExp('^'+key+'=.*$','m');assert(pattern.test(group),key);return profile.slice(0,start)+group.replace(pattern,key+'='+value)+profile.slice(end);};
const exact=async(a,b)=>JSON.parse((await run(resolve('build/qa-venv/bin/python'),['-c',String.raw`
import numpy as np,tifffile,json,sys
a,b=[tifffile.imread(p) for p in sys.argv[1:]];assert a.dtype==b.dtype==np.uint16 and a.shape==b.shape
error=np.abs(a.astype(np.int32)-b.astype(np.int32));assert np.array_equal(a,b),int(error.max())
print(json.dumps(dict(shape=list(a.shape),maxChannelDifference=int(error.max()),differentSamples=int(np.count_nonzero(error)))))
`,a,b])).stdout);
try{
 core=new EngineClient({executable:binary,cache:join(root,'core'),env:{OMP_NUM_THREADS:'2'}});worker=new EngineClient({executable:binary,cache:join(root,'worker'),env:{OMP_NUM_THREADS:'2'}});
 const image=await core.call('open',{path,sessionId:'offset-domain',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
 const original={enabled:true,manualModel:'art-perspective-v1',horizontal:8,vertical:-6,angle:1.25,shear:2.5,focalLength:24,cropFactor:1.5,aspect:1.2,scale:1.4,offsetX:.03,offsetY:-.04,constrainCrop:false};
 const settings={...image.adjustments,crop:null,rotation:90,fineRotation:2,flipHorizontal:true,flipVertical:false,lensCorrections:false,lensManualDistortion:5,masks:[],spots:[],perspective:original},sparse={...settings};delete sparse.perspective;
 const apply=async(adjustments,artProfile)=>{const wait=core.preview(++revision),result=await core.call('update',{revision,adjustments,artProfile});const frame=await wait;const w=frame.fullWidth,h=frame.fullHeight,points=[{x:.15*w,y:.2*h},{x:.5*w,y:.5*h},{x:.85*w,y:.8*h}],mapped=await core.call('coordinates',{sessionId:image.id,revision,from:'source',to:'display',points});return {...result,frame,points:mapped.points};};
 const initial=await apply(settings,image.artProfile),initialProfile=initial.artProfile,checks=[];
 for(const [axis,sign] of [['offsetX',1],['offsetX',-1],['offsetY',1],['offsetY',-1]]){
  const value=100*.0072*sign,raw=replace(initialProfile,axis==='offsetX'?'CaptRAWOffsetX':'CaptRAWOffsetY',value),name=axis+'-'+sign;
  await assert.rejects(core.call('validate',{artProfile:initialProfile,adjustments:{...settings,perspective:{...original,[axis]:value}}}));
  const inherited=await core.call('validate',{artProfile:raw,adjustments:sparse});assert.deepEqual(inherited.perspective,{...original,[axis]:value});
  const art=await apply(sparse,raw),legacyFile=join(root,name+'-arp.tif');await worker.call('export',{path,artProfile:raw,output:legacyFile,format:'tiff',colorSpace:'srgb'});
  // Independently express the same target geometry through the existing signed
  // operator. This is an exact representation test, not Adobe equivalence.
  const candidate={...original,manualModel:'signed-framing-v1',aspect:-100,scale:original.scale/Math.sqrt(1.2),offsetX:original.offsetX/.0072,offsetY:-original.offsetY/.0072};candidate[axis]=axis==='offsetX'?sign*100:-sign*100;
  const signed=await apply({...settings,perspective:candidate},initialProfile),signedFile=join(root,name+'-signed.tif');await worker.call('export',{path,artProfile:signed.artProfile,output:signedFile,format:'tiff',colorSpace:'srgb'});
  const error=Math.max(...art.points.map((p,i)=>Math.hypot(p.x-signed.points[i].x,p.y-signed.points[i].y)));assert(error<1e-7,error);const pixels=await exact(legacyFile,signedFile);
  const beforeExpected=replace(initialProfile,axis==='offsetX'?'CaptRAWOffsetX':'CaptRAWOffsetY',sign*.5),clipped=await apply(sparse,beforeExpected),delta=art.points.map((p,i)=>({x:p.x-clipped.points[i].x,y:p.y-clipped.points[i].y})),span=axis==='offsetX'?art.frame.fullWidth:art.frame.fullHeight;
  for(const p of delta){assert(Math.abs(p[axis==='offsetX'?'x':'y']-sign*(value*sign-.5)*span)<.025);assert(Math.abs(p[axis==='offsetX'?'y':'x'])<.025);}
  checks.push({axis,value,signedValue:candidate[axis],coordinateDifferencePixels:error,independentTIFF16:pixels,deltaBeyondOldLimitPixels:delta[1],jsonBoundaryRejects:true,rawARPExact:true});await rm(legacyFile);await rm(signedFile);
 }
 // Distinguish a genuine empty intersection from the former UI validation cap.
 const overlap=(scale,x,y)=>Math.min(Math.min(1,.5*(1+scale)+x)-Math.max(0,.5*(1-scale)+x),Math.min(1,.5*(1+scale)+y)-Math.max(0,.5*(1-scale)+y));
 assert(overlap(1.4,.72,-.04)>0);assert(overlap(.1,.72,0)<0);assert.equal(overlap(.1,.55,0),0);
 for(const [p,hash] of Object.entries(cohort))assert.equal(sha(await readFile(p)),hash,p+' changed');passed=true;
 console.log(JSON.stringify({cohort,target:original,coarseRotation:90,fineRotation:2,flipHorizontal:true,lensManualDistortion:5,checks,actualAffineIntersection:{ordinaryCase:overlap(1.4,.72,-.04),emptyCase:overlap(.1,.72,0),boundaryCase:overlap(.1,.55,0)},scratchCleaned:true},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),stderr:error.stderr,stdout:error.stdout,cohort,diagnostics:core?.diagnostics},null,2));throw error;}finally{await worker?.stop();await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained offset domain probe:',root);}
