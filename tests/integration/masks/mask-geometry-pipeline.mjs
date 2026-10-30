import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';

const out=resolve(process.env.CAPTRAW_MASK_GEOMETRY_OUT||'artifacts/mask-geometry-pipeline');mkdirSync(out,{recursive:true});
const path=join(out,'target.png'),python=resolve('build/qa-venv/bin/python');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw,TiffImagePlugin
import sys
image=Image.new('RGB',(2051,1537),(96,96,96));draw=ImageDraw.Draw(image)
draw.rectangle((725,590,755,620),fill=(40,100,180))
exif=Image.Exif();exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
image.save(sys.argv[1],exif=exif)
`,path]);
const sourceHash=hash(path),engine=new EngineClient({cache:join(out,'preview-cache')}),exporter=new EngineClient({cache:join(out,'export-cache')});
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'))),cases=[],errors=[];let revision=0,passed=false,rejectedProfiles=0;
engine.on('error',message=>errors.push(message));exporter.on('error',message=>errors.push(message));
const section=(profile,name,body)=>{const start=profile.indexOf('['+name+']');assert(start>=0);const end=profile.indexOf('\n[',start);return profile.slice(0,start)+'['+name+']\n'+body+'\n'+(end<0?'':profile.slice(end));};
const rotationProfile=(profile,angle,reference,fill,enabled)=>section(section(profile,'Rotation',`Enabled=${angle!==0}\nDegree=${angle}\nCaptRAWMaskCoordinates=${enabled}\nCaptRAWMaskReferenceDegree=${reference}`),'Common Properties for Transformations',`AutoFill=${fill}`);
const inverse=(x,y,rotation)=>rotation===90?{x:y,y:1-x}:rotation===180?{x:1-x,y:1-y}:rotation===270?{x:1-y,y:x}:{x,y};
const marker=file=>JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a=np.asarray(Image.open(sys.argv[1])).astype(float);y,x=np.where((a[:,:,2]>a[:,:,0]+35)&(a[:,:,2]>a[:,:,1]+25));assert len(x)>15
print(json.dumps(dict(x=float(x.mean()),y=float(y.mean()),width=a.shape[1],height=a.shape[0])))
`,file],{encoding:'utf8'}));
async function update(profile,adjustments){
 const pending=engine.preview(++revision);const result=await engine.call('update',{revision,artProfile:profile,adjustments,maskId:adjustments.masks[0]?.id||''});
 return {...result,frame:await pending};
}
function maskAt(point,type){
 const shape={id:'subject',name:'Subject',type:'radial',enabled:true,inverted:false,feather:0,points:[],start:{x:point.x-.035,y:point.y-.035},end:{x:point.x+.035,y:point.y+.035},brightness:.4,contrast:0,saturation:0};
 if(type==='brush')return {...shape,type,points:[{...point,radius:.2}]};
 if(type==='group')return {...shape,components:[{...shape,id:'inside',operation:'add'},{...shape,id:'remove',operation:'subtract',start:{x:.7,y:.7},end:{x:.8,y:.8}}],tone:{highlights:20,shadows:0,whites:0,blacks:0},details:{hue:0,texture:10,clarity:8,noise:5,noiseDetail:50}};
 return shape;
}
try{
 const image=await engine.call('open',{path,sessionId:'mask-geometry'});
 const inputs=[
  {rotation:0,angle:23,reference:0,fill:true,type:'radial',crop:false},
  {rotation:90,angle:-23,reference:0,fill:false,type:'brush',crop:false},
  {rotation:180,angle:23,reference:0,fill:false,type:'group',crop:true},
  {rotation:270,angle:-23,reference:0,fill:true,type:'radial',crop:true},
  {rotation:0,angle:0,reference:23,fill:true,type:'group',crop:true},
  {rotation:90,angle:0,reference:-23,fill:false,type:'radial',crop:true}
 ];
 for(const [index,c] of inputs.entries()){
  const name='case-'+index;
  const adjustments={...image.adjustments,rotation:c.rotation,crop:c.crop?{x:.06,y:.06,width:.88,height:.88}:null,lensCorrections:true,lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true}};
  const authored=await update(rotationProfile(image.artProfile,c.reference,c.reference,c.fill,false),adjustments);
  const origin=marker(authored.frame.file),point=inverse((origin.x+.5)/origin.width,(origin.y+.5)/origin.height,c.rotation);
  const masks=[maskAt(point,c.type)],edited={...adjustments,masks};
  const identity=await update(rotationProfile(image.artProfile,c.reference,c.reference,c.fill,true),edited);
  const ordinary=await update(rotationProfile(image.artProfile,c.reference,c.reference,c.fill,false),edited);
  assert.equal(hash(identity.frame.file),hash(ordinary.frame.file),'Same reference angle must preserve RGB');
  assert.equal(hash(identity.frame.mask.file),hash(ordinary.frame.mask.file),'Same reference angle must preserve coverage');
  const current=rotationProfile(image.artProfile,c.angle,c.reference,c.fill,true);
  const neutral=await update(current,adjustments),target=marker(neutral.frame.file);
  const moved=await update(current,edited);assert(moved.frame.mask);assert(moved.lensStatus.distortion&&moved.lensStatus.ca);
  copyFileSync(moved.frame.file,join(out,name+'-fit.png'));copyFileSync(moved.frame.mask.file,join(out,name+'-fit-mask.png'));
  const unmoved=await update(rotationProfile(current,c.angle,c.reference,c.fill,false),edited);
  copyFileSync(unmoved.frame.mask.file,join(out,name+'-unmoved-mask.png'));
  const restored=await update(moved.artProfile,edited);assert.equal(hash(restored.frame.mask.file),hash(moved.frame.mask.file));
  const rect={x:0,y:0,width:moved.frame.fullWidth,height:moved.frame.fullHeight};
  const pending=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,...rect});const detail=await pending;
  assert(detail.mask);copyFileSync(detail.file,join(out,name+'-detail.png'));copyFileSync(detail.mask.file,join(out,name+'-detail-mask.png'));
  const regions=[];
  for(const [regionIndex,origin] of [{x:0,y:0},{x:Math.floor(rect.width*.35),y:Math.floor(rect.height*.3)}].entries()){
   const request={...origin,width:401,height:303},waiting=engine.preview(revision,'detail',120000);
   await engine.call('viewport',{revision,...request});const region=await waiting;assert(region.mask);
   assert.equal(region.x,request.x);assert.equal(region.y,request.y);assert.equal(region.width,request.width);assert.equal(region.height,request.height);
   copyFileSync(region.file,join(out,`${name}-region-${regionIndex}.png`));copyFileSync(region.mask.file,join(out,`${name}-region-${regionIndex}-mask.png`));
   regions.push({...request,mask:{x:region.mask.x,y:region.mask.y,width:region.mask.width,height:region.mask.height}});
  }
  await exporter.call('export',{path,artProfile:restored.artProfile,format:'tiff',output:join(out,name+'.tiff')});
  writeFileSync(join(out,name+'.arp'),restored.artProfile);
  const document={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path,size:statSync(path).size,sha256:sourceHash},adjustments:edited,artProfile:restored.artProfile};
  const xmp=join(out,name+'.xmp');writeFileSync(xmp,await documents.serialize(document));const saved=await documents.read(xmp);
  assert.equal(saved.artProfile,restored.artProfile);
  await engine.call('close');await engine.call('open',{path,sessionId:name+'-reopen'});
  const reopened=await update(saved.artProfile,{...image.adjustments,...saved.adjustments});
  assert.equal(hash(reopened.frame.file),hash(moved.frame.file),'XMP reopened RGB differs');
  assert.equal(hash(reopened.frame.mask.file),hash(moved.frame.mask.file),'XMP reopened coverage differs');
  const crop=restored.artProfile.match(/\[Crop\]\n([^[]+)/)[1],get=k=>Number(crop.match(new RegExp('^'+k+'=(.+)$','m'))[1]);
  const outputRect=c.crop?{x:get('X'),y:get('Y'),width:get('W'),height:get('H')}:rect;
  const info={name,...c,target,point,rect,outputRect,regions,fitSize:[moved.frame.width,moved.frame.height],identityExact:true,reopenedExact:true};
  execFileSync(python,['-c',String.raw`
from PIL import Image
from pathlib import Path
import numpy as np,tifffile,json,sys
p=Path(sys.argv[1]);c=json.loads(sys.argv[2]);n=c['name'];q=c['target']
read=lambda suffix:np.asarray(Image.open(p/(n+suffix)))
mask=read('-fit-mask.png')[:,:,3];old=read('-unmoved-mask.png')[:,:,3];x,y=round(q['x']),round(q['y'])
inside=float(mask[y-1:y+2,x-1:x+2].mean());wrong=float(old[y-1:y+2,x-1:x+2].mean())
assert inside>240,(n,'subject lost',inside);assert wrong<30,(n,'negative control insensitive',wrong)
detail=read('-detail.png');tiff=tifffile.imread(p/(n+'.tiff'));r=c['outputRect'];a=detail[r['y']:r['y']+r['height'],r['x']:r['x']+r['width']]
assert tiff.dtype==np.uint16 and a.shape==tiff.shape
error=np.abs(a.astype(float)-np.rint(tiff.astype(float)/257));assert error.max()==0,(n,'detail/export',float(error.max()))
fullmask=read('-detail-mask.png')
for i,region in enumerate(c['regions']):
 x,y,w,h=[region[k] for k in ['x','y','width','height']]
 assert np.array_equal(read(f'-region-{i}.png'),detail[y:y+h,x:x+w]),(n,'partial detail',i)
 m=region['mask'];x,y,w,h=[m[k] for k in ['x','y','width','height']]
 assert np.array_equal(read(f'-region-{i}-mask.png'),fullmask[y:y+h,x:x+w]),(n,'partial coverage',i)
with tifffile.TiffFile(p/(n+'.tiff')) as f:icc=len(f.pages[0].tags[34675].value)
result=dict(subjectCoverage=inside,untransportedCoverage=wrong,detailExportMaxDifference=float(error.max()),partialRegionsExact=len(c['regions']),bits=16,iccBytes=icc,shape=list(tiff.shape))
(p/(n+'-pixels.json')).write_text(json.dumps(result,indent=2)+'\n')
`,out,JSON.stringify(info)]);
  cases.push({...info,pixels:JSON.parse(readFileSync(join(out,name+'-pixels.json'),'utf8'))});console.log('PASS',name,c);
 }
 const valid=(await engine.call('save')).artProfile;
 for(const [profile,message] of [
  [rotationProfile(valid,46,0,true,true),/Invalid mask reference rotation/],
  [rotationProfile(valid,0,-46,true,true),/Invalid mask reference rotation/],
  [valid.replace(/^CaptRAWDrawnMaskStrokes_1=.*$/m,'CaptRAWDrawnMaskStrokes_1=1;0.4;1;1;0.2;'),/Invalid ART profile/]
 ]){
  assert.notEqual(profile,valid);await assert.rejects(engine.call('update',{revision:++revision,artProfile:profile,adjustments:image.adjustments}),message);
  assert.equal((await engine.call('save')).artProfile,valid);++rejectedProfiles;
 }
 await update(valid,image.adjustments);assert.equal(hash(path),sourceHash);assert.deepEqual(errors,[]);passed=true;
}finally{
 await engine.stop();await exporter.stop();
 writeFileSync(join(out,'report.json'),JSON.stringify({status:passed?'passed':'failed',engine:resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),sourceHash,rejectedProfiles,errors,cases},null,2)+'\n');
}
