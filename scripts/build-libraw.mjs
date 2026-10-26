import {resolve} from 'node:path';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),commit='3b20539d3faa766a370e93a529a3b87edffbf0f6';
const source=resolve(root,`build/upstream/redlamp-libraw-${commit}`),prefix=resolve(root,'build/vendor/libraw');
const run=(command,args,cwd=root,extra={})=>{const r=spawnSync(command,args,{cwd,stdio:'inherit',env:{...process.env,...extra}});if(r.status!==0)throw new Error(`${command} failed: ${r.status}`);};
mkdirSync(resolve(root,'build/upstream'),{recursive:true});
if(!existsSync(source)){
 run('curl',['-fsSL','--retry','3',`https://codeload.github.com/pdcgomes/redlamp-libraw/tar.gz/${commit}`,'-o','build/upstream/libraw-he.tar.gz']);
 if(createHash('sha256').update(readFileSync(resolve(root,'build/upstream/libraw-he.tar.gz'))).digest('hex')!=='2c98d641b777d9a67dd8c716a6e5cfd4479648057eae267e08e3b5c4899c5145')throw new Error('LibRaw archive checksum mismatch');
 run('tar',['-xzf','build/upstream/libraw-he.tar.gz','-C','build/upstream']);
}
if(!existsSync(resolve(prefix,'captraw-commit'))||readFileSync(resolve(prefix,'captraw-commit'),'utf8')!==commit){
 run('autoreconf',['-fi'],source);
 run('./configure',[`--prefix=${prefix}`,'--disable-examples','--disable-openmp','--disable-lcms','--disable-static','--enable-shared'],source,{CXXFLAGS:'-O3 -std=c++17 -arch arm64 -mmacosx-version-min=26.0',CFLAGS:'-O3 -arch arm64 -mmacosx-version-min=26.0',CPPFLAGS:'-I/opt/homebrew/opt/jpeg-turbo/include',LDFLAGS:'-L/opt/homebrew/opt/jpeg-turbo/lib'});
 run('make',['-j8'],source);run('make',['install'],source);writeFileSync(resolve(prefix,'captraw-commit'),commit);
}
console.log('LibRaw HE/HE* source build ready',prefix);
