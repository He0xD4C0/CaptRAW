import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('AVIF dependency build currently targets macOS ARM64.');
const root=resolve(import.meta.dirname,'..'),version='1.4.2',sha256='2b645287340ba5a631d268b551dc2d72bd73ac33335962dd36dcdb6d8366921d';
const source=join(root,'build/upstream/libavif-'+version),archive=join(root,'build/upstream/libavif-'+version+'.tar.gz'),prefix=join(root,'build/vendor/libavif');
const run=(command,args)=>execFileSync(command,args,{cwd:root,stdio:'inherit'}),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const aom=execFileSync('pkg-config',['--modversion','aom'],{encoding:'utf8'}).trim();if(aom!=='3.15.0')throw new Error('HDR AVIF currently requires aom 3.15.0; install the documented dependency version.');
mkdirSync(join(root,'build/upstream'),{recursive:true});
if(!existsSync(archive))run('curl',['-fsSL','--retry','3',`https://codeload.github.com/AOMediaCodec/libavif/tar.gz/refs/tags/v${version}`,'-o',archive]);
if(hash(archive)!==sha256)throw new Error('libavif source checksum mismatch');
if(!existsSync(source))run('tar',['-xzf',archive,'-C',join(root,'build/upstream')]);
const record={version,sha256,aom,source:`https://codeload.github.com/AOMediaCodec/libavif/tar.gz/refs/tags/v${version}`,aomCommit:'de4c1d1edc49723a78954d30a83690aa1937422f'};
if(!existsSync(join(prefix,'lib/libavif.dylib'))||!existsSync(join(prefix,'AOM-PATENTS'))||!existsSync(join(prefix,'build.json'))||JSON.stringify(JSON.parse(readFileSync(join(prefix,'build.json'),'utf8')))!==JSON.stringify(record)){
 run('cmake',['-S',source,'-B',join(root,'build/avif'),'-G','Ninja','-DCMAKE_BUILD_TYPE=Release',`-DCMAKE_INSTALL_PREFIX=${prefix}`,'-DCMAKE_OSX_ARCHITECTURES=arm64','-DCMAKE_OSX_DEPLOYMENT_TARGET=26.0','-DCMAKE_PREFIX_PATH=/opt/homebrew','-DBUILD_SHARED_LIBS=ON','-DAVIF_CODEC_AOM=SYSTEM','-DAVIF_LIBYUV=OFF','-DAVIF_JPEG=OFF','-DAVIF_ZLIBPNG=OFF','-DAVIF_BUILD_APPS=OFF','-DAVIF_BUILD_TESTS=OFF']);
 run('cmake',['--build',join(root,'build/avif'),'-j',process.env.CAPTRAW_BUILD_JOBS||'8']);run('cmake',['--install',join(root,'build/avif')]);
 const temporary=join(prefix,'aom-patents.base64');
 try{run('curl',['-fsSL','--retry','3',`https://aomedia.googlesource.com/aom/+/${record.aomCommit}/PATENTS?format=TEXT`,'-o',temporary]);const data=Buffer.from(readFileSync(temporary,'utf8'),'base64');if(createHash('sha256').update(data).digest('hex')!=='661fb8e504744e95587b556b94a58343448300606a41bea8c7a9b97125696e61')throw new Error('AOM patent notice checksum mismatch');writeFileSync(join(prefix,'AOM-PATENTS'),data);}finally{rmSync(temporary,{force:true});}
 writeFileSync(join(prefix,'build.json'),JSON.stringify(record,null,2)+'\n');
}
console.log('libavif source build ready',prefix);
