// SPDX-License-Identifier: GPL-3.0-or-later
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const normalizeName=value=>value.replace(/\s+/g,' ').trim().toLocaleLowerCase('en-US');

export function hasMatchingSignoff(message,authorName,authorEmail){
  const expectedName=normalizeName(authorName),expectedEmail=authorEmail.trim().toLocaleLowerCase('en-US');
  for(const match of message.matchAll(/^Signed-off-by:\s*(.+) <([^<>\r\n]+)>\s*$/gm)){
    if(normalizeName(match[1])===expectedName&&match[2].trim().toLocaleLowerCase('en-US')===expectedEmail)return true;
  }
  return false;
}

export function assertCommitSignedOff(commit){
  if(!hasMatchingSignoff(commit.message,commit.authorName,commit.authorEmail)){
    throw new Error(`${commit.hash}: missing Signed-off-by matching ${commit.authorName} <${commit.authorEmail}>`);
  }
}

export function checkRange(base,head,cwd=process.cwd()){
  if(!/^[0-9a-f]{7,64}$/i.test(base)||!/^[0-9a-f]{7,64}$/i.test(head))throw new Error('DCO base and head must be commit hashes');
  const hashes=execFileSync('git',['rev-list','--no-merges',`${base}..${head}`],{cwd,encoding:'utf8'}).trim().split('\n').filter(Boolean);
  if(!hashes.length)throw new Error(`DCO range ${base}..${head} contains no non-merge commits`);
  for(const hash of hashes){
    const author=execFileSync('git',['show','-s','--format=%an%n%ae',hash],{cwd,encoding:'utf8'}).trimEnd().split('\n');
    const message=execFileSync('git',['show','-s','--format=%B',hash],{cwd,encoding:'utf8'});
    assertCommitSignedOff({hash,authorName:author[0],authorEmail:author[1],message});
  }
  return hashes;
}

function main(){
  const {values}=parseArgs({options:{base:{type:'string'},head:{type:'string'}}});
  if(!values.base||!values.head)throw new Error('Usage: node scripts/check-dco.mjs --base <sha> --head <sha>');
  for(const hash of checkRange(values.base,values.head))console.log(`DCO valid: ${hash}`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{main();}
  catch(error){
    console.error(`DCO check failed: ${error instanceof Error?error.message:String(error)}`);
    process.exitCode=1;
  }
}
