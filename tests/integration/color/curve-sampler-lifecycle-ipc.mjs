import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';

// Host lifecycle evidence, separate from the visible TAT GUI acceptance.
// The renderer stays empty so its effects cannot perform the host's cleanup.
const root=await mkdtemp(join(tmpdir(),'captraw-curve-lifecycle-')),paths=[join(root,'第一张.tif'),join(root,'第二张.tif')];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');let app,page,passed=false;
const original=await readFile('artifacts/stage-0/acr-reference/tat-interaction-187/inputs/controlled-tat.tif');
async function prepare(image,revision){
 await page.evaluate(async({image,revision})=>window.captraw.update(image.id,revision,image.adjustments,image.recipe?.artProfile||image.artProfile||''),{image,revision});
 await page.waitForFunction(({id,revision})=>window.__frames.some(f=>f.sessionId===id&&f.revision===revision&&f.kind==='fit'),{id:image.id,revision});
}
async function warm(image,revision){
 const request={id:crypto.randomUUID(),sessionId:image.id,revision,channel:'curve',point:{x:640,y:550}};
 const first=await page.evaluate(request=>window.captraw.sampleCurve(request),request);assert(first&&!first.reused);
 const next=await page.evaluate(request=>window.captraw.sampleCurve(request),{...request,id:crypto.randomUUID()});assert(next?.reused);
 const active=await app.evaluate(()=>globalThis.__samplers.filter(s=>s.child.exitCode===null&&s.child.signalCode===null).map(s=>({pid:s.child.pid,directory:s.directory})));
 assert.equal(active.length,1,'exactly one real warmed sampler must exist');return active[0];
}
async function released(worker,label){
 const state=await app.evaluate((_,pid)=>{const child=globalThis.__samplers.find(s=>s.child.pid===pid)?.child;return child&&{exitCode:child.exitCode,signalCode:child.signalCode};},worker.pid);
 assert(state&&(state.exitCode!==null||state.signalCode!==null),label+' must await the actual sampler exit');
 const {existsSync}=await import('node:fs');assert(!existsSync(worker.directory),label+' must remove its worker directory');console.log('PASS',label);
}
try{
 for(const path of paths)await copyFile('artifacts/stage-0/acr-reference/tat-interaction-187/inputs/controlled-tat.tif',path);
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'user-data'),OMP_NUM_THREADS:'2'}});page=await app.firstWindow();page.setDefaultTimeout(60000);
 await app.evaluate(()=>{
  const cp=process.getBuiltinModule('node:child_process'),spawn=cp.spawn;globalThis.__samplers=[];
  cp.spawn=function(...args){const child=spawn.apply(this,args),directory=args[1]?.[1];if(typeof directory==='string'&&directory.includes('curve-sample-'))globalThis.__samplers.push({child,directory});return child;};
 });
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 let image=await page.evaluate(path=>window.captraw.open(path),paths[0]);await prepare(image,1);
 let worker=await warm(image,1);image.adjustments.exposure=.25;await prepare(image,2);await released(worker,'editing retires the completed prior-revision sampler');
 worker=await warm(image,2);image=await page.evaluate(path=>window.captraw.open(path),paths[1]);await released(worker,'switching photo retires the previous sampler');await prepare(image,1);
 worker=await warm(image,1);await page.evaluate(()=>window.captraw.close());await released(worker,'closing the image retires the completed sampler');
 await assert.rejects(page.evaluate(request=>window.captraw.sampleCurve(request),{id:'closed',sessionId:image.id,revision:1,channel:'curve',point:{x:640,y:550}}),/切换|载入/);
 for(const path of paths)assert.equal(digest(await readFile(path)),digest(original));
 assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused()&&!w.isFocusable())));passed=true;
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
finally{if(app)await closeElectron(app);if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained curve lifecycle failure:',root);}
