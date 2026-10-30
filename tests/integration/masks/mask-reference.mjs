import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {XMP,CT,CRS,property,encode,encodeAdjustments} from '@captraw/desktop-core/xmp';

const out=resolve(process.env.CAPTRAW_MASK_REFERENCE_OUT||'artifacts/mask-reference');mkdirSync(out,{recursive:true});
const path=join(out,'source.png'),targetPath=join(out,'target.png'),python=resolve('build/qa-venv/bin/python');
execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,sys
y,x=np.mgrid[:768,:1024];a=np.empty((768,1024,3),dtype=np.uint8)
a[:,:,0]=65+x%97;a[:,:,1]=70+y%83;a[:,:,2]=90+(x+y)%79
Image.fromarray(a).save(sys.argv[1])
`,path]);copyFileSync(path,targetPath);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),sourceHash=hash(path);
const engine=new EngineClient({cache:join(out,'core')}),exporter=new EngineClient({cache:join(out,'export')});
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp);
const presets=new Presets(join(out,'presets'),engine,join(out,'preset-cache'),xmp);
const sync=new Synchronizer(resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),join(out,'sync'),()=>{});
const checks=[],errors=[];let revision=0,passed=false;
engine.on('error',e=>errors.push(e.message));exporter.on('error',e=>errors.push(e.message));
const pass=name=>{checks.push(name);console.log('PASS',name);};
function rotation(profile,angle,reference,enabled=true){
 const start=profile.indexOf('[Rotation]'),end=profile.indexOf('\n[',start);assert(start>=0);
 return profile.slice(0,start)+`[Rotation]\nEnabled=${angle!==0}\nDegree=${angle}\nCaptRAWMaskCoordinates=${enabled}\nCaptRAWMaskReferenceDegree=${reference}\n`+(end<0?'':profile.slice(end));
}
async function render(profile,adjustments){
 const waiting=engine.preview(++revision,'fit',120000);
 const result=await engine.call('update',{revision,artProfile:profile,adjustments,maskId:adjustments.masks[0]?.id||''});
 return {...result,frame:await waiting};
}
const leaf=(id,referenceAngle,type='radial')=>({id,name:id,type,referenceAngle,enabled:true,inverted:false,feather:12,initialized:true,
 start:{x:.24,y:.23},end:{x:.69,y:.72},points:[{x:.34,y:.32,radius:.8},{x:.58,y:.54,radius:.8},{x:.45,y:.43,radius:.25,erase:true}],operation:'add'});
const group=components=>({...leaf('group',undefined),brightness:.5,contrast:10,saturation:12,components});
try{
 const image=await engine.call('open',{path,sessionId:'reference'}),base=image.adjustments;
 const sourceProfile=rotation(image.artProfile,23,5),targetProfile=rotation(image.artProfile,-11,-9);
 const inherited=leaf('inherited',undefined,'linear');delete inherited.referenceAngle;
 const components=[leaf('zero',0),leaf('minus17',-17,'brush'),leaf('plus7',7,'linear'),leaf('identity',23),inherited];
 components[1].operation='subtract';components[2].operation='intersect';
 const original={...base,masks:[group(components)]},snapshot=JSON.stringify(original);
 const bound=(await engine.call('validate',{artProfile:sourceProfile,adjustments:original})).masks;
 assert.equal(JSON.stringify(original),snapshot);
 assert.deepEqual(bound[0].components.map(c=>c.referenceAngle),[0,-17,7,23,5]);
 const legacy=(await engine.call('validate',{artProfile:rotation(sourceProfile,23,5,false),adjustments:{...base,masks:[group([inherited])]}})).masks;
 assert.equal(legacy[0].components[0].referenceAngle,23);
 pass('bind inherited leaves to the source reference or legacy current canvas, without changing input');
 for(const [index,component] of bound[0].components.entries()){
  const explicit=await render(sourceProfile,{...base,masks:[group([{...component,operation:'add'}])]});
  const fallback={...component,operation:'add'};delete fallback.referenceAngle;
  const oracle=await render(rotation(sourceProfile,23,component.referenceAngle),{...base,masks:[group([fallback])]});
  assert.equal(hash(explicit.frame.mask.file),hash(oracle.frame.mask.file));
  assert.equal(hash(explicit.frame.file),hash(oracle.frame.file));
  copyFileSync(explicit.frame.mask.file,join(out,`leaf-${index}.png`));
 }
 pass('five independent leaf references match profile-wide oracles in RGB and coverage');
 const adjustments={...base,masks:bound};
 const mixed=await render(sourceProfile,adjustments);copyFileSync(mixed.frame.mask.file,join(out,'mixed.png'));
 const differentFallback=await render(rotation(sourceProfile,23,-9),adjustments);
 assert.equal(hash(mixed.frame.file),hash(differentFallback.frame.file));assert.equal(hash(mixed.frame.mask.file),hash(differentFallback.frame.mask.file));
 execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,sys,json
from pathlib import Path
p=Path(sys.argv[1]);read=lambda name:np.asarray(Image.open(p/name)).astype(float)/255
leaves=[read(f'leaf-{i}.png') for i in range(5)]
expected=np.maximum(np.maximum(leaves[0]*(1-leaves[1])*leaves[2],leaves[3]),leaves[4])
error=np.abs(expected-read('mixed.png'));assert error.max()<=3/255,error.max()
(p/'coverage.json').write_text(json.dumps(dict(maxDifference=float(error.max()),tolerance=3/255))+'\n')
`,out]);
 pass('mixed add/subtract/intersect coverage matches independently composed leaves and ignores unrelated fallback');
 const file=join(out,'编辑 文档.xmp'),doc={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path,size:statSync(path).size,sha256:sourceHash},artProfile:mixed.artProfile,adjustments};
 writeFileSync(file,await documents.serialize(doc));const loaded=await documents.read(file);assert.deepEqual(loaded.adjustments,adjustments);
 await engine.call('close');await engine.call('open',{path,sessionId:'reopened'});
 const reopened=await render(loaded.artProfile,loaded.adjustments);assert.equal(hash(mixed.frame.file),hash(reopened.frame.file));
 for(const [name,profile] of [['before',mixed.artProfile],['reopened',reopened.artProfile]])await exporter.call('export',{path,artProfile:profile,output:join(out,name+'.tiff'),format:'tiff'});
 execFileSync(python,['-c',String.raw`
import tifffile,numpy as np,sys,json
from pathlib import Path
p=Path(sys.argv[1]);a=tifffile.imread(p/'before.tiff');b=tifffile.imread(p/'reopened.tiff')
assert a.dtype==np.uint16 and np.array_equal(a,b)
(p/'pixels.json').write_text(json.dumps(dict(bits=16,shape=list(a.shape),maxDifference=0))+'\n')
`,out]);
 pass('XMP reopen preserves mixed references, preview RGB and exact TIFF16 pixels');
 const preset=await presets.create({name:'Mixed references',group:'Test',groups:['masks'],adjustments:original,artProfile:sourceProfile});
 const presetFile=join(out,'preset.xmp');await presets.exportFile(preset.id,presetFile);
 const imported=await presets.importFile(presetFile);
 const target={image:{...image,path:targetPath,name:'target.png'},adjustments:base,profile:targetProfile};
 const expected=await render(targetProfile,adjustments);
 for(const [label,results] of [
  ['synchronize',await sync.run({source:{image:{...image,path},adjustments:original,profile:sourceProfile},targets:[target],groups:['masks']})],
  ['preset',await presets.apply(imported.id,target,sync)]
 ]){
  assert.equal(results.length,1);assert.deepEqual(results[0].adjustments.masks,bound);
  const actual=await render(results[0].profile,results[0].adjustments);
  assert.equal(hash(actual.frame.file),hash(expected.frame.file));assert.equal(hash(actual.frame.mask.file),hash(expected.frame.mask.file));
  pass(label+' retains source leaf references while rendering in the target geometry');
 }
 const oldFile=join(out,'unbound-preset.xmp');
 const oldMasks=[group([inherited])];
 writeFileSync(oldFile,(await xmp.call('write','',[...encodeAdjustments({masks:oldMasks}),property(CT,'EngineVersion',encode('CaptRAW-21_ART-1.26.10_LibRaw-3b20539')),property(CRS,'Name',{localized:'Unbound'})])).packet);
 const oldHash=hash(oldFile),oldPreset=await presets.importFile(oldFile);
 for(const global of [false,true]){
  const profile=rotation(targetProfile,23,-9,global),oldTarget={...target,profile};
  const oracle=await render(profile,{...base,masks:oldMasks});
  const [applied]=await presets.apply(oldPreset.id,oldTarget,sync);
  assert.equal(applied.adjustments.masks[0].components[0].referenceAngle,global?-9:23);
  const actual=await render(applied.profile,applied.adjustments);
  assert.equal(hash(actual.frame.file),hash(oracle.frame.file));assert.equal(hash(actual.frame.mask.file),hash(oracle.frame.mask.file));
 }
 assert.equal(hash(oldFile),oldHash);
 pass('unbound version 21 presets preserve target-canvas coverage with global transport on and off');
 const valid=(await engine.call('save')).artProfile;
 for(const invalid of [46,-46,'0',null]){
  const bad=structuredClone(adjustments);bad.masks[0].components[0].referenceAngle=invalid;
  await assert.rejects(engine.call('update',{revision:++revision,artProfile:valid,adjustments:bad}));
  assert.equal((await engine.call('save')).artProfile,valid);
 }
 pass('invalid leaf references reject the edit and preserve the active profile');
 assert.equal(hash(path),sourceHash);assert.equal(hash(targetPath),sourceHash);assert.deepEqual(errors,[]);passed=true;
}finally{
 sync.cancel();await engine.stop();await exporter.stop();
 writeFileSync(join(out,'report.json'),JSON.stringify({status:passed?'passed':'failed',engineVersion:ENGINE_VERSION,checks,errors},null,2)+'\n');
}
