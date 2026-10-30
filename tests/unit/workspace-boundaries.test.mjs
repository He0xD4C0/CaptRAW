import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

const root=process.cwd();
async function files(path){
  const result=[];
  for(const entry of await readdir(path,{withFileTypes:true})){
    const file=join(path,entry.name);
    if(entry.isDirectory())result.push(...await files(file));
    else if(entry.isFile()&&/\.(ts|tsx)$/.test(entry.name))result.push(file);
  }
  return result;
}

test('desktop-core exposes stable domain entries only',async()=>{
  const manifest=JSON.parse(await readFile(join(root,'packages/desktop-core/package.json'),'utf8'));
  assert.deepEqual(Object.keys(manifest.exports).sort(),[
    './documents','./editing','./engine','./export','./presets','./profiles','./testing',
  ]);
});

test('production code uses domain entries and never testing or source/dist deep paths',async()=>{
  const source=[...(await files(join(root,'apps'))),...(await files(join(root,'packages')))]
    .filter(file=>!file.includes(`${join('packages','desktop-core','src','testing')}`));
  const violations=[];
  for(const file of source){
    const text=await readFile(file,'utf8');
    if(/@captraw\/desktop-core\/testing/.test(text))violations.push(`${file}: testing import`);
    if(/@captraw\/desktop-core\/src\//.test(text)||/packages\/desktop-core\/(?:src|dist)\//.test(text))violations.push(`${file}: deep path`);
    for(const match of text.matchAll(/@captraw\/desktop-core\/([a-z0-9-]+)/g)){
      const entry=match[1];
      if(!['documents','editing','engine','export','presets','profiles'].includes(entry))violations.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(violations,[]);
});
