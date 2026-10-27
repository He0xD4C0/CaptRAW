import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This deployment probe currently targets macOS arm64');
const root=resolve(import.meta.dirname,'..'),work=join(root,'build/segmentation');
const ort=join(work,'upstream/onnxruntime-osx-arm64-1.30.0');
const installed=join(homedir(),'Applications/CaptRAW-0.26.app/Contents/Resources/native');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
mkdirSync(work,{recursive:true});
const libraries=[['libonnxruntime.1.dylib',join(ort,'lib/libonnxruntime.1.30.0.dylib')],['libpng16.16.dylib',join(installed,'lib/libpng16.16.dylib')]];
for(const [name,path]of libraries)copyFileSync(path,join(work,name));
execFileSync('clang++',['-std=c++17','-O2','tests/segmentation-runtime.cc','native/segmentation-input.cc',
 '-I'+join(ort,'include'),'-I/opt/homebrew/include',join(work,'libonnxruntime.1.dylib'),join(work,'libpng16.16.dylib'),
 '-Wl,-rpath,@loader_path','-o',join(work,'runtime-probe')],{cwd:root,stdio:'inherit'});
const files=['runtime-probe',...libraries.map(v=>v[0])];
for(const name of files){
 const path=join(work,name);execFileSync('codesign',['--verify','--strict',path],{stdio:'pipe'});
 const links=execFileSync('otool',['-L',path],{encoding:'utf8'}).split('\n').slice(1).filter(Boolean).map(line=>line.trim().split(' (')[0]);
 if(links.some(p=>!p.startsWith('@loader_path/')&&!p.startsWith('@rpath/')&&!p.startsWith('/usr/lib/')&&!p.startsWith('/System/Library/')))throw new Error('Unbundled dependency: '+name);
}
writeFileSync(join(work,'runtime-build.json'),JSON.stringify({platform:'darwin-arm64',files:Object.fromEntries(files.map(name=>[name,hash(join(work,name))])),sources:Object.fromEntries(['tests/segmentation-runtime.cc','native/segmentation-input.h','native/segmentation-input.cc'].map(p=>[p,hash(join(root,p))]))},null,2)+'\n');
console.log('Built standalone headless probe:',join(work,'runtime-probe'));
