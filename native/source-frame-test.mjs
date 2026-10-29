// Run only after the coordinated core build. The old executable is an oracle,
// never used to claim that the new policy works.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../tests/engine-client.mjs';

const root=await mkdtemp(join(tmpdir(),'captraw-source-frame-native-'));
const python=resolve('build/qa-venv/bin/python'),binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const sha=b=>createHash('sha256').update(b).digest('hex'),engineSHA=sha(await readFile(binary));
const legacy=process.env.CAPTRAW_SOURCE_FRAME_LEGACY_ENGINE;
const checks=[];let engine,passed=false,revision=0,image;
const mask=(reference)=>({id:'anchor',name:'anchor',type:'radial',enabled:true,inverted:false,initialized:true,feather:0,brightness:.5,contrast:0,saturation:0,points:[],start:{x:.2,y:.3},end:{x:.4,y:.6},...(reference?{geometryReference:reference}:{})});
const pixels=file=>execFileSync(python,['-c',"import tifffile,sys;sys.stdout.buffer.write(tifffile.imread(sys.argv[1]).tobytes())",file]);
const coverage=file=>execFileSync(python,['-c',"from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).getchannel('A').tobytes())",file]);
const dimensions=file=>JSON.parse(execFileSync(python,['-c',"import tifffile,sys,json;a=tifffile.imread(sys.argv[1]);print(json.dumps([a.shape[1],a.shape[0]]))",file],{encoding:'utf8'}));
const near=(a,b,tolerance=.025)=>assert(Math.hypot(a.x-b.x,a.y-b.y)<tolerance,JSON.stringify({a,b,tolerance}));
const render=async(adjustments,artProfile=image.artProfile)=>{
 const wait=engine.preview(++revision);const result=await engine.call('update',{revision,artProfile,adjustments,maskId:adjustments.masks[0]?.id||''});return {...result,frame:await wait};
};
const open=async(name,options={})=>{image=await engine.call('open',{path:join(root,name),sessionId:'frame-'+name,...options});return image;};
try{
 execFileSync(python,['tests/source-frame-fixtures.py',root],{stdio:'pipe'});
 engine=new EngineClient({cache:join(root,'engine'),executable:binary});
 await open('bayer.dng',{sourceFramePolicy:'active-area-v1'});
 assert.equal(image.sourceFrame?.policy,'active-area-v1','New core required; do not run this test against the old binary');
 assert.deepEqual([image.width,image.height,image.sourceFrame.border],[192,128,0]);
 assert.equal(image.adjustments.sourceFrame.policy,'active-area-v1');
 let result=await render(image.adjustments);assert.deepEqual([result.frame.fullWidth,result.frame.fullHeight],[192,128]);
 const at={x:58,y:57};
 const reference=await engine.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[at],geometryReference:'current'});
 assert.equal(reference.geometryReference.version,3);near(reference.points[0],at);
 assert(reference.geometryReference.data.includes('CaptRAWSourceFrameV1'));
 const currentFrame=image.sourceFrame,activeImage=structuredClone(image);
 let settings={...image.adjustments,masks:[mask(reference.geometryReference)]};
 result=await render(settings);assert(result.frame.mask);
 for(const rotation of [0,90,180,270]){
  const next={...settings,rotation,flipHorizontal:true,lensManualDistortion:10,perspective:{enabled:true,horizontal:5,vertical:-4,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1}};
  result=await render(next);const w=result.frame.fullWidth,h=result.frame.fullHeight;
  const author=rotation===90?{x:1-at.y/128,y:at.x/192}:rotation===180?{x:1-at.x/192,y:1-at.y/128}:rotation===270?{x:at.y/128,y:1-at.x/192}:{x:at.x/192,y:at.y/128};
  const q={x:author.x*w,y:author.y*h};
  const mapped=await engine.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:[q],geometryReference:reference.geometryReference});
  const back=await engine.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:mapped.points,geometryReference:reference.geometryReference});near(back.points[0],q);
  const wait=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:0,y:0,width:w,height:h});assert((await wait).mask);
 }
 checks.push('new Bayer v2 authoring reference, all coarse rotations, flip, perspective/distortion, fit/detail');
 const composed=await engine.call('compose',{path:activeImage.path,width:192,height:128,artProfile:activeImage.artProfile,adjustments:activeImage.adjustments});
 const output=join(root,'independent.tif');await engine.call('export',{path:activeImage.path,artProfile:composed.artProfile,output,format:'tiff',colorSpace:'srgb'});assert.deepEqual(dimensions(output),[192,128]);
 await open('bayer.dng',{artProfile:composed.artProfile,sourceFrame:currentFrame});assert.deepEqual(image.sourceFrame,currentFrame);
 await render(image.adjustments);await assert.rejects(()=>engine.call('update',{revision:++revision,artProfile:image.artProfile,adjustments:{...image.adjustments,sourceFrame:{...currentFrame,layoutWidth:191}}}),/immutable/);
 checks.push('independent compose/export and reopen use the same immutable frame');
 const falseFrame={...currentFrame,fullWidth:20000,fullHeight:20000,border:9990,width:20,height:20,layoutWidth:20,layoutHeight:20};
 // This frame is internally consistent and below 512 MP, but does not belong
 // to the decoded 192x128 photo. Exercise both low-level routes without open.
 await assert.rejects(()=>engine.call('compose',{path:activeImage.path,width:192,height:128,artProfile:activeImage.artProfile,adjustments:{...activeImage.adjustments,sourceFrame:falseFrame}}),/source frame.*decoded photo/i);
 const forged=composed.artProfile.replace(/^(CaptRAWSourceFrameV1=).*$/m,(_,prefix)=>prefix+JSON.stringify(falseFrame));assert.notEqual(forged,composed.artProfile);
 const rejectedOutput=join(root,'must-not-exist.tif');
 await assert.rejects(()=>engine.call('export',{path:activeImage.path,artProfile:forged,output:rejectedOutput,format:'tiff',colorSpace:'srgb'}),/source frame.*decoded photo/i);
 await assert.rejects(()=>readFile(rejectedOutput),{code:'ENOENT'});
 for(const key of ['sensor','decoded']){
  const frame={...currentFrame,[key]:key==='sensor'?'linear':{...currentFrame.decoded,left:2}};
  await assert.rejects(()=>engine.call('compose',{path:activeImage.path,width:192,height:128,artProfile:activeImage.artProfile,adjustments:{...activeImage.adjustments,sourceFrame:frame}}),/source frame.*decoded photo/i);
 }
 checks.push('headless compose/export reject internally valid foreign processing frames before output; source-reference frames remain mapping-only');
 await open('inset.dng',{sourceFramePolicy:'active-area-v1'});
 assert.deepEqual([image.sourceFrame.fullWidth,image.sourceFrame.fullHeight,image.sourceFrame.decoded.left,image.sourceFrame.decoded.top],[180,120,6,4]);
 assert.deepEqual(image.cameraCrop,{x:8/180,y:6/120,width:160/180,height:100/120},'DefaultCrop is relative to decoded ActiveArea, margins are added exactly once');
 result=await render(image.adjustments);assert.deepEqual([result.frame.fullWidth,result.frame.fullHeight],[180,120]);
 checks.push('nonzero ActiveArea and DefaultCrop remain separate');
 for(const [name,w,h] of [['linear.dng',192,128],['rotated.dng',128,192],['rendered.png',192,128]]){
  await open(name,{sourceFramePolicy:'active-area-v1'});assert.deepEqual([image.width,image.height,image.sourceFrame.border],[w,h,0]);
  result=await render(image.adjustments);assert.deepEqual([result.frame.fullWidth,result.frame.fullHeight],[w,h]);
  const file=join(root,name+'.tif');await engine.call('export',{path:image.path,artProfile:result.artProfile,output:file,format:'tiff',colorSpace:'srgb'});assert.deepEqual(dimensions(file),[w,h]);
 }
 checks.push('LinearRaw has no CFA exclusion; file orientation and rendered inputs retain correct frames');
 // A historical document keeps its original layout even with a custom ARP
 // border. The copied reference is upgraded only at the explicit bind boundary.
 await open('bayer.dng');assert.deepEqual([image.width,image.height,image.sourceFrame.border],[184,120,4]);assert.equal(image.adjustments.sourceFrame,undefined);
 result=await render(image.adjustments);
 const capturedReference=(await engine.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[{x:40,y:40}],geometryReference:'current'})).geometryReference;const oldReference={version:1,data:capturedReference.data.replace(/^CaptRAWSourceFrameV1=.*\n/gm,'')};
 const oldSettings={...image.adjustments,masks:[mask(oldReference)]};
 const bound=await engine.call('validate',{artProfile:result.artProfile,adjustments:oldSettings,sourceFrame:image.sourceFrame,sourcePath:image.path,bindSourceFrame:true});assert.equal(bound.masks[0].geometryReference.version,3);
 const oldFrame=image.sourceFrame,oldProfile=result.artProfile;
 await open('bayer.dng',{sourceFramePolicy:'active-area-v1'});result=await render({...image.adjustments,masks:bound.masks});
 const point={x:.3*192,y:.45*128};const mapped=await engine.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:[point],geometryReference:bound.masks[0].geometryReference});
 near(mapped.points[0],{x:.3*184+4,y:.45*120+4},.03);
 const custom=oldProfile.replace(/(\[RAW Bayer\][^[]*?\nBorder=)4\n/,(_,prefix)=>prefix+'0\n');assert.notEqual(custom,oldProfile);
 await open('bayer.dng',{artProfile:custom,sourceFramePolicy:'active-area-v1'});assert.equal(image.sourceFrame.policy,'legacy');assert.equal(image.sourceFrame.border,0);assert.deepEqual([image.width,image.height],[184,120]);
 await render(image.adjustments,custom);
 await engine.call('open',{path:image.path,sessionId:image.id,artProfile:custom,sourceFrame:image.sourceFrame});
 checks.push('old absent policy, v1 reference and explicit Border preserve their canvas; copy binds source frame before warp');
 // Nonzero recorded edge coverage is not a license to paint the newly
 // exposed sensor margin. Test vector and external raster through real native
 // masks, rather than inferring this behavior from a center-coordinate check.
 const edgeAsset=join(root,'edge.png');execFileSync(python,['-c',"from PIL import Image;import sys;Image.new('L',(184,120),255).save(sys.argv[1])",edgeAsset]);
 const raster={path:edgeAsset,sha256:sha(await readFile(edgeAsset)),width:184,height:120};
 const edgeCases=[{...mask(),type:'brush',points:[{x:0,y:.5,radius:.25}]},{...mask(),type:'linear',start:{x:0,y:.5},end:{x:.8,y:.5}},{...mask(),type:'raster',raster}];
 for(const edgeMask of edgeCases){
  await open('bayer.dng');const old=await render({...image.adjustments,masks:[edgeMask]});const recorded=coverage(old.frame.mask.file);
  assert(recorded[60*184]>0,edgeMask.type+' fixture must have nonzero recorded edge coverage');
  const copied=await engine.call('validate',{artProfile:old.artProfile,adjustments:{...image.adjustments,masks:[edgeMask]},sourceFrame:image.sourceFrame,sourcePath:image.path,bindSourceFrame:true});
  await open('bayer.dng',{sourceFramePolicy:'active-area-v1'});const moved=await render({...image.adjustments,masks:copied.masks});const actual=coverage(moved.frame.mask.file);
  let margin=0,difference=0;
  for(let y=0;y<128;++y)for(let x=0;x<192;++x){const v=actual[y*192+x];if(x<4||y<4||x>=188||y>=124)margin=Math.max(margin,v);else difference=Math.max(difference,Math.abs(v-recorded[(y-4)*184+x-4]));}
  assert.equal(margin,0,'unrecorded '+edgeMask.type+' margin remains zero');assert(difference<=1,edgeMask.type+' recorded interior coverage must survive the frame translation');
  checks.push({edge:edgeMask.type,recordedEdge:recorded[60*184],newFourPixelMarginMaximum:margin,retainedInteriorMaximum8BitDifference:difference,semantics:'explicit copy only; zero outside recorded authoring canvas; unchanged half-pixel boundary rule'});
 }
 if(legacy){
  await engine.stop();engine=undefined;
  const oracle=new EngineClient({cache:join(root,'oracle'),executable:resolve(legacy)});
  const samples=[];
  try{
   const old=await oracle.call('open',{path:join(root,'bayer.dng'),sessionId:'old-oracle'});
   for(const border of [4,0,6]){
    const profile=old.artProfile.replace(/(\[RAW Bayer\][^[]*?\nBorder=)4\n/,(_,prefix)=>prefix+border+'\n');
    for(const rotation of [0,90]){
     const adjustments={...old.adjustments,rotation,fineRotation:3,masks:[mask()]};
     const composed=await oracle.call('compose',{path:old.path,width:old.width,height:old.height,artProfile:profile,adjustments});
     const file=join(root,`oracle-${border}-${rotation}.tif`);await oracle.call('export',{path:old.path,artProfile:composed.artProfile,output:file,format:'tiff',colorSpace:'srgb'});
     samples.push({border,rotation,profile,adjustments,hash:sha(pixels(file)),dimensions:dimensions(file)});
    }
   }
  }finally{await oracle.stop();}
  engine=new EngineClient({cache:join(root,'new-oracle'),executable:binary});
  for(const sample of samples){
   await open('bayer.dng',{artProfile:sample.profile});await render(sample.adjustments,sample.profile);
   const composed=await engine.call('compose',{path:image.path,width:image.width,height:image.height,artProfile:sample.profile,adjustments:sample.adjustments});
   const file=join(root,`new-${sample.border}-${sample.rotation}.tif`);await engine.call('export',{path:image.path,artProfile:composed.artProfile,output:file,format:'tiff',colorSpace:'srgb'});
   assert.deepEqual(dimensions(file),sample.dimensions);assert.equal(sha(pixels(file)),sample.hash,'all TIFF16 pixel bytes must equal the prechange binary');
  }
  checks.push('six legacy/custom Border TIFF16 pixel planes exactly equal the separate prechange executable');
 }
 if(process.argv.includes('--cameras'))for(const name of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  image=await engine.call('open',{path:resolve('build/samples',name),sessionId:name,sourceFramePolicy:'active-area-v1'});
  const f=image.sourceFrame;assert.equal(f.border,0);assert.equal(f.decoderModel,'sensor-crop-v1');assert.equal(image.width,f.fullWidth-2*f.border);assert.equal(image.height,f.fullHeight-2*f.border);
  result=await render(image.adjustments);assert.deepEqual([result.frame.fullWidth,result.frame.fullHeight],[image.width,image.height]);
  const target=await engine.call('open',{path:image.path,sessionId:name+'-worker',...{artProfile:result.artProfile,sourceFrame:f}});assert.deepEqual(target.sourceFrame,f);
  checks.push(name+' decoder boundary, fit and independent reopen agree');
 }
 assert.equal(sha(await readFile(binary)),engineSHA,'binary remained frozen throughout native evidence');
 passed=true;console.log(JSON.stringify({engineSHA,checks},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,diagnostics:engine?.diagnostics},null,2));throw error;}
finally{await engine?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained latest source-frame failure:',root);}
