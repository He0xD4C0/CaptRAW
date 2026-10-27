import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {cpSync,readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version;
const output=resolve(root,process.env.CAPTRAW_RELEASE_DIR||'release');mkdirSync(output,{recursive:true});
const archive=resolve(output,`CaptRAW-${version}-source.tar.gz`);
const excludes=['node_modules','dist','.turbo','build','release','artifacts','.git','.DS_Store','test-results'];
execFileSync('tar',['-czf',archive,...excludes.map(name=>'--exclude='+name),'-C',root,'.','-C',resolve(root,'build/bundle/native'),'dependency-manifest.json','-C',resolve(root,'build/bundle'),'segmentation/dependency-manifest.json'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
cpSync(resolve(root,'build/upstream/art.tar.gz'),resolve(output,'ART-1.26.10-source.tar.gz'));
cpSync(resolve(root,'build/upstream/libraw-he.tar.gz'),resolve(output,'LibRaw-3b20539-source.tar.gz'));
cpSync(resolve(root,'build/upstream/xmp-sdk.tar.gz'),resolve(output,'XMP-2025.03-source.tar.gz'));
const files=[`CaptRAW-${version}-arm64.dmg`,`CaptRAW-${version}-source.tar.gz`,'ART-1.26.10-source.tar.gz','LibRaw-3b20539-source.tar.gz','XMP-2025.03-source.tar.gz'];
writeFileSync(resolve(output,'SHA256SUMS'),files.map(file=>{
 const path=resolve(output,file);if(!existsSync(path))throw new Error(`Missing release: ${file}`);
 return `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${file}`;
}).join('\n')+'\n');
console.log('Release sources and SHA256SUMS written.');
