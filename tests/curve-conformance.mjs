import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {EngineClient} from './engine-client.mjs';
const js=await transform(readFileSync('apps/desktop/src/curve.ts','utf8'),{loader:'ts',format:'esm'});
const {sampleCurve}=await import(`data:text/javascript;base64,${Buffer.from(js.code).toString('base64')}`);
const engine=new EngineClient({cache:'build/curve-test-cache'});const results=[];
try{
 for(const points of [
  [{x:0,y:0},{x:1,y:1}],
  [{x:0,y:0},{x:.2,y:.1},{x:.5,y:.6},{x:.8,y:.95},{x:1,y:1}],
  [{x:0,y:.1},{x:.1,y:.8},{x:.5,y:.2},{x:.9,y:1},{x:1,y:.85}],
  [{x:0,y:0},{x:.01,y:.8},{x:.99,y:.2},{x:1,y:1}],
 ]){
  const {samples}=await engine.call('curve',{points}),display=sampleCurve(points);
  const maximum=Math.max(...samples.map((n,i)=>Math.abs(n-display[i])));assert(maximum<1e-12);
  results.push({points,sampleCount:samples.length,maximumDifference:maximum});
 }
 await assert.rejects(engine.call('curve',{points:[{x:0,y:0},{x:.5,y:.3},{x:.5,y:.7},{x:1,y:1}]}));
 writeFileSync('artifacts/curve-conformance.json',JSON.stringify({actualARTSampler:true,results},null,2)+'\n');console.log('Frontend/native curve conformance passed',results.length);
}finally{await engine.stop();}
