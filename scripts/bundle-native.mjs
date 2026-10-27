import { cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync, existsSync, chmodSync,rmSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const root=resolve(import.meta.dirname,'..'),output=join(root,'build/bundle/native');
const upstream=join(root,'build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b');
rmSync(output,{recursive:true,force:true});mkdirSync(join(output,'lib'),{recursive:true});
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:32*1024*1024});
const deps=file=>run('otool',['-L',file]).split('\n').slice(1).map(x=>x.trim().split(' (')[0]).filter(Boolean);
const rpaths=file=>[...run('otool',['-l',file]).matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g)].map(x=>x[1]);
const system=p=>p.startsWith('/usr/lib/')||p.startsWith('/System/Library/');
const visited=new Map(),names=new Map(),formulas=new Map();
function locate(dep,source){
  if(dep.startsWith('/'))return dep;
  if(dep.startsWith('@loader_path/'))return resolve(dirname(source),dep.slice(13));
  if(dep.startsWith('@rpath/')){
    for(const path of rpaths(source)){
      const dir=path.replace('@loader_path',dirname(source));
      const file=join(dir,dep.slice(7));if(existsSync(file))return file;
    }
  }
  throw new Error(`Unresolved dependency ${dep} from ${source}`);
}
function collect(source,destination,isExecutable=false){
  source=realpathSync(source);
  if(visited.has(source))return visited.get(source);
  const name=basename(destination);
  if(names.has(name)&&names.get(name)!==source)throw new Error(`Library name collision: ${name}`);
  names.set(name,source);visited.set(source,destination);
  cpSync(source,destination);chmodSync(destination,0o755);
  const cellar=source.match(/^(.*\/Cellar\/([^/]+)\/([^/]+))\//);
  if(cellar)formulas.set(cellar[2],{version:cellar[3],path:cellar[1]});
  for(const dep of deps(source)){
    if(system(dep))continue;
    const original=locate(dep,source);
    if(realpathSync(original)===source)continue; // LC_ID_DYLIB
    const target=join(output,'lib',basename(original));
    collect(original,target);
    run('install_name_tool',['-change',dep,`${isExecutable?'@loader_path/lib':'@loader_path'}/${basename(target)}`,destination]);
  }
  if(!isExecutable)run('install_name_tool',['-id',`@loader_path/${basename(destination)}`,destination]);
  for(const path of rpaths(destination))if(path.startsWith('/opt/')||path.startsWith('/Users/'))run('install_name_tool',['-delete_rpath',path,destination]);
  run('codesign',['--force','--sign','-',destination]);
  return destination;
}
collect(join(root,'build/native/captraw-engine'),join(output,'captraw-engine'),true);
collect(join(root,'build/xmp/captraw-xmp'),join(output,'captraw-xmp'),true);
cpSync(join(root,'build/native/resources'),join(output,'resources'),{recursive:true});
const licenses=join(output,'licenses');mkdirSync(licenses,{recursive:true});
cpSync(join(upstream,'LICENSE.txt'),join(licenses,'ART-GPL-3.0.txt'));
cpSync(join(upstream,'AUTHORS.txt'),join(licenses,'ART-AUTHORS.txt'));
cpSync(join(upstream,'licenses'),join(licenses,'ART-components'),{recursive:true});
const manifest=[];
const xmpSource=join(root,'build/upstream/xmp-sdk');mkdirSync(join(licenses,'xmp'),{recursive:true});
cpSync(join(xmpSource,'LICENSE'),join(licenses,'xmp/LICENSE'));
for(const name of ['MD5.cpp','MD5.h'])cpSync(join(xmpSource,'third-party/zuid/interfaces',name),join(licenses,'xmp',name));
cpSync(join(root,'build/xmp/build.json'),join(licenses,'xmp/build.json'));
manifest.push({name:'Adobe XMP Toolkit SDK',version:'v2025.03',license:'BSD-3-Clause; RSA MD5 notice retained',commit:'581c41213ddcee1fbc72cbb532531102a6617a25',source:'https://github.com/adobe/XMP-Toolkit-SDK',sha256:'7e9f4b0d62979e1a7d44e16febfe2c6ab337ceccdaf1dad092666ac14b2fdcd5'});
const libraw=join(root,'build/upstream/redlamp-libraw-3b20539d3faa766a370e93a529a3b87edffbf0f6');
mkdirSync(join(licenses,'libraw'),{recursive:true});
for(const file of ['COPYRIGHT','LICENSE.LGPL','LICENSE.CDDL','REDLAMP.md'])cpSync(join(libraw,file),join(licenses,'libraw',file));
manifest.push({name:'LibRaw (Redlamp fork)',version:'3b20539d3faa766a370e93a529a3b87edffbf0f6',license:'LGPL-2.1-only',source:'https://codeload.github.com/pdcgomes/redlamp-libraw/tar.gz/3b20539d3faa766a370e93a529a3b87edffbf0f6',sha256:'2c98d641b777d9a67dd8c716a6e5cfd4479648057eae267e08e3b5c4899c5145'});
const installed=JSON.parse(run('brew',['info','--json=v2','--installed'])).formulae;
for(const [name,info] of [...formulas].sort(([a],[b])=>a.localeCompare(b))){
  const dest=join(licenses,name);mkdirSync(dest,{recursive:true});
  const formula=join(info.path,'.brew',`${name}.rb`);
  if(existsSync(formula))cpSync(formula,join(dest,`${name}.rb`));
  function copyNotices(dir,depth=0){
    if(depth>5)return;
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const path=join(dir,entry.name);
      if(entry.isDirectory()&&entry.name!=='.brew')copyNotices(path,depth+1);
      else if(entry.isFile()&&/licen[sc]e|copying|copyright|notice|authors/i.test(entry.name)){
        const relative=path.slice(info.path.length+1).replaceAll('/','__');cpSync(path,join(dest,relative));
      }
    }
  }
  copyNotices(info.path);
  const text=existsSync(formula)?readFileSync(formula,'utf8'):'';
  const metadata=installed.find(f=>f.name===name);
  manifest.push({name,version:info.version,license:metadata?.license||text.match(/^\s*license\s+(.+)$/m)?.[1],source:metadata?.urls?.stable?.url||text.match(/^\s*url\s+"([^"]+)"/m)?.[1],sha256:metadata?.urls?.stable?.checksum||text.match(/^\s*sha256\s+"([^"]+)"/m)?.[1]});
}
const web=[];
const dependencyGraph=JSON.parse(run('pnpm',['--filter','@captraw/desktop','list','--prod','--depth','Infinity','--json']));
const directories=new Map();
function visitDependencies(dependencies={}){
  for(const dependency of Object.values(dependencies)){
    const dir=dependency.path;
    if(dir){
      const p=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
      if(!p.name.startsWith('@captraw/'))directories.set(`${p.name}@${p.version}`,dir);
    }
    visitDependencies(dependency.dependencies);visitDependencies(dependency.optionalDependencies);
  }
}
for(const project of dependencyGraph){visitDependencies(project.dependencies);visitDependencies(project.optionalDependencies);}
for(const [,dir] of [...directories].sort(([a],[b])=>a.localeCompare(b))){
  const p=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
  const dest=join(licenses,'web',`${p.name.replaceAll('/','__')}@${p.version}`);mkdirSync(dest,{recursive:true});
  for(const file of readdirSync(dir))if(/^(licen[sc]e|notice|copying)/i.test(file))cpSync(join(dir,file),join(dest,file));
  web.push({name:p.name,version:p.version,license:p.license,repository:p.repository});
}
const require=createRequire(join(root,'package.json')),electronDist=join(dirname(require.resolve('electron/package.json')),'dist');
cpSync(join(electronDist,'LICENSE'),join(licenses,'Electron-LICENSE'));
cpSync(join(electronDist,'LICENSES.chromium.html'),join(licenses,'Chromium-LICENSES.html'));
writeFileSync(join(licenses,'web-dependencies.json'),JSON.stringify(web,null,2)+'\n');
if(existsSync(join(root,'THIRD_PARTY.md')))cpSync(join(root,'THIRD_PARTY.md'),join(licenses,'README.md'));
const audit=[];
for(const destination of visited.values()){
  const links=deps(destination);
  if(links.some(d=>!system(d)&&!d.startsWith('@loader_path/')))throw new Error(`Unbundled load command: ${destination}`);
  audit.push({file:destination.slice(output.length+1),sha256:createHash('sha256').update(readFileSync(destination)).digest('hex'),dependencies:links});
}
writeFileSync(join(output,'dependency-manifest.json'),JSON.stringify({platform:'darwin-arm64',minimumMacOS:'26.0',engine:'ART 1.26.10',commit:'1e0e12c62e4f329d30bb5624d62a23a663ffbe6b',dependencies:manifest,loadCommands:audit},null,2)+'\n');
console.log(`Bundled ${visited.size-1} native libraries and ${formulas.size} dependency notices.`);
