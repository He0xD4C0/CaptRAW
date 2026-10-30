import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {XMP,CRS,CT,XMP_BASIC,lookup,property,text} from '@captraw/desktop-core/xmp';
import {finishOutputMetadata} from '@captraw/desktop-core/output-metadata';
import {BatchExporter} from '@captraw/desktop-core/batch-export';
import {DEFAULT_EXPORT_OPTIONS} from '@captraw/contracts/export-options';
import {EngineClient} from '../../support/engine-client.mjs';
const scratch=mkdtempSync(join(tmpdir(),'captraw-output-metadata-')),source=join(scratch,'源 照片.tiff'),python=resolve('build/qa-venv/bin/python');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),engine=new EngineClient({cache:join(scratch,'cache')});
const DC='http://purl.org/dc/elements/1.1/',EXIF='http://ns.adobe.com/exif/1.0/',U='https://example.invalid/metadata/';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let passed=false;
try{
 execFileSync(python,['-c',`from PIL import Image
import sys
im=Image.new('RGB',(480,320));im.putdata([((x*3+y)%256,(y*2+x)%256,(x+y*3)%256) for y in range(320) for x in range(480)]);im.save(sys.argv[1])`,source]);
 const packet=(await xmp.call('write','',[
  property(U,'Keep',{value:'opaque',qualifiers:[property(U,'Proof',text('qualified')),property(EXIF,'GPSAltitude',text('123'))]}),
  property(U,'Large',text('blob-value-'.repeat(10000))),
  property(U,'Empty',{value:'',qualifiers:[property(U,'EmptyProof',text('preserve-empty'))]}),
  property(U,'EmptyStructure',{fields:[]}),property(U,'EmptyArray',{items:[],options:0x600}),
  property(U,'ExtendedStructure',{fields:[property(U,'Payload',text('blob-value-'.repeat(10000))),property(U,'Empty',{value:'',qualifiers:[property(U,'Proof',text('extended-empty'))]}),property(U,'Structure',{fields:[]}),property(U,'Array',{items:[],options:0x600})]}),
  property(CT,'FutureTag',text('opaque-future')),property(CT,'Source',text('private-source-path')),
  property(CRS,'Exposure2012',{value:'1.25',qualifiers:[property(U,'Proof',text('managed-qualified'))]}),
  property(U,'Structure',{fields:[property(U,'Leaf',text('survives')),property(U,'EmptyLeaf',text('')),property(EXIF,'GPSLatitude',text('31,10N')),property(CRS,'Exposure2012',text('4')),property(CT,'ARTProfile',text('private-nested-profile'))]}),
  property(EXIF,'GPSLatitude',text('31,10N')),property(EXIF,'GPSLongitude',text('121,20E')),
  property(DC,'rights',{localized:'old copyright'}),property(DC,'creator',{items:[text('old author')],options:0x600}),
 ])).packet;
 const inputXMP=join(scratch,'input.xmp');writeFileSync(inputXMP,packet);
 execFileSync('exiftool',['-overwrite_original','-XMP<='+inputXMP,'-Make=Fixture','-Model=Test Camera','-GPSLatitude=31.1','-GPSLongitude=121.2','-GPSLatitudeRef=N','-GPSLongitudeRef=E','-IPTC:City=private city','-IPTC:CopyrightNotice=old copyright','-EXIF:Copyright=old copyright','-EXIF:Artist=old author',source],{stdio:'pipe'});
 const original=hash(source),opened=await engine.call('open',{path:source,sessionId:'metadata'});
 const current=(await xmp.call('write',packet,[property(DC,'rights',{localized:'当前版权'}),property(DC,'creator',{items:[text('当前作者')],options:0x600}),property(U,'Later',text('current sidecar'))])).packet;
 const doc={path:source,width:opened.width,height:opened.height,artProfile:opened.artProfile,adjustments:{...opened.adjustments,exposure:.75},rating:4,xmpPacket:current};
 const {artProfile}=await engine.call('compose',doc),outputs=[];
 for(const format of ['tiff','jpeg'])for(const [include,removeLocation] of [['all',false],['all-except-develop',true],['copyright',false],['none',false]]){
  const options={...structuredClone(DEFAULT_EXPORT_OPTIONS),metadata:{include,removeLocation}},path=join(scratch,include+'.'+format);
  const output=await engine.call('export',{path:source,artProfile,output:path,format,colorSpace:'srgb',options,rating:doc.rating});
  await finishOutputMetadata(engine,xmp,doc,format,options,output);
  const result=JSON.parse(execFileSync('exiftool',['-j','-G1','-n','-s',path],{encoding:'utf8'}))[0];
  const properties=(await xmp.call('file-read','',[],{path,format})).properties;
  if(include==='all'||include==='all-except-develop'){
   assert.equal(lookup(properties,U,'Keep').value,'opaque');assert.equal(lookup(properties,U,'Keep').qualifiers.find(p=>p.ns===U&&p.name==='Proof').node.value,'qualified');
   assert.equal(lookup(properties,U,'Large').value,'blob-value-'.repeat(10000));
   assert.equal(lookup(properties,U,'Empty').value,'');assert.equal(lookup(properties,U,'Empty').qualifiers.find(p=>p.name==='EmptyProof').node.value,'preserve-empty');
   assert.deepEqual(lookup(properties,U,'EmptyStructure').fields,[]);assert.deepEqual(lookup(properties,U,'EmptyArray').items,[]);
   const extended=lookup(properties,U,'ExtendedStructure').fields;
   assert.equal(extended.find(p=>p.name==='Empty').node.value,'');assert.equal(extended.find(p=>p.name==='Empty').node.qualifiers[0].node.value,'extended-empty');
   assert.deepEqual(extended.find(p=>p.name==='Structure').node.fields,[]);assert.deepEqual(extended.find(p=>p.name==='Array').node.items,[]);
   assert.equal(lookup(properties,U,'Structure').fields.find(p=>p.name==='EmptyLeaf').node.value,'');
   assert(!lookup(properties,U,'Structure').fields.some(p=>p.ns===CRS||p.ns===CT));
   assert.equal(lookup(properties,U,'Later').value,'current sidecar');assert.equal(lookup(properties,XMP_BASIC,'Rating').value,'4');
   assert(!properties.some(p=>p.ns===CT),'develop namespace must not be published');
   assert.equal(result['IFD0:Copyright'],'当前版权');assert.equal(result['IFD0:Artist'],'当前作者');
   assert.equal(result['IPTC:CopyrightNotice'],'当前版权');
  }
  assert(!properties.some(p=>p.ns===CRS||p.ns===CT),'all policies exclude develop instructions');
  if(include==='all')assert(result['GPS:GPSLatitude']);
  if(removeLocation){
   assert(!Object.keys(result).some(k=>k.startsWith('GPS:')));assert.equal(result['IPTC:City'],undefined);
   assert.equal(lookup(properties,EXIF,'GPSLatitude'),undefined);
   assert.equal(lookup(properties,U,'Structure').fields.some(p=>p.ns===EXIF&&p.name.startsWith('GPS')),false);
   assert(!lookup(properties,U,'Keep').qualifiers.some(p=>p.ns===EXIF&&p.name.startsWith('GPS')));
  }
  if(include==='copyright'){
   assert.equal(result['IFD0:Copyright'],'当前版权');assert.equal(result['IFD0:Artist'],'当前作者');assert.equal(lookup(properties,U,'Keep'),undefined);
   assert.equal(result['IFD0:Make'],undefined);assert.equal(result['IPTC:City'],undefined);
  }
  if(include==='none'){
   assert.equal(result['IFD0:Copyright'],undefined);assert.equal(result['IFD0:Artist'],undefined);assert.equal(result['IFD0:Make'],undefined);
   assert.equal(result['IPTC:CopyrightNotice'],undefined);assert.equal(lookup(properties,U,'Keep'),undefined);
  }
  assert(!properties.some(p=>p.ns===CT&&['Source','EngineVersion','ARTProfile','ARTAdjustments','ARTWhiteBalanceCoordinates'].includes(p.name)));assert.equal(result['IFD0:Orientation'],1);assert.equal(result['IFD0:XResolution'],300);outputs.push({path,format});
  const fileBytes=readFileSync(path);assert(!fileBytes.includes(Buffer.from('private-source-path')),'removed source path must not survive in abandoned metadata bytes');
  assert(!fileBytes.includes(Buffer.from('ARTWhiteBalanceCoordinates')));
  if(removeLocation||include==='none'||include==='copyright')for(const secret of ['private city','GPSLatitude','GPSLongitude'])assert(!fileBytes.includes(Buffer.from(secret)),secret+' survives in abandoned output metadata');
  if(include==='none')for(const secret of ['old copyright','old author','当前版权','当前作者'])assert(!fileBytes.includes(Buffer.from(secret)),secret+' survives in metadata-free output');
  if(include==='none'||include==='copyright')assert(!fileBytes.includes(Buffer.from('blob-value-'.repeat(100))));
  if(include==='all'){
   const raw=execFileSync('exiftool',['-a','-b','-XMP',path]);assert(raw.includes(Buffer.from('managed-qualified')));assert(raw.includes(Buffer.from('blob-value-'.repeat(10000))));
   if(format==='jpeg')assert(readFileSync(path).includes(Buffer.from('http://ns.adobe.com/xmp/extension/')),'large XMP must use real Extended JPEG XMP segments');
  }
 }
 execFileSync(python,['-c',`from PIL import Image
import sys,json,numpy as np,tifffile
items=json.loads(sys.argv[1]);ref={}
for item in items:
 im=Image.open(item['path']);assert im.size==(480,320);assert im.info.get('icc_profile')
 a=tifffile.imread(item['path']) if item['format']=='tiff' else np.asarray(im)
 if item['format']=='tiff':assert a.dtype==np.uint16
 if item['format'] in ref:assert np.array_equal(a,ref[item['format']])
 else:ref[item['format']]=a
print('all 8 metadata policies preserve encoded pixels, dimensions and ICC')`,JSON.stringify(outputs)],{stdio:'inherit'});
 const directory=join(scratch,'batch');mkdirSync(directory);
 const queue=new BatchExporter(resolve('build/native/captraw-engine'),resolve('build/native/resources'),join(scratch,'batch-cache'),()=>{},xmp);
 const results=await queue.run({format:'tiff',colorSpace:'srgb',documents:[doc],options:{...structuredClone(DEFAULT_EXPORT_OPTIONS),metadata:{include:'all',removeLocation:true}}},directory);
 assert(results[0].output);assert.equal(Number(lookup((await xmp.call('file-read','',[],{path:results[0].output,format:'tiff'})).properties,CRS,'Exposure2012').value),.75);
 assert.equal(hash(source),original);passed=true;console.log('PASS current sidecar, unknown qualified/nested RDF, EXIF/IPTC reconciliation, privacy, real pixels and shared batch pipeline');
}finally{await engine.stop();if(passed)rmSync(scratch,{recursive:true,force:true});else console.error('Failure retained:',scratch);}
