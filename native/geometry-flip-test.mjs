// Requires the newly linked flip-capable core. This script never builds it.
import assert from 'node:assert/strict';
import {mkdtemp,rm,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EngineClient} from '../tests/engine-client.mjs';
const scratch=await mkdtemp(join(tmpdir(),'captraw-native-flip-'));
const source=join(scratch,'source.png'),python=resolve('build/qa-venv/bin/python');
let core,passed=false,revision=0;
const near=(a,b)=>assert(Math.hypot(a.x-b.x,a.y-b.y)<.02,JSON.stringify({a,b}));
const rotate=(p,r)=>r===90?{x:1-p.y,y:p.x}:r===180?{x:1-p.x,y:1-p.y}:r===270?{x:p.y,y:1-p.x}:p;
try{
 execFileSync(python,['-c',"from PIL import Image,ImageDraw;import sys;im=Image.new('RGB',(1024,768),(96,96,96));d=ImageDraw.Draw(im);d.rectangle((346,335,370,359),fill=(35,80,160));im.save(sys.argv[1])",source]);
 core=new EngineClient({cache:join(scratch,'cache')});const errors=[];core.on('error',e=>errors.push(e));
 const image=await core.call('open',{path:source,sessionId:'flip'});
 const update=async(adjustments,artProfile=image.artProfile)=>{
  const waiting=core.preview(++revision);const result=await core.call('update',{revision,artProfile,adjustments,maskId:adjustments.masks[0]?.id||''});
  return {...result,frame:await waiting};
 };
 const coordinates=(from,to,points,geometryReference)=>core.call('coordinates',{sessionId:'flip',revision,from,to,points,geometryReference});
 const base={...image.adjustments,lensCorrections:false,fineRotation:0,crop:null,rotation:0,flipHorizontal:false,flipVertical:false};
 await update(base);const reference=(await coordinates('display','reference',[{x:358,y:347}],'current')).geometryReference;
 const leaf={id:'anchor',name:'anchor',type:'radial',enabled:true,inverted:false,feather:0,brightness:.5,contrast:0,saturation:0,
  points:[],start:{x:.3,y:.39},end:{x:.4,y:.51},initialized:true,geometryReference:reference};
 const cases=[];
 // New snapshots and old angle-only masks both follow the same image content.
 for(const legacy of [false,true])for(const rotation of [0,90,180,270])for(const flipHorizontal of [false,true])for(const flipVertical of [false,true]){
  const mask={...leaf};if(legacy)delete mask.geometryReference;
  const adjustments={...base,rotation,flipHorizontal,flipVertical,masks:[mask]};
  const result=await update(adjustments);
  assert.equal(result.geometry.flipHorizontal,flipHorizontal,'Use the freshly linked flip-capable core');assert.equal(result.geometry.flipVertical,flipVertical);
  const width=result.frame.fullWidth,height=result.frame.fullHeight;
  const normalized=rotate({x:358/1023,y:347/767},rotation),unflipped={x:normalized.x*(width-1),y:normalized.y*(height-1)};
  const expected={x:flipHorizontal?width-1-unflipped.x:unflipped.x,y:flipVertical?height-1-unflipped.y:unflipped.y};
  const displayed=(await coordinates('source','display',[unflipped])).points[0];near(displayed,expected);
  near((await coordinates('display','source',[displayed])).points[0],unflipped);
  const maskFile=join(scratch,`mask-${cases.length}.png`);assert(result.frame.mask);await copyFile(result.frame.mask.file,maskFile);
  const alpha=Number(execFileSync(python,['-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]).getchannel('A');x=round(float(sys.argv[2])*im.width/float(sys.argv[4]));y=round(float(sys.argv[3])*im.height/float(sys.argv[5]));print(im.getpixel((x,y)))",maskFile,String(expected.x),String(expected.y),String(width),String(height)],{encoding:'utf8'}));
  assert(alpha>180,`mask lost anchor: ${JSON.stringify({legacy,rotation,flipHorizontal,flipVertical,alpha})}`);
  cases.push({legacy,rotation,flipHorizontal,flipVertical,alpha});
 }
 // Authored while flipped, then changed again: the reference canvas must not
 // silently become the current canvas when only coarse reflection changes.
 const authored={...base,flipHorizontal:true,flipVertical:false};await update(authored);
 const snapshot=await coordinates('display','reference',[{x:665,y:347}],'current');
 const authoredMask={...leaf,geometryReference:snapshot.geometryReference,start:{x:.6,y:.39},end:{x:.7,y:.51}};
 for(const flipHorizontal of [true,false]){
  await update({...authored,flipHorizontal,masks:[authoredMask]});
  const q=(await coordinates('reference','display',[{x:665,y:347}],snapshot.geometryReference)).points[0];
  near(q,{x:flipHorizontal?665:358,y:347});
 }
 // Undo is allowed to restore absence. An empty profile must use the initial
 // canvas, whereas a nonempty historical ARP owns its inherited coarse flips.
 const pixels=frame=>createHash('sha256').update(readFileSync(frame.file)).digest('hex');
 await core.call('open',{path:source,sessionId:'flip'});
 const absent={...image.adjustments,crop:null,masks:[]};delete absent.flipHorizontal;delete absent.flipVertical;
 const neutral=await update(absent,'');const original=pixels(neutral.frame);
 for(const key of ['flipHorizontal','flipVertical']){
  const changed=await update({...absent,[key]:true},'');assert.notEqual(pixels(changed.frame),original);
  const undone=await update(absent,'');assert.equal(pixels(undone.frame),original,'empty-profile undo must restore absent '+key);
  assert.equal(undone.geometry[key],false);
  const explicit=await update({...absent,[key]:false},'');assert.equal(pixels(explicit.frame),original);
 }
 for(const [flipHorizontal,flipVertical] of [[true,false],[false,true],[true,true]]){
  const inherited=await update({...absent,flipHorizontal,flipVertical},image.artProfile),inheritedPixels=pixels(inherited.frame);
  const adopted=await update(absent,inherited.artProfile);assert.equal(pixels(adopted.frame),inheritedPixels);
  assert.equal(adopted.geometry.flipHorizontal,flipHorizontal);assert.equal(adopted.geometry.flipVertical,flipVertical);
  near((await coordinates('source','display',[{x:358,y:347}])).points[0],{x:flipHorizontal?665:358,y:flipVertical?420:347});
  await update({...absent,flipHorizontal:false,flipVertical:false},inherited.artProfile);
  const restored=await update(absent,inherited.artProfile);assert.equal(pixels(restored.frame),inheritedPixels);
 }
 // Simulate a pre-flip-control ARP: its mask and clone were authored on the
 // inherited mirrored display. No point rewrite is allowed when flipping it.
 const seed=await update({...absent,flipHorizontal:true},image.artProfile);
 const legacyProfile=seed.artProfile.replace(/^CaptRAWSourceBasis(?:Horizontal|Vertical)?=.*\n/gm,'');
 const legacyData={...absent,masks:[{...leaf,geometryReference:undefined,start:{x:.60,y:.39},end:{x:.70,y:.51}}],spots:[{
  id:'clone',name:'Legacy clone',enabled:true,method:'clone',source:{x:665/1023,y:347/767},target:{x:.25,y:.7},radius:30,feather:0,opacity:100,detail:0,sourceMode:'manual'}]};
 const inheritedCanvas=await update(legacyData,legacyProfile),inheritedCanvasPixels=pixels(inheritedCanvas.frame);
 const unmirrored=await update({...legacyData,flipHorizontal:false},inheritedCanvas.artProfile);
 assert.equal(unmirrored.geometry.sourceFlipHorizontal,true,'Inherited anchor canvas remains readonly metadata');
 near((await coordinates('source','display',[{x:665,y:347}])).points[0],{x:358,y:347});
 assert.equal(pixels((await update({...legacyData,flipHorizontal:false},unmirrored.artProfile)).frame),pixels(unmirrored.frame),'Replaying the saved native basis must not apply reflection twice');
 const mirroredAgain=await update({...legacyData,flipHorizontal:true},unmirrored.artProfile);
 assert.equal(pixels(mirroredAgain.frame),inheritedCanvasPixels,'Legacy mask and clone pixels restore without changing stored points');
 await update({...absent,fineRotation:13},'');
 const missingAngle={...absent};delete missingAngle.fineRotation;
 assert.equal((await update(missingAngle,'')).geometry.angle,13,'empty-profile restoration only resets new flips, not old optional controls');
 assert.deepEqual(errors,[]);passed=true;console.log(JSON.stringify({passed,cases:cases.length,checks:['all coarse rotations and both flip flags','unflipped source coordinate contract','new and no-reference mask coverage','authoring on a mirrored canvas','empty-profile undo to absent controls','nonempty ARP inherits and restores existing flips']},null,2));
}finally{
 await core?.stop();if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained latest failure:',scratch);
}
