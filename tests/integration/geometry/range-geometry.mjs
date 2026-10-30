import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {EngineClient} from '../../support/engine-client.mjs';

// Native geometry only: locate targets in rendered pixels, never with coordinates RPC.
// Baseline and transformed cases deliberately use the same installed 0.49 engine.
const native=join(homedir(),'Applications/CaptRAW-0.49.app/Contents/Resources/native');
const executable=resolve(process.env.CAPTRAW_ENGINE||join(native,'captraw-engine')),resources=resolve(process.env.CAPTRAW_RESOURCES||join(native,'resources'));
const python=resolve('build/qa-venv/bin/python');
const out=mkdtempSync(join(tmpdir(),'range-geometry-'));
const cache=join(out,'cache'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const width=800,height=600;
let engine,revision=0,timer;
const errors=[],rows=[];
function fields(profile,name,values){
 const start=profile.indexOf(`[${name}]\n`);assert(start>=0,`Missing ${name}`);
 const next=profile.indexOf('\n[',start),end=next<0?profile.length:next;
 let text=profile.slice(start,end);
 for(const [key,value] of Object.entries(values)){
  const pattern=new RegExp(`^${key}=.*$`,'m');
  text=pattern.test(text)?text.replace(pattern,`${key}=${value}`):text.trimEnd()+`\n${key}=${value}\n`;
 }
 return profile.slice(0,start)+text+profile.slice(end);
}
function canonical(x,y,rotation){
 return rotation===90?{x:y,y:1-x}:rotation===180?{x:1-x,y:1-y}:rotation===270?{x:1-y,y:x}:{x,y};
}
async function render(adjustments,artProfile){
 const pending=engine.preview(++revision);pending.catch(()=>{});
 const result=await engine.call('update',{revision,adjustments,artProfile,colorSampling:true,luminance:true});
 return {...result,frame:await pending};
}
function locate(frame){
 return JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a=np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
masks={'color':(a[:,:,0]>a[:,:,1]+60)&(a[:,:,0]>a[:,:,2]+60),
       'luminance':(a.min(axis=2)>190)&(a.max(axis=2)-a.min(axis=2)<5)}
result={}
for name,mask in masks.items():
 y,x=np.where(mask);assert len(x)>40,(name,len(x))
 cx,cy=round(float(x.mean())),round(float(y.mean()))
 assert mask[cy-5:cy+6,cx-5:cx+6].all(),(name,cx,cy,'target interior too small')
 result[name]={'x':cx,'y':cy,'pixels':len(x)}
print(json.dumps(result))
`,frame.file],{encoding:'utf8',maxBuffer:4096}));
}
async function samples(frame,positions,rotation,area=false,reverse=false){
 const result={};
 for(const name of ['color','luminance']){
  const p=positions[name],delta=area?2:0;
  let start=canonical((p.x-delta)/(frame.width-1),(p.y-delta)/(frame.height-1),rotation);
  let end=area?canonical((p.x+delta)/(frame.width-1),(p.y+delta)/(frame.height-1),rotation):undefined;
  if(reverse)[start,end]=[end,start];
  result[name]=await engine.call(name==='color'?'sampleColor':'sampleLuminance',{revision,start,end});
 }
 return result;
}
function difference(actual,expected,name){
 const keys=name==='color'?['l','c','h']:['minimum','maximum'];
 return Math.max(...keys.map(key=>{
  const d=Math.abs(actual[key]-expected[key]);return key==='h'?Math.min(d,360-d):d;
 }));
}
function cleanFrames(){
 for(const name of readdirSync(cache))if(name.endsWith('.png'))rmSync(join(cache,name));
}
try{
 const binaryHash=hash(executable);
 engine=new EngineClient({executable,resources,cache});engine.on('error',error=>errors.push(error));
 timer=setTimeout(()=>engine.child.kill('SIGKILL'),180000);
 for(const geometry of ['fine','lens','perspective','combined']){
 const source=join(out,geometry+'.png');
 const targets=geometry==='lens'?{color:{x:30,y:30},luminance:{x:770,y:570}}:
  {color:{x:260,y:220},luminance:{x:540,y:375}};
 execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw,TiffImagePlugin
import sys,json
im=Image.new('RGB',(800,600),(85,85,85));d=ImageDraw.Draw(im)
targets=json.loads(sys.argv[2])
for name,color in [('color',(230,40,30)),('luminance',(225,225,225))]:
 x,y=targets[name]['x'],targets[name]['y'];r=int(sys.argv[3]);d.rectangle((x-r,y-r,x+r,y+r),fill=color)
exif=Image.Exif();exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
im.save(sys.argv[1],exif=exif)
`,source,JSON.stringify(targets),geometry==='lens'?'8':'12']);
 const sourceHash=hash(source);
 const image=await engine.call('open',{path:source,sessionId:'range-geometry'});
 assert.equal(image.width,width);assert.equal(image.height,height);
 const base={...image.adjustments,crop:null,masks:[],spots:[]};delete base.perspective;
 const neutral=await render(base,image.artProfile),neutralTargets=locate(neutral.frame);
 for(const name of Object.keys(targets))for(const axis of ['x','y'])assert.equal(neutralTargets[name][axis],targets[name][axis]);
 const reference=await samples(neutral.frame,neutralTargets,0);
 assert(!reference.color.reused&&!reference.luminance.reused);
 const optics={mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true};
 cleanFrames();
 for(const rotation of [0,90,180,270])for(const fill of [false,true]){
  const angle=geometry==='fine'||geometry==='combined'?(fill?23:-17):0;
  const lens=geometry==='lens'||geometry==='combined',perspective=geometry==='perspective'||geometry==='combined';
  let profile=fields(image.artProfile,'Common Properties for Transformations',{AutoFill:fill});
  profile=fields(profile,'Perspective',{Enabled:perspective,Horizontal:25,Vertical:-15,Angle:2,Shear:3,FocalLength:10,CropFactor:1.5,Aspect:1,ControlLines:''});
  const current=await render({...base,rotation,fineRotation:angle,lensCorrections:lens,lensProfile:optics},profile);
  if(lens)assert(current.lensStatus.distortion&&current.lensStatus.ca,'Real Lensfun distortion and CA required');
  assert.equal(current.frame.width,current.frame.fullWidth);assert.equal(current.frame.height,current.frame.fullHeight);
  const positions=locate(current.frame),point=await samples(current.frame,positions,rotation);
  assert(!point.color.reused&&!point.luminance.reused,'Geometry change must invalidate both caches');
  const area=await samples(current.frame,positions,rotation,true),reverse=await samples(current.frame,positions,rotation,true,true);
  const error={};
  for(const name of ['color','luminance']){
   error[name]=Math.max(difference(point[name],reference[name],name),difference(area[name],reference[name],name));
   assert(error[name]<.02,JSON.stringify({geometry,rotation,fill,name,error:error[name],point:point[name],reference:reference[name]}));
   assert.deepEqual(area[name],reverse[name],'Reversed rectangle must preserve sample and cache reuse');
   assert(area[name].reused&&reverse[name].reused);
   assert.equal(point[name].pixels,25);
  }
  // Negative control: sampling the original source placements must miss the moved patches.
  const stale={};
  for(const name of ['color','luminance']){
   stale[name]=await engine.call(name==='color'?'sampleColor':'sampleLuminance',{
    revision,start:{x:targets[name].x/(width-1),y:targets[name].y/(height-1)},
   });
  }
  const staleDifference={color:difference(stale.color,reference.color,'color'),luminance:difference(stale.luminance,reference.luminance,'luminance')};
  rows.push({geometry,rotation,angle,fill,positions,error,staleDifference});
  console.log('PASS',JSON.stringify(rows.at(-1)));
  cleanFrames();
 }
 assert.equal(hash(source),sourceHash);
 }
 for(const geometry of ['fine','lens','perspective','combined'])for(const name of ['color','luminance']){
  assert(rows.some(row=>row.geometry===geometry&&row.staleDifference[name]>5),`${geometry}/${name}: fixture must reject stale source coordinates`);
 }
 assert.equal(hash(executable),binaryHash);assert.deepEqual(errors,[]);
 console.log('PASS',JSON.stringify({cases:rows.length,sourcePixels:width*height,executable,binaryHash,
  maximumColorError:Math.max(...rows.map(r=>r.error.color)),maximumLuminanceError:Math.max(...rows.map(r=>r.error.luminance)),
  scope:'Selected native engine PNG fit pixels, full-resolution point/rectangle samples; no GUI, RAW, crop or export acceptance'}));
}finally{
 if(engine){
  const exited=engine.child.exitCode!==null||engine.child.signalCode!==null?Promise.resolve():once(engine.child,'exit');
  await engine.stop();await exited;
 }
 clearTimeout(timer);rmSync(out,{recursive:true,force:true});
}
