// Actual SDK ownership lifecycle and sealed native-active inputs; no render/build.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {XMP,CRS,lookup,readExtension,decodeAdjustments} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
const root=await mkdtemp(join(tmpdir(),'captraw-signed-xmp-')),xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),sha=b=>createHash('sha256').update(b).digest('hex');let passed=false;
try{
 const p={enabled:false,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:25,manualModel:'signed-framing-v1',scale:1.1,offsetX:10,offsetY:-10,constrainCrop:false};
 const original=resolve('artifacts/stage-0/acr-reference/source/acr-geometry-grid.tif'),bytes=await readFile(original);await copyFile(original,join(root,'source.tif'));
 const base={source:{path:'source.tif',size:bytes.length,sha256:sha(bytes)},artProfile:'',adjustments:{perspective:p}},file=join(root,'edit.xmp');let packet;
 for(const [name,perspective] of [['disabled',p],['enabled',{...p,enabled:true}],['undo-disabled',p],['redo-enabled',{...p,enabled:true}]]){
  packet=await documents.serialize({...base,adjustments:{perspective},xmpPacket:packet});await writeFile(file,packet);
  const saved=await documents.read(file),properties=(await xmp.read(file)).properties,privateP=readExtension(properties,'ARTAdjustments').perspective;
  assert.deepEqual(saved.adjustments.perspective,perspective,name+' full snapshot');
  for(const key of ['aspect','scale','offsetX','offsetY'])assert.equal(Object.hasOwn(privateP,key),!perspective.enabled,name+' ownership '+key);
  assert.equal(lookup(properties,CRS,'PerspectiveAspect').value,perspective.enabled?'25':'0');
 }
 const hold=resolve('artifacts/stage-0/acr-reference/geometry-holdout-187'),source=JSON.parse(await readFile(join(hold,'sources.json'),'utf8'));
 for(const item of source.cases){const file=join(hold,item.id+'-active.xmp'),before=await readFile(file),raw=await xmp.read(file),p=decodeAdjustments(raw.properties).adjustments.perspective,expected=item.expected;
  if(item.id==='portrait-neutral')assert.equal(p,undefined);else{assert.equal(p.manualModel,'signed-framing-v1');assert.equal(p.aspect,expected.PerspectiveAspect??0);assert.equal(p.scale,(expected.PerspectiveScale??100)/100);assert.equal(p.offsetX,expected.PerspectiveX??0);assert.equal(p.offsetY,expected.PerspectiveY??0);}
  assert.deepEqual(await readFile(file),before);
 }
 assert.equal(sha(await readFile(original)),sha(bytes));passed=true;console.log('PASS actual SDK disabled/enabled/Undo/save ownership and 11 unmodified native-active geometry imports');
}finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained signed SDK failure:',root);}
