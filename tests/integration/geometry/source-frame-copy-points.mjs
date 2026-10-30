// Evidence first: a same-byte source must retain physical sample coordinates.
// Cross-photo copies instead use relative positions in the unbordered canvas.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {Presets} from '@captraw/desktop-core/presets';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
const root=await mkdtemp(join(tmpdir(),'captraw-frame-copy-points-')),python=resolve('build/qa-venv/bin/python');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve('build/native/resources');
const sha=b=>createHash('sha256').update(b).digest('hex'),engineSHA=sha(await readFile(binary));
const baseline=JSON.parse(await readFile('/var/folders/61/zp95tf4d2td4q8j8th6jn__c0000gn/T/captraw-camera-frame-legacy-80Zsk1/baseline.json','utf8'));
let core,sync,passed=false,revision=0;const rows=[],authored=new Map();
const binding=reference=>{
 assert.equal(reference.version,3);const frame=JSON.parse(reference.data.match(/^CaptRAWSourceFrameV1=(.*)$/m)[1]),b=frame.renderBinding;
 assert.equal(b.version,1);assert.deepEqual(Object.keys(b.source).sort(),['sha256','size']);assert.equal(b.frame.renderBinding,undefined);
 assert.equal(b.map.length,4);assert(b.map.every(Number.isFinite));return b;
};
const assertHolder=async(reference,image)=>{
 const b=binding(reference),bytes=await readFile(image.path);assert.deepEqual(b.source,{size:bytes.length,sha256:sha(bytes)});assert.deepEqual(b.frame,image.sourceFrame);return b;
};
const inspect=(frame,expected)=>JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
m=json.loads(sys.argv[2]);a=np.array(Image.open(sys.argv[1]).getchannel('A')).astype(np.float64);yy,xx=np.indices(a.shape);total=a.sum();iy,ix=np.unravel_index(a.argmax(),a.shape)
x,y=int(sys.argv[3])-m['x'],int(sys.argv[4])-m['y']
print(json.dumps(dict(size=[a.shape[1],a.shape[0]],maximum=int(a.max()),peak=dict(x=int(ix)+m['x'],y=int(iy)+m['y']),centroid=dict(x=float((xx*a).sum()/total)+m['x'],y=float((yy*a).sum()/total)+m['y']) if total else None,atPhysical=int(a[y,x]) if 0<=x<a.shape[1] and 0<=y<a.shape[0] else None,sha256=__import__('hashlib').sha256(a.astype(np.uint8).tobytes()).hexdigest())))
`,frame.mask.file,JSON.stringify(frame.mask),String(expected.x),String(expected.y)],{encoding:'utf8'}));
const render=async(image,settings,profile)=>{
 const wait=core.preview(++revision);const result=await core.call('update',{revision,artProfile:profile,adjustments:settings,maskId:settings.masks[0]?.id||''});return {...result,frame:await wait};
};
const detail=async(at)=>{const wait=core.preview(revision,'detail');await core.call('viewport',{revision,x:Math.floor(at.x)-16,y:Math.floor(at.y)-16,width:40,height:40});return wait;};
try{
 core=new EngineClient({cache:join(root,'core'),executable:binary});sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});
 for(const [name,at] of [['canon-r5.CR3',{x:7000,y:4700}],['fuji-xt4.RAF',{x:4500,y:3000}],['nikon-d850.NEF',{x:6000,y:4000}]]){
  const previous=baseline.rows.find(r=>r.name===name&&r.mode==='prior-active'),path=resolve('build/samples',name),sourceSHA=sha(await readFile(path));
  const image=await core.call('open',{path,sessionId:'old-'+name,...(previous?{artProfile:previous.artProfile,sourceFrame:previous.sourceFrame}:{sourceFramePolicy:'active-area-v1'})});
  const settings={...(previous?.adjustments||image.adjustments),crop:null,fineRotation:0,lensCorrections:false,lensManualDistortion:0,perspective:{enabled:false,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1},masks:[]};
  let result=await render(image,settings,previous?.artProfile||image.artProfile);
  const ref=(await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[at],geometryReference:'current'})).geometryReference;
  assert.equal(ref.version,3);if(previous)assert.equal(image.sourceFrame.decoderModel,undefined);
  // A compatibility fixture retains the actual old v2 transform, with no
  // identity/binding. Only the explicit sync bind may establish a holder.
  ref.data=ref.data.replace(/^(CaptRAWSourceFrameV1=)(.*)$/m,(_,key,data)=>{const frame=JSON.parse(data);delete frame.renderBinding;return key+JSON.stringify(frame);});ref.version=2;
  const asset=join(root,name+'-unit.png');execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.new('L',(int(sys.argv[2]),int(sys.argv[3])),0);im.putpixel((int(sys.argv[4]),int(sys.argv[5])),255);im.save(sys.argv[1])",asset,String(image.width),String(image.height),String(at.x),String(at.y)]);
  const mask={id:'impulse',name:'physical sample',type:'raster',enabled:true,inverted:false,initialized:true,feather:0,brightness:.5,contrast:0,saturation:0,points:[],start:{x:0,y:0},end:{x:1,y:1},geometryReference:ref,raster:{path:asset,sha256:sha(await readFile(asset)),width:image.width,height:image.height}};
  const a={...settings,masks:[mask]};result=await render(image,a,result.artProfile);const oldDetail=await detail(at),oldPixels=inspect(oldDetail,at);assert.equal(oldPixels.atPhysical,255);
  await copyFile(oldDetail.mask.file,join(root,name+'-old-coverage.png'));
  const source={image,profile:result.artProfile,adjustments:a};authored.set(name,{source,at,sourceSHA,oldPixels,ref});
  await core.call('close');
 }
 for(const [name,targetName,sameBytes] of [['canon-r5.CR3','canon-r5.CR3',true],['fuji-xt4.RAF','fuji-xt4.RAF',true],['canon-r5.CR3','nikon-d850.NEF',false]]){
  const old=authored.get(name),path=sameBytes?join(root,'same-'+targetName):resolve('build/samples',targetName);
  if(sameBytes)await copyFile(old.source.image.path,path);
  const targetSHA=sha(await readFile(path));assert.equal(targetSHA===old.sourceSHA,sameBytes);
  const image=await core.call('open',{path,sessionId:'new-'+targetName,sourceFramePolicy:'active-area-v1'}),a={...image.adjustments,crop:null};
  const initial=await render(image,a,image.artProfile);const target={image,profile:initial.artProfile,adjustments:a};
  const synchronized=await sync.run({source:old.source,targets:[target],groups:['masks']});assert.equal(synchronized.length,1);
  await assertHolder(synchronized[0].adjustments.masks[0].geometryReference,image);
  const result=await render(image,synchronized[0].adjustments,synchronized[0].profile);
  const f=old.source.image.sourceFrame,n=image.sourceFrame,p=old.at;
  const physical={x:p.x+f.border+f.decoded.left-n.border-n.decoded.left,y:p.y+f.border+f.decoded.top-n.border-n.decoded.top};
  const relative={x:(p.x+.5+f.border)/f.fullWidth*n.fullWidth-n.border-.5,y:(p.y+.5+f.border)/f.fullHeight*n.fullHeight-n.border-.5};
  const referencePoint={x:p.x*image.width/old.source.image.width,y:p.y*image.height/old.source.image.height};
  const guide=(await core.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:[referencePoint],geometryReference:synchronized[0].adjustments.masks[0].geometryReference})).points[0];
  const expected=sameBytes?physical:relative;const actualDetail=await detail(expected),actualPixels=inspect(actualDetail,physical);
  await copyFile(actualDetail.mask.file,join(root,name+'-to-'+targetName+'-new-coverage.png'));
  rows.push({name,targetName,sameBytes,sourceSHA:old.sourceSHA,targetSHA,oldFrame:f,newFrame:n,sourcePixel:p,physicalExpected:physical,relativeExpected:relative,guide,guideDelta:{x:guide.x-expected.x,y:guide.y-expected.y},oldPixels:old.oldPixels,newPixels:actualPixels,
   exactPhysicalPixel:sameBytes?actualPixels.atPhysical===255&&actualPixels.peak.x===physical.x&&actualPixels.peak.y===physical.y:null,
   strictCoordinateMatch:Math.abs(guide.x-expected.x)<1e-8&&Math.abs(guide.y-expected.y)<1e-8});
  assert.equal(sha(await readFile(old.source.image.path)),old.sourceSHA);assert.equal(sha(await readFile(path)),targetSHA);await core.call('close');
 }
 // A foreign authoring reference must first preserve its rendering on holder
 // B. The next same-byte B copy belongs to B's physical frame, not A's hash.
 const a=authored.get('nikon-d850.NEF'),b=baseline.rows.find(r=>r.name==='canon-r5.CR3'&&r.mode==='prior-active');
 const oldBPath=join(root,'chain-old-B.CR3'),newBPath=join(root,'chain-new-B.CR3');
 await copyFile(resolve('build/samples/canon-r5.CR3'),oldBPath);await copyFile(oldBPath,newBPath);
 const oldB=await core.call('open',{path:oldBPath,sessionId:'chain-old-B',artProfile:b.artProfile,sourceFrame:b.sourceFrame});
 const bBase={...b.adjustments,crop:null};let r=await render(oldB,bBase,b.artProfile);
 const first=await sync.run({source:a.source,targets:[{image:oldB,profile:r.artProfile,adjustments:bBase}],groups:['masks']});
 await assertHolder(first[0].adjustments.masks[0].geometryReference,oldB);
 r=await render(oldB,first[0].adjustments,first[0].profile);
 const point=async(image)=>({x:a.at.x*image.width/a.source.image.width,y:a.at.y*image.height/a.source.image.height});
 const oldGuide=(await core.call('coordinates',{sessionId:oldB.id,revision,from:'reference',to:'display',points:[await point(oldB)],geometryReference:first[0].adjustments.masks[0].geometryReference})).points[0];
 const physicalPixel={x:Math.round(oldGuide.x),y:Math.round(oldGuide.y)},oldDetail=await detail(oldGuide),oldPixels=inspect(oldDetail,physicalPixel);
 await copyFile(oldDetail.mask.file,join(root,'chain-old-B-coverage.png'));
 const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),store=new Presets(join(root,'presets'),core,join(root,'preset-cache'),xmp);
 const savedPath=join(root,'chain-B.xmp'),sourceBytes=await readFile(oldBPath);
 await saveRecipeWithMasks(core,savedPath,{engineVersion:'',baselineVersion:4,source:{path:'chain-old-B.CR3',size:sourceBytes.length,sha256:sha(sourceBytes)},artProfile:r.artProfile,adjustments:first[0].adjustments},value=>documents.serialize(value));
 const saved=await restoreRecipeMasks(core,savedPath,await documents.read(savedPath),join(root,'document-assets'));
 assert.deepEqual(saved.adjustments.masks[0].geometryReference,first[0].adjustments.masks[0].geometryReference);
 await core.call('close');
 const reopened=await core.call('open',{path:oldBPath,sessionId:'chain-reopen-B',artProfile:saved.artProfile,sourceFrame:oldB.sourceFrame});
 r=await render(reopened,saved.adjustments,saved.artProfile);assert.equal(inspect(await detail(oldGuide),physicalPixel).sha256,oldPixels.sha256,'XMP/asset reopen preserves B coverage');
 const sourceB={image:reopened,profile:r.artProfile,adjustments:saved.adjustments};
 const preset=await store.create({name:'Bound B',group:'Physical reference',groups:['masks'],adjustments:sourceB.adjustments,artProfile:sourceB.profile,sourceFrame:reopened.sourceFrame,sourcePath:reopened.path});
 const presetPath=join(root,'portable-B.xmp');await store.exportFile(preset.id,presetPath);const imported=await store.importFile(presetPath);
 await assert.rejects(core.call('validate',{artProfile:sourceB.profile,adjustments:sourceB.adjustments,sourceFrame:reopened.sourceFrame,sourcePath:oldBPath,sourceIdentity:{size:sourceBytes.length,sha256:'0'.repeat(64)},bindSourceFrame:true}),/source identity changed/);
 await core.call('close');
 const newB=await core.call('open',{path:newBPath,sessionId:'chain-new-B',sourceFramePolicy:'active-area-v1'}),newBase={...newB.adjustments,crop:null};
 r=await render(newB,newBase,newB.artProfile);
 const second=await sync.run({source:sourceB,targets:[{image:newB,profile:r.artProfile,adjustments:newBase}],groups:['masks']});
 await assertHolder(second[0].adjustments.masks[0].geometryReference,newB);
 await render(newB,second[0].adjustments,second[0].profile);
 const guide=(await core.call('coordinates',{sessionId:newB.id,revision,from:'reference',to:'display',points:[await point(newB)],geometryReference:second[0].adjustments.masks[0].geometryReference})).points[0];
 const newDetail=await detail(oldGuide),newPixels=inspect(newDetail,physicalPixel);await copyFile(newDetail.mask.file,join(root,'chain-new-B-coverage.png'));
 assert.equal(sha(await readFile(oldBPath)),sha(await readFile(newBPath)));assert.notEqual(a.sourceSHA,sha(await readFile(oldBPath)));
 rows.push({name:'Nikon A → old Canon B → same-byte new B',targetName:'chain',sameBytes:true,oldFrame:oldB.sourceFrame,newFrame:newB.sourceFrame,physicalExpected:oldGuide,guide,guideDelta:{x:guide.x-oldGuide.x,y:guide.y-oldGuide.y},oldPixels,newPixels,strictCoordinateMatch:Math.abs(guide.x-oldGuide.x)<1e-8&&Math.abs(guide.y-oldGuide.y)<1e-8,exactPhysicalPixel:oldPixels.sha256===newPixels.sha256});
 const applied=await store.apply(imported.id,{image:newB,profile:r.artProfile,adjustments:newBase},sync);assert.equal(applied.length,1);
 await assertHolder(applied[0].adjustments.masks[0].geometryReference,newB);await render(newB,applied[0].adjustments,applied[0].profile);
 const presetGuide=(await core.call('coordinates',{sessionId:newB.id,revision,from:'reference',to:'display',points:[await point(newB)],geometryReference:applied[0].adjustments.masks[0].geometryReference})).points[0];
 const presetPixels=inspect(await detail(oldGuide),physicalPixel);
 rows.push({name:'B portable preset → same-byte new B',sameBytes:true,guide:presetGuide,physicalExpected:oldGuide,oldPixels,newPixels:presetPixels,strictCoordinateMatch:Math.abs(presetGuide.x-oldGuide.x)<1e-8&&Math.abs(presetGuide.y-oldGuide.y)<1e-8,exactPhysicalPixel:oldPixels.sha256===presetPixels.sha256});
 await writeFile(join(root,'observations.json'),JSON.stringify({engineSHA,rows},null,2));console.log(JSON.stringify({engineSHA,rows},null,2));
 assert.equal(sha(await readFile(binary)),engineSHA);
 for(const row of rows){assert(row.strictCoordinateMatch,row.name+' physical/relative guide point');if(row.sameBytes)assert(row.exactPhysicalPixel,row.name+' physical coverage pixel');}
 passed=true;
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),engineSHA,rows,diagnostics:core?.diagnostics},null,2));throw error;}
finally{sync?.cancel();await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained copy/point failure:',root);}
