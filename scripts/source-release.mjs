import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {cpSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version;
const archive=resolve(root,`release/CaptRAW-${version}-source.tar.gz`);
execFileSync('tar',['-czf',archive,'--exclude=./node_modules','--exclude=./build','--exclude=./dist','--exclude=./release','--exclude=./artifacts','--exclude=./.git','--exclude=./.DS_Store','-C',root,'.','-C',resolve(root,'build/bundle/native'),'dependency-manifest.json']);
cpSync(resolve(root,'build/upstream/art.tar.gz'),resolve(root,'release/ART-1.26.10-source.tar.gz'));
cpSync(resolve(root,'build/upstream/libraw-he.tar.gz'),resolve(root,'release/LibRaw-3b20539-source.tar.gz'));
const files=[`CaptRAW-${version}-arm64.dmg`,`CaptRAW-${version}-source.tar.gz`,'ART-1.26.10-source.tar.gz','LibRaw-3b20539-source.tar.gz'];
writeFileSync(resolve(root,'release/SHA256SUMS'),files.map(file=>{
 const path=resolve(root,'release',file);if(!existsSync(path))throw new Error(`Missing release: ${file}`);
 return `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${file}`;
}).join('\n')+'\n');
console.log('Release sources and SHA256SUMS written.');
