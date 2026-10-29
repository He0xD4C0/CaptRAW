// Signed-value transport checks only. Negative image combinations require real ACR TIFF references.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {XMP,CRS,CT,encode,property,lookup,readExtension,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {capturePreset} from '@captraw/contracts/presets';
import {synchronizedAdjustments} from '@captraw/contracts/synchronize';
import {EngineClient} from './engine-client.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-glow-signed-')),xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp);
const makeMask=glow=>({id:'signed-glow',name:'Signed Glow',type:'linear',enabled:true,initialized:true,inverted:false,feather:50,points:[],start:{x:.2,y:.5},end:{x:.8,y:.5},brightness:0,contrast:0,saturation:0,details:{hue:0,texture:0,clarity:0,noise:0,noiseDetail:50,glow}});
let core,success=false;
try{
 for(const glow of [-100,-30,0,30,100]){
  const changes=[...encodeAdjustments({masks:[makeMask(glow)]}),property(CT,'EngineVersion',encode(ENGINE_VERSION))];
  const packet=(await xmp.call('write','',changes)).packet,properties=(await xmp.call('read',packet)).properties;
  assert.equal(decodeAdjustments(properties).adjustments.masks[0].details.glow,glow);
  assert.equal(readExtension(properties,'ARTAdjustments').masks[0].details.glow,glow);
 }
 for(const glow of [-101,101,NaN,Infinity,1.5])assert.throws(()=>encodeAdjustments({masks:[makeMask(glow)]}));
 for(const glow of [-101,101,NaN,Infinity,1.5]){
  if(!Number.isFinite(glow))continue;
  assert.throws(()=>decodeAdjustments([property(CT,'ARTAdjustments',encode({masks:[makeMask(glow)]}))]));
 }
 assert.throws(()=>encodeAdjustments({glow:-1}),'Global Glow remains unsigned');
 // Manufacture one sign change in an in-memory copy of the real +30 fixture.
 // This validates decoder range/scale, not actual Adobe negative semantics.
 const actual=(await xmp.read(resolve('artifacts/stage-0/acr-reference/controls-187/glow-local30-render.xmp'))).properties;
 const correction=structuredClone(lookup(actual,CRS,'MaskGroupBasedCorrections'));let changed=0;
 const sign=node=>{for(const field of node?.fields??[]){if(field.ns===CRS&&field.name==='LocalGlow'){field.node.value='-0.3';changed++;}else sign(field.node);}for(const child of node?.items??[])sign(child);};sign(correction);assert.equal(changed,1);
 const packet=(await xmp.call('write','',[property(CRS,'MaskGroupBasedCorrections',correction)])).packet;
 assert.equal(decodeAdjustments((await xmp.call('read',packet)).properties).adjustments.masks[0].details.glow,-30);
 console.log('PASS signed typed RDF endpoints/roundtrip/rejection; synthetic -0.3 decoder transport; global remains 0..100');
 if(!process.argv.includes('--xmp-only')){
  const source=join(work,'fixture.tif');execFileSync(resolve('build/qa-venv/bin/python'),['-c','import numpy as np,tifffile,sys;tifffile.imwrite(sys.argv[1],np.full((96,128,3),30000,np.uint16),photometric="rgb")',source]);
  core=new EngineClient({cache:join(work,'core'),env:{OMP_NUM_THREADS:'2'}});const image=await core.call('open',{path:source,sessionId:'signed',effectsDefaults:'legacy'});
  for(const global of [0,40])for(const amount of [-100,-30,100]){
   const a={...image.adjustments,glow:global,glowStyle:'halation',glowRange:50,glowSpread:50,glowWarmth:0,masks:[makeMask(amount)]};
   const composed=await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:a});
   const values=composed.artProfile.match(/\[CaptRAW Glow\][\s\S]*?\nValues=([^\n]+)/)?.[1].split(';').filter(Boolean).map(Number);
   assert(values,'Nonzero signed local amounts must not be dropped');assert.equal(values.at(-1),amount);assert.equal(values[0],global);
   const reloaded=await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:composed.artProfile,adjustments:a});assert.match(reloaded.artProfile,new RegExp(';-?'+Math.abs(amount)+';'));
   const recipe={engineVersion:ENGINE_VERSION,source:{path:source,size:0,sha256:'0'.repeat(64)},adjustments:a,artProfile:composed.artProfile};const file=join(work,`g${global}-l${amount}.xmp`);writeFileSync(file,await documents.serialize(recipe));assert.equal((await documents.read(file)).adjustments.masks[0].details.glow,amount);
   const preset=capturePreset({name:'Signed',group:'Glow',groups:['effects','masks'],adjustments:a});assert.equal(preset.adjustments.masks[0].details.glow,amount);
   const synced=synchronizedAdjustments({image,profile:composed.artProfile,adjustments:a},{image,profile:image.artProfile,adjustments:image.adjustments},['effects','masks']);assert.equal(synced.masks[0].details.glow,amount);
  }
  for(const glow of [-101,101])await assert.rejects(()=>core.call('validate',{artProfile:image.artProfile,adjustments:{...image.adjustments,masks:[makeMask(glow)]}}));
  console.log('PASS native signed ARP compose/reload/XMP/preset/sync; no pixel-response claim');
 }
 success=true;console.log(JSON.stringify({negativeImageCombination:'unverified',pendingRealACRTiff:[{globalGlow:0,localGlow:-30},{globalGlow:40,localGlow:-30}],native:!process.argv.includes('--xmp-only')}));
}finally{if(core)await core.stop();if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
