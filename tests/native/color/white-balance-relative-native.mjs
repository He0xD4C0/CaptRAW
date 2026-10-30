// Explicit local native/SDK checks; never part of the default pure unit suite.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CRS,lookup} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/presets';
import {ENGINE_VERSION} from '@captraw/contracts';
const capture=process.argv.includes('--capture'),root=capture?await mkdtemp(join(tmpdir(),'captraw-relative-wb-')):process.env.CAPTRAW_RELATIVE_WB_SCRATCH;
if(!root)throw new Error('Capture the frozen core with --capture, then set CAPTRAW_RELATIVE_WB_SCRATCH before checking the rebuilt core.');
const python=process.env.CAPTRAW_PYTHON||resolve('build/qa-venv/bin/python'),hash=b=>createHash('sha256').update(b).digest('hex');
if(capture)execFileSync(python,['tests/fixtures/generators/relative-wb-fixtures.py',root],{stdio:'inherit'});
const engine=new EngineClient({cache:join(root,capture?'old-cache':'new-cache')}),checks=[];engine.on('error',()=>{});
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp);
const sync=new Synchronizer(resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),join(root,'sync'),()=>{});
const store=new Presets(join(root,'presets'),engine,join(root,'preset-cache'),xmp);let success=false,revision=0;
const pixelInfo=path=>JSON.parse(execFileSync(python,['-c','import sys,json,hashlib,numpy as n,tifffile as t;a=t.imread(sys.argv[1]);assert a.dtype==n.uint16;v=n.mean(a,axis=(0,1));print(json.dumps(dict(sha256=hashlib.sha256(a.tobytes()).hexdigest(),shape=list(a.shape),neutrality=float((v.max()-v.min())/max(1,v.mean())))))',path],{encoding:'utf8'}));
const pass=s=>{checks.push(s);console.log('PASS',s);};
const meanTint=path=>Number(execFileSync(python,['-c',`from PIL import Image,ImageCms
import io,sys
im=Image.open(sys.argv[1]);profile=ImageCms.ImageCmsProfile(io.BytesIO(im.info['icc_profile']))
lab=ImageCms.profileToProfile(im.convert('RGB'),profile,ImageCms.createProfile('LAB'),outputMode='LAB')
print(sum(lab.getpixel((x,y))[1]-128 for y in range(lab.height) for x in range(lab.width))/(lab.width*lab.height))`,path],{encoding:'utf8'}));
async function render(path,adjustments,artProfile='',current=false){
 const image=await engine.call('open',{path,sessionId:'relative-test',whiteBalanceDefaults:current?'current':'legacy'});
 const a=adjustments||image.adjustments,p=await engine.call('compose',{path,width:image.width,height:image.height,adjustments:a,artProfile});
 const output=join(root,'output.tif');await engine.call('export',{path,artProfile:p.artProfile,output,format:'tiff',colorSpace:'srgb'});
 return {image,adjustments:a,profile:p.artProfile,pixels:pixelInfo(output)};
}
async function prepare(path,adjustments){
 const image=await engine.call('open',{path,sessionId:'relative-live',whiteBalanceDefaults:'current'}),pending=engine.preview(++revision);
 const a=adjustments||image.adjustments;await engine.call('update',{revision,adjustments:a,artProfile:''});await pending;return {image,adjustments:a};
}
try{
 const sourceFiles=['raw.dng','neutral.jpg','neutral.tif','warm.jpg','warm.tif','cool.jpg','cool.tif','split.tif','black.tif'];
 const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async n=>[n,hash(await readFile(join(root,n)))])));
 if(capture){
  const rows=[];
  for(const name of ['raw.dng','neutral.jpg','neutral.tif']){
   const path=join(root,name),base=await render(path);rows.push({name,adjustments:base.adjustments,pixels:base.pixels});
   for(const temperature of [3200,6500,20000]){const a={...base.adjustments,temperature,tint:0,wbMode:'custom',wbMultipliers:null};rows.push({name,adjustments:a,pixels:(await render(path,a)).pixels});}
  }
  await writeFile(join(root,'baseline.json'),JSON.stringify({sourceHashes,rows}));console.log('CAPTRAW_RELATIVE_WB_SCRATCH='+root);
 }else{
  const baseline=JSON.parse(await readFile(join(root,'baseline.json')));assert.deepEqual(sourceHashes,baseline.sourceHashes);
  for(const row of baseline.rows)assert.deepEqual((await render(join(root,row.name),row.adjustments)).pixels,row.pixels);
  pass('RAW and legacy rendered edits bypass the new path with identical captured TIFF16 pixels');
  for(const name of ['neutral.jpg','neutral.tif']){
   const current=await render(join(root,name),undefined,'',true),old=baseline.rows.find(r=>r.name===name);
   assert.deepEqual(current.pixels,old.pixels);assert.equal(current.adjustments.incrementalTemperature,0);assert.equal(current.adjustments.incrementalTint,0);
   const manual={...current.adjustments,incrementalTemperature:25,incrementalTint:-15},changed=await render(join(root,name),manual);assert.notEqual(changed.pixels.sha256,current.pixels.sha256);assert.match(changed.profile,/CaptRAWRelativeVersion=1/);
   const saved=join(root,'saved.xmp');await writeFile(saved,await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:join(root,name),size:(await readFile(join(root,name))).length,sha256:sourceHashes[name]},artProfile:changed.profile,adjustments:manual}));
   const properties=(await xmp.read(saved)).properties;assert.equal(lookup(properties,CRS,'IncrementalTemperature').value,'25');assert.equal(lookup(properties,CRS,'Temperature'),undefined);
   const reopened=await documents.read(saved);assert.deepEqual((await render(join(root,name),reopened.adjustments,reopened.artProfile)).pixels,changed.pixels);
   const live=await prepare(join(root,name));const oldFrame=engine.preview(++revision);await engine.call('update',{revision,adjustments:manual,artProfile:''});const changedHash=hash(await readFile((await oldFrame).file));const restored=engine.preview(++revision);await engine.call('update',{revision,adjustments:live.adjustments,artProfile:''});assert.notEqual(hash(await readFile((await restored).file)),changedHash);
  }
  pass('relative zero is exact, manual offsets change pixels, standard XMP reopens exactly and preview undo resets the matrix');
  for(const name of ['neutral.jpg','neutral.tif']){
   const current=await render(join(root,name),undefined,'',true),base=meanTint(join(root,'output.tif'));
   for(const tint of [-15,15]){
    await render(join(root,name),{...current.adjustments,incrementalTint:tint});
    const difference=meanTint(join(root,'output.tif'))-base;
    assert(Math.sign(tint)*difference>2,`Tint ${tint} must move neutral Lab a toward ${tint<0?'green':'magenta'}, got ${difference}`);
   }
  }
  pass('independent ICC Lab confirms negative Tint shifts green and positive Tint shifts magenta for JPEG and TIFF');
  const fixtures=JSON.parse(await readFile(join(root,'fixtures.json')));
  for(const fixture of fixtures.filter(f=>!f.path.includes('neutral.'))){
   for(const mode of ['auto','sample']){
    const live=await prepare(fixture.path),solved=await engine.call('whiteBalance',{mode,x:.5,y:.5,size:11});
    assert.equal(solved.relativeWBModel,'art-ctl-v1');assert.equal(solved.wbMultipliers,null);
    // JPEG quantization changes the authored colour and its integer optimum.
    // TIFF retains the authored offsets; both formats must actually neutralize.
    if(fixture.path.endsWith('.tif')){assert(Math.abs(solved.incrementalTemperature-fixture.temperature)<=2,JSON.stringify(solved));assert(Math.abs(solved.incrementalTint-fixture.tint)<=2,JSON.stringify(solved));}
    for(const value of [solved.incrementalTemperature,solved.incrementalTint])assert(Number.isInteger(value)&&value>=-100&&value<=100);
    assert((await render(fixture.path,{...live.adjustments,...solved})).pixels.neutrality<.025);
   }
  }
  pass('auto and eyedropper recover TIFF offsets and actually neutralize decoded JPEG and TIFF inputs');
  const split=await prepare(join(root,'split.tif'));const normal=await engine.call('whiteBalance',{mode:'sample',x:.25,y:.5,size:11});assert(Math.abs(normal.incrementalTemperature-25)<=2);
  await prepare(join(root,'split.tif'),{...split.adjustments,flipHorizontal:true});const flipped=await engine.call('whiteBalance',{mode:'sample',x:.25,y:.5,size:11});assert(Math.abs(flipped.incrementalTemperature+25)<=2);
  await prepare(join(root,'black.tif'));await assert.rejects(engine.call('whiteBalance',{mode:'auto'}),/有效颜色/);
  const raw=await render(join(root,'raw.dng'));await assert.rejects(engine.call('compose',{path:join(root,'raw.dng'),width:raw.image.width,height:raw.image.height,artProfile:'',adjustments:{...raw.adjustments,incrementalTemperature:25,incrementalTint:0,relativeWBModel:'art-ctl-v1',wbMultipliers:null}}),/已渲染|RAW/);
  pass('eyedropper respects a real flip; black samples and RAW/relative unit conflicts fail explicitly');
  const docs=[];for(const name of ['neutral.jpg','neutral.tif']){const d=await render(join(root,name),undefined,'',true);docs.push({image:d.image,adjustments:d.adjustments,profile:d.profile});}
  const preset=await store.create({name:'相对白平衡',group:'验证',groups:['whiteBalance'],adjustments:{...docs[0].adjustments,incrementalTemperature:25,incrementalTint:-15}});
  const result=await store.applyMany({id:preset.id,targets:docs,operationId:'relative-batch'},sync);assert.equal(result.results.length,2);assert(result.results.every(r=>r.adjustments.incrementalTemperature===25&&r.adjustments.incrementalTint===-15));
  const before=structuredClone(docs);await assert.rejects(store.applyMany({id:preset.id,targets:[docs[0],{image:raw.image,adjustments:raw.adjustments,profile:raw.profile}],operationId:'mixed'},sync),/相对|RAW/);assert.deepEqual(docs,before);
  pass('JPEG/TIFF presets prepare together; mixed RAW targets reject without mutating any document');
  for(const [name,sha] of Object.entries(sourceHashes))assert.equal(hash(await readFile(join(root,name))),sha);success=true;
 }
}finally{
 sync.cancel();await engine.stop();if(engine.child.exitCode===null&&engine.child.signalCode===null)await new Promise(done=>engine.child.once('exit',done));
 if(!capture&&success)await rm(root,{recursive:true,force:true});else console.log('Retained relative WB workspace:',root);
}
