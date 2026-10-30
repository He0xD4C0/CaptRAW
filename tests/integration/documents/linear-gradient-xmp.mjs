import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {Documents} from '@captraw/desktop-core/documents';import {XMP,decodeAdjustments,CRS,lookup} from '@captraw/desktop-core/documents';
const fixture=JSON.parse(readFileSync('tests/fixtures/assets/linear-gradient-legacy.json','utf8')),work=await mkdtemp(join(tmpdir(),'captraw-linear-xmp-')),xmp=new XMP(resolve('build/xmp/captraw-xmp')),docs=new Documents(xmp);let passed=false;
try{
 const legacy=fixture.legacyAdjustments,newValue=structuredClone(legacy);newValue.masks[0].components[0].linearGradientModel='full-zero-v1';newValue.masks[0].components[0].feather=0;
 const source={path:fixture.sourceFile,size:readFileSync('tests/fixtures/assets/'+fixture.sourceFile).length,sha256:fixture.sourceSHA256};
 const doc={source,artProfile:fixture.legacyProfile,adjustments:legacy,baselineVersion:4};
 const oldPacket=await docs.serialize(doc),newPacket=await docs.serialize({...doc,adjustments:newValue,xmpPacket:oldPacket});
 await writeFile(join(work,'upgraded.xmp'),newPacket);const upgraded=await docs.read(join(work,'upgraded.xmp'));assert.equal(upgraded.adjustments.masks[0].components[0].linearGradientModel,'full-zero-v1');
 const undoPacket=await docs.serialize({...doc,xmpPacket:newPacket});await writeFile(join(work,'undo.xmp'),undoPacket);const undone=await docs.read(join(work,'undo.xmp'));assert.equal(undone.adjustments.masks[0].components[0].linearGradientModel,undefined,'Undo + save must remove the owned model field, never resurrect it as unknown XMP');
 for(const name of ['global0-local-minus30','global0-local0','global0-local-plus30','global40-local-minus30','global40-local0','global40-local-plus30']){
  const raw=await xmp.read('artifacts/stage-0/acr-reference/glow-tiff-187/'+name+'.xmp');const a=decodeAdjustments(raw.properties).adjustments;assert.equal(a.masks[0].components[0].linearGradientModel,'full-zero-v1');assert.equal(a.masks[0].components[0].feather,0);
 }
 const bidirectionalFile='artifacts/stage-0/acr-reference/cases/nikon-bidirectional-gradient.xmp',original=readFileSync(bidirectionalFile);
 const raw=await xmp.call('read',original.toString('utf8')),decoded=decodeAdjustments(raw.properties);
 assert.equal((decoded.adjustments.masks||[]).length,0,'Unimplemented bidirectional geometry must not silently become a one-sided gradient');
 assert(decoded.warnings.some(w=>w.includes('双向')));
 const retained=await docs.serialize({...doc,adjustments:{...legacy,masks:[]},xmpPacket:original.toString('utf8')});
 const reread=await xmp.call('read',retained);assert.deepEqual(lookup(reread.properties,CRS,'MaskGroupBasedCorrections'),lookup(raw.properties,CRS,'MaskGroupBasedCorrections'));
 assert.deepEqual(readFileSync(bidirectionalFile),original);
 console.log('PASS SDK upgrade/undo save, six actual ACR gradient imports and lossless unsupported bidirectional preservation');passed=true;
}finally{if(passed)await rm(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
