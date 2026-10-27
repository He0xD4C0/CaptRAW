import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),work=join(root,'build/segmentation');
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Segmentation currently builds on macOS arm64');
copyFileSync(join(work,'upstream/onnxruntime-osx-arm64-1.30.0/lib/libonnxruntime.1.30.0.dylib'),join(work,'libonnxruntime.1.dylib'));
copyFileSync(join(root,'build/bundle/native/lib/libpng16.16.dylib'),join(work,'libpng16.16.dylib'));
const registry=JSON.parse(readFileSync(join(root,'tests/segmentation-sources.json'),'utf8')).convertedModels;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const models=['tiny','small'].filter(m=>m==='small'||existsSync(join(work,'models',m,'encoder.onnx')));
for(const model of models){
 const directory=join(work,'models',model),files={...registry[model].files,'preprocess.onnx':registry.preprocess};
 const prep=join(work,'models/preprocess.onnx');if(hash(prep)!==registry.preprocess.sha256)throw new Error('Preprocessing graph checksum mismatch');
 copyFileSync(prep,join(directory,'preprocess.onnx'));
 for(const [name,expected]of Object.entries(files)){const p=join(directory,name);if(readFileSync(p).length!==expected.bytes||hash(p)!==expected.sha256)throw new Error('Converted model checksum mismatch: '+p);}
 writeFileSync(join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,modelId:registry[model].modelId,files},null,2)+'\n');
}
execFileSync('clang++',['-std=c++17','-O2','native/segmentation-worker.cc','native/segmentation.cc','native/segmentation-input.cc',
 '-I'+join(work,'upstream/onnxruntime-osx-arm64-1.30.0/include'),'-I/opt/homebrew/include',join(work,'libonnxruntime.1.dylib'),join(work,'libpng16.16.dylib'),
 '-Wl,-rpath,@loader_path','-o',join(work,'captraw-segment')],{cwd:root,stdio:'inherit'});
execFileSync('codesign',['--verify','--strict',join(work,'captraw-segment')],{stdio:'pipe'});
writeFileSync(join(work,'worker-build.json'),JSON.stringify({binarySHA256:hash(join(work,'captraw-segment')),sources:Object.fromEntries(['native/segmentation-worker.cc','native/segmentation.cc','native/segmentation.h','native/segmentation-input.cc','native/segmentation-input.h'].map(p=>[p,hash(join(root,p))])),manifests:Object.fromEntries(models.map(m=>[m,hash(join(work,'models',m,'manifest.json'))]))},null,2)+'\n');
console.log('Built independent segmentation worker:',join(work,'captraw-segment'));
