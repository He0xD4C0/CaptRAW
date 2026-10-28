import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {ENGINE_VERSION} from '@captraw/contracts';
import {XMP,XMP_BASIC,CRS,lookup,property,text} from '@captraw/desktop-core/xmp';
import {Documents,BatchDocumentSaver} from '@captraw/desktop-core/documents';
import {EngineClient} from './engine-client.mjs';
const out=resolve(process.env.CAPTRAW_RATINGS_OUT||'artifacts/ratings');mkdirSync(out,{recursive:true});const work=mkdtempSync(join(out,'run-'));
const source=resolve('build/samples/synthetic.dng'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source);
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),engine=new EngineClient({cache:join(work,'core')}),checks=[],pass=message=>{checks.push(message);console.log('PASS',message);};let success=false,tiffPixels;
const fixture=rating=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="${XMP_BASIC}" xmlns:crs="${CRS}" xmlns:u="https://example.invalid/rating/" crs:Exposure2012="0.75" xmp:Label="自定义标签" u:Keep="opaque"><xmp:Rating rdf:parseType="Resource"><rdf:value>${rating}</rdf:value><u:Proof>keep</u:Proof></xmp:Rating></rdf:Description></rdf:RDF></x:xmpmeta>`;
try{
 for(const rating of [-1,0,1,2.5,5]){const path=join(work,'rating.xmp');writeFileSync(path,fixture(rating));assert.equal((await documents.read(path)).rating,rating);}
 for(const rating of ['','six','-2','-0.5','5.1','Infinity']){const path=join(work,'invalid.xmp');writeFileSync(path,fixture(rating));await assert.rejects(documents.read(path),/评分/);}
 pass('standard XMP Rating reads rejected, unrated, stars and fractional values and rejects malformed or out-of-range metadata');
 const image=await engine.call('open',{path:source,sessionId:'ratings'}),base={engineVersion:ENGINE_VERSION,source:{path:source,size:statSync(source).size,sha256:sourceHash},baselineVersion:4,artProfile:image.artProfile,adjustments:image.adjustments};
 const packet=await documents.serialize(base);assert.equal(lookup((await xmp.call('read',packet)).properties,XMP_BASIC,'Rating'),undefined);
 const original=join(work,'original.xmp');writeFileSync(original,fixture(2.5));const originalHash=hash(original),saved=join(work,'saved.xmp');
 writeFileSync(saved,await documents.serialize({...base,xmpPacket:readFileSync(original,'utf8'),rating:4}));let props=(await xmp.read(saved)).properties;
 assert.equal((await documents.read(saved)).rating,4);assert.equal(lookup(props,XMP_BASIC,'Label').value,'自定义标签');assert.equal(lookup(props,'https://example.invalid/rating/','Keep').value,'opaque');assert(readFileSync(saved,'utf8').includes('keep'));
 for(const rating of [0,-1]){writeFileSync(saved,await documents.serialize({...base,xmpPacket:readFileSync(saved,'utf8'),rating}));assert.equal((await documents.read(saved)).rating,rating);}
 assert.equal(hash(original),originalHash);pass('explicit rating saves use the standard namespace, preserve unrelated metadata and never modify the imported packet or invent an absent default');
 await assert.rejects(documents.serialize({...base,rating:6}),/评分/);
 const generated=join(work,'embedded.tiff');execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np,sys
a=np.tile(np.linspace(0,65535,160,dtype=np.uint16),(96,1));rgb=np.stack([a,a,a],axis=2)
xmp=('<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4"/></rdf:RDF></x:xmpmeta>').encode()
tifffile.imwrite(sys.argv[1],rgb,photometric='rgb',metadata=None,extratags=[(700,'B',len(xmp),xmp,False)])`,generated]);
 const embeddedHash=hash(generated),embedded=await engine.call('open',{path:generated,sessionId:'embedded-rating'});assert.equal(embedded.rating,4);assert.equal(hash(generated),embeddedHash);
 pass('the bundled RAW core reads an embedded integer XMP rating without changing the source image');
 const batchDirectory=join(work,'batch');mkdirSync(batchDirectory);const batch=new BatchDocumentSaver(resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),join(work,'batch-cache'),documents,()=>{});
 const batchResult=await batch.run({documents:[{path:source,width:image.width,height:image.height,artProfile:base.artProfile,adjustments:base.adjustments,xmpPacket:readFileSync(original,'utf8'),rating:-1}]},batchDirectory);assert.equal(batchResult.results.length,1);assert(!batchResult.results[0].error);const restored=await documents.read(batchResult.results[0].output);assert.equal(restored.rating,-1);assert.equal(lookup((await xmp.read(batchResult.results[0].output)).properties,XMP_BASIC,'Label').value,'自定义标签');
 pass('batch XMP saving carries rating snapshots independently of development controls and preserves custom labels');
 const current=join(work,'current.tiff'),reference=join(work,'reference.tiff');await engine.call('export',{path:source,artProfile:restored.artProfile,format:'tiff',output:current});
 const old=new EngineClient({executable:process.env.CAPTRAW_RATINGS_REFERENCE_ENGINE||process.env.CAPTRAW_ENGINE,resources:process.env.CAPTRAW_RATINGS_REFERENCE_RESOURCES||process.env.CAPTRAW_RESOURCES,cache:join(work,'reference-cache')});try{await old.call('export',{path:source,artProfile:restored.artProfile,format:'tiff',output:reference});}finally{await old.stop();}
 tiffPixels=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np,json,sys
a,b=[tifffile.imread(p) for p in sys.argv[1:3]]
assert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)
with tifffile.TiffFile(sys.argv[1]) as t:icc=t.pages[0].tags[34675].value
assert len(icc)>0
print(json.dumps(dict(shape=list(a.shape),bitsPerSample=16,maximumDifference=0,iccBytes=len(icc))))`,current,reference],{encoding:'utf8'}));
 pass('rating persistence leaves the native TIFF16 pixels and ICC unchanged against the previous installed core');assert.equal(hash(source),sourceHash);success=true;
}finally{await engine.stop();writeFileSync(join(out,'report.json'),JSON.stringify({checks,success,sourceHash,tiffPixels,...(!success?{work}:{})},null,2)+'\n');if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure workspace:',work);}
