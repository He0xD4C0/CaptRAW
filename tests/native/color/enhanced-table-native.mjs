import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {rustReference} from '../../support/enhanced-table-reference.mjs';
const alphabet="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?`'|()[]{}@%$#";
export function encodeTable(bytes){
 const length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);const data=Buffer.concat([length,deflateSync(bytes)]);let encoded='';
 for(let i=0;i<data.length;i+=4){const count=Math.min(4,data.length-i),part=Buffer.alloc(4);data.copy(part,0,i,i+count);let value=part.readUInt32LE();for(let n=0;n<count+1;++n){encoded+=alphabet[value%85];value=Math.floor(value/85);}}
 return encoded;
}
export function rgbTable({dimensions=3,divisions=3,primaries=0,gamma=0,gamut=0,flags=0,bounds=[0,2],identity=false}={}){
 const n=divisions,count=dimensions===1?n:n**3,end=16+6*count,bytes=Buffer.alloc(end+32);
 [1,1,dimensions,n].forEach((v,i)=>bytes.writeUInt32LE(v,i*4));
 for(let i=0;i<count;++i){const indexes=dimensions===1?[i,i,i]:[Math.floor(i/(n*n)),Math.floor(i/n)%n,i%n],p=indexes.map(v=>v/(n-1));
  // Same class of public synthetic asymmetric maps as upstream synthetic-looks.py;
  // expected values come from the pinned original Rust reader/application, not this generator.
  const out=identity?p:[Math.max(0,Math.min(1,.04+.68*p[0]+.16*p[1]*p[2])),Math.max(0,Math.min(1,.03+.73*p[1]+.13*p[0]*p[0])),Math.max(0,Math.min(1,.06+.69*p[2]+.17*p[1]*p[0]))];
  for(let c=0;c<3;++c){const grid=Math.floor((indexes[c]*65535+Math.floor((n-1)/2))/(n-1)),target=Math.round(out[c]*65535);bytes.writeUInt16LE((target-grid+65536)%65536,16+i*6+c*2);}
 }
 [primaries,gamma,gamut].forEach((v,i)=>bytes.writeUInt32LE(v,end+4*i));bytes.writeDoubleLE(bounds[0],end+12);bytes.writeDoubleLE(bounds[1],end+20);bytes.writeUInt32LE(flags,end+28);return bytes;
}
export function hsvTable({version=2,dimensions=[6,3,3],gamma=0,bounds=[0,2],flags=0}={}){
 const count=dimensions.reduce((a,b)=>a*b),end=20+count*12,bytes=Buffer.alloc(end+(version===2?20:4)+4);
 [0,version,...dimensions].forEach((v,i)=>bytes.writeUInt32LE(v,i*4));
 for(let i=0;i<count;++i){const hue=Math.floor(i/dimensions[1])%dimensions[0],sat=i%dimensions[1],value=Math.floor(i/(dimensions[0]*dimensions[1]));[(-22+9*hue+3*value),.65+.21*sat,.75+.11*value+.03*hue].forEach((v,c)=>bytes.writeFloatLE(v,20+12*i+4*c));}
 bytes.writeUInt32LE(gamma,end);if(version===2){bytes.writeDoubleLE(bounds[0],end+4);bytes.writeDoubleLE(bounds[1],end+12);}bytes.writeUInt32LE(flags,bytes.length-4);return bytes;
}
export const lookDefinition=(bytes,kind='RGBTable')=>{
 const id=createHash('md5').update(bytes).digest('hex').toUpperCase();
 return {schemaVersion:1,uuid:'ABCDEF1234567890ABCDEF1234567890',name:'Synthetic enhanced Look',group:'Public differential vectors',copyright:'Synthetic data',baseProfile:'',cameraModelRestriction:'',supportsAmount:true,supportsSceneReferred:true,supportsOutputReferred:true,supportsColor:true,supportsMonochrome:true,supportsHighDynamicRange:true,supportsNormalDynamicRange:true,parameters:{[kind]:id,RGBTableAmount:'0.5'},tables:[{fingerprint:id,data:encodeTable(bytes)}],xmpPacket:''};
};
export function probe(inputs){
 const binary=resolve(process.env.CAPTRAW_ENHANCED_PROBE||'build/native/captraw-enhanced-table-probe');
 return execFileSync(binary,[],{input:inputs.map(v=>JSON.stringify(v)).join('\n')+'\n',encoding:'utf8',maxBuffer:64*1024*1024}).trim().split('\n').map(v=>JSON.parse(v));
}
async function main(){
 const scratch=await mkdtemp(join(tmpdir(),'captraw-enhanced-native-'));let passed=false;
 try{
  const reference=await rustReference(scratch),pixels=[[.82,.51,.19],[.82,.19,.51],[.51,.82,.19],[.19,.82,.51],[.51,.19,.82],[.19,.51,.82],[0,0,0],[1,1,1],[.5,.5,.5],[-.1,.34,1.2],[1.8,-.2,.4]];
  let tables=0,samples=0,worst=0;
  for(const dimensions of [1,3])for(let primaries=0;primaries<5;++primaries)for(let gamma=0;gamma<5;++gamma)for(let gamut=0;gamut<2;++gamut){
   const bytes=rgbTable({dimensions,divisions:dimensions===1?7:3,primaries,gamma,gamut,flags:tables%2}),encoded=encodeTable(bytes),cases=[];
   for(const amount of [0,.25,1,1.5,2])for(const tableAmount of [.5,1,2])for(const p of pixels)cases.push([...p,amount,tableAmount]);
   const expected=await reference(bytes,cases),actual=probe(cases.map(([r,g,b,amount,tableAmount])=>({encoded,pixels:[[r,g,b]],amount,tableAmount})));
   for(let i=0;i<cases.length;++i){assert(!actual[i].error,actual[i].error);assert.equal(actual[i].result.sha256,createHash('sha256').update(bytes).digest('hex'));for(let c=0;c<3;++c){const error=Math.abs(actual[i].result.pixels[0][c]-expected[i][c]);worst=Math.max(worst,error);assert(error<5e-5,JSON.stringify({dimensions,primaries,gamma,gamut,input:cases[i],channel:c,actual:actual[i].result.pixels[0],expected:expected[i],error}));}++samples;}
   ++tables;
  }
  console.log(`PASS original Rust RGB differential: ${tables} tables, ${samples} pixel/amount cases, max absolute error ${worst}`);
  let hsvCount=0;
  for(const version of [1,2])for(const gamma of [0,1])for(const dimensions of [[1,2,1],[6,3,1],[6,3,3]]){
   const bytes=hsvTable({version,gamma,dimensions}),encoded=encodeTable(bytes),cases=[];
   for(const amount of [0,.25,1,1.5,2])for(const p of pixels)cases.push([...p,amount,1]);
   const expected=await reference(bytes,cases),actual=probe(cases.map(([r,g,b,amount])=>({encoded,pixels:[[r,g,b]],amount})));
   for(let i=0;i<cases.length;++i){assert(!actual[i].error,actual[i].error);for(let c=0;c<3;++c){const error=Math.abs(actual[i].result.pixels[0][c]-expected[i][c]);assert(error<5e-5,JSON.stringify({version,gamma,dimensions,input:cases[i],channel:c,actual:actual[i].result.pixels[0],expected:expected[i],error}));}++hsvCount;}
  }
  console.log(`PASS original Rust HSV arithmetic: ${hsvCount} pixel/amount cases, v1/v2, one/multiple value divisions, hue wrapping`);
  const base=rgbTable(),invalid=[];
  for(const [offset,value] of [[0,9],[4,2],[8,2],[12,1]]){const v=Buffer.from(base);v.writeUInt32LE(value,offset);invalid.push(encodeTable(v));}
  invalid.push(encodeTable(base.subarray(0,-1)),encodeTable(rgbTable({flags:2})),encodeTable(rgbTable({gamma:5})),encodeTable(rgbTable({primaries:5})),encodeTable(rgbTable({gamut:2})),encodeTable(rgbTable({bounds:[0,.5]})));
  const nan=Buffer.from(base);nan.writeDoubleLE(NaN,base.length-20);invalid.push(encodeTable(nan));invalid.push('z','~~~~~');
  for(const r of probe(invalid.map(encoded=>({encoded}))))assert(r.error,'Malformed/unsupported table was accepted');
  console.log(`PASS ${invalid.length} malformed, nonfinite and unsupported table boundaries reject`);
  const profile=lookDefinition(base),p=[[.2,.4,.8]],inputs=[{profile,amount:1.5,pixels:p,stage:'rgb'},{encoded:profile.tables[0].data,amount:1.5,tableAmount:.5,pixels:p}];
  const [normalized,direct]=probe(inputs);assert(!normalized.error,normalized.error);assert.deepEqual(normalized.result.pixels,direct.result.pixels);
  const unsupported=structuredClone(profile);unsupported.parameters.UnknownRequiredControl='1';assert(probe([{profile:unsupported,amount:1}])[0].error);
  const missing=structuredClone(profile);missing.tables=[];assert(probe([{profile:missing,amount:1}])[0].error);
  const wrongFingerprint=structuredClone(profile),wrongID='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';wrongFingerprint.tables[0].fingerprint=wrongID;wrongFingerprint.parameters.RGBTable=wrongID;
  assert(probe([{profile:wrongFingerprint,amount:1}])[0].error,'Valid hex and matching references must not substitute for the actual payload fingerprint');
  const curveOnly=structuredClone(profile);curveOnly.tables=[];curveOnly.parameters={};curveOnly.curve=[{x:0,y:0},{x:.4,y:.6},{x:1,y:1}];
  const curveResult=probe([{profile:curveOnly,amount:1,stage:'curve',pixels:[[.2,.4,.7]]}])[0];assert(!curveResult.error,curveResult.error);assert.notDeepEqual(curveResult.result.pixels,[[.2,.4,.7]]);
  const missingWithCurve=structuredClone(curveOnly);missingWithCurve.parameters.RGBTable=profile.tables[0].fingerprint;assert(probe([{profile:missingWithCurve,amount:1}])[0].error,'A curve must not hide a missing referenced table');
  const empty=structuredClone(curveOnly);delete empty.curve;assert(probe([{profile:empty,amount:1}])[0].error,'A metadata-only placeholder has no supported rendering state');
  console.log('PASS normalized asset contract, amount composition and required-feature rejection (upstream arithmetic; independent ACR acceptance remains separate)');
  const manifest=JSON.parse(await readFile('native/config/enhanced-profile-sources.json','utf8'));assert.equal(manifest.commit,'e0251f9da4b8b70678388f4ec357ba88f416ac32');assert.equal(createHash('sha256').update(await readFile('native/config/enhanced-profile.LICENSE')).digest('hex'),manifest.files.find(f=>f.path==='LICENSE').sha256);
  if(process.env.CAPTRAW_ENHANCED_INSTALLED_MANIFEST){
   const installed=JSON.parse(await readFile(process.env.CAPTRAW_ENHANCED_INSTALLED_MANIFEST,'utf8'));
   const {XMP,CRS}=await import('@captraw/desktop-core/xmp'),xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'));
   const installedRoot=process.env.CAPTRAW_ENHANCED_INSTALLED_ROOT||'/Library/Application Support/Adobe/CameraRaw/Settings/Adobe/Profiles',seen=new Set();let count=0;
   for(const source of installed.files){
    const bytes=await readFile(join(installedRoot,source.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256,'Installed source changed: '+source.file);
    const properties=(await xmp.call('read',new TextDecoder('utf-8',{fatal:true}).decode(bytes))).properties;
    for(const property of properties.filter(p=>p.ns===CRS&&/^Table_[a-f0-9]{32}$/i.test(p.name))){
     const id=property.name.slice(6).toLowerCase(),expected=installed.tables.find(t=>t.adobeFingerprint===id);assert(expected,'Manifest is missing table '+id);
     const result=probe([{encoded:property.node.value}])[0];assert(!result.error,result.error);assert.equal(result.result.wireMD5,id);
     for(const key of ['sha256','type','version','samples','dimensions','divisions','primaries','gamma','gamut','flags','bounds'])assert.deepEqual(result.result[key],expected[key],source.file+' / '+key);
     seen.add(id);++count;
    }
   }
   assert.equal(seen.size,installed.tables.length);console.log(`PASS optional read-only installed manifest: ${installed.files.length} files, ${seen.size} unique tables, ${count} declarations; payloads remain outside the repository`);
  }
  passed=true;
 }finally{if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained enhanced native failure:',scratch);}
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)await main();
