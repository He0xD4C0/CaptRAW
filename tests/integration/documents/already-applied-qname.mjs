// Compile only the small metadata helper adapter in an independent temporary
// directory. Never build the shared engine or rewrite any source photo.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
const root=await mkdtemp(join(tmpdir(),'captraw-xmp-qnames-')),hash=bytes=>createHash('sha256').update(bytes).digest('hex');let passed=false;
const U='https://example.invalid/qname/U/',V='https://example.invalid/qname/V/';
function scopedPacket(witness=false,shadow=false,collision=false,rich=false){
 return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:p="${U}">
<p:Envelope rdf:parseType="Resource"><p:OuterU>p:outer literal</p:OuterU><p:NestedV xmlns:p="${V}" rdf:parseType="Resource"><p:InnerV>p:inner literal</p:InnerV></p:NestedV>
<p:UQualified rdf:parseType="Resource"><rdf:value>ordinary p:literal &amp; 中文 &#13; unchanged</rdf:value><p:QualV xmlns:p="${V}">p:qualifier V</p:QualV><p:QualU>p:qualifier U</p:QualU></p:UQualified><p:AfterU>p:after literal</p:AfterU>
${rich?`<p:Sequence><rdf:Seq><rdf:li rdf:parseType="Resource" xmlns:p="${V}"><p:Item>p:second</p:Item><p:Attrs p:Proof="p:attribute &amp; &#9;&#10;&#13; literal"/></rdf:li><rdf:li rdf:parseType="Resource"><p:Item xml:lang="zh-CN">p:第一</p:Item></rdf:li></rdf:Seq></p:Sequence><Default xmlns="${V}" rdf:parseType="Resource"><p:Field>default namespace rebind</p:Field></Default>`:''}
${collision?`<p:Same>U same</p:Same><p:Same xmlns:p="${V}">V same</p:Same>`:''}</p:Envelope>
${witness?`<v:SchemaWitness xmlns:v="${V}">V schema</v:SchemaWitness>`:''}${shadow?'<captrawXmlNs0:Shadow xmlns:captrawXmlNs0="https://example.invalid/qname/W/">captrawXmlNs0:literal</captrawXmlNs0:Shadow>':''}
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}
function packet(p,q,deep=false){
 const seed=`<${p}:Seed>U literal a:Text new:Text ?qual:Proof https://example.invalid/a:uri</${p}:Seed><${q}:Seed>V seed</${q}:Seed>`;
 const body=deep?`<${p}:Struct rdf:parseType="Resource"><${q}:Deep rdf:parseType="Resource"><${p}:Leaf rdf:parseType="Resource"><rdf:value>literal new:Leaf &amp; a:Leaf</rdf:value><${q}:Proof>literal qual:Proof != b:Proof</${q}:Proof></${p}:Leaf></${q}:Deep><${p}:Seq><rdf:Seq><rdf:li rdf:parseType="Resource"><${q}:Name>second:literal</${q}:Name></rdf:li><rdf:li rdf:parseType="Resource"><${q}:Name>first:literal</${q}:Name></rdf:li></rdf:Seq></${p}:Seq></${p}:Struct>
<${p}:Array rdf:parseType="Resource"><rdf:value><rdf:Seq><rdf:li>second:literal</rdf:li><rdf:li>first:literal</rdf:li></rdf:Seq></rdf:value><${q}:ArrayProof>literal new:Array /?qual:Proof</${q}:ArrayProof></${p}:Array>
<${p}:Empty></${p}:Empty><${p}:Localized><rdf:Alt><rdf:li xml:lang="x-default">literal new:Localized</rdf:li><rdf:li xml:lang="zh-CN">中文 a:literal</rdf:li></rdf:Alt></${p}:Localized>`:'';
 return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:${p}="${U}" xmlns:${q}="${V}">${seed}${body}</rdf:Description></rdf:RDF></x:xmpmeta>`;
}
function canonical(n){
 if(!n)return n;const result={};
 for(const key of ['localized','lang','type'])if(n[key]!==undefined)result[key]=n[key];
 if(n.value!==undefined&&!n.fields&&!n.items)result.value=n.value;
 if(n.options&0x1f02)result.options=n.options&0x1f02;
 for(const key of ['fields','qualifiers'])if(n[key])result[key]=properties(n[key]);
 if(n.items)result.items=n.items.map(canonical);return result;
}
const properties=ps=>ps.map(p=>({ns:p.ns,name:p.name,node:canonical(p.node)})).sort((a,b)=>(a.ns+'|'+a.name).localeCompare(b.ns+'|'+b.name));
const parse=packet=>{const response=JSON.parse(execFileSync(resolve('build/xmp/captraw-xmp'),[],{input:JSON.stringify({id:1,method:'read',packet})+'\n',encoding:'utf8'}));assert(!response.error,response.error);return response.result.properties;};
try{
 const inputs=[packet('a','b'),packet('new','qual',true),packet('third','other',true),packet('a','b',true),
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:a="https://example.invalid/qname/W/"><a:Struct rdf:parseType="Resource"><a:Leaf rdf:parseType="Resource"><rdf:value>ordinary a:literal unchanged</rdf:value><a:Proof>same a:literal</a:Proof></a:Leaf></a:Struct></rdf:Description></rdf:RDF></x:xmpmeta>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:again="https://example.invalid/qname/U/" xmlns:leaf="https://example.invalid/qname/OnlyNested/"><again:Struct rdf:parseType="Resource"><leaf:Leaf rdf:parseType="Resource"><rdf:value>leaf:literal</rdf:value><leaf:Proof>again:literal</leaf:Proof></leaf:Leaf></again:Struct></rdf:Description></rdf:RDF></x:xmpmeta>'
 ];
 const files=[];for(const [index,input]of inputs.entries()){const path=join(root,String(index)+'.xmp');await writeFile(path,input);files.push(path);}
 const originalHashes=await Promise.all(files.map(async path=>hash(await readFile(path))));
 // Use the same explicit imported Expat target as the production owner. This
 // verifies helper compilation/linkage only; the coordinated engine build is separate.
 const project=join(root,'project'),build=join(root,'build');await mkdir(project);
 await writeFile(join(project,'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.20)
project(XMPQNameRegression LANGUAGES CXX)
find_package(EXPAT REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(EXIV2 REQUIRED IMPORTED_TARGET exiv2)
add_executable(qname-probe "${resolve('tests/native/documents/already-applied-qname.cc')}")
target_compile_features(qname-probe PRIVATE cxx_std_17)
target_link_libraries(qname-probe PRIVATE EXPAT::EXPAT PkgConfig::EXIV2 nlohmann_json::nlohmann_json)
file(GENERATE OUTPUT "\${CMAKE_BINARY_DIR}/expat-target.txt" CONTENT "$<TARGET_FILE:EXPAT::EXPAT>\\n$<TARGET_PROPERTY:EXPAT::EXPAT,INTERFACE_INCLUDE_DIRECTORIES>\\n")
`);
 execFileSync('cmake',['-S',project,'-B',build,'-G','Ninja'],{stdio:'pipe'});
 execFileSync('cmake',['--build',build,'--target','qname-probe','-j','2'],{stdio:'pipe'});
 const binary=join(build,'qname-probe');console.log('EXPAT::EXPAT helper linkage:',(await readFile(join(build,'expat-target.txt'),'utf8')).trim().replaceAll('\n','; '));
 for(const name of ['raw','fixed'])await mkdir(join(root,name));
 const run=(mode,paths=files)=>JSON.parse(execFileSync(binary,[mode,join(root,mode==='raw'?'raw':'fixed'),...paths],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const raw=run('raw');assert.deepEqual(raw.map(r=>r.code),[0,3,3,0,0,0],'pinned Exiv2 alias mismatch remains the independent failing control');
 console.log('PASS raw Exiv2 same-process QName failure reproduced for two distinct aliases');
 const fixed=run('fixed');assert.equal(fixed.length,7);
 const compare=async(item,expected)=>{
  expected??=properties(parse(await readFile(item.input,'utf8')));
  assert.equal(item.code,0,basename(item.input));
  assert.deepEqual(properties(parse(await readFile(item.normalized,'utf8'))),expected,'normalized '+basename(item.input));
  assert.deepEqual(properties(parse(await readFile(item.output,'utf8'))),expected,'encoded '+basename(item.input));
 };
 for(const item of fixed)await compare(item);
 console.log('PASS 7 complete SDK RDF comparisons: multi-alias structs/qualifiers/arrays, namespace reuse, cached mixed-alias XmpData, LangAlt, empty and literal text');
 const scoped=[];
 for(const [index,input]of [scopedPacket(),scopedPacket(true),scopedPacket(true,true),scopedPacket(false,false,true),scopedPacket(true,true,true,true)].entries()){
  parse(input);const path=join(root,'scoped-'+index+'.xmp');await writeFile(path,input);scoped.push(path);
 }
 const scopedRaw=run('raw',scoped.slice(0,1));assert.equal(scopedRaw[0].code,0);
 assert(scopedRaw[0].keys.includes('Xmp.p.Envelope/p:NestedV/p:InnerV'));
 assert(scopedRaw[0].keys.includes('Xmp.p.Envelope/p:UQualified/?p:QualV'));
 assert.notDeepEqual(properties(parse(await readFile(scopedRaw[0].output,'utf8'))),properties(parse(await readFile(scoped[0],'utf8'))),'raw Exiv2 silently assigns nested fields/qualifiers to the outer URI');
 console.log('PASS raw Exiv2 scoped-prefix URI corruption reproduced without the helper');
 const scopedHashes=await Promise.all(scoped.map(async path=>hash(await readFile(path))));
 const mixed=run('fixed',[...files,...scoped,...scoped.slice().reverse()]);assert.equal(mixed.length,17);
 for(const item of mixed)await compare(item);
 for(const [index,path]of scoped.entries())assert.equal(hash(await readFile(path)),scopedHashes[index]);
 console.log('PASS 17 same-worker full SDK RDF comparisons before normalization/after normalization/after encoding: 5 scoped fixtures in both orders, 6 alias fixtures, and cached mixed-alias reuse');
 const utf16=join(root,'scoped-utf16.xmp'),utf16Input='<?xml version="1.0" encoding="UTF-16"?>'+scopedPacket(true,true,true,true);
 await writeFile(utf16,Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(utf16Input,'utf16le')]));
 for(const item of run('packet',[utf16]))await compare(item,properties(parse(scopedPacket(true,true,true,true))));
 console.log('PASS UTF-16 source packet normalized to UTF-8 without truncating its final code unit or changing SDK RDF values');
 for(const [index,path]of files.entries())assert.equal(hash(await readFile(path)),originalHashes[index]);
 if(process.argv[2]){
  const sources=['ordinary','minimal','private'].map(name=>join(resolve(process.argv[2]),name+'.tiff'));
  const hashes=await Promise.all(sources.map(async path=>hash(await readFile(path))));
  for(const item of run('fixed',sources)){
   assert.equal(item.code,0);const original=execFileSync('exiftool',['-b','-XMP',item.input],{encoding:'utf8'});
   assert.deepEqual(properties(parse(await readFile(item.output,'utf8'))),properties(parse(original)),basename(item.input));
  }
  for(const [index,path]of sources.entries())assert.equal(hash(await readFile(path)),hashes[index]);
  console.log('PASS 4 actual HDR-source/cache full SDK RDF comparisons, including the entire original archive before privacy filtering');
 }
 passed=true;
}finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('QName failure retained:',root);}
