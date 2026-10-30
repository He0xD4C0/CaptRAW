import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['apps/desktop/src/hooks/workbench/history.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {undoDocuments}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const adjustments=value=>({exposure:value});
const document=(path,exposure)=>({
  image:{id:path,path},
  adjustments:adjustments(exposure),
  initial:adjustments(0),
  profile:'',
  profileId:1,
  saved:adjustments(0),
  savedProfileId:1,
  savedRating:0,
  savedLabel:'',
  rating:0,
  label:'',
  dirty:exposure!==0,
  past:[{adjustments:adjustments(0),profile:'',profileId:1,rating:0,label:'',operationId:'linked',sequence:1}],
  future:[],
});

test('history undo and redo preserve linked operation membership',()=>{
  const source=document('source',1),target=document('target',1),untouched=document('other',1);
  const undone=undoDocuments([source,target,untouched],new Set(['source','target']),false,1);
  assert.equal(undone.changed,true);
  assert.equal(undone.documents[0].adjustments.exposure,0);
  assert.equal(undone.documents[1].adjustments.exposure,0);
  assert.equal(undone.documents[2].adjustments.exposure,1);
  assert.equal(undone.documents[0].past.length,0);
  assert.equal(undone.documents[0].future.length,1);

  const redone=undoDocuments(undone.documents,new Set(['source','target']),true,undone.sequence);
  assert.equal(redone.changed,true);
  assert.equal(redone.documents[0].adjustments.exposure,1);
  assert.equal(redone.documents[1].adjustments.exposure,1);
  assert.equal(redone.documents[2].adjustments.exposure,1);
  assert.equal(redone.documents[0].past.length,1);
  assert.equal(redone.documents[0].future.length,0);
});

test('history refuses non-target stacks without emitting a transition',()=>{
  const result=undoDocuments([document('source',1)],new Set(['other']),false,1);
  assert.equal(result.changed,false);
  assert.equal(result.sequence,1);
});
