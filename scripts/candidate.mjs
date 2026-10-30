import {readFile,writeFile,readdir,mkdir,mkdtemp,rename,rm,access} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=resolve(import.meta.dirname,'..'),candidates=join(root,'build/candidates');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function sourceFiles(){
 const removed=new Set(execFileSync('git',['ls-files','--deleted','-z'],{cwd:root}).toString().split('\0'));
 return [...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0'))].filter(path=>path&&!removed.has(path)&&basename(path)!=='AGENTS.md').sort();
}
const buildInput=path=>/^(apps|packages|native|scripts)\//.test(path)||/^tests\/.*\.(cc|h)$/.test(path)||['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','tsconfig.json'].includes(path);
const verificationInput=path=>buildInput(path)||path.startsWith('tests/');
async function fingerprints(paths){return Object.fromEntries(await Promise.all(paths.map(async path=>[path,digest(await readFile(join(root,path)))])));}
async function tree(path){
 const entries=await readdir(join(root,path),{withFileTypes:true}),files=[];
 for(const entry of entries){const child=path+'/'+entry.name;if(entry.isDirectory())files.push(...await tree(child));else if(entry.isFile()||entry.isSymbolicLink())files.push(child);else throw new Error('Unexpected candidate resource: '+child);}
 return files.sort();
}
async function artifacts(){
 const files=['build/app-build.json','build/native/captraw-engine','build/native/captraw-art-reference','build/xmp/captraw-xmp','build/xmp/build.json'];
 for(const path of ['apps/desktop/dist','packages/contracts/dist','packages/desktop-core/dist','build/native/resources','build/bundle/native'])files.push(...await tree(path));
 return fingerprints([...new Set(files)].sort());
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function verifyCandidate(id){
 if(!/^[a-f0-9]{16}$/.test(id||''))throw new Error('Invalid candidate ID');
 const manifest=await json(join(candidates,id,'manifest.json'));
 const currentSource=Object.fromEntries(Object.entries(await fingerprints(await sourceFiles())).filter(([path])=>verificationInput(path)));
 if(!equal(currentSource,manifest.verificationInputs)){
  const changed=[...new Set([...Object.keys(currentSource),...Object.keys(manifest.verificationInputs)])].filter(path=>currentSource[path]!==manifest.verificationInputs[path]);
  throw new Error('Candidate source inputs changed; create a new candidate before testing. Changed files: '+changed.join(', '));
 }
 if(!equal(await artifacts(),manifest.artifacts))throw new Error('Candidate build artifacts changed; results cannot be assigned to '+id);
 return manifest;
}
async function build(){
 await mkdir(candidates,{recursive:true});const scratch=await mkdtemp(join(tmpdir(),'captraw-candidate-'));let published=false;
 try{
  const paths=await sourceFiles(),source=await fingerprints(paths),inputs=Object.fromEntries(Object.entries(source).filter(([path])=>buildInput(path))),verificationInputs=Object.fromEntries(Object.entries(source).filter(([path])=>verificationInput(path)));
  // Capture the dirty working source, including untracked implementation files.
  // No Git reset, commit, branch or dependency on an older release archive.
  await writeFile(join(scratch,'source-files'),paths.join('\0')+'\0');
  execFileSync('tar',['-czf',join(scratch,'source.tar.gz'),'-C',root,'--null','-T',join(scratch,'source-files')],{env:{...process.env,COPYFILE_DISABLE:'1'}});
  // TypeScript does not retire outputs after a source file moves. Regenerate
  // only these disposable package outputs; native dependency caches stay warm.
  for(const directory of ['packages/contracts/dist','packages/desktop-core/dist'])await rm(join(root,directory),{recursive:true,force:true});
  for(const args of [['build','--force']]){
   const result=spawnSync('pnpm',args,{cwd:root,stdio:'inherit'});if(result.status!==0)throw new Error('Candidate build failed: '+(result.error||result.status));
  }
  const bundle=spawnSync(process.execPath,['scripts/bundle-native.mjs'],{cwd:root,stdio:'inherit'});if(bundle.status!==0)throw new Error('Candidate dependency bundle failed: '+(bundle.error||bundle.status));
  const afterSource=Object.fromEntries(Object.entries(await fingerprints(await sourceFiles())).filter(([path])=>verificationInput(path)));
  if(!equal(afterSource,verificationInputs)){
   const changed=[...new Set([...Object.keys(verificationInputs),...Object.keys(afterSource)])].filter(path=>verificationInputs[path]!==afterSource[path]);
   throw new Error('Source changed during candidate build; nothing published. Changed files: '+changed.join(', '));
  }
  const output=await artifacts(),version=(await json(join(root,'package.json'))).version,build=await json(join(root,'build/app-build.json'));
  const identity={schemaVersion:1,platform:process.platform,arch:process.arch,version,contractVersion:build.contractVersion,nativeReadyVersion:build.nativeReadyVersion,packageVersion:build.packageVersion,inputs,verificationInputs,artifacts:output};
  const id=digest(JSON.stringify(identity)).slice(0,16),destination=join(candidates,id);
  const manifest={id,...identity,node:process.version,createdAt:new Date().toISOString(),source,sourceArchiveSHA256:digest(await readFile(join(scratch,'source.tar.gz')))};
  let existing=false;try{await access(join(destination,'manifest.json'));existing=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!existing){await mkdir(destination);await rename(join(scratch,'source.tar.gz'),join(destination,'source.tar.gz'));await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');}
  await verifyCandidate(id);await writeFile(join(candidates,'latest.json'),JSON.stringify({id})+'\n');published=true;console.log('Candidate ready:',id);
 }finally{if(published)await rm(scratch,{recursive:true,force:true});else console.error('Candidate failure retained:',scratch);}
}
async function check(id,name,command,args){
 if(!/^[a-z0-9-]+$/.test(name||'')||!command)throw new Error('Usage: check <id> <name> <command> [args]');
 await verifyCandidate(id);const directory=join(candidates,id),started=Date.now();
 const entries=new Set(args.flatMap(argument=>argument.match(/tests\/[A-Za-z0-9/_.-]+\.(?:mjs|js|json)/g)||[]));
 const validationFiles=(await sourceFiles()).filter(path=>/^tests\/(support|fixtures)\//.test(path)||entries.has(path)),validationInputs=await fingerprints(validationFiles);
 const result=spawnSync(command,args,{cwd:root,env:{...process.env,CAPTRAW_CANDIDATE:id},encoding:'utf8',maxBuffer:32*1024*1024});
 let mismatch;try{await verifyCandidate(id);if(!equal(await fingerprints(validationFiles),validationInputs))throw new Error('Validation sources changed during check.');}catch(error){mismatch=String(error);}
 const passed=result.status===0&&!result.error&&!mismatch,log=[result.stdout,result.stderr,result.error,mismatch].filter(Boolean).join('\n');
 const record={name,command:[command,...args],validationInputs,passed,exitCode:result.status,durationMs:Date.now()-started,finishedAt:new Date().toISOString(),tail:log.split('\n').slice(-20).join('\n')};
 const records=join(directory,'checks');await mkdir(records,{recursive:true});
 await writeFile(join(records,name+'.json'),JSON.stringify(record,null,2)+'\n');
 const failure=join(directory,name+'-failure.log');if(passed)await rm(failure,{force:true});else await writeFile(failure,log);
 const {validationInputs:recordedInputs,...summary}=record;console.log(JSON.stringify({candidate:id,...summary}));if(!passed)process.exitCode=1;
}
async function report(id){
 await verifyCandidate(id);const directory=join(candidates,id),records=join(directory,'checks'),checks={};
 for(const file of (await readdir(records)).filter(file=>file.endsWith('.json')).sort()){const record=await json(join(records,file));checks[record.name]=record;}
 await writeFile(join(directory,'checks.json'),JSON.stringify(checks,null,2)+'\n');
 console.log(JSON.stringify({candidate:id,checks:Object.values(checks).map(({name,passed})=>({name,passed}))}));
 if(Object.values(checks).some(check=>!check.passed))process.exitCode=1;
}
async function suite(id,name){
 if(!/^[a-z0-9-]+$/.test(name||''))throw new Error('Usage: suite <id> <suite>');
 await verifyCandidate(id);
 const {loadSuites,runSuite}=await import('./test-suite.mjs'),manifest=await loadSuites(),entry=manifest.suites.find(value=>value.id===name);
 if(!entry)throw new Error('Unknown suite: '+name);
 const record=await runSuite(entry,{candidate:id,verifyCandidate,writeChecks:true,allowManual:true});
 const records=join(candidates,id,'checks');await mkdir(records,{recursive:true});await writeFile(join(records,'suite-'+name+'.json'),JSON.stringify(record,null,2)+'\n');
 await report(id);
 if(record.status!=='passed')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [mode,id,name,command,...args]=process.argv.slice(2);
 if(mode==='build')await build();
 else if(mode==='verify'){await verifyCandidate(id);console.log('Candidate verified:',id);}
 else if(mode==='check')await check(id,name,command,args);
 else if(mode==='report')await report(id);
 else if(mode==='suite')await suite(id,name);
 else throw new Error('Usage: candidate.mjs build | verify <id> | check <id> <name> <command> [args] | report <id> | suite <id> <suite>');
}
