// Old-domain fingerprints are captured only from an explicitly pinned old core.
// Verification never rewrites that evidence or any repository golden.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {EngineClient} from '../../support/engine-client.mjs';
const arg=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3),capture=process.argv.includes('--capture-legacy'),run=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const binary=resolve('build/native/captraw-engine'),path=resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif'),engineSHA=sha(await readFile(binary)),sourceSHA=sha(await readFile(path)),python=resolve('build/qa-venv/bin/python');
if(capture){assert(arg('engine-sha'),'Pin the prechange engine with --engine-sha');assert.equal(engineSHA,arg('engine-sha'));}else assert(arg('baseline'),'Supply the existing --baseline=<prechange.json>; verification cannot recapture it');
const root=await mkdtemp(join(tmpdir(),'captraw-offset-native-'));let core,worker,passed=false,revision=0;
const patch=(profile,key,value)=>{const i=profile.indexOf('[Perspective]\n');assert(i>=0);let j=profile.indexOf('\n[',i+1);if(j<0)j=profile.length;const group=profile.slice(i,j),re=new RegExp('^'+key+'=.*$','m');assert(re.test(group));return profile.slice(0,i)+group.replace(re,key+'='+value)+profile.slice(j);};
const inspect=async file=>JSON.parse((await run(python,['-c','import tifffile,numpy as np,hashlib,json,sys\na=tifffile.imread(sys.argv[1]);assert a.dtype==np.uint16;print(json.dumps(dict(shape=list(a.shape),sha256=hashlib.sha256(a.tobytes()).hexdigest())))',file])).stdout);
try{
 const baseline=capture?undefined:JSON.parse(await readFile(resolve(arg('baseline')))),baselineHash=capture?undefined:sha(await readFile(resolve(arg('baseline'))));
 if(baseline){assert.notEqual(engineSHA,baseline.engineSHA,'Verification needs a different candidate core');assert.equal(sourceSHA,baseline.sourceSHA);}
 core=new EngineClient({executable:binary,cache:join(root,'core'),env:{OMP_NUM_THREADS:'2'}});worker=new EngineClient({executable:binary,cache:join(root,'worker'),env:{OMP_NUM_THREADS:'2'}});
 const image=await core.call('open',{path,sessionId:'offset-native',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'}),baseProfile=baseline?.baseProfile??image.artProfile;
 const original={enabled:true,manualModel:'art-perspective-v1',horizontal:8,vertical:-6,angle:1.25,shear:2.5,focalLength:24,cropFactor:1.5,aspect:1.2,scale:1.4,offsetX:.03,offsetY:-.04,constrainCrop:false},settings={...image.adjustments,crop:null,rotation:90,fineRotation:2,flipHorizontal:true,flipVertical:false,lensCorrections:false,lensManualDistortion:5,masks:[],spots:[],perspective:original};
 const render=async(adjustments,profile=baseProfile)=>{const wait=core.preview(++revision),result=await core.call('update',{revision,adjustments,artProfile:profile}),frame=await wait,points=[{x:.15*frame.fullWidth,y:.2*frame.fullHeight},{x:.5*frame.fullWidth,y:.5*frame.fullHeight},{x:.85*frame.fullWidth,y:.8*frame.fullHeight}],mapped=await core.call('coordinates',{sessionId:image.id,revision,from:'source',to:'display',points});return {...result,points:mapped.points,frame};};
 const output=async(profile,name)=>{const file=join(root,name+'.tif');await worker.call('export',{path,artProfile:profile,output:file,format:'tiff',colorSpace:'srgb'});const data=await inspect(file);await rm(file);return data;};
 const legacy=baseline?.legacy??[
  ['base',{}],['x-minus-half',{offsetX:-.5}],['x-plus-half',{offsetX:.5}],['y-minus-half',{offsetY:-.5}],['y-plus-half',{offsetY:.5}],
  ['minimum-scale-fill',{scale:.1,offsetX:.5,offsetY:-.5,constrainCrop:true}],['maximum-scale-fill',{scale:4,offsetX:-.5,offsetY:.5,constrainCrop:true}],['disabled',{enabled:false,scale:.1,offsetX:.5,constrainCrop:true}],
  ['unmarked',{manualModel:undefined,scale:undefined,offsetX:undefined,offsetY:undefined,constrainCrop:undefined}],
 ].map(([name,change])=>{const perspective={...original,...change};for(const key of Object.keys(perspective))if(perspective[key]===undefined)delete perspective[key];return {name,adjustments:{...settings,perspective}};});
 for(const row of legacy){const result=await render(row.adjustments),pixels=await output(result.artProfile,row.name);if(capture){row.pixels=pixels;row.points=result.points;}else{assert.deepEqual(pixels,row.pixels,row.name+' old-domain TIFF16 pixel bytes');assert.deepEqual(result.points,row.points,row.name+' old-domain coordinates');}}
 if(capture){const directory=await mkdtemp(join(tmpdir(),'captraw-offset-prechange-')),file=join(directory,'prechange.json');await writeFile(file,JSON.stringify({engineSHA,sourceSHA,baseProfile,legacy},null,2));passed=true;console.log(JSON.stringify({prechange:file,engineSHA,legacyCases:legacy.length,repositoryGoldensUntouched:true}));}
 else{
  const checks=[];
  for(const [axis,sign] of [['offsetX',1],['offsetX',-1],['offsetY',1],['offsetY',-1]]){
   const p={...original,[axis]:sign*.72},result=await render({...settings,perspective:p}),pixels=await output(result.artProfile,axis+sign),signed={...p,manualModel:'signed-framing-v1',aspect:-100,scale:1.4/Math.sqrt(1.2),offsetX:p.offsetX/.0072,offsetY:-p.offsetY/.0072},lowered=await render({...settings,perspective:signed});
   assert.deepEqual(await output(lowered.artProfile,axis+sign+'-signed'),pixels);assert.deepEqual(lowered.points,result.points);
   await render({...settings,perspective:p});const at={x:400,y:500},reference=await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[at],geometryReference:'current'}),back=await core.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:reference.points,geometryReference:reference.geometryReference});assert(Math.hypot(back.points[0].x-at.x,back.points[0].y-at.y)<.025);
   assert.equal((await core.call('validate',{artProfile:baseProfile,adjustments:{...settings,perspective:p}})).perspective[axis],sign*.72);
   checks.push({axis,offset:sign*.72,exactTIFF16:true,exactCoordinates:true,referenceAccepted:true});
  }
  const valid=await render(settings),sparse={...settings};delete sparse.perspective;
  for(const offset of [.55,.72]){
   const invalid={...original,scale:.1,offsetX:offset,constrainCrop:true};await assert.rejects(core.call('validate',{artProfile:valid.artProfile,adjustments:{...settings,perspective:invalid}}),/可见交集/);
   let bad=patch(valid.artProfile,'CaptRAWScale',.1);bad=patch(bad,'CaptRAWOffsetX',offset);bad=patch(bad,'CaptRAWConstrainCrop','true');await assert.rejects(core.call('validate',{artProfile:bad,adjustments:sparse}),/可见交集/);
   const outputFile=join(root,'must-not-publish-'+offset+'.tif');await assert.rejects(worker.call('export',{path,artProfile:bad,output:outputFile,format:'tiff',colorSpace:'srgb'}),/可见交集/);assert(!existsSync(outputFile));
   const at={x:400,y:500},record=await core.call('coordinates',{sessionId:image.id,revision,from:'display',to:'reference',points:[at],geometryReference:'current'}),reference={...record.geometryReference,data:patch(patch(patch(record.geometryReference.data,'CaptRAWScale',.1),'CaptRAWOffsetX',offset),'CaptRAWConstrainCrop','true')};await assert.rejects(core.call('coordinates',{sessionId:image.id,revision,from:'reference',to:'display',points:[at],geometryReference:reference}),/可见交集/);
  }
  for(const change of [{offsetX:.720001},{offsetY:-.720001}])await assert.rejects(core.call('validate',{artProfile:baseProfile,adjustments:{...settings,perspective:{...original,...change}}}));
  assert.equal(sha(await readFile(resolve(arg('baseline')))),baselineHash,'Never rewrite old-core evidence');passed=true;console.log(JSON.stringify({engineSHA,baselineEngineSHA:baseline.engineSHA,legacyExactCases:legacy.length,expandedCases:checks,emptyAndNegativeIntersectionsRejectedAtJSON_ARP_Export_Reference:true,outputNotPublished:true,baselineUnchanged:true}));
 }
 assert.equal(sha(await readFile(binary)),engineSHA);assert.equal(sha(await readFile(path)),sourceSHA);
}catch(error){passed=false;await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),stderr:error.stderr,stdout:error.stdout,engineSHA,diagnostics:core?.diagnostics},null,2));throw error;}finally{await worker?.stop();await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained native range failure:',root);}
