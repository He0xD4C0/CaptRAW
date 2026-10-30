import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';

const out=resolve(process.env.CAPTRAW_WB_HISTORY_OUT||'artifacts/white-balance-history');
mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),checks=[];
const executable=process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine');
let complete=false,failure;
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
async function render(engine,revision,adjustments,artProfile){
 const pending=engine.preview(revision);
 const result=await engine.call('update',{revision,adjustments,artProfile});
 const frame=await pending;
 return {profile:result.artProfile,frame,sha256:hash(frame.file)};
}
try{
 for(const name of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const path=resolve('build/samples',name),original=hash(path);
  const history=new EngineClient({cache:join(work,name,'history')});
  const fresh=new EngineClient({cache:join(work,name,'fresh')});
  try{
   const image=await history.call('open',{path,sessionId:'history',baselineVersion:4});
   let rev=0;
   let previous=await render(history,++rev,image.adjustments,image.artProfile);
   const camera=previous;
   const manual={...image.adjustments,temperature:6500,tint:25,wbMode:'custom',wbMultipliers:null};
   previous=await render(history,++rev,manual,previous.profile);
   const sample=await history.call('whiteBalance',{mode:'sample',x:.6,y:.6,size:25});
   const sampled={...manual,...sample};
   previous=await render(history,++rev,sampled,previous.profile);
   copyFileSync(previous.frame.file,join(work,name+'-history.png'));
   const reopened=await fresh.call('open',{path,sessionId:'fresh',baselineVersion:4});
   const reference=await render(fresh,1,sampled,previous.profile);
   copyFileSync(reference.frame.file,join(work,name+'-fresh.png'));
   assert.equal(previous.profile,reference.profile,'Identical saved processing parameters');
   assert.equal(previous.sha256,reference.sha256,name+': cached WB preview must match a fresh process');
   // Undo must also restore RAW preprocessing, rather than only RGB-stage WB.
   const undone=await render(history,++rev,image.adjustments,previous.profile);
   assert.equal(undone.sha256,camera.sha256,name+': camera WB undo must restore original pixels');
   const redone=await render(history,++rev,sampled,undone.profile);
   assert.equal(redone.sha256,reference.sha256,name+': redo must restore sampled pixels');
   const before=history.preview(++rev,'before');
   await history.call('before',{revision:rev});await before;
   const compared=await render(history,++rev,sampled,redone.profile);
   assert.equal(compared.sha256,reference.sha256,name+': before/after comparison must preserve sampled pixels');
   assert.equal(hash(path),original,'Original RAW unchanged');
   checks.push({name,sourceSHA256:original,previewSHA256:reference.sha256,width:reference.frame.width,height:reference.frame.height,freshProcess:true,undo:true,redo:true,comparison:true});
   console.log('PASS',name,'WB history / fresh process / undo / redo / comparison exact');
  }finally{await history.stop();await fresh.stop();}
 }
 complete=true;
}catch(error){failure=error.stack||String(error);throw error;}
finally{
 writeFileSync(join(out,'report.json'),JSON.stringify({complete,engine:executable,engineSHA256:hash(executable),checks,...(!complete?{work,failure}:{}),limits:['Same-core consistency, not Adobe rendering equivalence.']},null,2)+'\n');
 if(complete)rmSync(work,{recursive:true,force:true});
}
