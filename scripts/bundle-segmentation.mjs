import './build-segmentation-worker.mjs';
import {resolve,join} from 'node:path';import {mkdirSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const work=resolve('build/segmentation'),output=resolve('build/bundle/segmentation'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
rmSync(output,{recursive:true,force:true});mkdirSync(join(output,'models/small'),{recursive:true});mkdirSync(join(output,'licenses'),{recursive:true});
const manifest=JSON.parse(readFileSync(join(work,'models/small/manifest.json')));const files={};
for(const name of ['captraw-segment','libonnxruntime.1.dylib','libpng16.16.dylib']){
 const destination=join(output,name);cpSync(join(work,name),destination);execFileSync('codesign',['--verify','--strict',destination]);
 const links=execFileSync('otool',['-L',destination],{encoding:'utf8'}).split('\n').slice(1).filter(Boolean).map(s=>s.trim().split(' (')[0]);
 if(links.some(p=>!p.startsWith('@loader_path/')&&!p.startsWith('@rpath/')&&!p.startsWith('/usr/lib/')&&!p.startsWith('/System/Library/')))throw new Error('Unbundled segmentation dependency: '+name);
 files[name]=hash(destination);
}
for(const [name,expected]of Object.entries(manifest.files)){const source=join(work,'models/small',name);if(hash(source)!==expected.sha256||readFileSync(source).length!==expected.bytes)throw new Error('Model checksum mismatch: '+name);cpSync(source,join(output,'models/small',name));files['models/small/'+name]=expected.sha256;}
cpSync(join(work,'models/small/manifest.json'),join(output,'models/small/manifest.json'));
const sam=join(work,'upstream/sam2-2b90b9f5ceec907a1c18123530e92e794ad901a4'),ort=join(work,'upstream/onnxruntime-osx-arm64-1.30.0');
for(const [source,name]of [[join(sam,'LICENSE'),'SAM2-LICENSE.txt'],[join(ort,'LICENSE'),'ORT-LICENSE.txt'],[join(ort,'ThirdPartyNotices.txt'),'ORT-ThirdPartyNotices.txt'],[resolve('build/bundle/native/licenses/libpng/LICENSE'),'libpng-LICENSE.txt']])cpSync(source,join(output,'licenses',name));
writeFileSync(join(output,'NOTICE.txt'),`CaptRAW local object selection\nSAM 2.1 Small, Copyright (c) Meta Platforms, Inc. and affiliates. Apache-2.0.\nSource: https://github.com/facebookresearch/sam2/tree/2b90b9f5ceec907a1c18123530e92e794ad901a4\nOfficial checkpoint converted to FP32 ONNX using the unmodified Microsoft ONNX Runtime v1.30.0 SAM2 exporter. No quantization or retraining.\nONNX Runtime v1.30.0, Copyright (c) Microsoft Corporation. MIT.\nSource: https://github.com/microsoft/onnxruntime/tree/v1.30.0\nDeterministic preprocessing graph authored for CaptRAW; implementation and hash registry in the accompanying source release.\nlibpng: bundled unchanged from the native development engine. License included.\nAll model inference runs locally. Model scores are not verified boundary accuracy.\nSee licenses/ for applicable terms and third-party notices. Training reproduction was not verified.\n`);
writeFileSync(join(output,'dependency-manifest.json'),JSON.stringify({platform:'darwin-arm64',modelId:manifest.modelId,files,sources:JSON.parse(readFileSync('tests/segmentation-sources.json'))},null,2)+'\n');console.log('Bundled local segmentation runtime and Small model');
