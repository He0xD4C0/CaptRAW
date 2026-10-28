import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';

const root=resolve('artifacts/straighten');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),source=join(out,'source.png');
const python=resolve('build/qa-venv/bin/python');
const executable=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const installed=join(homedir(),'Applications/CaptRAW-0.48.app/Contents/Resources/native');
const referenceExecutable=join(installed,'captraw-engine'),referenceResources=join(installed,'resources');
const report={passed:false,scope:'Native RPC and independently rendered installed 0.48 TIFF16 marker centers; no GUI acceptance',
 executable,resources,referenceExecutable,referenceResources,rows:[],checks:[],rejections:[],timingsMs:[],errors:[]};
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const clients=[];let revision=0,referenceRevision=0,sessionId='straighten',previewEvents=0;
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
function client(binary,assets,name){
 const engine=new EngineClient({executable:binary,resources:assets,cache:join(out,name)});
 engine.on('error',error=>report.errors.push({name,...error}));clients.push(engine);return engine;
}
function fields(profile,name,values){
 const title=`[${name}]\n`,start=profile.indexOf(title);assert(start>=0,`Missing ${name}`);
 const next=profile.indexOf('\n[',start),end=next<0?profile.length:next;let part=profile.slice(start,end);
 for(const [key,value] of Object.entries(values)){
  const pattern=new RegExp(`^${key}=.*$`,'m');
  part=pattern.test(part)?part.replace(pattern,`${key}=${value}`):part.trimEnd()+`\n${key}=${value}\n`;
 }
 return profile.slice(0,start)+part+profile.slice(end);
}
function rotationProfile(profile,angle){return fields(profile,'Rotation',{Enabled:angle!==0,Degree:angle});}
async function render(engine,profile,adjustments,reference=false,before=false){
 const next=reference?++referenceRevision:++revision;
 const pending=engine.preview(next,before?'before':'fit',120000);pending.catch(()=>{});
 const result=await engine.call(before?'before':'update',{revision:next,artProfile:profile,adjustments});
 return {...result,frame:await pending};
}
function centers(file){
 return JSON.parse(execFileSync(python,['-c',String.raw`
import json,sys,numpy as np
from PIL import Image
if sys.argv[1].endswith('.tiff'):
 import tifffile
 with tifffile.TiffFile(sys.argv[1]) as f:
  page=f.pages[0];assert page.bitspersample==16 and 34675 in page.tags
  a=page.asarray().astype(float)/257
else:a=np.asarray(Image.open(sys.argv[1])).astype(float)
r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
weights=[r-np.maximum(g,b),b-np.maximum(r,g),g-np.maximum(r,b),np.minimum(r,b)-g]
points=[]
for w in weights:
 # CA can leave small colored fringes around the other markers. Measure the
 # largest connected marker, not the centroid of unrelated fringe pixels.
 w=np.where(w>35,w,0);remaining=set(zip(*np.nonzero(w)));largest=[]
 while remaining:
  component=[remaining.pop()];stack=component.copy()
  while stack:
   y,x=stack.pop()
   for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
    q=(y+dy,x+dx)
    if q in remaining:remaining.remove(q);component.append(q);stack.append(q)
  if len(component)>len(largest):largest=component
 assert len(largest)>12,(sys.argv[1],len(largest))
 y,x=np.asarray(largest).T;mass=w[y,x].sum()
 points.append(dict(x=float(np.sum(x*w[y,x])/mass),y=float(np.sum(y*w[y,x])/mass)))
print(json.dumps(dict(width=a.shape[1],height=a.shape[0],points=points)))
`,file],{encoding:'utf8'}));
}
const axisOf=(a,b)=>Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?'horizontal':'vertical';
const residual=(a,b,axis)=>Math.atan2(Math.abs(axis==='horizontal'?b.y-a.y:b.x-a.x),Math.abs(axis==='horizontal'?b.x-a.x:b.y-a.y))*180/Math.PI;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function coarse(p,rotation){
 return rotation===90?{x:767-p.y,y:p.x}:rotation===180?{x:1023-p.x,y:767-p.y}:rotation===270?{x:p.y,y:1023-p.x}:p;
}
let engine,reference;
async function solve(start,end,override={}){
 const started=performance.now();
 try{return await engine.call('straighten',{sessionId,revision,start,end,...override});}
 finally{report.timingsMs.push(performance.now()-started);}
}
const map=(from,to,points)=>engine.call('coordinates',{sessionId,revision,from,to,points});
async function reject(name,request){
 await assert.rejects(engine.call('straighten',request),error=>{
  report.rejections.push({name,error:error.message});assert.match(error.message,/[\u4e00-\u9fff]/);return true;
 });
}
try{
 for(const path of [python,executable,resources,referenceExecutable,referenceResources])assert(existsSync(path),`Missing ${path}`);
 report.binaryHashes={current:hash(executable),reference:hash(referenceExecutable)};
 // Same camera/lens metadata as geometry-mapping.mjs and geometry-probe.cc's fixture.
 // Independent source marker positions: no coordinates RPC or solver creates this image.
 const markers=[{x:290,y:285},{x:705,y:350},{x:420,y:190},{x:470,y:580}];
 report.markers=markers;
 execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw,TiffImagePlugin
import sys,json
im=Image.new('RGB',(1024,768),(96,96,96));d=ImageDraw.Draw(im)
for p,color in zip(json.loads(sys.argv[2]),[(230,30,30),(30,40,230),(30,220,40),(220,30,220)]):
 x,y=p['x'],p['y'];d.ellipse((x-7,y-7,x+7,y+7),fill=color)
exif=Image.Exif();exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
im.save(sys.argv[1],exif=exif)
`,source,JSON.stringify(markers)]);
 report.sourceHash=hash(source);
 engine=client(executable,resources,'current-cache');reference=client(referenceExecutable,referenceResources,'reference-cache');
 engine.on('preview',()=>++previewEvents);
 report.engineVersions={current:(await engine.ready).engineVersion,reference:(await reference.ready).engineVersion};
 assert.equal(report.engineVersions.current,report.engineVersions.reference);
 await reject('no active image',{sessionId,revision,start:{x:0,y:0},end:{x:10,y:0}});
 const image=await engine.call('open',{path:source,sessionId});
 const referenceImage=await reference.call('open',{path:source,sessionId:'oracle'});
 assert.equal(image.artProfile,referenceImage.artProfile,'Same installed baseline is required');
 assert.equal(referenceImage.adjustments.fineRotation,0,'Installed 0.48 must support fineRotation');
 const base={...image.adjustments,crop:null};delete base.perspective;
 const optics={mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true};
 for(const rotation of [0,90,180,270])for(const angle of [-17,23])for(const fill of [false,true])for(const geometry of ['none','lens','perspective']){
  const name=`r${rotation}-a${angle}-fill${fill}-${geometry}`;
  let profile=fields(image.artProfile,'Common Properties for Transformations',{AutoFill:fill});
  profile=fields(profile,'Perspective',{Enabled:geometry==='perspective',Horizontal:25,Vertical:-15,Angle:2,Shear:3,FocalLength:10,CropFactor:1.5,Aspect:1,ControlLines:''});
  profile=fields(profile,'Distortion',{Enabled:geometry==='perspective',Amount:.12});
  profile=fields(profile,'CACorrection',{Enabled:false,Red:.012,Blue:-.009});
  const adjustments={...base,rotation,fineRotation:angle,lensCorrections:geometry!=='none',lensProfile:optics};
  const initial=await render(engine,profile,adjustments);
  if(geometry!=='none')assert(initial.lensStatus.distortion&&initial.lensStatus.ca);
  const oracle=await render(reference,initial.artProfile,adjustments,true);
  assert.equal(oracle.artProfile,initial.artProfile,'Independent core must receive exactly the same profile');
  assert.equal(hash(initial.frame.file),hash(oracle.frame.file),'Initial preview differs from installed core');
  const measured=centers(oracle.frame.file);
  assert.equal(measured.width,initial.frame.fullWidth);assert.equal(measured.height,initial.frame.fullHeight);
  const mapped=await map('source','display',markers.map(p=>coarse(p,rotation)));
  const markerError=Math.max(...mapped.points.map((p,i)=>{assert(p);return distance(p,measured.points[i]);}));
  assert(markerError<1,`${name}: source marker projection error ${markerError}`);
  copyFileSync(oracle.frame.file,join(out,name+'-before.png'));
  for(const pair of [[0,1],[2,3]]){
   if(pair[0]!==0)await render(engine,initial.artProfile,adjustments);
   const start=measured.points[pair[0]],end=measured.points[pair[1]],axis=axisOf(start,end);
   const snapshot=await engine.call('save'),coordinates=await map('display','source',[start,end]);
   const frameCount=previewEvents,previewHash=hash(initial.frame.file);
   const solved=await solve(start,end),reversed=await solve(end,start);
   assert.deepEqual(reversed,solved,'Reverse stroke must be bit-identical');
   assert.deepEqual(Object.keys(solved).sort(),['angle','axis','previousAngle','residualDegrees'].sort());
   assert.equal(solved.axis,axis);assert.equal(solved.previousAngle,angle);
   assert(solved.angle>=-45&&solved.angle<=45);assert(Math.abs(solved.angle*100-Math.round(solved.angle*100))<1e-9);
   assert(solved.residualDegrees>=0&&solved.residualDegrees<=.02);
   assert.deepEqual(await engine.call('save'),snapshot);
   assert.deepEqual(await map('display','source',[start,end]),coordinates,'Solve changed geometry or revision');
   assert.equal(previewEvents,frameCount,'Solve emitted a preview');assert.equal(hash(initial.frame.file),previewHash);
   const expected=rotationProfile(initial.artProfile,solved.angle);
   const applied=await render(engine,initial.artProfile,{...adjustments,fineRotation:solved.angle});
   assert.equal(rotationProfile(applied.artProfile,solved.angle),expected,'Only Rotation Enabled/Degree may change when applying result');
   assert.equal(Number(applied.artProfile.match(/\[Rotation\]\nEnabled=.*\nDegree=(.*)\n/)[1]),solved.angle);
   const output=join(out,`${name}-pair${pair[0]}.tiff`);
   writeFileSync(output+'.arp',applied.artProfile);
   // Installed binary exports without consulting coordinates or the new solver.
   await reference.call('export',{path:source,artProfile:applied.artProfile,output,format:'tiff'});
   const rendered=centers(output),current=centers(applied.frame.file);
   const before=residual(start,end,axis),after=residual(rendered.points[pair[0]],rendered.points[pair[1]],axis);
   const previewResidual=residual(current.points[pair[0]],current.points[pair[1]],axis);
   assert(after<.12&&previewResidual<.12,`${name} pair ${pair}: ${JSON.stringify({solved,before,after,previewResidual})}`);
   assert(after<before,`${name}: markers did not approach ${axis}`);
   report.rows.push({name,pair,rotation,angle,fill,geometry,markerError,start,end,...solved,beforeDegrees:before,renderedResidualDegrees:after,previewResidualDegrees:previewResidual,output});
  }
  console.log('PASS',name);
 }
 pass('96 bidirectional solutions across coarse rotations, signed fine angles, AutoFill, lens CA/distortion and perspective; independent TIFF16 marker centers align');

 let stable=await render(engine,fields(image.artProfile,'Common Properties for Transformations',{AutoFill:false}),base);
 const request={sessionId,revision,start:{x:200,y:200},end:{x:700,y:210}};
 const saved=await engine.call('save'),count=previewEvents;
 const invalid=[['old revision',{revision:revision-1}],['future revision',{revision:revision+1}],['fractional revision',{revision:revision+.5}],
  ['string revision',{revision:String(revision)}],['null revision',{revision:null}],['old session',{sessionId:'old'}],['null session',{sessionId:null}],
  ['identical endpoints',{end:request.start}],['too short',{end:{x:200+1e-7,y:200}}],
  ['left out of bounds',{start:{x:-.500001,y:100}}],['right out of bounds',{end:{x:1023.500001,y:100}}],
  ['top out of bounds',{start:{x:100,y:-.500001}}],['bottom out of bounds',{end:{x:100,y:767.500001}}],
  ['null point',{start:null}],['array point',{start:[1,2]}],['missing x',{start:{y:1}}],['missing y',{end:{x:1}}]];
 for(const bad of [null,'2',true,[],{},NaN,Infinity,-Infinity])invalid.push([`invalid number ${String(bad)}`,{start:{x:bad,y:100}}]);
 for(const [name,override] of invalid)await reject(name,{...request,...override});
 for(const key of ['sessionId','revision','start','end']){const incomplete={...request};delete incomplete[key];await reject(`missing ${key}`,incomplete);}
 assert.deepEqual(await engine.call('save'),saved);assert.equal(previewEvents,count);
 assert.equal((await solve(request.start,request.end)).previousAngle,0,'Valid request must recover after rejections');
 for(const [start,end,axis] of [[{x:-.5,y:-.5},{x:1023.5,y:-.5},'horizontal'],[{x:1023.5,y:-.5},{x:1023.5,y:767.5},'vertical'],
  [{x:-.5,y:767.5},{x:1023.5,y:767.5},'horizontal'],[{x:-.5,y:-.5},{x:-.5,y:767.5},'vertical']]){
  const solved=await solve(start,end);assert.equal(solved.angle,0);assert.equal(solved.axis,axis);assert.deepEqual(await solve(end,start),solved);
 }
 for(const dy of [-200,200]){
  const start={x:300,y:384},end={x:500,y:384+dy},solved=await solve(start,end);
  assert.equal(solved.axis,'horizontal','Equal absolute dx/dy chooses horizontal');assert.equal(Math.abs(solved.angle),45);
  assert.deepEqual(await solve(end,start),solved);
 }
 pass('inclusive half-pixel edges, horizontal diagonal ties, ±45 roots, malformed input, stale sessions/revisions and valid recovery');

 // Analytically, a 60-degree source segment cannot be horizontal at any fine
 // angle in [-45,45]. Pick the current extreme where it appears horizontal.
 let noRoot=0;
 for(const angle of [-45,45]){
  await render(engine,stable.artProfile,{...base,fineRotation:angle});
  const points=(await map('source','display',[{x:462,y:300},{x:562,y:300+100*Math.sqrt(3)}])).points;
  assert(points.every(Boolean));
  if(axisOf(...points)!=='horizontal')continue;
  const snapshot=await engine.call('save'),events=previewEvents;
  await reject('chosen horizontal axis has no root',{sessionId,revision,start:points[0],end:points[1]});
  await reject('reverse no root',{sessionId,revision,start:points[1],end:points[0]});
  assert.deepEqual(await engine.call('save'),snapshot);assert.equal(previewEvents,events);++noRoot;
 }
 assert.equal(noRoot,1);pass('out-of-range root rejects in both directions without clamping or changing axis');

 // Preserve an enabled stored angle and a cropped recipe while operating in
 // full display coordinates. Neither solve success nor rejection may edit it.
 const cropped={...base,rotation:90,fineRotation:23,crop:{x:.12,y:.18,width:.7,height:.65}};
 stable=await render(engine,stable.artProfile,cropped);
 const cropBefore=await engine.call('save'),cropPoints=[{x:120,y:300},{x:570,y:350}];
 await solve(...cropPoints);assert.deepEqual(await engine.call('save'),cropBefore);
 const before=await render(engine,stable.artProfile,cropped,false,true);
 await reject('before view',{sessionId,revision,start:cropPoints[0],end:cropPoints[1]});
 assert.deepEqual(await engine.call('save'),cropBefore);assert.equal(before.frame.kind,'before');
 const recovery=await render(engine,stable.artProfile,cropped);
 assert.equal(hash(recovery.frame.file),hash(stable.frame.file));await solve(...cropPoints);
 await engine.call('close');await reject('closed again',{sessionId,revision,start:cropPoints[0],end:cropPoints[1]});
 sessionId='reopened';await engine.call('open',{path:source,sessionId});
 await render(engine,image.artProfile,base);
 await reject('previous session after reopen',{...request,revision});
 assert.equal((await solve({x:100,y:100},{x:900,y:100})).angle,0);
 pass('full coordinates with crop, before rejection, unchanged saved profile, preview recovery and reopened session isolation');
 assert.equal(hash(source),report.sourceHash);assert.equal(hash(referenceExecutable),report.binaryHashes.reference);
 assert.equal(hash(executable),report.binaryHashes.current,'Core changed during test');assert.deepEqual(report.errors,[]);
 const times=report.timingsMs.toSorted((a,b)=>a-b);
 report.performance={calls:times.length,medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.floor(times.length*.95)],maximumMs:times.at(-1),budgetMs:2000,candidateMapBudget:192};
 assert(report.performance.maximumMs<report.performance.budgetMs,JSON.stringify(report.performance));
 report.passed=true;pass('RPC measured within 2 second budget; binary and controlled source unchanged');
}catch(error){report.failure=error.stack;throw error;}
finally{
 for(const [index,client] of clients.entries()){
  await client.stop();writeFileSync(join(out,index===0?'current.stderr.log':'reference.stderr.log'),client.diagnostics);
 }
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('REPORT',join(out,'report.json'));
}
