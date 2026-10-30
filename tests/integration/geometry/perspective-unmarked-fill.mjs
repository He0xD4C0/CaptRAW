// Exercise the real ART gate, full-profile projection and isolated batch path.
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
import {adjustmentCommand} from '@captraw/contracts/synchronize';
import {Synchronizer} from '@captraw/desktop-core/presets';
const root=await mkdtemp(join(tmpdir(),'captraw-unmarked-fill-')),path=join(root,'grid.tif'),binary=resolve('build/native/captraw-engine'),sha=b=>createHash('sha256').update(b).digest('hex'),characterize=process.argv.includes('--characterize');let core,passed=false,revision=0;
const field=(profile,group,key)=>{const section=profile.split('['+group+']')[1]?.split('\n[')[0];return section?.split('\n').find(line=>line.startsWith(key+'='))?.slice(key.length+1);};
const mapError=(a,b)=>Math.max(...a.map((p,i)=>Math.hypot(p.x-b[i].x,p.y-b[i].y)));
try{
 await copyFile(resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif'),path);const original=sha(await readFile(path)),engineSHA=sha(await readFile(binary));
 core=new EngineClient({executable:binary,cache:join(root,'cache'),env:{OMP_NUM_THREADS:'2'}});const image=await core.call('open',{path,sessionId:'unmarked-fill',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
 const raw={...image.adjustments.perspective,enabled:true,aspect:1,horizontal:12,vertical:-8,angle:2,shear:3};for(const key of ['manualModel','scale','offsetX','offsetY','constrainCrop'])delete raw[key];
 const base={...image.adjustments,crop:null,rotation:0,flipHorizontal:false,flipVertical:false,fineRotation:0,lensCorrections:false,lensManualDistortion:0,masks:[],spots:[]};
 const profile=image.artProfile.replace(/^AutoFill=.*$/m,'AutoFill=true');assert.equal(field(profile,'Common Properties for Transformations','AutoFill'),'true');
 const points=[{x:250,y:200},{x:500,y:400},{x:750,y:600}],render=async(perspective,artProfile=profile,settings=base)=>{const wait=core.preview(++revision);const updated=await core.call('update',{revision,artProfile,adjustments:{...settings,perspective}});const frame=await wait;const mapped=await core.call('coordinates',{sessionId:image.id,revision,from:'source',to:'display',points});return {profile:updated.artProfile,geometry:updated.geometry,points:mapped.points,pixels:sha(await readFile(frame.file))};};
 const inherited=await render(raw),retained=await render({...raw,manualModel:'art-perspective-v1',scale:1,offsetX:0,offsetY:0,constrainCrop:true});
 const promoted=await render({...raw,manualModel:'signed-framing-v1',aspect:0,scale:1,offsetX:10,offsetY:0,constrainCrop:false});
 const retainedError=mapError(inherited.points,retained.points),notOnlyOffset=Math.max(...inherited.points.map((p,i)=>Math.hypot(promoted.points[i].x-p.x-72,promoted.points[i].y-p.y)));
 assert.equal(retainedError,0);assert.equal(inherited.pixels,retained.pixels);assert(notOnlyOffset>1);
 // Reproduce the Panel's former first-use ART model with an absent fill value.
 const naiveSingle=await render({...raw,manualModel:'art-perspective-v1',offsetX:.072}),correctSingle=await render({...raw,manualModel:'art-perspective-v1',offsetX:.072,constrainCrop:true}),sourceGateError=mapError(naiveSingle.points,correctSingle.points);assert(sourceGateError>1);
 const checks=[];
 for(const fill of [false,true])for(const [name,p,settings] of [
  ['projective',raw,base],
  ['neutral', {...raw,horizontal:0,vertical:0,angle:0,shear:0},base],
  ['fine-distortion-flip',{...raw,horizontal:0,vertical:0,angle:0,shear:0},{...base,fineRotation:3,lensManualDistortion:12,rotation:90,flipHorizontal:true}],
 ]){
  const arp=profile.replace(/^AutoFill=.*$/m,'AutoFill='+fill),before=await render(p,arp,settings),neutral={...p,manualModel:'art-perspective-v1',scale:1,offsetX:0,offsetY:0,constrainCrop:fill},manual=await render(neutral,arp,settings);
  assert.equal(mapError(before.points,manual.points),0,name+' neutral map');assert.equal(before.pixels,manual.pixels,name+' neutral pixels');
  const signedNeutral=await render({...neutral,manualModel:'signed-framing-v1',aspect:0},arp,settings);assert.equal(mapError(before.points,signedNeutral.points),0,name+' signed neutral map');assert.equal(before.pixels,signedNeutral.pixels,name+' signed neutral pixels');
  if(!characterize){
   assert.equal(before.geometry.effectiveFill,fill);assert.deepEqual(before.geometry.perspective,p);
   const sparse={...settings};delete sparse.perspective;const checked=await core.call('validate',{artProfile:before.profile,adjustments:sparse});assert.equal(checked.geometry.effectiveFill,fill);assert.deepEqual(checked.perspective,p);assert.deepEqual(checked.geometry.perspective,p);
   // Explicit model gates take authority over the opposite inherited ARP gate.
   const opposite=await core.call('validate',{artProfile:arp.replace(/^AutoFill=.*$/m,'AutoFill='+!fill),adjustments:{...settings,perspective:neutral}});assert.equal(opposite.geometry.effectiveFill,fill);
  }
  checks.push({name,fill,exactNeutralMap:true,exactNeutralPixels:true});
 }
 if(!characterize){
  for(const fill of [false,true]){
   const settings={...base,fineRotation:3,lensManualDistortion:12},arp=profile.replace(/^AutoFill=.*$/m,'AutoFill='+fill),prior=await render(raw,arp,settings),sparse={...settings};delete sparse.perspective;
   const sourceP={...raw,horizontal:0,vertical:0,angle:0,shear:0,manualModel:'signed-framing-v1',aspect:0,scale:1,offsetX:0,offsetY:0,constrainCrop:!fill},before={...settings,perspective:sourceP},after={...before,perspective:{...sourceP,offsetX:10}},command=adjustmentCommand(before,after,'inherited-'+fill);
   const source={image:{...image,path:join(root,'source-context.tif')},adjustments:before,profile:arp},target={image:{...image,path,name:'omitted-perspective.tif'},adjustments:sparse,profile:prior.profile},service=new Synchronizer(binary,resolve('build/native/resources'),join(root,'sync-'+fill),()=>{});
   const results=await service.run({source,targets:[target],groups:[],command});assert.equal(results.length,1);const result=results[0],expected={...raw,manualModel:'art-perspective-v1',scale:1,offsetX:.072,offsetY:0,constrainCrop:fill};assert.deepEqual(result.adjustments.perspective,expected);assert(!Object.hasOwn(result.adjustments,'effectiveFill'));assert(!JSON.stringify(command).includes('effectiveFill'));
   const actual=await render(result.adjustments.perspective,result.profile,result.adjustments),reference=await render(expected,prior.profile,settings);assert.equal(mapError(actual.points,reference.points),0);assert.equal(actual.pixels,reference.pixels);
   for(const key of ['Horizontal','Vertical','Angle','Shear','Aspect','FocalLength','CropFactor'])assert.equal(field(result.profile,'Perspective',key),field(prior.profile,'Perspective',key),key);
   assert.equal(field(result.profile,'Common Properties for Transformations','AutoFill'),String(fill));assert.equal(field(result.profile,'Perspective','CaptRAWConstrainCrop'),String(fill));assert.equal(target.adjustments.perspective,undefined);
   checks.push({name:'full-ARP sparse target service',fill,exactExpectedMap:true,exactExpectedPixels:true});
   const bypassProfile=(await render({...raw,horizontal:0,vertical:0,angle:0,shear:0,aspect:1.3},arp,settings)).profile,ambiguous={...target,profile:bypassProfile};
   await assert.rejects(service.run({source,targets:[ambiguous],groups:[],command}),/自动填充/);assert.equal(service.previews.size,0);
  }
 }
 assert.equal(sha(await readFile(path)),original);assert.equal(sha(await readFile(binary)),engineSHA);
 passed=true;console.log(JSON.stringify({engineSHA,characterizationOnly:characterize,retainedFillCoordinateErrorPixels:retainedError,naiveSignedPromotionExtraGeometryErrorPixels:notOnlyOffset,naiveSingleSourceGateErrorPixels:sourceGateError,checks,sourceUnchanged:true},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),diagnostics:core?.diagnostics},null,2));throw error;}finally{await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained fill failure:',root);}
