import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';
import {XMP,CRS,lookup,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const probe=resolve(process.env.CAPTRAW_WB_PROBE||'build/native/captraw-wb-probe');
const source=resolve('build/samples/synthetic.dng');
const oldPairs=[2000,2001,2500,3000,3200,4000,5000,6500,9000,20000,50000].flatMap(t=>[-150,-25,0,25,150].map(tint=>[t,tint]));
const coordinates=pairs=>JSON.parse(execFileSync(probe,[],{input:JSON.stringify(pairs),encoding:'utf8'}));
const pixelHash=path=>execFileSync('build/qa-venv/bin/python',['-c',"import sys,hashlib,tifffile; a=tifffile.imread(sys.argv[1]);print(str(a.shape)+str(a.dtype)+':'+hashlib.sha256(a.tobytes()).hexdigest())",path],{encoding:'utf8'}).trim();
const coefficients=profile=>profile.match(/\[White Balance\][\s\S]*?Multipliers=([^\n]+)/)[1].split(';').filter(Boolean).map(Number);
if(process.argv.includes('--capture')){
 const scratch=await mkdtemp(join(tmpdir(),'captraw-white-balance-low-')),engine=new EngineClient({cache:join(scratch,'baseline-cache')});engine.on('error',()=>{});
 try{
  const image=await engine.call('open',{path:source,sessionId:'legacy-wb'}),renders=[];
  for(const temperature of [2000,3200,6500,20000]){
   const adjustments={...image.adjustments,temperature,tint:0,wbMode:'custom',wbMultipliers:null};
   const {artProfile}=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments,artProfile:''});
   const output=join(scratch,`old-${temperature}.tiff`);await engine.call('export',{path:source,artProfile,output,format:'tiff'});
   renders.push({temperature,adjustments,multipliers:coefficients(artProfile),pixels:pixelHash(output)});await rm(output);
  }
  await writeFile(join(scratch,'baseline.json'),JSON.stringify({source,sourceHash:hash(await readFile(source)),dimensions:{width:image.width,height:image.height},coordinates:coordinates(oldPairs),renders}));
  console.log('LEGACY_BASELINE',scratch);
 }catch(error){console.error('Retained failure:',scratch);throw error;}finally{await engine.stop();}
 }else{
 const scratch=process.env.CAPTRAW_WB_LOW_SCRATCH;
 if(!scratch)throw new Error('Set CAPTRAW_WB_LOW_SCRATCH to the captured baseline.');
 const baseline=JSON.parse(await readFile(join(scratch,'baseline.json'))),engine=new EngineClient({cache:join(scratch,'verification-cache')});engine.on('error',()=>{});
 let passed=false;
 try{
  assert.equal(hash(await readFile(source)),baseline.sourceHash);
  assert.deepEqual(JSON.parse(JSON.stringify(coordinates(oldPairs))),baseline.coordinates,'>=2000 K forward and legacy inverse coordinates must match the captured JSON exactly (zero sign is not encoded by JSON.stringify)');
  console.log('PASS 55 legacy coordinate/inverse pairs unchanged exactly at captured JSON precision');
  for(const row of baseline.renders){
   const {artProfile}=await engine.call('compose',{path:source,...baseline.dimensions,adjustments:row.adjustments,artProfile:''});
   assert.deepEqual(coefficients(artProfile),row.multipliers);
   const output=join(scratch,`new-${row.temperature}.tiff`);await engine.call('export',{path:source,artProfile,output,format:'tiff'});
   assert.equal(pixelHash(output),row.pixels,`Legacy pixels changed at ${row.temperature}`);await rm(output);
  }
  console.log('PASS 4 legacy camera coefficient sets and TIFF16 pixel arrays unchanged exactly');
  const pairs=[1500,1600,1667,1750,1900,1999,2000].flatMap(t=>[-150,-25,0,25,150].map(g=>[t,g]));
  const referenceText=execFileSync(join(scratch,'sdk-reference/reference'),[],{input:pairs.map(p=>p.join(' ')).join('\n')+'\n',encoding:'utf8'});
  const reference=referenceText.trim().split('\n').map(line=>{const [t,g,x,y,it,ig]=line.trim().split(/\s+/).map(Number);return {input:[t,g],xy:[x,y],inverse:[it,ig]};});
  assert.equal(reference.length,pairs.length);
  const actual=coordinates(pairs),cross=coordinates(reference.map(r=>({xy:r.xy})));let xyError=0,inverseError=0;
  for(let i=0;i<actual.length;i++){
   const error=Math.max(...actual[i].xy.map((v,j)=>Math.abs(v-reference[i].xy[j])));xyError=Math.max(xyError,error);
   assert(error<4e-6,JSON.stringify({actual:actual[i],reference:reference[i],error}));
   if(pairs[i][0]<2000){
    assert(Math.abs(actual[i].inverse[0]-pairs[i][0])<1e-5);assert(Math.abs(actual[i].inverse[1]-pairs[i][1])<1e-6);
    inverseError=Math.max(inverseError,Math.abs(cross[i].inverse[0]-pairs[i][0]));
    assert(Math.abs(cross[i].inverse[0]-pairs[i][0])<.15,JSON.stringify({reference:reference[i],cross:cross[i]}));
    assert(Math.abs(cross[i].inverse[1]-pairs[i][1])<.03);
   }
  }
  console.log('PASS independent local SDK comparison',JSON.stringify({whitepoints:reference.length,maximumXYError:xyError,maximumCrossInverseKelvinError:inverseError}));
  await writeFile(join(scratch,'sdk-whitepoints.json'),JSON.stringify(reference));
  execFileSync('build/qa-venv/bin/python',['tests/white-balance-low-fixtures.py',scratch],{stdio:'inherit'});
  const fixtures=JSON.parse(await readFile(join(scratch,'neutral-fixtures.json')));
  for(const fixture of fixtures){
   const sourceHash=hash(await readFile(fixture.path)),image=await engine.call('open',{path:fixture.path,sessionId:'low-neutral'});
   const adjustments={...image.adjustments,temperature:fixture.temperature,tint:0,wbMode:'custom',wbMultipliers:null,colorProfile:{...image.adjustments.colorProfile,mode:'embedded'}};
   const {artProfile}=await engine.call('compose',{path:fixture.path,width:image.width,height:image.height,artProfile:'',adjustments});
   const actual=coefficients(artProfile);assert(Math.max(...actual.map((v,i)=>Math.abs(v-fixture.multipliers[i])/fixture.multipliers[i]))<.0003,JSON.stringify({fixture,actual}));
   const output=join(scratch,`neutral-${fixture.temperature}.tiff`);await engine.call('export',{path:fixture.path,artProfile,output,format:'tiff'});
   execFileSync('build/qa-venv/bin/python',['-c',"import sys,numpy as np,tifffile; a=tifffile.imread(sys.argv[1]); m=np.median(a[32:-32,32:-32],axis=(0,1));spread=float((m.max()-m.min())/m.mean());assert a.dtype==np.uint16 and spread<.0015,(m,spread);print('PASS independent neutral DNG TIFF16',sys.argv[2],spread)",output,String(fixture.temperature)],{stdio:'inherit'});
   assert.equal(hash(await readFile(fixture.path)),sourceHash);
   const packet=await new Documents(new XMP(resolve('build/xmp/captraw-xmp'))).serialize({adjustments,artProfile,baselineVersion:4,source:{path:fixture.path,size:(await readFile(fixture.path)).length,sha256:sourceHash}});
   const properties=(await new XMP(resolve('build/xmp/captraw-xmp')).call('read',packet)).properties;
   assert.equal(Number(lookup(properties,CRS,'Temperature').value),fixture.temperature);
   assert.equal(decodeAdjustments(encodeAdjustments(adjustments)).adjustments.temperature,fixture.temperature);
   await assert.rejects(engine.call('compose',{path:fixture.path,width:image.width,height:image.height,artProfile:'',adjustments:{...adjustments,temperature:1499}}));
  }
  assert.throws(()=>decodeAdjustments(encodeAdjustments({temperature:1499})));
  assert.equal(hash(await readFile(source)),baseline.sourceHash);
  console.log('PASS native and XMP accept 1500/1750/1999, reject 1499; all source bytes unchanged');passed=true;
 }catch(error){console.error('Retained failure:',scratch);throw error;}finally{await engine.stop();if(passed){await rm(scratch,{recursive:true,force:true});console.log('PASS low-temperature scratch removed');}}
}

