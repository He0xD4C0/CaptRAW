import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {ENGINE_VERSION} from '@captraw/contracts';

const out=resolve(process.env.CAPTRAW_GEOMETRY_OUT||'artifacts/geometry-mapping');mkdirSync(out,{recursive:true});
const python=resolve('build/qa-venv/bin/python'),path=join(out,'geometry-target.png');
execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw,TiffImagePlugin
import sys
image=Image.new('RGB',(1024,768),(96,96,96));draw=ImageDraw.Draw(image)
draw.rectangle((360,280,408,328),fill=(40,100,180))
exif=Image.Exif();exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
image.save(sys.argv[1],exif=exif)
`,path]);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),sourceHash=hash(path);
const coordinates=JSON.parse(execFileSync('build/native/captraw-geometry-probe',[resolve('build/native/resources'),join(out,'probe-cache'),path],{encoding:'utf8',maxBuffer:4*1024*1024}));
writeFileSync(join(out,'coordinates.json'),JSON.stringify(coordinates,null,2)+'\n');
console.log(`PASS ${coordinates.rows.length} ART float geometry cases and ${coordinates.fields.length} scalar mask fields`);
const current=new EngineClient({cache:join(out,'core-cache')}),oldRoot=resolve(process.env.HOME,'Applications/CaptRAW-0.41.app/Contents/Resources/native');
const old=new EngineClient({executable:join(oldRoot,'captraw-engine'),resources:join(oldRoot,'resources'),cache:join(out,'old-cache')});
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'))),rows=[];let revision=0,oldFailures=0;
function section(profile,name,body){const title='['+name+']',start=profile.indexOf(title);assert(start>=0,`Missing ART section ${name}`);const end=profile.indexOf('\n[',start);return profile.slice(0,start)+title+'\n'+body+'\n'+(end<0?'':profile.slice(end));}
const inverse=(x,y,rotation)=>rotation===90?[y,1-x]:rotation===180?[1-x,1-y]:rotation===270?[1-y,x]:[x,y];
try{
 const image=await current.call('open',{path,sessionId:'geometry'});await old.call('open',{path,sessionId:'geometry'});
 const p=current.preview(++revision);await current.call('update',{revision,adjustments:image.adjustments});await p;
 const reference=await current.call('whiteBalance',{mode:'sample',x:384/1023,y:304/767,size:3});
 for(const rotation of [0,90,180,270])for(const angle of [-17,23])for(const fill of [false,true])for(const perspective of [false,true]){
  let profile=section(image.artProfile,'Rotation',`Enabled=true\nDegree=${angle}`);
  profile=section(profile,'Common Properties for Transformations',`AutoFill=${fill}`);
  profile=section(profile,'Perspective',`Enabled=${perspective}\nHorizontal=25\nVertical=-15\nAngle=2\nShear=3\nFocalLength=10\nCropFactor=1.5\nAspect=1\nControlLines=`);
  profile=section(profile,'CACorrection','Enabled=false\nRed=0.012\nBlue=-0.009');
  const adjustments={...image.adjustments,perspective:undefined,rotation,crop:{x:.02,y:.02,width:.96,height:.96},lensCorrections:true,lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true}};
  const pending=current.preview(++revision),response=await current.call('update',{revision,adjustments,artProfile:profile}),frame=await pending;
  assert(response.lensStatus.distortion&&response.lensStatus.ca);
  const before=old.preview(revision);await old.call('update',{revision,adjustments,artProfile:profile});const oldFrame=await before;
  assert.equal(hash(frame.file),hash(oldFrame.file),'Fixed-recipe rendering must not change');
  const target=JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a=np.asarray(Image.open(sys.argv[1])).astype(float);y,x=np.where((a[:,:,2]>a[:,:,0]+35)&(a[:,:,2]>a[:,:,1]+25));assert len(x)>30
print(json.dumps([float(x.mean())/(a.shape[1]-1),float(y.mean())/(a.shape[0]-1)]))
`,frame.file],{encoding:'utf8'}));
  const [x,y]=inverse(...target,rotation),value=await current.call('whiteBalance',{mode:'sample',x,y,size:3}),previous=await old.call('whiteBalance',{mode:'sample',x,y,size:3});
  const error=Math.max(...value.wbMultipliers.map((v,i)=>Math.abs(v-reference.wbMultipliers[i]))),oldError=Math.max(...previous.wbMultipliers.map((v,i)=>Math.abs(v-reference.wbMultipliers[i])));
  assert(error<1e-8,JSON.stringify({rotation,angle,fill,perspective,error,value,reference}));if(oldError>.1)++oldFailures;
  rows.push({rotation,angle,fill,perspective,target,error,oldError,previewUnchanged:true});
  if(rotation===0&&angle===23&&fill&&perspective){
   writeFileSync(join(out,'transformed.xmp'),await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path,size:statSync(path).size,sha256:sourceHash},adjustments,artProfile:response.artProfile}));
   for(const [engine,name] of [[current,'current'],[old,'previous']])await engine.call('export',{path,artProfile:response.artProfile,format:'tiff',output:join(out,name+'.tiff')});
  }
 }
 assert(oldFailures>0,'Regression must expose the old mapping error');assert.equal(hash(path),sourceHash);
 execFileSync(python,['-c',String.raw`
import tifffile,numpy as np,json,sys
from pathlib import Path
p=Path(sys.argv[1]);a=tifffile.imread(p/'current.tiff');b=tifffile.imread(p/'previous.tiff')
assert a.dtype==np.uint16 and np.array_equal(a,b)
with tifffile.TiffFile(p/'current.tiff') as f:icc=len(f.pages[0].tags[34675].value)
(p/'pixels.json').write_text(json.dumps(dict(shape=list(a.shape),bits=16,iccBytes=icc,maximumDifference=0),indent=2)+'\n')
`,out]);
 writeFileSync(join(out,'wb.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,coordinateProbe:'development native',rows,oldFailures,reference,sourceHash},null,2)+'\n');
 console.log(`PASS ${rows.length} rendered-target WB cases, ${oldFailures} old failures reproduced, identical TIFF16`);
}finally{await current.stop();await old.stop();}
