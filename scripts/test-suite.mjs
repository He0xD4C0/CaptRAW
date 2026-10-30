import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=resolve(import.meta.dirname,'..');
const manifestPath=join(root,'tests/suites.json');
export async function loadSuites(){return JSON.parse(await readFile(manifestPath,'utf8'));}

const escape=s=>s.replace(/[.+^${}()|[\]\\]/g,'\\$&');
const globPattern=pattern=>new RegExp('^'+pattern.split('/').map(part=>part==='**'?'.*':escape(part).replaceAll('*','[^/]*').replaceAll('?','[^/]')).join('/')+'$');
async function walk(directory){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())result.push(...await walk(path));else if(entry.isFile())result.push(path.slice(root.length+1).split(sep).join('/'));}return result;}
let allFiles;
async function expand(patterns){allFiles??=await walk(join(root,'tests'));const matchers=patterns.map(globPattern);return allFiles.filter(file=>matchers.some(match=>match.test(file))).sort();}

function commandExists(command){try{execFileSync('which',[command],{stdio:'ignore'});return true;}catch{return false;}}
function requirementMet(requirement){
  if(requirement==='candidate'||requirement==='electron')return true;
  if(requirement.startsWith('platform:'))return process.platform===requirement.slice(9);
  if(requirement.startsWith('file:'))return existsSync(join(root,requirement.slice(5)));
  if(requirement.startsWith('env:'))return !!process.env[requirement.slice(4)];
  if(requirement.startsWith('executable:'))return commandExists(requirement.slice(11));
  return false;
}
function missingRequirements(suite,{candidate}){
  const missing=[];
  if(suite.requirements.includes('candidate')&&!candidate)missing.push('candidate');
  if(suite.requirements.includes('electron')&&!existsSync(join(root,'node_modules/electron/dist')))missing.push('electron');
  for(const requirement of suite.requirements.filter(value=>value!=='candidate'&&value!=='electron'))if(!requirementMet(requirement))missing.push(requirement);
  return missing;
}
async function runCommand(command,args,env){return new Promise((accept,reject)=>{
  const child=spawn(command,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;process.stdout.write(chunk);});child.stderr.on('data',chunk=>{stderr+=chunk;process.stderr.write(chunk);});
  child.once('error',reject);child.once('exit',(code,signal)=>accept({status:code??1,signal,stdout,stderr}));
});}

function visibleSuite(suite){return {id:suite.id,layer:suite.layer,domain:suite.domain,requirements:suite.requirements,manual:!!suite.manual,gates:Object.entries((globalThis.__suiteManifest?.gates||{})).filter(([,ids])=>ids.includes(suite.id)).map(([name])=>name)};}

export async function runSuite(suite,options={}){
  const started=Date.now(),candidate=options.candidate||process.env.CAPTRAW_CANDIDATE||'',devUnverified=!!options.devUnverified;
  const requiresCandidate=suite.requirements.includes('candidate');
  const trusted=!!candidate&&!devUnverified;
  const finish=record=>{const result={...record,trusted:!!record.trusted&&trusted};console.log(JSON.stringify({suite:suite.id,status:result.status,trusted:result.trusted,devUnverified,candidate:candidate||null,...(result.reason?{reason:result.reason}:{})}));return result;};
  if(suite.manual&&!options.allowManual)return finish({name:suite.id,status:'skipped',passed:false,reason:'manual suite; pass --manual to execute',durationMs:Date.now()-started});
  if(requiresCandidate&&!candidate&&!devUnverified)return finish({name:suite.id,status:'blocked',passed:false,reason:'a valid candidate is required',durationMs:Date.now()-started});
  if(trusted&&options.verifyCandidate){
    try{await options.verifyCandidate(candidate);}
    catch(error){return finish({name:suite.id,status:'blocked',passed:false,reason:'candidate verification failed before run: '+String(error),durationMs:Date.now()-started});}
  }
  const missing=missingRequirements(suite,{candidate:candidate||devUnverified});
  if(missing.length)return finish({name:suite.id,status:'blocked',passed:false,reason:'missing requirements: '+missing.join(', '),durationMs:Date.now()-started});
  const files=await expand(suite.files||[]);
  if((suite.files||[]).length&&!files.length)return finish({name:suite.id,status:'blocked',passed:false,reason:'file patterns matched nothing',durationMs:Date.now()-started});
  const command=suite.command||['node'],runs=[];
  if(files.length&&command.includes('--test'))runs.push([...command,...files]);
  else if(files.length)for(const file of files)runs.push([...command,file]);
  else if(suite.command)runs.push(command);
  let failed=false;
  for(const args of runs){
    const result=await runCommand(args[0],args.slice(1),candidate?{CAPTRAW_CANDIDATE:candidate}:{});
    if(result.status!==0)failed=true;
    if(failed&&options.failFast)break;
  }
  let mismatch;
  if(trusted&&options.verifyCandidate){try{await options.verifyCandidate(candidate);}catch(error){mismatch=String(error);}}
  const status=failed||mismatch?'failed':'passed';
  const record={name:suite.id,command:runs,status,passed:status==='passed',candidate:candidate||null,trusted,devUnverified,durationMs:Date.now()-started,mismatch};
  if(options.writeChecks&&trusted){
    const directory=join(root,'build/candidates',candidate,'checks');await mkdir(directory,{recursive:true});await writeFile(join(directory,'suite-'+suite.id+'.json'),JSON.stringify(record,null,2)+'\n');
  }
  console.log(JSON.stringify({suite:suite.id,status,trusted:record.trusted,devUnverified,candidate:candidate||null}));
  return record;
}

export async function runSuites(ids,options={}){
  const manifest=globalThis.__suiteManifest=await loadSuites(),records=[];
  for(const id of ids){const suite=manifest.suites.find(item=>item.id===id);if(!suite){records.push({name:id,status:'blocked',passed:false,reason:'unknown suite'});continue;}records.push(await runSuite(suite,options));if(options.failFast&&records.at(-1).status==='failed')break;}
  return records;
}

async function affected(base){
  const manifest=globalThis.__suiteManifest=await loadSuites();
  const tracked=base?execFileSync('git',['diff','--name-only',base,'--'],{cwd:root,encoding:'utf8'}):execFileSync('git',['diff','--name-only','HEAD','--'],{cwd:root,encoding:'utf8'});
  const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'});
  const changed=[...new Set([...tracked.trim().split('\n'),...untracked.trim().split('\n')].filter(Boolean))];
  return manifest.suites.filter(suite=>(suite.pathTriggers||[]).some(pattern=>{const match=globPattern(pattern);return changed.some(file=>match.test(file));}));
}

async function main(){
  const [mode,...args]=process.argv.slice(2);const candidate=process.env.CAPTRAW_CANDIDATE||'';
  const options={candidate,devUnverified:process.argv.includes('--dev-unverified'),failFast:process.argv.includes('--fail-fast'),allowManual:process.argv.includes('--manual'),writeChecks:!!candidate};
  if(candidate){const {verifyCandidate}=await import('./candidate.mjs');options.verifyCandidate=verifyCandidate;}
  let records=[];
  if(mode==='list'){const manifest=await loadSuites();globalThis.__suiteManifest=manifest;console.log(JSON.stringify(manifest.suites.map(visibleSuite),null,2));return;}
  if(mode==='run')records=await runSuites(args.filter(value=>!value.startsWith('--')),options);
  else if(mode==='gate'){const manifest=await loadSuites(),gate=args.find(value=>!value.startsWith('--'));if(!manifest.gates[gate])throw new Error('Unknown gate: '+gate);records=await runSuites(manifest.gates[gate],options);}
  else if(mode==='affected'){const matched=await affected(args.find(value=>!value.startsWith('--')));globalThis.__suiteManifest=await loadSuites();records=await Promise.all(matched.map(suite=>runSuite(suite,options)));}
  else throw new Error('Usage: test-suite.mjs list | run <suite...> | gate <name> | affected [base] [--dev-unverified] [--manual] [--fail-fast]');
  process.exitCode=records.some(record=>record.status==='failed'||record.status==='blocked')?1:0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
