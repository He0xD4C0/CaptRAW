// Narrow HDR metadata regression. Run against the coordinated native artifact;
// CAPTRAW_ALREADY_APPLIED_SOURCE=1 only prepares RDF with the source helper.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {NativeEngine} from '@captraw/desktop-core/engine';
import {XMP,CRS,CT,XMP_BASIC,property,text,lookup,encode} from '@captraw/desktop-core/xmp';
const root=await mkdtemp(join(tmpdir(),'captraw-already-applied-hdr-'));
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),U='https://example.invalid/hdr-baked/',SECRET='private-baked-原始蒙版',PATH_SECRET='private-original-source-path';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');let worker,passed=false;
// AVIF mdat contains EXIF/XMP items too. Demux the video stream with the mature
// reader rather than mistaking container/metadata differences for pixel changes.
const av1=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-c:v','copy','-f','obu','pipe:1'],{maxBuffer:16*1024*1024});
try{
 let prepareImageXMP;
 if(process.env.CAPTRAW_ALREADY_APPLIED_SOURCE==='1'){
  const path=join(root,'baked-crs.mjs');await writeFile(path,stripTypeScriptTypes(await readFile(resolve('packages/desktop-core/src/baked-crs.ts'),'utf8'),{mode:'transform'}));
  ({prepareImageXMP}=await import(pathToFileURL(path).href));
 }else({prepareImageXMP}=await import('@captraw/desktop-core/baked-crs'));
 const original=await xmp.call('write','',[
  property(CRS,'AlreadyApplied',text('True')),property(CRS,'Exposure2012',text(1)),
  property(CRS,'FutureMask',{options:0x600,items:[{fields:[property(U,'Secret',{value:SECRET,qualifiers:[property(U,'Proof',text('arbitrary archive qualifier'))]})]}]}),
  property(U,'Keep',{value:'ordinary metadata',qualifiers:[property(U,'Proof',text('retain ordinary qualifier'))]}),
  property(CT,'FutureTag',text('retain unknown namespace field')),property(XMP_BASIC,'Rating',text(4)),property(XMP_BASIC,'Label',text('HDR 自定义标签'))
 ]);
 const prepared=prepareImageXMP(original.properties),archived=await xmp.call('write',original.packet,[...prepared.changes,
  property(CT,'Source',encode({path:PATH_SECRET,size:1,sha256:'0'.repeat(64)})),property(CT,'ARTProfile',text('private-native-profile')),
  property(CT,'ARTAdjustments',encode({exposure:.25})),property(CT,'ARTWhiteBalanceCoordinates',encode([5000,0])),
  property(CT,'MaskAssets',encode({schemaVersion:1,files:[]})),property(CT,'InputProfileAsset',encode({path:'private-profile-asset'})),
  property(CT,'EngineVersion',text('private-engine-version')),property(CT,'BaselineVersion',text(4))
 ]);
 const ordinary=await xmp.call('write','',original.properties.filter(p=>p.ns!==CRS));
 const simple=await xmp.call('write',ordinary.packet,[property(CRS,'AlreadyApplied',text('True')),property(CRS,'Exposure2012',text(1)),property(CRS,'FutureMask',text(SECRET))]);
 const minimal=await xmp.call('write',simple.packet,prepareImageXMP(simple.properties).changes);
 const active=await xmp.call('write',ordinary.packet,[property(CRS,'AlreadyApplied',text('False')),property(CRS,'Exposure2012',text(1)),property(CRS,'FutureActive',text('ordinary active unknown'))]);
 const names=['ordinary','active','minimal','private'],packets=[ordinary.packet,active.packet,minimal.packet,archived.packet],sources=names.map(name=>join(root,name+'.tiff'));
 for(const [index,path]of sources.entries()){
  execFileSync(resolve('build/qa-venv/bin/python'),['-c','import numpy as np,tifffile,sys;a=np.full((96,128,3),30000,np.uint16);a[:24,:32]=[12000,24000,36000];tifffile.imwrite(sys.argv[1],a,photometric="rgb",metadata=None)',path]);
  await xmp.call('file-write',packets[index],[],{path,format:'tiff'});
 }
 const sourceHashes=await Promise.all(sources.map(async p=>hash(await readFile(p)))),artifactHash=hash(await readFile(binary));
 console.log('HDR metadata artifact:',artifactHash);
 worker=new NativeEngine(binary,resources,join(root,'native-cache'));await worker.ready;
 let baseline;
 for(const [index,path]of sources.entries()){
  const image=await worker.call('open',{path,sessionId:'hdr-baked-'+index,effectsDefaults:'current',whiteBalanceDefaults:'current',sourceFramePolicy:'active-area-v1'});
  const composed=await worker.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:{...image.adjustments,exposure:2,hdrEnabled:true,hdrHeadroom:3}});
  const destination=join(root,names[index]+'.avif'),result=await worker.call('export',{path,artProfile:composed.artProfile,output:destination,format:'avif',colorSpace:'rec2020',rating:4});
  const bytes=await readFile(destination),packet=execFileSync('exiftool',['-b','-XMP',destination],{encoding:'utf8'}),properties=(await xmp.call('read',packet)).properties;
  const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=pix_fmt,color_primaries,color_transfer,color_space,color_range','-of','json',destination],{encoding:'utf8'})).streams[0];
  const output={bytes,properties,hdr:result.hdr,av1:av1(destination),stream};if(index===0){baseline=output;continue;}
  const leaked=properties.filter(p=>p.ns===CT&&['BakedCRS','Source','EngineVersion','ARTProfile','ARTAdjustments','ARTWhiteBalanceCoordinates','BaselineVersion','MaskAssets','InputProfileAsset'].includes(p.name)).map(p=>p.name);
  console.log(names[index],'HDR private fields:',JSON.stringify(leaked),'archiveMarkerInBytes:',bytes.includes(Buffer.from(SECRET)),'privateSourceInBytes:',bytes.includes(Buffer.from(PATH_SECRET)));
  for(const [i,source]of sources.entries())assert.equal(hash(await readFile(source)),sourceHashes[i],'native output must not write the source');
  assert.equal(hash(output.av1),hash(baseline.av1),'metadata filtering must not change coded HDR pixels');
  assert.deepEqual(stream,baseline.stream);assert.equal(stream.color_primaries,'bt2020');assert.equal(stream.color_transfer,'smpte2084');assert.equal(stream.color_space,'gbr');assert.equal(stream.color_range,'pc');assert.equal(stream.pix_fmt,'gbrp12le');
  assert.deepEqual(output.hdr,baseline.hdr);assert.equal(output.hdr.depth,12);assert.equal(output.hdr.colorPrimaries,9);assert.equal(output.hdr.transferCharacteristics,16);assert.equal(output.hdr.matrixCoefficients,0);assert.equal(output.hdr.fullRange,true);
  assert.equal(lookup(properties,U,'Keep').value,'ordinary metadata');assert.equal(lookup(properties,U,'Keep').qualifiers.find(p=>p.ns===U&&p.name==='Proof').node.value,'retain ordinary qualifier');
  assert.equal(lookup(properties,CT,'FutureTag').value,'retain unknown namespace field');assert.equal(lookup(properties,XMP_BASIC,'Rating').value,'4');assert.equal(lookup(properties,XMP_BASIC,'Label').value,'HDR 自定义标签');
  assert.equal(lookup(properties,CRS,'AlreadyApplied')?.value,'True','rendered AVIF must not publish active False editing declarations');
  if(names[index]==='active'){assert.equal(lookup(properties,CRS,'FutureActive').value,'ordinary active unknown');assert.equal(lookup(properties,CRS,'Exposure2012').value,'1');}
  assert.deepEqual(leaked,[],'AVIF must not publish private baked develop provenance');
  for(const secret of [SECRET,PATH_SECRET,'private-native-profile','private-profile-asset','private-engine-version'])assert(!bytes.includes(Buffer.from(secret)),secret+' leaked into AVIF bytes');
 }
 assert.equal(hash(await readFile(binary)),artifactHash,'shared native artifact must stay fixed during the regression');passed=true;
 console.log('PASS HDR AVIF removes private baked RDF/qualifiers and native state, retains ordinary metadata/labels, unchanged AV1 payload/CICP/CLLI and source hashes');
}finally{
 if(worker){const stopped=worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise(done=>worker.child.once('exit',done));worker.terminate();await stopped;}
 if(passed)await rm(root,{recursive:true,force:true});else console.error('HDR baked failure retained:',root);
}
