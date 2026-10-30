import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ObjectSelection} from '@captraw/desktop-core/object-selection';
import {EngineClient} from '../../support/engine-client.mjs';

const root=resolve(process.env.CAPTRAW_OBJECT_GEOMETRY_OUT||'artifacts/object-geometry');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),native=resolve(process.env.CAPTRAW_NATIVE_ROOT||'build/native'),segment=resolve(process.env.CAPTRAW_SEGMENT_ROOT||'build/segmentation');
const python=resolve('build/qa-venv/bin/python'),fixture=resolve('artifacts/segmentation-input/inputs/canon-r5.CR3.png'),source=join(out,'source.png');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),fixtureHash=hash(fixture);
execFileSync(python,['-c',String.raw`
from PIL import Image,TiffImagePlugin
import sys
im=Image.open(sys.argv[1]);icc=im.info.get('icc_profile');im=im.convert('RGB');exif=Image.Exif()
exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
im.save(sys.argv[2],exif=exif,icc_profile=icc)
`,fixture,source]);
const sourceHash=hash(source),core=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(out,'core')});
let preparedStarted=()=>{};
const host=join(out,'host'),controller=new ObjectSelection(join(native,'captraw-engine'),join(native,'resources'),join(segment,'captraw-segment'),join(segment,'models/small'),host,(_id,message)=>{if(message==='正在准备完整照片…')preparedStarted();});
const checks=[],rows=[],errors=[];core.on('error',e=>errors.push(e));let revision=0,passed=false;
const pass=name=>{checks.push(name);console.log('PASS',name);};
function section(profile,name,body){const start=profile.indexOf('['+name+']');assert(start>=0);const end=profile.indexOf('\n[',start);return profile.slice(0,start)+`[${name}]\n${body}\n`+(end<0?'':profile.slice(end));}
async function render(adjustments,artProfile,maskId=''){
 const pending=core.preview(++revision,'fit',120000),result=await core.call('update',{revision,adjustments,artProfile,maskId});return {...result,frame:await pending};
}
try{
 const image=await core.call('open',{path:source,sessionId:'geometry'});
 let profile=section(image.artProfile,'Rotation','Enabled=true\nDegree=23\nCaptRAWMaskCoordinates=true\nCaptRAWMaskReferenceDegree=7');
 profile=section(profile,'Common Properties for Transformations','AutoFill=true');
 profile=section(profile,'Perspective','Enabled=true\nHorizontal=25\nVertical=-15\nAngle=2\nShear=3\nFocalLength=10\nCropFactor=1.5\nAspect=1\nControlLines=');
 for(const rotation of [0,90,180,270]){
  const folder=join(out,'rotation'+rotation);mkdirSync(folder);
  const a={...image.adjustments,perspective:undefined,rotation,crop:null,lensCorrections:true,lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true}};
  const current=await render(a,profile);assert.deepEqual(current.geometry,{rotation,angle:23});assert(current.lensStatus.distortion&&current.lensStatus.ca);
  const input=await controller.begin(image,a,current.artProfile);
  const selections=readdirSync(join(host,'objects'));assert.equal(selections.length,1);
  const snapshot=join(host,'objects',selections[0],'input.png');assert.equal(hash(snapshot),hash(current.frame.file),'Segmentation must see exactly the current uncropped oriented preview');
  copyFileSync(snapshot,join(folder,'input.png'));controller.invalidate(image.id,a,current.artProfile);
  const box={start:{x:.25,y:.24},end:{x:.75,y:.8}},prediction=await controller.predict(input.id,[],box);
  assert(prediction.candidates.some(c=>c.pixels));
  const candidate=prediction.candidates.find(c=>c.index===prediction.selected);assert(candidate.pixels);
  const borrowed=controller.previews.get(new URL(candidate.url).pathname.slice(1));assert(borrowed);const candidateHash=hash(borrowed);
  const result=await controller.commit(input.id,prediction.revision,prediction.selected),asset=result.raster;
  assert.equal(result.referenceAngle,23,'Use actual snapshot angle, not inherited global mask reference 7');
  assert.equal(asset.sha256,candidateHash);assert.equal(hash(asset.path),candidateHash);
  assert.equal(asset.width,rotation%180?input.height:input.width);assert.equal(asset.height,rotation%180?input.width:input.height);
  copyFileSync(asset.path,join(folder,'canonical.png'));
  const mask={id:'object',name:'Object',type:'raster',enabled:true,inverted:false,feather:0,points:[],start:{x:0,y:0},end:{x:1,y:1},brightness:0,contrast:0,saturation:0,...result};
  const committed=await render({...a,masks:[mask]},current.artProfile,'object');assert(committed.frame.mask);
  copyFileSync(committed.frame.mask.file,join(folder,'coverage.png'));
  const measured=JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
asset=np.asarray(Image.open(sys.argv[1]).convert('L'));shown=np.asarray(Image.open(sys.argv[2]).convert('RGBA'))[:,:,3]
expected=np.rot90(asset,-int(sys.argv[3])//90)
assert shown.shape==expected.shape,(shown.shape,expected.shape)
error=int(np.max(np.abs(shown.astype(int)-expected.astype(int))));assert error==0,error
print(json.dumps(dict(coverageMaximumDifference=error,selectedPixels=int(np.count_nonzero(shown)),shape=list(shown.shape))))
`,asset.path,committed.frame.mask.file,String(rotation)],{encoding:'utf8'}));
  const wrong=await render({...a,masks:[{...mask,referenceAngle:7}]},current.artProfile,'object');assert.notEqual(hash(wrong.frame.mask.file),hash(committed.frame.mask.file),'Fixture must distinguish incorrect inherited reference');
  const adjusted=await render({...a,masks:[{...mask,brightness:.7}]},current.artProfile,'object');assert.notEqual(hash(adjusted.frame.file),hash(current.frame.file));
  const output=join(folder,'object.tiff');await core.call('export',{path:source,artProfile:adjusted.artProfile,output,format:'tiff'});
  const clone=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(folder,'independent')});
  try{await clone.call('export',{path:source,artProfile:adjusted.artProfile,output:join(folder,'independent.tiff'),format:'tiff'});}finally{await clone.stop();}
  execFileSync(python,['-c','import tifffile,numpy as np,sys;a,b=[tifffile.imread(p) for p in sys.argv[1:]];assert a.dtype==np.uint16 and np.array_equal(a,b)',output,join(folder,'independent.tiff')]);
  rows.push({rotation,angle:23,globalMaskReference:7,input,asset:{...asset,path:join(folder,'canonical.png')},...measured,tiffMaximumDifference:0});
  pass(`${rotation}: current-geometry snapshot, canonical candidate, committed coverage and independent TIFF16 agree`);
 }
 const a=image.adjustments,current=await render(a,profile),changed=section(current.artProfile,'Rotation','Enabled=true\nDegree=-11\nCaptRAWMaskCoordinates=true\nCaptRAWMaskReferenceDegree=7');
 const input=await controller.begin(image,a,current.artProfile),prediction=await controller.predict(input.id,[{point:{x:.5,y:.5},exclude:false}]);
 controller.invalidate(image.id,a,changed);await assert.rejects(controller.commit(input.id,prediction.revision,prediction.selected));await controller.cancel();
 pass('profile-only change with identical adjustments invalidates real candidates before commit');
 const entered=new Promise(resolve=>{preparedStarted=resolve;});
 const starting=controller.begin(image,a,current.artProfile);starting.catch(()=>{});await entered;
 controller.invalidate(image.id,a,changed);await assert.rejects(starting);await controller.cancel();
 pass('profile-only change during snapshot preparation rejects the late result');
 assert.equal(hash(source),sourceHash);assert.equal(hash(fixture),fixtureHash);assert.deepEqual(errors,[]);passed=true;
}finally{
 await controller.cancel();controller.shutdown();await core.stop();
 writeFileSync(join(out,'report.json'),JSON.stringify({passed,checks,rows,errors,sourceHash,fixtureHash,binaries:{native,segment}},null,2)+'\n');
 console.log('REPORT',join(out,'report.json'));
}
