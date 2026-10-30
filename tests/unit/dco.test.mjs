// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertCommitSignedOff,checkRange,hasMatchingSignoff} from '../../scripts/check-dco.mjs';

const author={authorName:'CaptRAW Contributor',authorEmail:'contributor@example.com'};

test('DCO accepts a matching author sign-off',()=>{
  const message='feat: add a contribution\n\nSigned-off-by: CaptRAW Contributor <contributor@example.com>\n';
  assert.equal(hasMatchingSignoff(message,author.authorName,author.authorEmail),true);
  assert.doesNotThrow(()=>assertCommitSignedOff({hash:'abc1234',...author,message}));
});

test('DCO rejects missing, mismatched, and identity-only sign-offs',()=>{
  for(const message of [
    'feat: unsigned',
    'feat: wrong email\n\nSigned-off-by: CaptRAW Contributor <other@example.com>',
    'feat: wrong name\n\nSigned-off-by: Other Author <contributor@example.com>',
    'feat: identity only\n\nSigned-off-by: contributor@example.com',
  ]){
    assert.throws(()=>assertCommitSignedOff({hash:'abc1234',...author,message}),/missing Signed-off-by/);
  }
});

test('DCO range survives rebase and rejects a later unsigned commit',()=>{
  const repository=mkdtempSync(join(tmpdir(),'captraw-dco-'));
  const git=(...args)=>execFileSync('git',args,{cwd:repository,encoding:'utf8'}).trim();
  try{
    git('init','--initial-branch=main');
    git('config','user.name',author.authorName);
    git('config','user.email',author.authorEmail);
    git('config','commit.gpgsign','false');
    writeFileSync(join(repository,'base.txt'),'base\n');
    git('add','base.txt');
    git('commit','-m','base');
    const base=git('rev-parse','HEAD');

    git('switch','-c','feature');
    writeFileSync(join(repository,'feature.txt'),'feature\n');
    git('add','feature.txt');
    git('commit','-s','-m','feat: signed change');

    git('switch','main');
    writeFileSync(join(repository,'main.txt'),'main\n');
    git('add','main.txt');
    git('commit','-m','chore: advance main');
    const advanced=git('rev-parse','HEAD');

    git('switch','feature');
    git('rebase','main');
    const rebased=git('rev-parse','HEAD');
    assert.deepEqual(checkRange(advanced,rebased,repository),[rebased]);

    writeFileSync(join(repository,'unsigned.txt'),'unsigned\n');
    git('add','unsigned.txt');
    git('commit','-m','feat: unsigned change');
    assert.throws(()=>checkRange(advanced,git('rev-parse','HEAD'),repository),/missing Signed-off-by/);
  }finally{
    rmSync(repository,{recursive:true,force:true});
  }
});
