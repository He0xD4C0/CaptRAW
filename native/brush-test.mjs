// Run only after the coordinating process links the new core. No builds here.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,copyFile,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../tests/engine-client.mjs';
import {encodeAdjustments,decodeAdjustments,XMP} from '@captraw/desktop-core/xmp';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {Documents} from '@captraw/desktop-core/documents';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ENGINE_VERSION} from '@captraw/contracts';
const root=await mkdtemp(join(tmpdir(),'captraw-brush-native-')),python=resolve('build/qa-venv/bin/python');
const path=join(root,'source.png'),binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const hash=b=>createHash('sha256').update(b).digest('hex');
const engineSHA=hash(await readFile(binary));if(process.env.CAPTRAW_BRUSH_ENGINE_SHA256)assert.equal(engineSHA,process.env.CAPTRAW_BRUSH_ENGINE_SHA256);
let engine,portableCore,sync,revision=0,passed=false;const checks=[];
const rotate=(p,r)=>r===90?{x:1-p.y,y:p.x}:r===180?{x:1-p.x,y:1-p.y}:r===270?{x:p.y,y:1-p.x}:p;
const alpha=(frame,x=.4,y=.5)=>Number(execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]).getchannel('A');print(im.getpixel((round(float(sys.argv[2])*im.width),round(float(sys.argv[3])*im.height))))",frame.mask.file,String(x),String(y)],{encoding:'utf8'}));
const plane=frame=>execFileSync(python,['-c',"from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).getchannel('A').tobytes())",frame.mask.file]);
try{
 execFileSync(python,['-c',"from PIL import Image,ImageDraw;import sys;im=Image.new('RGB',(640,480),(180,50,35));ImageDraw.Draw(im).rectangle((320,0,639,479),fill=(30,145,190));im.save(sys.argv[1])",path]);
 engine=new EngineClient({cache:join(root,'render'),executable:binary});const image=await engine.call('open',{path,sessionId:'brush-test',effectsDefaults:'legacy'});
 const update=async masks=>{const waiting=engine.preview(++revision);const result=await engine.call('update',{revision,adjustments:{...image.adjustments,masks},artProfile:image.artProfile,maskId:masks[0]?.id||'',colorSampling:true});return {...result,frame:await waiting};};
 await update([]);
 const ref=(await engine.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[{x:256,y:240}],geometryReference:'current'})).geometryReference;
 const stroke=(change={})=>({id:'stroke',gestureId:'gesture',operation:'paint',flow:100,density:100,feather:0,canvas:{width:640,height:480},points:[{x:.4,y:.5,radius:.4}],geometryReference:ref,autoMask:false,...change});
 const mask=(strokes,points=[])=>({id:'brush',name:'brush',type:'brush',enabled:true,inverted:false,initialized:true,feather:0,points,start:{x:.5,y:.5},end:{x:.5,y:.5},brightness:1,contrast:0,saturation:0,brush:{version:1,strokes}});
 let current=await update([mask([stroke()])]);assert(current.artProfile.includes('CaptRAWBrushProgramV1'),'Fresh brush-capable core is required');assert(alpha(current.frame)>=254);
 current=await update([mask([stroke({flow:30})])]);assert(Math.abs(alpha(current.frame)-76.5)<=1,'Single dab flow');
 current=await update([mask([stroke({flow:30,points:[{x:.4,y:.5,radius:.4},{x:.5,y:.5,radius:.4},{x:.4,y:.5,radius:.4}]})])]);assert(alpha(current.frame)>200,'Same stroke overlaps accumulate flow');
 current=await update([mask([stroke({density:40}),stroke({id:'second',density:40})])]);assert(Math.abs(alpha(current.frame)-102)<=1,'Repeated strokes respect density cap');
 current=await update([mask([stroke(),stroke({id:'erase',operation:'erase',density:30})])]);assert(Math.abs(alpha(current.frame)-178.5)<=1,'Erase density limits removal');
 current=await update([mask([stroke({flow:0})])]);assert.equal(alpha(current.frame),0,'Zero flow is neutral');
 current=await update([mask([stroke({density:0})])]);assert.equal(alpha(current.frame),0,'Zero density is neutral');checks.push('flow accumulation, density cap, erase and zero endpoints');
 const line=[{x:.2,y:.5,radius:.2},{x:.8,y:.5,radius:.2}];
 const sparse=await update([mask([stroke({flow:18,points:line})])]);
 const dense=await update([mask([stroke({flow:18,points:Array.from({length:61},(_,i)=>({x:.2+i*.01,y:.5,radius:.2}))})])]);
 assert.deepEqual(plane(sparse.frame),plane(dense.frame),'Fixed arc length is independent of event segmentation');checks.push('event segmentation invariance');
 const legacy=mask([],line);delete legacy.brush;const old=await update([legacy]);
 const over=await update([mask([stroke({density:0})],line)]);assert.deepEqual(plane(old.frame),plane(over.frame),'Legacy base remains unchanged under a neutral program');checks.push('legacy base unchanged');
 await update([]);
 const auto=stroke({flow:33,feather:20,points:[{x:.4,y:.5,radius:1.4},{x:.6,y:.5,radius:1.4}],autoMask:{model:'art-deltae-seed-v1',tolerance:10}}),output=join(root,'coverage.png');
 const info=await engine.call('prepareBrush',{sessionId:image.id,revision,stroke:auto,output});const bytes=await readFile(output);
 assert.equal(bytes[24],16);assert.equal(bytes[25],0,'Frozen coverage is grayscale, not alpha');assert.equal(info.width,640);assert.equal(info.height,480);
 auto.autoMask.seed=info.seed;auto.coverage={path:output,sha256:hash(bytes),width:640,height:480};
 current=await update([mask([auto])]);assert(alpha(current.frame,.4,.5)>100);assert(alpha(current.frame,.6,.5)<5,'AutoMask gates the opposite color');const frozen=plane(current.frame);
 const plain={...auto,autoMask:false};delete plain.coverage;const plainPixels=plane((await update([mask([plain])])).frame);
 for(let y=0;y<480;++y)for(let x=0;x<300;++x)assert(Math.abs(plainPixels[y*640+x]-frozen[y*640+x])<=1,'Gray16 loading must preserve linear unit coverage');
 const changed=image.adjustments;const waiting=engine.preview(++revision);const changedResult=await engine.call('update',{revision,artProfile:current.artProfile,adjustments:{...changed,temperature:2500,tint:60,saturation:-70,exposure:1.5,masks:[mask([auto])]},maskId:'brush'});const recolored=await waiting;
 assert.deepEqual(plane(recolored),frozen,'WB/global color cannot reselect frozen coverage');assert.equal(hash(await readFile(output)),auto.coverage.sha256);checks.push('gray16 AutoMask and stable coverage after WB/global color');
 assert.deepEqual(decodeAdjustments(encodeAdjustments({masks:[mask([auto])]})).adjustments.masks[0].brush,mask([auto]).brush);
 const inventory=await engine.call('maskAssets',{artProfile:changedResult.artProfile,adjustments:{...changed,masks:[mask([auto])]},validate:true});assert.deepEqual(inventory.paths,[output]);
 const rebound=await engine.call('maskAssets',{artProfile:changedResult.artProfile,adjustments:{...changed,masks:[mask([auto])]},replacements:{[output]:'captraw-mask:'+auto.coverage.sha256}});assert.equal(rebound.adjustments.masks[0].brush.strokes[0].coverage.path,'captraw-mask:'+auto.coverage.sha256);assert(rebound.artProfile.includes('captraw-mask:'));checks.push('JSON and ARP inventory/remapping, typed RDF');
 for(const rotation of [0,90,180,270]){
  const a={...changed,rotation,flipHorizontal:true,lensManualDistortion:12,perspective:{enabled:true,horizontal:8,vertical:-5,angle:1,shear:0,focalLength:0,cropFactor:1,aspect:1},masks:[mask([auto])]};
  const wait=engine.preview(++revision),result=await engine.call('update',{revision,artProfile:image.artProfile,adjustments:a,maskId:'brush'}),frame=await wait;
  const p=rotate({x:.4,y:.5},rotation),q=(await engine.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',geometryReference:ref,points:[{x:p.x*frame.fullWidth,y:p.y*frame.fullHeight}]})).points[0];assert(q);
  assert(alpha(frame,q.x/frame.fullWidth,q.y/frame.fullHeight)>100,`Frozen coverage follows content at coarse ${rotation}`);
  if(rotation===90){const detail=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:0,y:0,width:frame.fullWidth,height:frame.fullHeight});const detailed=await detail;assert(detailed.mask);}
  if(rotation===270){const file=join(root,'export.tiff'),other=join(root,'independent.tiff');await engine.call('export',{path,artProfile:result.artProfile,output:file,format:'tiff',colorSpace:'srgb'});const independent=new EngineClient({cache:join(root,'independent')});try{await independent.call('export',{path,artProfile:result.artProfile,output:other,format:'tiff',colorSpace:'srgb'});}finally{await independent.stop();}execFileSync(python,['-c',"import tifffile,numpy as np,sys;a=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert a.dtype==np.uint16;assert np.array_equal(a,b)",file,other]);}
 }
 checks.push('frozen source anchor across perspective/distortion/flips/coarse rotation, detail and TIFF');
 // Exercise the real portable preset/document stores and synchronization, not
 // just a self-encode/decode of the program. Remove the author's source asset.
 const targetPath=join(root,'target.png');await copyFile(path,targetPath);
 const a={...image.adjustments,masks:[mask([auto],line)]},authored=await engine.call('compose',{path,width:640,height:480,artProfile:image.artProfile,adjustments:a});
 const source={image,adjustments:a,profile:authored.artProfile},target={image:{...image,id:'target',name:'target.png',path:targetPath},adjustments:{...image.adjustments,masks:[]},profile:image.artProfile};
 const expected=join(root,'portable-expected.tiff');await engine.call('export',{path,artProfile:source.profile,output:expected,format:'tiff',colorSpace:'srgb'});
 const resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});
 const synchronized=await sync.run({source,targets:[target],groups:['masks']});assert.equal(synchronized.length,1);assert.deepEqual(synchronized[0].adjustments.masks[0].brush,mask([auto]).brush);
 const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),store=new Presets(join(root,'presets'),engine,join(root,'preset-cache'),xmp);
 const preset=await store.create({name:'Frozen brush',group:'Tests',groups:['masks'],adjustments:a,artProfile:source.profile});await mkdir(join(root,'portable'));const presetPath=join(root,'portable','preset.xmp');await store.exportFile(preset.id,presetPath);
 const documents=new Documents(xmp),recipePath=join(root,'portable','document.xmp'),fileInfo=await stat(path);
 await saveRecipeWithMasks(engine,recipePath,{engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path,size:fileInfo.size,sha256:hash(await readFile(path))},artProfile:source.profile,adjustments:a},value=>documents.serialize(value));
 await rm(output);await assert.rejects(engine.call('maskAssets',{artProfile:source.profile,adjustments:a,validate:true}),/coverage|missing|changed/i);
 portableCore=new EngineClient({cache:join(root,'portable-core'),executable:binary,resources});
 const restarted=new Presets(join(root,'imported-presets'),portableCore,join(root,'imported-cache'),xmp),imported=await restarted.importFile(presetPath),applied=await restarted.apply(imported.id,target,sync);assert.equal(applied.length,1);
 const restored=await restoreRecipeMasks(portableCore,recipePath,await documents.read(recipePath),join(root,'document-cache'));
 for(const [label,value] of [['preset',applied[0]],['document',{profile:restored.artProfile,adjustments:restored.adjustments}]]){
  const program=value.adjustments.masks[0].brush,asset=program.strokes[0].coverage;assert.notEqual(asset.path,output);assert.equal(hash(await readFile(asset.path)),auto.coverage.sha256);
  assert.deepEqual({...program.strokes[0],coverage:auto.coverage},auto);assert.deepEqual(value.adjustments.masks[0].points,line);
  const file=join(root,label+'-portable.tiff');await portableCore.call('export',{path:targetPath,artProfile:value.profile,output:file,format:'tiff',colorSpace:'srgb'});
  execFileSync(python,['-c',"import tifffile,numpy as np,sys;a=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert a.dtype==np.uint16;assert np.array_equal(a,b)",expected,file]);
 }
 checks.push('real synchronization, portable preset export/import/apply and document asset restoration after author asset deletion, identical TIFF16 pixels');
 passed=true;console.log(JSON.stringify({engineSHA,checks},null,2));
}catch(error){await writeFile(join(root,'failure.txt'),String(error)+'\n'+engine?.diagnostics);throw error;}
finally{sync?.cancel();await portableCore?.stop();await engine?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained latest brush native failure:',root);}
