import assert from 'node:assert/strict';
import {mkdirSync,rmSync,readFileSync,writeFileSync,copyFileSync,readdirSync,cpSync} from 'node:fs';
import {resolve,join,basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {BatchDocumentSaver,Documents,validateBatchSave} from '@captraw/desktop-core/documents';
import {XMP,lookup} from '@captraw/desktop-core/xmp';
import {restoreRecipeMasks,saveRecipeWithMasks} from '@captraw/desktop-core/mask-assets';
import {EngineClient} from './engine-client.mjs';
const out=resolve(process.env.CAPTRAW_BATCH_SAVE_OUT||'artifacts/batch-save');mkdirSync(out,{recursive:true});
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),engine=new EngineClient({executable:binary,resources,cache:join(out,'core')});
let callback=()=>{},revision=0;const saver=new BatchDocumentSaver(binary,resources,join(out,'workers'),documents,message=>callback(message));
const checks=[],sources={},pairs=[],hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),pass=s=>{checks.push(s);console.log('PASS',s);};
const directory=name=>{const p=join(out,name);rmSync(p,{recursive:true,force:true});mkdirSync(p,{recursive:true});return p;};
const packet='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:u="https://example.invalid/metadata/" u:Keep="保留未知属性"/></rdf:RDF></x:xmpmeta>';
try{
 const snapshots=[],expected=[];
 for(const [i,name] of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF'].entries()){
  const path=resolve('build/samples',name);sources[path]=hash(path);const image=await engine.call('open',{path,sessionId:name});
  const artProfile=(await engine.call('save')).artProfile,adjustments={...image.adjustments,exposure:.3+i*.2,rotation:90,crop:{x:.1,y:.1,width:.12,height:.13}};
  const next=engine.preview(++revision),rendered=await engine.call('update',{revision,adjustments,artProfile});await next;
  snapshots.push({path,width:image.width,height:image.height,artProfile,adjustments,xmpPacket:packet});expected.push(rendered.artProfile);
 }
 const dest=directory('三种 RAW'),sentinel=join(dest,'nikon-d850.xmp');writeFileSync(sentinel,'existing XMP');
 const result=await saver.run({documents:snapshots},dest);assert.equal(result.cancelled,false);assert.equal(result.results.length,3);
 for(const [i,r] of result.results.entries()){
  assert(r.output&&!r.error,JSON.stringify(r));const saved=await documents.read(r.output);assert.equal(saved.artProfile,expected[i]);assert.deepEqual(saved.adjustments,snapshots[i].adjustments);assert.equal(saved.source.sha256,sources[r.source]);
  assert.equal(lookup((await xmp.read(r.output)).properties,'https://example.invalid/metadata/','Keep').value,'保留未知属性');
 }
 assert.equal(readFileSync(sentinel,'utf8'),'existing XMP');assert(result.results[0].output.endsWith('_1.xmp'));
 pass('real NEF/CR3/RAF snapshots compose current edits over stale profiles, preserve metadata/source identity and retain existing XMP');
 await engine.call('export',{path:snapshots[0].path,artProfile:expected[0],output:join(out,'expected.tiff'),format:'tiff'});
 await engine.call('export',{path:snapshots[0].path,artProfile:(await documents.read(result.results[0].output)).artProfile,output:join(out,'saved.tiff'),format:'tiff'});pairs.push(['expected.tiff','saved.tiff']);
 const inputs=directory('same-name-input');for(const n of ['一','二']){mkdirSync(join(inputs,n));copyFileSync('build/samples/synthetic.dng',join(inputs,n,'同名 原片.dng'));}
 const image=await engine.call('open',{path:join(inputs,'一/同名 原片.dng'),sessionId:'assets'}),base={path:image.path,width:image.width,height:image.height,artProfile:(await engine.call('save')).artProfile,adjustments:image.adjustments};
 const same=[base,{...structuredClone(base),path:join(inputs,'二/同名 原片.dng')}],sameDir=directory('same-name-output');
 const duplicates=await saver.run({documents:same},sameDir);assert.equal(new Set(duplicates.results.map(r=>r.output)).size,2);assert(duplicates.results.every(r=>r.output));
 pass('same Chinese basenames from different source folders get distinct usable XMP files');
 const mutable={documents:[structuredClone(base)]},snapshotDir=directory('snapshot');const pending=saver.run(mutable,snapshotDir);mutable.documents[0].adjustments.exposure=4;mutable.documents[0].path='missing';const captured=await pending;
 assert.equal((await documents.read(captured.results[0].output)).adjustments.exposure,base.adjustments.exposure);
 const mixed=await saver.run({documents:[same[0],{...base,path:join(inputs,'missing.dng')},same[1]]},directory('mixed'));
 assert(mixed.results[0].output&&mixed.results[1].error&&mixed.results[2].output);assert.match(mixed.results[1].error,/恢复原片/);pass('immutable snapshots and actionable per-file failure preserve completed results and continue later files');
 callback=()=>saver.cancel();const cancelled=await saver.run({documents:same},directory('cancel'));callback=()=>{};
 assert(cancelled.cancelled);assert.equal(cancelled.results.length,1);assert(cancelled.results[0].output);assert.equal(saver.active,false);
 pass('stop request completes the current atomic document, skips remaining photos and releases the queue');
 const brokenCache=join(out,'unwritable-cache');writeFileSync(brokenCache,'not a directory');
 const broken=new BatchDocumentSaver(binary,resources,brokenCache,documents,()=>{}),brokenResult=await broken.run({documents:same},directory('startup-failure'));
 assert.equal(brokenResult.results.length,2);assert(brokenResult.results.every(r=>r.error&&!r.output));assert.equal(broken.active,false);
 const missingBinary=new BatchDocumentSaver(join(out,'missing-engine'),resources,join(out,'missing-worker'),documents,()=>{});
 assert((await missingBinary.run({documents:[base]},directory('missing-binary'))).results[0].error);assert.equal(missingBinary.active,false);
 pass('worker startup failure returns per-file errors without hanging or leaving the queue locked');
 const assets=directory('original-assets'),mask=join(assets,'mask.png'),icc=join(assets,'input.icc');
 execFileSync('build/qa-venv/bin/python',['-c','from PIL import Image;import numpy as np,sys;a=np.zeros((48,64),dtype=np.uint8);a[:,16:48]=255;Image.fromarray(a).save(sys.argv[1])',mask]);
 copyFileSync(join(resources,'iccprofiles/output/RTv4_sRGB.icc'),icc);
 const a={...base.adjustments,colorProfile:{mode:'inherited',reference:'file:'+icc,toneCurve:false,lookTable:false,hueSatMap:true,baselineExposure:true,illuminant:0},masks:[{id:'raster',name:'测试选区',type:'raster',enabled:true,inverted:false,feather:10,brightness:.4,contrast:0,saturation:0,points:[],start:{x:0,y:0},end:{x:1,y:1},raster:{path:mask,sha256:hash(mask),width:64,height:48}}]};
 const portable=await saver.run({documents:[{...base,adjustments:a}]},directory('portable'));assert(portable.results[0].output,JSON.stringify(portable));
 const original=portable.results[0].output,saved=await documents.read(original);assert.equal(saved.maskAssets.files.length,1);assert(saved.inputProfileAsset);
 const referenceProfile=(await engine.call('compose',{...base,adjustments:a})).artProfile;await engine.call('export',{path:base.path,artProfile:referenceProfile,output:join(out,'asset-reference.tiff'),format:'tiff'});
 const moved=directory('移动 配方');copyFileSync(original,join(moved,'重命名.xmp'));cpSync(original+'.assets',join(moved,basename(original)+'.assets'),{recursive:true});rmSync(assets,{recursive:true});
 const restored=await restoreRecipeMasks(engine,join(moved,'重命名.xmp'),await documents.read(join(moved,'重命名.xmp')),join(out,'restored'));
 await engine.call('export',{path:base.path,artProfile:restored.artProfile,output:join(out,'asset-restored.tiff'),format:'tiff'});pairs.push(['asset-reference.tiff','asset-restored.tiff']);
 pass('raster mask and ICC assets survive moving/renaming the XMP and deleting original asset files');
 const raced=join(out,'raced.xmp');rmSync(raced,{force:true});
 const raceCore={call:async(method,params)=>{if(method==='publish'&&params.destination===raced)writeFileSync(raced,'another writer');return engine.call(method,params);}};
 const falseResult=await saveRecipeWithMasks(raceCore,raced,await documents.read(result.results[0].output),value=>documents.serialize(value),false);
 assert.equal(falseResult,false);assert.equal(readFileSync(raced,'utf8'),'another writer');pass('a concurrent destination writer is protected by atomic no-replace publication');
 for(const invalid of [{documents:[]},{documents:[base,base]},{documents:[{...base,width:0}]},{documents:[{...base,path:'relative.dng'}]}])assert.throws(()=>validateBatchSave(invalid));
 for(const [path,before] of Object.entries(sources))assert.equal(hash(path),before);assert(!readdirSync(dest).some(name=>name.endsWith('.tmp')));
 pass('invalid requests fail before writes, temporary files are cleaned, and original RAW hashes remain unchanged');
 execFileSync('build/qa-venv/bin/python',['-c','import tifffile,numpy as np,json,sys;from pathlib import Path;p=Path(sys.argv[1]);pairs=json.loads(sys.argv[2]);r=[]\nfor a,b in pairs:\n x,y=tifffile.imread(p/a),tifffile.imread(p/b);assert x.dtype==y.dtype==np.uint16 and np.array_equal(x,y);r.append({"first":a,"second":b,"shape":list(x.shape),"dtype":str(x.dtype),"maximumDifference":0})\n(p/"pixels.json").write_text(json.dumps(r,indent=2)+"\\n")',out,JSON.stringify(pairs)]);
}finally{await engine.stop();writeFileSync(join(out,'report.json'),JSON.stringify({checks,sources,pairs,engine:binary},null,2)+'\n');}
