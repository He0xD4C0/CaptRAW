import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {runSuite} from '../../scripts/test-suite.mjs';

const originalCandidate=process.env.CAPTRAW_CANDIDATE;
before(()=>{delete process.env.CAPTRAW_CANDIDATE;});
after(()=>{if(originalCandidate===undefined)delete process.env.CAPTRAW_CANDIDATE;else process.env.CAPTRAW_CANDIDATE=originalCandidate;});

const suite={id:'fixture',requirements:['candidate'],command:['node','-e'],files:[],manual:false};

test('candidate-gated suite blocks without identity',async()=>{
  const result=await runSuite(suite);
  assert.equal(result.status,'blocked');
  assert.equal(result.trusted,false);
});

test('dev-unverified execution remains explicitly untrusted',async()=>{
  const result=await runSuite({...suite,command:['node','-e','0']},{candidate:'0123456789abcdef',devUnverified:true,writeChecks:true});
  assert.equal(result.status,'passed');
  assert.equal(result.trusted,false);
  assert.equal(result.devUnverified,true);
});

test('suite failures are returned as structured records',async()=>{
  const failing={...suite,command:['node','-e','process.exit(2)']};
  const result=await runSuite(failing,{devUnverified:true});
  assert.equal(result.status,'failed');
  assert.equal(result.passed,false);
});

test('candidate drift blocks before execution and fails after execution',async()=>{
  const before=await runSuite({...suite,command:['node','-e','0']},{candidate:'0123456789abcdef',verifyCandidate:async()=>{throw new Error('source changed');}});
  assert.equal(before.status,'blocked');
  assert.match(before.reason,/source changed/);

  let checks=0;
  const after=await runSuite({...suite,command:['node','-e','0']},{candidate:'0123456789abcdef',verifyCandidate:async()=>{if(++checks>1)throw new Error('artifacts changed');}});
  assert.equal(after.status,'failed');
  assert.match(after.mismatch,/artifacts changed/);
});
