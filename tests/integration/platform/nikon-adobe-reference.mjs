// Adobe is an independent test oracle only; the installed product never calls it.
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const converter='/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter';
const bench=resolve('build/upstream/redlamp-libraw-3b20539d3faa766a370e93a529a3b87edffbf0f6/redlamp/bench'),cache=resolve('build/samples/nikon-he'),out=resolve('artifacts/nikon-he-independent');mkdirSync(join(out,'refs'),{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),manifest=JSON.parse(readFileSync(join(bench,'samples.json'))),all=manifest.samples.filter(s=>s.mode==='HE'||s.mode==='HE*');
const fixtures=all.filter(s=>(!process.env.CAPTRAW_NIKON_FILTER||s.name.includes(process.env.CAPTRAW_NIKON_FILTER))&&existsSync(join(cache,s.name+'.NEF'))&&hash(join(cache,s.name+'.NEF'))===s.sha256);
assert(fixtures.length,'No complete Nikon fixtures available');assert(existsSync(converter),'Adobe reference converter unavailable');
const profile=resolve('tests/support/offline-native.sb'),dump=resolve('build/nikon-dump'),decode=args=>JSON.parse(execFileSync('/usr/bin/sandbox-exec',['-f',profile,dump,...args],{encoding:'utf8'}));
const dependency=execFileSync('otool',['-L',dump],{encoding:'utf8'}).split('\n').map(s=>s.trim().split(' (')[0]).find(s=>s.endsWith('/libraw_r.26.dylib'));assert(dependency&&dependency.startsWith('/'),'Dump tool must link the installed decoder');
const decoderLibrary={path:dependency,sha256:hash(dependency)};
const version=execFileSync('plutil',['-extract','CFBundleShortVersionString','raw','-o','-','/Applications/Adobe DNG Converter.app/Contents/Info.plist'],{encoding:'utf8'}).trim(),results=[],failures=[];
const report=()=>writeFileSync(join(out,'report.json'),JSON.stringify({referenceOnly:true,decoderLibrary,converterVersion:version,availableSamples:all.length,selectedSamples:fixtures.length,results,failures},null,2)+'\n');
for(const s of fixtures){
 try{
 const source=join(cache,s.name+'.NEF');let ref=readdirSync(join(out,'refs')).find(f=>f.toLowerCase()===(s.name+'.dng').toLowerCase());
 if(!ref){execFileSync('/usr/bin/sandbox-exec',['-f',profile,converter,'-u','-p0','-d',join(out,'refs'),source],{stdio:['ignore','pipe','pipe'],timeout:120000});ref=readdirSync(join(out,'refs')).find(f=>f.toLowerCase()===(s.name+'.dng').toLowerCase());}assert(ref,'Converter produced no DNG');
 ref=join(out,'refs',ref);const a=join(out,'current.u16'),b=join(out,'reference.u16'),actual=decode([source,a]),reference=decode([ref,b]);assert.equal(actual.unpack,0);assert.equal(reference.unpack,0);
 const current=readFileSync(a),expected=readFileSync(b);assert.equal(actual.raw_width,reference.raw_width,'Reference raw width differs');assert.equal(actual.raw_height,reference.raw_height,'Reference raw height differs');assert.equal(current.length,expected.length);
 let max=0,differences=0;for(let i=0;i<current.length;i+=2){const d=Math.abs(current.readUInt16LE(i)-expected.readUInt16LE(i));if(d){differences++;max=Math.max(max,d);}}
 const item={name:s.name,camera:s.camera,mode:s.mode,crop:s.crop,sourceSHA256:hash(source),referenceSHA256:hash(ref),photosites:current.length/2,maximumDifference:max,differingPhotosites:differences,sourceUnchanged:hash(source)===s.sha256,licence:s.licence||'CC0',source:s.source||manifest.source};results.push(item);rmSync(a);rmSync(b);report();assert.equal(differences,0,'Photosites differ from Adobe');console.log('PASS independent',s.name,item.photosites);
 }catch(error){failures.push({name:s.name,error:String(error)});report();console.error('FAIL independent',s.name,String(error));}
}
report();if(failures.length)throw new Error(`${failures.length} independent Nikon comparisons failed`);
