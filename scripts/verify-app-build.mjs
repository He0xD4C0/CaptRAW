import {access,readFile,readdir,stat,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const required=[
  'build/native/captraw-engine',
  'build/native/captraw-art-reference',
  'build/native/resources/wbpresets.json',
  'build/xmp/captraw-xmp',
  'build/xmp/build.json',
  'LICENSE',
  'COPYRIGHT',
  'THIRD_PARTY.md',
  'apps/desktop/dist/electron/main.cjs',
  'apps/desktop/dist/electron/preload.cjs',
  'apps/desktop/dist/renderer/index.html',
];
const hash=async path=>createHash('sha256').update(await readFile(join(root,path))).digest('hex');
const contractSource=await readFile(join(root,'packages/contracts/index.ts'),'utf8');
const versions=[...contractSource.matchAll(/^export const ENGINE_VERSION='([^']+)';$/gm)].map(match=>match[1]);
if(versions.length!==1)throw new Error(`Expected one canonical ENGINE_VERSION, found ${versions.length}`);
const contractVersion=versions[0];
for(const path of required){
  await access(join(root,path));
  const info=await stat(join(root,path));
  if(!info.isFile()&&!info.isDirectory())throw new Error(`Unexpected build artifact: ${path}`);
}

const manifest=JSON.parse(await readFile(join(root,'packages/desktop-core/package.json'),'utf8'));
for(const [entry,targets] of Object.entries(manifest.exports)){
  for(const path of [targets.types,targets.import])if(path&&!(await access(join(root,'packages/desktop-core',path)).then(()=>true,()=>false)))
    throw new Error(`desktop-core export ${entry} points to missing file ${path}`);
}

const renderer=await readFile(join(root,'apps/desktop/dist/renderer/index.html'),'utf8');
if(!/src="\.\/assets\/[^"]+\.js"/.test(renderer))throw new Error('Desktop renderer entry is missing');
const xmpBuild=JSON.parse(await readFile(join(root,'build/xmp/build.json'),'utf8'));
if(xmpBuild.sdkTag!=='v2025.03'||!xmpBuild.workerSHA256)throw new Error('XMP build report is incomplete');

const cache=await mkdtemp(join(tmpdir(),'captraw-verify-ready-'));
let child;
try{
  child=spawn(join(root,'build/native/captraw-engine'),[join(root,'build/native/resources'),cache],{
    cwd:root,
    env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:''},
    stdio:['ignore','pipe','pipe'],
  });
  let diagnostics='';
  child.stderr.on('data',chunk=>diagnostics+=chunk);
  const ready=await Promise.race([
    new Promise((accept,reject)=>{
      const lines=createInterface({input:child.stdout});
      lines.on('line',line=>{
        try{
          const message=JSON.parse(line);
          if(message.event==='ready'){lines.close();accept(message);}
          else if(message.event==='error'){lines.close();reject(new Error(message.message));}
        }catch(error){lines.close();reject(error);}
      });
      child.once('error',reject);
      child.once('exit',code=>reject(new Error(`captraw-engine exited before ready: ${code}\n${diagnostics}`)));
    }),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(`captraw-engine ready timeout\n${diagnostics}`)),15000)),
  ]);
  if(ready.engineVersion!==contractVersion)throw new Error(`Engine version ${ready.engineVersion} does not match contract ${contractVersion}`);
  const report={
    schemaVersion:1,
    contractVersion,
    nativeReadyVersion:ready.engineVersion,
    packageVersion:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,
    artifacts:Object.fromEntries(await Promise.all(required.map(async path=>[path,await hash(path)]))),
  };
  await writeFile(join(root,'build/app-build.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Unified app build ready:',contractVersion);
}finally{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  await rm(cache,{recursive:true,force:true});
}
