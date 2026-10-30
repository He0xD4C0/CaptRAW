import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {patchLinearGradient} from '../../native/patches/patch-linear-gradient.mjs';

const sourceFixture=process.env.CAPTRAW_ART_SOURCE_ARCHIVE||resolve('build/upstream/art.tar.gz');
test('Full/Zero patch only changes the Gradient case and replays safely',{skip:existsSync(sourceFixture)?false:'Requires the pinned ART source archive'},()=>{
 const work=mkdtempSync(join(tmpdir(),'captraw-linear-gradient-patch-'));let passed=false;
 try{
  const prefix='ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine/';
  const files=['procparams.h','procparams.cc','masks.cc'];mkdirSync(join(work,'src/engine'),{recursive:true});
  for(const name of files)writeFileSync(join(work,'src/engine',name),execFileSync('tar',['-xOf',sourceFixture,prefix+name]));
  const before=readFileSync(join(work,'src/engine/masks.cc'),'utf8');
  const rectangle=s=>s.slice(s.indexOf('        case AreaMask::Shape::RECTANGLE:'),s.indexOf('        case AreaMask::Shape::POLYGON:'));
  assert(rectangle(before).includes('Coord center'));
  patchLinearGradient(work);
  const once=files.map(name=>readFileSync(join(work,'src/engine',name),'utf8')),after=once[2];
  assert.equal(rectangle(after),rectangle(before));
  const marker='            // Full/Zero projection uses continuous authoring coordinates.';
  const start=after.indexOf(marker),end=after.indexOf('            Coord center',start);
  assert(start>after.indexOf('static_cast<AreaMask::Gradient *>'));
  assert.equal(after.slice(0,start)+after.slice(end),before,'Legacy mask code must remain byte-for-byte intact');
  assert(once[1].includes('captrawFullZero == o->captrawFullZero'));
  assert(once[1].includes('"CaptRAWFullZeroV1"'));
  patchLinearGradient(work);
  assert.deepEqual(files.map(name=>readFileSync(join(work,'src/engine',name),'utf8')),once);
  const misplaced=after.slice(start,end);
  writeFileSync(join(work,'src/engine/masks.cc'),before.replace('            Coord center',misplaced+'            Coord center'));
  assert.throws(()=>patchLinearGradient(work),/Misplaced Full\/Zero patch/);
  passed=true;
 }finally{if(passed)rmSync(work,{recursive:true,force:true});else console.error('Retained failing fixture:',work);}
});
