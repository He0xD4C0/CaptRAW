// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const root=process.cwd();
const licenseSHA256='3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986';

test('LICENSE is the canonical GNU GPL version 3 text',async()=>{
  const license=await readFile(join(root,'LICENSE'));
  assert.equal(createHash('sha256').update(license).digest('hex'),licenseSHA256);
});

test('all workspaces declare GPL-3.0-or-later',async()=>{
  for(const path of ['package.json','apps/desktop/package.json','packages/desktop-core/package.json','packages/contracts/package.json']){
    const manifest=JSON.parse(await readFile(join(root,path),'utf8'));
    assert.equal(manifest.license,'GPL-3.0-or-later',path);
  }
});

test('project and community notices are present',async()=>{
  for(const path of ['COPYRIGHT','DCO','CONTRIBUTING.md','CODE_OF_CONDUCT.md','SECURITY.md','GOVERNANCE.md','.github/CODEOWNERS','.github/pull_request_template.md']){
    await assert.doesNotReject(readFile(join(root,path)),path);
  }
});
