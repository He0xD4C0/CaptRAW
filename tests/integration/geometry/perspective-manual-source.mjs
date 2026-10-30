import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {patchGeometryMapping} from '../../../native/patches/patch-geometry.mjs';
const root=await mkdtemp(join(tmpdir(),'captraw-perspective-manual-source-'));let passed=false;
try{
 const upstream=resolve('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b'),files=['procparams.h','procparams.cc','perspectivecorrection.h','perspectivecorrection.cc','ashift_dt.c','improcfun.h','iptransform.cc','improccoordinator.cc','dcrop.cc'];
 await mkdir(join(root,'src/engine'),{recursive:true});
 for(const file of files)await copyFile(join(upstream,'src/engine',file),join(root,'src/engine',file));
 patchGeometryMapping(root);const once=await Promise.all(files.map(f=>readFile(join(root,'src/engine',f),'utf8')));
 patchGeometryMapping(root);assert.deepEqual(await Promise.all(files.map(f=>readFile(join(root,'src/engine',f),'utf8'))),once);
 assert(once[1].includes('if (perspective.captrawManual)'),'legacy profiles do not gain new serialized controls');
 assert(once[6].includes('(params->perspective.captrawManual && (params->perspective.aspect != (params->perspective.captrawSignedFraming ? 0 : 1) ||'),'aspect-only opt-in reaches the sampler for both models');
 const contracts=await readFile('packages/contracts/index.ts','utf8'),start=contracts.indexOf('export function validatePerspective('),end=contracts.indexOf('export interface Adjustments',start);
 const {validatePerspective}=await import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(contracts.slice(start,end),{mode:'transform'})));
 const base={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1};
 validatePerspective(base);validatePerspective({...base,manualModel:'art-perspective-v1',scale:.1,offsetX:.5,offsetY:-.5,constrainCrop:true});
 for(const change of [{scale:1},{manualModel:'unknown'},{manualModel:'art-perspective-v1',scale:0},{manualModel:'art-perspective-v1',offsetX:.721},{manualModel:'art-perspective-v1',constrainCrop:1}])assert.throws(()=>validatePerspective({...base,...change}));
 const sync=await readFile('packages/contracts/synchronize.ts','utf8'),syncStart=sync.indexOf('const editDefaults='),syncEnd=sync.indexOf('export interface CameraExposureMatch',syncStart);
 const commands=await import('data:text/javascript,'+encodeURIComponent(`import {mergeAdjustmentPatch,validateCurveRefine} from '${pathToFileURL(resolve('packages/contracts/dist/index.js')).href}';\nconst validatePerspective=${validatePerspective.toString()};\n`+stripTypeScriptTypes(sync.slice(syncStart,syncEnd),{mode:'transform'})));
 const old={perspective:base},newModel={...base,manualModel:'art-perspective-v1',scale:1.2};
 const command=commands.adjustmentCommand({perspective:{...newModel,scale:1.1}},{perspective:newModel},'scale-only');
 assert.equal(command.merge.perspective.manualModel,'art-perspective-v1','linked scalar edits carry the model even when unchanged on the source');
 assert.equal(commands.applyEditCommand(old,command,{effectiveFill:true}).perspective.scale,1.2);
 assert.equal(commands.applyEditCommand({perspective:{...base,enabled:false}},command,{effectiveFill:true}).perspective.enabled,true,'a scalar edit from an already-enabled source must enable a disabled target');
 const reset=commands.adjustmentCommand({perspective:newModel},old,'remove-model');
 assert.deepEqual(commands.applyEditCommand({perspective:newModel},reset).perspective,base,'group reset removes optional model fields rather than leaving them in a sparse merge');
 passed=true;console.log('PASS manual perspective schema and ART patch anchors/idempotence; legacy serialization and opt-in sampler gate');
}catch(error){await writeFile(join(root,'failure.txt'),String(error.stack||error));throw error;}
finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained manual source failure:',root);}
