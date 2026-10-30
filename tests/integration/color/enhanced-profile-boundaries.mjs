// Focused regression checks; deliberately does not repeat the Rust table differential.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {probe,rgbTable,hsvTable,lookDefinition,encodeTable} from '../../native/color/enhanced-table-native.mjs';
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
const bytes=rgbTable(),profile=lookDefinition(bytes),pixel=[.25,.5,.75],outside=[-.5,1.25,.5];
const wrong=structuredClone(profile),wrongID='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';wrong.tables[0].fingerprint=wrongID;wrong.parameters.RGBTable=wrongID;
assert.match(probe([{profile:wrong,amount:1}])[0].error||'',/指纹/);
const changed=Buffer.from(bytes);changed.writeUInt16LE((changed.readUInt16LE(16)+1)%65536,16);
const tampered=structuredClone(profile);tampered.tables[0].data=encodeTable(changed);
assert.notEqual(hash('md5',changed),profile.tables[0].fingerprint.toLowerCase());
assert.match(probe([{profile:tampered,amount:1}])[0].error||'',/指纹/);
const lower=structuredClone(profile);lower.tables[0].fingerprint=lower.tables[0].fingerprint.toLowerCase();lower.parameters.RGBTable=lower.parameters.RGBTable.toLowerCase();
assert(!probe([{profile:lower,amount:1}])[0].error);
console.log('PASS strict payload fingerprint: valid-hex forgery and structurally valid sample tampering reject; case-insensitive genuine digest accepts');
const identity=lookDefinition(rgbTable({dimensions:1,divisions:2,identity:true,gamut:1}));
const hsv=hsvTable();const count=hsv.readUInt32LE(8)*hsv.readUInt32LE(12)*hsv.readUInt32LE(16);
for(let i=0;i<count;++i)for(let c=0;c<3;++c)hsv.writeFloatLE(c?1:0,20+i*12+c*4);
const hsvIdentity=lookDefinition(hsv,'LookTable');hsvIdentity.parameters={LookTable:hsvIdentity.tables[0].fingerprint};
for(const request of [{profile:identity,amount:1,stage:'rgb'},{profile:hsvIdentity,amount:1,stage:'hsv'},{profile,amount:0,stage:'rgb'}]){
 const result=probe([{...request,pixels:[pixel,outside]}])[0];assert(!result.error,result.error);assert.deepEqual(result.result.pixels,[pixel,outside]);
}
console.log('PASS neutral RGB/HSV and zero RGB amount bypass exactly, including input outside the table domain');
const curveOnly=structuredClone(profile);curveOnly.tables=[];curveOnly.parameters={};curveOnly.curve=[{x:0,y:0},{x:.4,y:.6},{x:1,y:1}];
const curve=probe([{profile:curveOnly,amount:1,stage:'curve',pixels:[pixel]}])[0];assert(!curve.error,curve.error);assert.notDeepEqual(curve.result.pixels,[pixel]);
const zeroCurve=probe([{profile:curveOnly,amount:0,stage:'curve',pixels:[pixel,outside]}])[0];assert(!zeroCurve.error,zeroCurve.error);assert.deepEqual(zeroCurve.result.pixels,[pixel,outside]);
const missing=structuredClone(curveOnly);missing.parameters.RGBTable=profile.tables[0].fingerprint;assert.match(probe([{profile:missing,amount:1}])[0].error||'',/缺少表资产/);
const empty=structuredClone(curveOnly);delete empty.curve;assert.match(probe([{profile:empty,amount:1}])[0].error||'',/没有表、曲线或支持/);
console.log('PASS curve-only zero-table Look accepts and changes pixels; zero curve amount bypasses; a missing referenced table and metadata-only placeholder still reject');
if(process.env.CAPTRAW_ENHANCED_INSTALLED_MANIFEST){
 const manifest=JSON.parse(await readFile(process.env.CAPTRAW_ENHANCED_INSTALLED_MANIFEST,'utf8'));
 const {XMP,CRS}=await import('@captraw/desktop-core/documents'),xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'));
 const root=process.env.CAPTRAW_ENHANCED_INSTALLED_ROOT||'/Library/Application Support/Adobe/CameraRaw/Settings/Adobe/Profiles',seen=new Set();let declarations=0;
 for(const source of manifest.files){
  const file=join(root,source.file),data=await readFile(file);assert.equal(hash('sha256',data),source.sha256,source.file);
  const properties=(await xmp.call('read',new TextDecoder('utf-8',{fatal:true}).decode(data))).properties;
  for(const property of properties.filter(p=>p.ns===CRS&&/^Table_[a-f0-9]{32}$/i.test(p.name))){
   const id=property.name.slice(6).toLowerCase(),expected=manifest.tables.find(t=>t.adobeFingerprint===id),result=probe([{encoded:property.node.value}])[0];assert(expected,id);assert(!result.error,result.error);assert.equal(result.result.wireMD5,id);
   for(const key of ['sha256','type','version','samples','dimensions','divisions','primaries','gamma','gamut','flags','bounds'])assert.deepEqual(result.result[key],expected[key],source.file+' / '+key);
   const genuine=lookDefinition(bytes);genuine.tables=[{fingerprint:id,data:property.node.value}];genuine.parameters={[result.result.type==='hsv'?'LookTable':'RGBTable']:id};
   assert(!probe([{profile:genuine,amount:1}])[0].error,'Real installed payload must pass the strict Profile validator: '+source.file);
   seen.add(id);++declarations;
  }
  assert.equal(hash('sha256',await readFile(file)),source.sha256);
 }
 assert.equal(seen.size,manifest.tables.length);console.log(`PASS optional installed assets: ${manifest.files.length} source SHA checks, ${seen.size} unique table fingerprints/descriptions, ${declarations} strict profile validations; no payload copied`);
}
