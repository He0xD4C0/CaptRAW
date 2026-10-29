// Run only against the coordinating build. This tests ART candidate semantics,
// not Adobe equivalence: the sealed 18.7 set has no nonzero affine TIFF oracle.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../tests/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
const root=await mkdtemp(join(tmpdir(),'captraw-perspective-manual-native-')),python=resolve('build/qa-venv/bin/python');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve('build/native/resources');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),engineSHA=hash(await readFile(binary));
const base={enabled:false,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1};
const manual=change=>({...base,enabled:true,manualModel:'art-perspective-v1',scale:1,offsetX:0,offsetY:0,constrainCrop:false,...change});
let core,sync,passed=false,revision=0;const checks=[];
const near=(a,b,tolerance=.025)=>assert(Math.hypot(a.x-b.x,a.y-b.y)<tolerance,JSON.stringify({a,b,tolerance}));
const rotate=(p,r)=>r===90?{x:1-p.y,y:p.x}:r===180?{x:1-p.x,y:1-p.y}:r===270?{x:p.y,y:1-p.x}:p;
try{
 const path=join(root,'grid.png');execFileSync(python,['-c',"from PIL import Image,ImageDraw;import sys;im=Image.new('RGB',(640,480),(80,100,120));d=ImageDraw.Draw(im);[(d.line((x,0,x,479),fill=(200,60,40),width=3)) for x in range(20,640,60)];[(d.line((0,y,639,y),fill=(40,180,160),width=3)) for y in range(20,480,60)];d.rectangle((180,130,220,170),fill=(30,50,200));im.save(sys.argv[1])",path]);
 const sourceHash=hash(await readFile(path));core=new EngineClient({cache:join(root,'core'),executable:binary});
 const image=await core.call('open',{path,sessionId:'manual'}),sourceSettings={...image.adjustments,perspective:base};
 const render=async(settings,artProfile=image.artProfile)=>{const wait=core.preview(++revision);const result=await core.call('update',{revision,adjustments:settings,artProfile,maskId:settings.masks[0]?.id||''});return {...result,frame:await wait};};
 const neutral=await render(sourceSettings),neutralHash=hash(await readFile(neutral.frame.file));
 const checked=await core.call('validate',{artProfile:image.artProfile,adjustments:{...sourceSettings,perspective:manual({})}});
 assert.equal(checked.perspective.manualModel,'art-perspective-v1','new coordinated native core required');
 for(const perspective of [manual({scale:0}),manual({scale:4.1}),manual({offsetX:.51}),manual({offsetY:-.51}),manual({constrainCrop:1}),manual({manualModel:'unknown'}),{...base,scale:1}])await assert.rejects(core.call('validate',{artProfile:image.artProfile,adjustments:{...sourceSettings,perspective}}));
 const unboundAspect=await render({...sourceSettings,perspective:{...base,enabled:true,aspect:1.3}});
 assert.equal(hash(await readFile(unboundAspect.frame.file)),neutralHash,'old aspect-only bypass remains unchanged until explicit model opt-in');
 assert(!unboundAspect.artProfile.includes('CaptRAWManualV1'));
 assert.equal(hash(await readFile((await render({...sourceSettings,perspective:manual({})})).frame.file)),neutralHash,'neutral new model is pixel neutral');
 for(const [key,values] of [['aspect',[.8,1.3]],['scale',[.8,1.3]],['offsetX',[-.1,.1]],['offsetY',[-.1,.1]]])for(const value of values){
  const settings={...sourceSettings,perspective:manual({[key]:value})},result=await render(settings);
  assert.notEqual(hash(await readFile(result.frame.file)),neutralHash,key+' must change actual preview pixels');
  assert.deepEqual((await core.call('validate',{artProfile:result.artProfile,adjustments:settings})).perspective,settings.perspective);
  if(key!=='aspect'){
   const p={x:220,y:190},zoom=key==='scale'?value:1;
   const expected={x:320+(p.x-320)*zoom+(key==='offsetX'?value*640:0),y:240+(p.y-240)*zoom+(key==='offsetY'?value*480:0)};
   const mapped=(await core.call('coordinates',{sessionId:image.id,revision,from:'source',to:'display',points:[p]})).points[0];near(mapped,expected);
  }
 }
 checks.push('signed aspect/scale/X/Y change pixels; zoom/translation coordinates match analytical pixel-center mapping; old bypass and new neutral remain exact');
 const inheritedManual=await render({...sourceSettings,perspective:manual({scale:1.2,offsetX:.05})}),inheritedHash=hash(await readFile(inheritedManual.frame.file));
 const absent={...sourceSettings};delete absent.perspective;
 const retained=await render(absent,inheritedManual.artProfile);assert.equal(hash(await readFile(retained.frame.file)),inheritedHash,'missing controls retain a nonempty inherited manual ART profile');
 const emptyProfileUndo=await render(absent,'');assert.equal(hash(await readFile(emptyProfileUndo.frame.file)),neutralHash,'empty-profile undo to absent perspective clears the previous optional manual state');
 checks.push('absent perspective retains an inherited nonempty profile; restoring absent controls with an empty profile returns exact baseline pixels');
 const constrained={...sourceSettings,perspective:manual({scale:.65,offsetX:.12,offsetY:-.08})};
 const empty=await render(constrained),emptyFile=join(root,'unconstrained.png');await copyFile(empty.frame.file,emptyFile);
 constrained.perspective.constrainCrop=true;const filled=await render(constrained);
 const bounds=JSON.parse(execFileSync(python,['-c',"from PIL import Image;import numpy as np,json,sys;a=np.array(Image.open(sys.argv[1]).convert('RGB'));b=np.array(Image.open(sys.argv[2]).convert('RGB'));print(json.dumps(dict(before=int(np.all(a==0,axis=2).sum()),after=int(np.all(b==0,axis=2).sum()))))",emptyFile,filled.frame.file],{encoding:'utf8'}));
 assert(bounds.before>1000);assert.equal(bounds.after,0,'constraint must remove geometric blank pixels rather than merely changing metadata');
 checks.push({constraint:bounds});
 await render(sourceSettings);const at={x:260,y:210};
 const reference=(await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[at],geometryReference:'current'})).geometryReference;
 const mask={id:'anchor',name:'anchor',type:'radial',enabled:true,inverted:false,initialized:true,feather:0,brightness:.5,contrast:0,saturation:0,points:[],start:{x:at.x/640-.04,y:at.y/480-.04},end:{x:at.x/640+.04,y:at.y/480+.04},geometryReference:reference};
 let result,settings;
 for(const rotation of [0,90,180,270]){
  const spot={id:'clone',name:'source anchor',enabled:true,method:'clone',source:{x:200/639,y:150/479},target:{x:450/639,y:320/479},radius:16,feather:0,opacity:100,detail:0,sourceMode:'manual'};
  settings={...sourceSettings,rotation,flipHorizontal:true,lensManualDistortion:5,perspective:manual({horizontal:7,vertical:-5,angle:1,aspect:1.1,scale:1.2,offsetX:.03,offsetY:-.02}),masks:[mask],spots:[spot]};
  const withoutRepair=await render({...settings,spots:[]});result=await render(settings);const f=result.frame,p=rotate({x:at.x/640,y:at.y/480},rotation),q={x:p.x*f.fullWidth,y:p.y*f.fullHeight};
  const mapped=(await core.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:[q],geometryReference:reference})).points[0];
  const back=(await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[mapped],geometryReference:reference})).points[0];near(back,q);
  const sourcePoints=[spot.source,spot.target].map(p=>{const r=rotate(p,rotation);return {x:r.x*(f.fullWidth-1),y:r.y*(f.fullHeight-1)};});
  const centers=(await core.call('coordinates',{sessionId:image.id,revision,from:'source',to:'display',points:sourcePoints})).points;
  const clone=JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a,b=[np.array(Image.open(p).convert('RGB')).astype(float) for p in sys.argv[1:3]]
points=json.loads(sys.argv[3]);w,h=json.loads(sys.argv[4])
def mean(im,p):
 x,y=round(p['x']*im.shape[1]/w),round(p['y']*im.shape[0]/h)
 patch=im[y-2:y+3,x-2:x+3];assert patch.shape==(5,5,3);return patch.mean((0,1))
src,dst,old=mean(b,points[0]),mean(b,points[1]),mean(a,points[1])
print(json.dumps(dict(copied=float(np.abs(src-dst).max()),changed=float(np.abs(dst-old).max()))))
`,withoutRepair.frame.file,f.file,JSON.stringify(centers),JSON.stringify([f.fullWidth,f.fullHeight])],{encoding:'utf8'}));
  assert(clone.copied<3,JSON.stringify({rotation,clone,centers}));assert(clone.changed>30,JSON.stringify({rotation,clone}));
  const alpha=frame=>Number(execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]).getchannel('A');print(im.getpixel((round(float(sys.argv[2])*im.width),round(float(sys.argv[3])*im.height))))",frame.mask.file,String((mapped.x-(frame.mask.x||0))/frame.mask.width),String((mapped.y-(frame.mask.y||0))/frame.mask.height)],{encoding:'utf8'}));
  assert(alpha(f)>180);const wait=core.preview(revision,'detail');await core.call('viewport',{revision,x:0,y:0,width:f.fullWidth,height:f.fullHeight});const detailed=await wait;assert(alpha(detailed)>180);
  const detailedClone=Number(execFileSync(python,['-c',"from PIL import Image;import numpy as np,json,sys;a=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(float);pts=json.loads(sys.argv[2]);w,h=json.loads(sys.argv[3]);xy=[(round(p['x']*a.shape[1]/w),round(p['y']*a.shape[0]/h)) for p in pts];v=[a[y-2:y+3,x-2:x+3].mean((0,1)) for x,y in xy];print(float(np.abs(v[0]-v[1]).max()))",detailed.file,JSON.stringify(centers),JSON.stringify([f.fullWidth,f.fullHeight])],{encoding:'utf8'}));assert(detailedClone<3,JSON.stringify({rotation,detailedClone,centers}));
 }
 checks.push('v3 mask and clone source/target anchors survive manual affine/aspect with perspective, distortion, flips and all coarse rotations; clone center copies actual source pixels in fit/detail');
 const author={x:result.frame.fullWidth*.5,y:result.frame.fullHeight*.5};
 const newReference=(await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[author],geometryReference:'current'})).geometryReference;
 assert(newReference.data.includes('CaptRAWManualV1=true'));assert(newReference.data.includes('CaptRAWScale='));
 const sourcePoint=(await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'source',points:[author]})).points[0];
 const invalidReference={...newReference,data:newReference.data.replace(/^CaptRAWScale=.*$/m,'CaptRAWScale=0')};assert.notEqual(invalidReference.data,newReference.data);
 await assert.rejects(core.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:[author],geometryReference:invalidReference}),/manual mask geometry reference/i);
 settings={...settings,perspective:manual({horizontal:-5,vertical:7,aspect:.9,scale:.85,offsetX:-.04,offsetY:.03}),masks:[{...mask,start:{x:.46,y:.46},end:{x:.54,y:.54},geometryReference:newReference}]};
 result=await render(settings);
 const anchored=(await core.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:[author],geometryReference:newReference})).points[0];
 const physical=(await core.call('coordinates',{sessionId:image.id,revision,from:'source',to:'display',points:[sourcePoint]})).points[0];near(anchored,physical);
 const newAlpha=Number(execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]).getchannel('A');print(im.getpixel((round(float(sys.argv[2])*im.width),round(float(sys.argv[3])*im.height))))",result.frame.mask.file,String(anchored.x/result.frame.fullWidth),String(anchored.y/result.frame.fullHeight)],{encoding:'utf8'}));assert(newAlpha>180);
 checks.push('new authoring snapshots persist affine fields and retain the physical mask anchor after later manual changes; invalid model/range/reference inputs reject');
 const direct=join(root,'direct.tiff'),independent=join(root,'independent.tiff');
 await core.call('export',{path,artProfile:result.artProfile,output:direct,format:'tiff',colorSpace:'srgb'});
 const worker=new EngineClient({cache:join(root,'independent'),executable:binary});try{await worker.call('export',{path,artProfile:result.artProfile,output:independent,format:'tiff',colorSpace:'srgb'});}finally{await worker.stop();}
 execFileSync(python,['-c',"import tifffile,numpy as np,sys;a,b=[tifffile.imread(p) for p in sys.argv[1:]];assert a.dtype==b.dtype==np.uint16;assert np.array_equal(a,b)",direct,independent]);
 const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),recipe=join(root,'manual.xmp');
 const stored={source:{path:'grid.png',size:(await readFile(path)).length,sha256:sourceHash},artProfile:result.artProfile,adjustments:settings};
 const packet=await documents.serialize(stored);await writeFile(recipe,packet);assert.deepEqual((await documents.read(recipe)).adjustments.perspective,settings.perspective);
 await writeFile(recipe,await documents.serialize({...stored,xmpPacket:packet,adjustments:{...settings,perspective:base}}));
 assert.deepEqual((await documents.read(recipe)).adjustments.perspective,base,'removed manual fields cannot revive during unknown-RDF merging');
 const targetPath=join(root,'target.png');await copyFile(path,targetPath);const targetImage=await core.call('open',{path:targetPath,sessionId:'target'});
 const target={image:targetImage,adjustments:targetImage.adjustments,profile:targetImage.artProfile},source={image,adjustments:settings,profile:result.artProfile};
 sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});const copied=await sync.run({source,targets:[target],groups:['perspective']});assert.deepEqual(copied[0].adjustments.perspective,settings.perspective);
 const store=new Presets(join(root,'presets'),core,join(root,'presets-cache'),xmp),preset=await store.create({name:'Manual',group:'Geometry',groups:['perspective'],adjustments:settings,artProfile:result.artProfile});
 const portable=join(root,'preset.xmp');await store.exportFile(preset.id,portable);const imported=await store.importFile(portable),applied=await store.apply(imported.id,target,sync);assert.deepEqual(applied[0].adjustments.perspective,settings.perspective);
 checks.push('independent TIFF16 exact; typed XMP persistence/removal ownership; real sync and portable preset apply retain the complete manual model');
 assert.equal(hash(await readFile(path)),sourceHash);assert.equal(hash(await readFile(binary)),engineSHA);passed=true;console.log(JSON.stringify({engineSHA,checks},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),engineSHA,checks,diagnostics:core?.diagnostics},null,2));throw error;}
finally{sync?.cancel();await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained manual native failure:',root);}
