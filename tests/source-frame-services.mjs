// Real independent processors: no source-frame state is synthesized by mocks.
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {Presets,PresetPreview} from '@captraw/desktop-core/presets';
import {BrushPreparation} from '@captraw/desktop-core/brush';
import {ObjectSelection} from '@captraw/desktop-core/object-selection';
import {AutoPerspective} from '@captraw/desktop-core/auto-perspective';
import {BatchExporter} from '@captraw/desktop-core/batch-export';
import {XMP} from '@captraw/desktop-core/xmp';
const root=await mkdtemp(join(tmpdir(),'captraw-source-frame-services-')),python=resolve('build/qa-venv/bin/python');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve('build/native/resources');
let core,sync,brush,objects,hover,perspective,passed=false,stage='';const opens=[],checks=[];
const original=NativeEngine.prototype.call;
NativeEngine.prototype.call=async function(method,p){const result=await original.call(this,method,p);if(method==='open')opens.push({stage,input:structuredClone(p),result:structuredClone(result)});return result;};
try{
 execFileSync(python,['tests/source-frame-fixtures.py',root],{stdio:'pipe'});await copyFile(join(root,'bayer.dng'),join(root,'target.dng'));
 core=new EngineClient({cache:join(root,'core'),executable:binary});
 const old=await core.call('open',{path:join(root,'bayer.dng'),sessionId:'legacy'});
 let wait=core.preview(1);const legacy=await core.call('update',{revision:1,artProfile:old.artProfile,adjustments:old.adjustments});await wait;
 const captured=(await core.call('coordinates',{sessionId:old.id,revision:1,from:'display',to:'reference',points:[{x:40,y:50}],geometryReference:'current'})).geometryReference;const ref={version:1,data:captured.data.replace(/^CaptRAWSourceFrameV1=.*\n/gm,'')};
 const mask={id:'copy',name:'copy',type:'radial',enabled:true,inverted:false,initialized:true,feather:0,brightness:.5,contrast:0,saturation:0,points:[],start:{x:.2,y:.3},end:{x:.4,y:.6},geometryReference:ref};
 const source={image:old,profile:legacy.artProfile,adjustments:{...old.adjustments,masks:[mask]}};
 const image=await core.call('open',{path:join(root,'target.dng'),sessionId:'active',sourceFramePolicy:'active-area-v1'});
 wait=core.preview(2);const active=await core.call('update',{revision:2,artProfile:image.artProfile,adjustments:image.adjustments});await wait;
 const target={image,profile:active.artProfile,adjustments:image.adjustments};
 sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});stage='synchronize';
 const copied=await sync.run({source,targets:[target],groups:['masks']});assert.equal(copied.length,1);assert.equal(copied[0].adjustments.masks[0].geometryReference.version,3);assert.deepEqual(copied[0].adjustments.sourceFrame,image.sourceFrame);assert.equal(source.adjustments.masks[0].geometryReference.version,1);
 checks.push('source v1 binds to its legacy frame only at explicit copy; target processing frame remains active');
 const xmp=new XMP(resolve('build/xmp/captraw-xmp')),store=new Presets(join(root,'presets'),core,join(root,'preset-cache'),xmp);
 const preset=await store.create({name:'Frame',group:'Test',groups:['masks'],adjustments:source.adjustments,artProfile:source.profile,sourceFrame:old.sourceFrame,sourcePath:old.path});
 await mkdir(join(root,'portable'));const file=join(root,'portable/preset.xmp');await store.exportFile(preset.id,file);
 const imported=await store.importFile(file);stage='preset';assert.equal((await store.apply(imported.id,target,sync)).length,1);
 hover=new PresetPreview(store,sync);stage='hover';const preview=await hover.preview({id:imported.id,target,revision:1});assert.equal(preview.results.length,1);await hover.cancel();
 checks.push('portable preset export/import/apply and hover retain target source frame');
 const current=(await core.call('coordinates',{sessionId:image.id,revision:2,from:'display',to:'reference',points:[{x:80,y:60}],geometryReference:'current'})).geometryReference;
 const stroke={id:'stroke',gestureId:'gesture',operation:'paint',flow:50,density:70,feather:30,canvas:{width:192,height:128},points:[{x:.4,y:.5,radius:.15},{x:.5,y:.5,radius:.15}],geometryReference:current,autoMask:{model:'art-deltae-seed-v1',tolerance:10}};
 brush=new BrushPreparation(binary,resources,join(root,'brush'),()=>core);stage='brush';const prepared=await brush.prepare(image,{id:'stroke',sessionId:image.id,revision:2,stroke},image.adjustments,active.artProfile,async()=>{});assert.equal(prepared.coverage.width,192);assert.equal(prepared.coverage.height,128);await brush.cancel();
 checks.push('actual AutoMask guide worker prepares full active canvas');
 objects=new ObjectSelection(binary,resources,'unused-segmenter','unused-models',join(root,'objects'),()=>{});stage='object-guide';const selection=await objects.begin(image,image.adjustments,active.artProfile);assert.deepEqual([selection.width,selection.height],[192,128]);await objects.cancel();
 checks.push('object guide preparation shares the frame; no segmentation model was run');
 perspective=new AutoPerspective(binary,resources,join(root,'perspective'));stage='perspective';
 const lines=[{axis:'horizontal',start:{x:20,y:30},end:{x:170,y:30}},{axis:'horizontal',start:{x:20,y:100},end:{x:170,y:100}},{axis:'vertical',start:{x:40,y:15},end:{x:40,y:115}},{axis:'vertical',start:{x:150,y:15},end:{x:150,y:115}}];
 try{await perspective.run(image.path,{id:'perspective',sessionId:image.id,direction:'both',lines,adjustments:image.adjustments,artProfile:active.artProfile,sourceFrame:image.sourceFrame});}catch(error){assert.match(String(error),/未找到足够可靠|超出支持范围|无法可靠校正/);}
 checks.push('real AutoPerspective worker opens the same frame before fitting');
 await mkdir(join(root,'exports'));const exporter=new BatchExporter(binary,resources,join(root,'batch'),()=>{});stage='batch';
 const results=await exporter.run({documents:[{path:image.path,width:192,height:128,artProfile:active.artProfile,adjustments:image.adjustments}],format:'tiff',colorSpace:'srgb',options:{size:{mode:'original',width:192,height:128,dontEnlarge:true},sharpen:{enabled:false,amount:80,radius:.5}}},join(root,'exports'));assert.equal(results.length,1);assert(results[0].output,JSON.stringify(results));
 const dimensions=JSON.parse(execFileSync(python,['-c',"import tifffile,json,sys;a=tifffile.imread(sys.argv[1]);print(json.dumps([a.shape[1],a.shape[0]]))",results[0].output],{encoding:'utf8'}));assert.deepEqual(dimensions,[192,128]);
 checks.push('Batch compose and loaded-source original-size TIFF use the active frame');
 for(const open of opens){assert.deepEqual(open.input.sourceFrame,image.sourceFrame,open.stage);assert.deepEqual(open.result.sourceFrame,image.sourceFrame,open.stage);assert.equal(open.result.width,192,open.stage);}
 assert.deepEqual(new Set(opens.map(o=>o.stage)),new Set(['synchronize','preset','hover','brush','object-guide','perspective']));
 passed=true;console.log(JSON.stringify({checks,workerOpens:opens.map(o=>({stage:o.stage,width:o.result.width,height:o.result.height,policy:o.result.sourceFrame.policy}))},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,opens,diagnostics:core?.diagnostics},null,2));throw error;}
finally{NativeEngine.prototype.call=original;await hover?.shutdown();sync?.cancel();await brush?.cancel();await objects?.cancel();perspective?.cancel();await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained source-frame service failure:',root);}
