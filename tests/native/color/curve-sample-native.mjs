import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-curve-sample-native-')),core=new EngineClient({cache:work});let success=false,revision=0;
const source=resolve('artifacts/stage-0/acr-reference/tat-interaction-187/inputs/controlled-tat.tif');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),before=hash(source);
const checks=[];const pass=s=>{checks.push(s);console.log('PASS',s);};
try{
 await core.ready;
 await assert.rejects(core.call('sampleCurve',{sessionId:'missing',revision:1,channel:'curve',point:{x:640,y:550}}),/照片已更新/);pass('new RPC rejects absent/stale session');
 const image=await core.call('open',{path:source,sessionId:'tat',sourceFramePolicy:'active-area-v1',whiteBalanceDefaults:'current'});
 const identity=[{x:0,y:0},{x:1,y:1}];
 const a={...image.adjustments,crop:null,exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,sharpening:0,luminanceNoise:0,colorNoise:0,
  clarity:0,texture:0,dehaze:0,grain:0,vignette:0,glow:0,lensCorrections:false,curve:identity,redCurve:identity,greenCurve:identity,blueCurve:identity,masks:[]};
 let profile=image.artProfile;
 async function render(adjustments){const pending=core.preview(++revision,'fit');const result=await core.call('update',{revision,adjustments,artProfile:profile});await pending;profile=result.artProfile;}
 const sample=(channel='curve',point={x:640,y:550},rev=revision)=>core.call('sampleCurve',{sessionId:'tat',revision:rev,channel,point});
 await render(a);const base=await sample();assert.equal(base.domain,'art-tone-input-v1');assert.equal(base.input,166/255);assert.equal(base.output,base.input);assert.equal(base.reused,false);
 const repeated=await sample();assert.equal(repeated.reused,true);assert.deepEqual(repeated.values,base.values);pass('real ToneCurve1 input166 and cached read-only repeat');
 const changed={...a,curve:[{x:0,y:0},{x:166/255,y:201/255},{x:1,y:1}]};await render(changed);
 const tone=await sample(),red=await sample('redCurve');assert.deepEqual(tone.values,base.values);assert(Math.abs(tone.output-201/255)<1e-6);assert.equal(red.domain,'art-rgb-input-v1');assert.equal(red.input,201/255);pass('main input remains before curve; RGB input sees preceding main effect');
 for(const channel of ['greenCurve','blueCurve'])assert.equal((await sample(channel)).input,201/255);pass('all three native RGB channel buffers');
 await assert.rejects(sample('curve',{x:-1,y:550}),/位置/);await assert.rejects(sample('hsl'),/通道/);await assert.rejects(sample('curve',undefined,revision-1),/照片已更新/);pass('invalid coordinates/channel/revision rejected');
 for(const [name,change]of [['crop',{crop:{x:.04,y:.04,width:.92,height:.92}}],['rotate90',{rotation:90}],['perspective',{fineRotation:2,perspective:{...a.perspective,enabled:true,horizontal:6,vertical:-4}}]]){
  await render({...a,...change});const sourcePoint=name==='rotate90'?{x:473,y:640}:{x:640,y:550};
  const mapped=await core.call('coordinates',{sessionId:'tat',revision,from:'source',to:'display',points:[sourcePoint]});assert(mapped.points[0]);
  assert.equal((await sample('curve',mapped.points[0])).input,166/255);pass(name+' display geometry maps to the same gray patch');
 }
 assert.equal(hash(source),before);success=true;console.log(JSON.stringify({checks:checks.length,sourceUnchanged:true}));
}finally{await core.stop();if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
