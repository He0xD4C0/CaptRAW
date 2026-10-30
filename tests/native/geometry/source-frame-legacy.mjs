// Capture with the explicitly pinned prechange core, verify with a later core.
// Baseline TIFFs are independent evidence, never regenerated during verification.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
const capture=process.argv.includes('--capture'),option=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3);
const root=option('directory')?resolve(option('directory')):capture?await mkdtemp(join(tmpdir(),'captraw-source-frame-legacy-')):undefined;
assert(root,'Verification requires --directory=<existing capture>');await mkdir(root,{recursive:true});
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),python=resolve('build/qa-venv/bin/python');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),engineSHA=sha(await readFile(binary));
const inspect=file=>JSON.parse(execFileSync(python,['-c',"import hashlib,tifffile,json,sys;a=tifffile.imread(sys.argv[1]);print(json.dumps({'shape':list(a.shape),'dtype':str(a.dtype),'sha256':hashlib.sha256(a.tobytes()).hexdigest()}))",file],{encoding:'utf8'}));
let engine,passed=false,revision=0;
try{
 if(capture)assert.equal(engineSHA,'a6c71c3fb28d02322dc3f3613aa720c9128f3c0cb90809d8840d38174b707766','Capture must use the actual pinned prechange core');
 const source=join(root,'bayer.dng');if(capture)execFileSync(python,['tests/fixtures/generators/source-frame-fixtures.py',root],{stdio:'pipe'});
 const previous=capture?undefined:JSON.parse(await readFile(join(root,'baseline.json'),'utf8'));
 if(previous){assert.notEqual(engineSHA,previous.engineSHA,'Do not compare the old core with itself');assert.equal(sha(await readFile(source)),previous.sourceSHA);}
 engine=new EngineClient({cache:join(root,capture?'capture-cache':'verify-cache'),executable:binary});
 const image=await engine.call('open',{path:source,sessionId:'legacy-source-frame'});
 const render=async(adjustments,artProfile)=>{const waiting=engine.preview(++revision);const result=await engine.call('update',{revision,adjustments,artProfile,maskId:adjustments.masks[0]?.id||''});return {...result,frame:await waiting};};
 const rows=[];
 if(capture){
  assert.equal(image.sourceFrame,undefined,'This is prechange evidence');
  for(const border of [4,0,6]){
   const profile=image.artProfile.replace(/(\[RAW Bayer\][^[]*?\nBorder=)4\n/,(_,prefix)=>prefix+border+'\n');
   const author={...image.adjustments,fineRotation:2,lensManualDistortion:8,perspective:{enabled:true,horizontal:5,vertical:-3,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1}};
   const authored=await render(author,profile);
   const reference=(await engine.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[{x:45,y:55}],geometryReference:'current'})).geometryReference;assert.equal(reference.version,1);
   const mask={id:'old-v1',name:'Old v1 geometry',type:'radial',enabled:true,inverted:false,initialized:true,referenceAngle:2,geometryReference:reference,feather:12,brightness:.5,contrast:0,saturation:0,points:[],start:{x:.1,y:.15},end:{x:.6,y:.7}};
   const spot={id:'clone',name:'Old clone',enabled:true,method:'clone',source:{x:.2,y:.3},target:{x:.65,y:.65},radius:8,feather:20,opacity:75,detail:0,sourceMode:'manual'};
   for(const rotation of [0,90]){
    const adjustments={...author,rotation,fineRotation:-3,lensManualDistortion:-6,masks:[mask],crop:{x:.05,y:.08,width:.85,height:.8},spots:[spot]};
    const updated=await render(adjustments,profile),composed=await engine.call('compose',{path:source,width:image.width,height:image.height,artProfile:profile,adjustments});
    const name=`border-${border}-rotation-${rotation}`,file=join(root,name+'.tif');await engine.call('export',{path:source,artProfile:composed.artProfile,output:file,format:'tiff',colorSpace:'srgb'});
    rows.push({name,border,rotation,openWidth:image.width,openHeight:image.height,frameWidth:updated.frame.fullWidth,frameHeight:updated.frame.fullHeight,artProfile:profile,adjustments,output:inspect(file)});
   }
  }
  await writeFile(join(root,'baseline.json'),JSON.stringify({engineSHA,sourceSHA:sha(await readFile(source)),rows},null,2));
  console.log(JSON.stringify({directory:root,engineSHA,rows:rows.map(({name,openWidth,openHeight,frameWidth,frameHeight,output})=>({name,openWidth,openHeight,frameWidth,frameHeight,output}))},null,2));
 }else{
  for(const row of previous.rows){
   const updated=await render(row.adjustments,row.artProfile);assert.deepEqual([image.width,image.height,updated.frame.fullWidth,updated.frame.fullHeight],[row.openWidth,row.openHeight,row.frameWidth,row.frameHeight]);
   const composed=await engine.call('compose',{path:source,width:image.width,height:image.height,artProfile:row.artProfile,adjustments:row.adjustments});
   const file=join(root,row.name+'-new.tif');await engine.call('export',{path:source,artProfile:composed.artProfile,output:file,format:'tiff',colorSpace:'srgb'});
   assert.deepEqual(inspect(file),row.output,row.name+' old v1 mask/crop/repair TIFF16 pixel bytes');await rm(file);
  }
  console.log(JSON.stringify({engineSHA,baselineEngineSHA:previous.engineSHA,exactLegacyCases:previous.rows.length},null,2));
 }
 passed=true;
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),engineSHA,diagnostics:engine?.diagnostics},null,2));throw error;}
finally{await engine?.stop();if(passed)await rm(join(root,capture?'capture-cache':'verify-cache'),{recursive:true,force:true});else console.error('Retained latest source-frame legacy failure:',root);}
