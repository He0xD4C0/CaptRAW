import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,writeFile,rm,rename,readdir,mkdir,symlink,link} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {captureSourceIdentity} from '@captraw/desktop-core/source-identity';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
async function scenario(run){
 const root=await mkdtemp(join(tmpdir(),'captraw-source-ipc-'));let app,passed=false;
 try{
  const paths=[join(root,'中文 原片.dng'),join(root,'other.dng')];for(const path of paths)await copyFile('build/samples/synthetic.dng',path);
  app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'user-data'),CAPTRAW_DEV_URL:''}});const page=await app.firstWindow();
  await run({root,paths,app,page});
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused()})));assert(windows.length&&windows.every(w=>!w.visible&&!w.focused));passed=true;
 }catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error),diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;}
 finally{if(app)await closeElectron(app);if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained source IPC failure:',root);}
}
const snapshot=image=>({path:image.path,width:image.width,height:image.height,artProfile:image.recipe?.artProfile||'',adjustments:image.adjustments,sourceIdentity:image.sourceIdentity});
async function mutate(path){const bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);}
// Observe actual JSON worker results; mutate synchronously before main receives
// them. Native open/export still run in full, with no product-only test hooks.
async function gate(app,method,path,redirect){
 await app.evaluate((_,{method,path,redirect})=>{
  const cp=process.getBuiltinModule('node:child_process'),fs=process.getBuiltinModule('node:fs');
  global.__sourceGate={method,path,redirect,reached:false};
  if(global.__sourceSpawn)return;
  global.__sourceSpawn=cp.spawn;
  cp.spawn=function(...args){
   const child=global.__sourceSpawn.apply(this,args);if(!/captraw-engine(?:\.exe)?$/.test(String(args[0])))return child;
   const requests=new Map(),write=child.stdin.write;let buffer='';
   child.stdin.write=function(chunk,...rest){try{for(const line of String(chunk).trim().split('\n')){const m=JSON.parse(line);requests.set(m.id,m.method);}}catch{}return write.call(this,chunk,...rest);};
   child.stdout.prependListener('data',bytes=>{
    buffer+=bytes.toString();let newline;
    while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let m;try{m=JSON.parse(line);}catch{continue;}
     const g=global.__sourceGate;if(!g.reached&&(g.method==='preview'?m.event==='preview':m.result&&requests.get(m.id)===g.method)){
      g.reached=true;
      if(g.redirect){const paths=process.getBuiltinModule('node:path');fs.renameSync(m.result.path,paths.join(g.redirect.directory,paths.basename(m.result.path)));fs.unlinkSync(g.redirect.alias);fs.symlinkSync(g.redirect.directory,g.redirect.alias,'dir');}
      else{const data=fs.readFileSync(g.path);data[data.length-1]^=1;fs.writeFileSync(g.path,data);}
     }
    }
   });return child;
  };
 },{method,path,redirect});
}

function rendered(path,format){execFileSync('build/qa-venv/bin/python',['-c',"from PIL import Image;import sys;Image.new('RGB',(160,96),(96,128,160)).save(sys.argv[1],format=sys.argv[2])",path,format==='jpeg'?'JPEG':'TIFF']);}

test('single export rejects parent aliases and same-inode JPEG/TIFF targets before creating any worker',()=>scenario(async({root,app,page})=>{
 const alias=join(root,'目录别名');await symlink(root,alias,'dir');
 for(const format of ['jpeg','tiff']){
  const extension=format==='jpeg'?'jpg':'tiff',source=join(root,'原片.'+extension),hard=join(root,'hard.'+extension),symbolic=join(root,'symbolic.'+extension);rendered(source,format);await link(source,hard);await symlink(source,symbolic);
  const original=await readFile(source),image=await page.evaluate(path=>window.captraw.open(path),source);
  await app.evaluate(()=>{const cp=process.getBuiltinModule('node:child_process');if(!global.__aliasSpawn){global.__aliasSpawn=cp.spawn;cp.spawn=function(...args){if(/captraw-engine(?:\.exe)?$/.test(String(args[0])))++global.__aliasWorkers;return global.__aliasSpawn.apply(this,args);};}global.__aliasWorkers=0;});
  for(const target of [join(alias,'原片.'+extension),hard,symbolic]){
   await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
   await assert.rejects(page.evaluate(({document,format})=>window.captraw.export({document,format,colorSpace:'srgb'}),{document:snapshot(image),format}),/不能覆盖原始照片/);
   assert.deepEqual(await readFile(source),original);assert.deepEqual(await readFile(target),original);
  }
  assert.equal(await app.evaluate(()=>global.__aliasWorkers),0,'same-source aliases must be rejected before spawning an export worker');
  const independent=join(root,'independent.'+extension);await writeFile(independent,'previous independent output');
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},independent);
  assert.equal(await page.evaluate(({document,format})=>window.captraw.export({document,format,colorSpace:'srgb'}),{document:snapshot(image),format}),independent);
  const exported=await page.evaluate(path=>window.captraw.open(path),independent);assert.equal(exported.width,image.width);assert.equal(exported.height,image.height);assert.deepEqual(await readFile(source),original);
 }
 assert(!(await readdir(root)).some(name=>name.endsWith('.tmp')));
}));

test('single export rechecks a parent alias retargeted to the source after actual rendering, retaining original JPEG/TIFF bytes',()=>scenario(async({root,app,page})=>{
 for(const format of ['jpeg','tiff']){
  const directory=join(root,format+'-original'),safe=join(root,format+'-exports'),alias=join(root,format+'-alias');await mkdir(directory);await mkdir(safe);await symlink(safe,alias,'dir');
  const name='原片.'+(format==='jpeg'?'jpg':'tiff'),source=join(directory,name),target=join(alias,name);rendered(source,format);const original=await readFile(source),image=await page.evaluate(path=>window.captraw.open(path),source);
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);await gate(app,'export',source,{directory,alias});
  await assert.rejects(page.evaluate(({document,format})=>window.captraw.export({document,format,colorSpace:'srgb'}),{document:snapshot(image),format}),/不能覆盖原始照片/);
  assert.equal(await app.evaluate(()=>global.__sourceGate.reached),true,'must finish actual native rendering before redirecting the output parent');
  assert.deepEqual(await readFile(source),original);assert.deepEqual(await readFile(target),original);assert.deepEqual(await readdir(directory),[name]);assert.deepEqual(await readdir(safe),[]);
 }
}));

test('main captures production source identity; matching switches retain it and stale switches preserve the prior active session',()=>scenario(async({paths,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]);assert.deepEqual(image.sourceIdentity,await captureSourceIdentity(paths[0]));
 const reopened=await page.evaluate(({path,identity})=>window.captraw.open(path,identity),{path:paths[0],identity:image.sourceIdentity});assert.deepEqual(reopened.sourceIdentity,image.sourceIdentity);
 const replacement=paths[0]+'.replacement';await copyFile(paths[0],replacement);await rename(replacement,paths[0]);
 const identical=await page.evaluate(({path,identity})=>window.captraw.open(path,identity),{path:paths[0],identity:image.sourceIdentity});assert.deepEqual(identical.sourceIdentity,image.sourceIdentity);
 const second=await page.evaluate(path=>window.captraw.open(path),paths[1]);await mutate(paths[0]);
 await assert.rejects(page.evaluate(({path,identity})=>window.captraw.open(path,identity),{path:paths[0],identity:image.sourceIdentity}),/原片已变化/);
 await page.evaluate(image=>window.captraw.update(image.id,1,image.adjustments,''),second);
}));

test('source replacement after actual decode rejects open before committing a new session',()=>scenario(async({paths,app,page})=>{
 const previous=await page.evaluate(path=>window.captraw.open(path),paths[0]);await gate(app,'open',paths[1]);
 await assert.rejects(page.evaluate(path=>window.captraw.open(path),paths[1]),/原片已变化/);assert.equal(await app.evaluate(()=>global.__sourceGate.reached),true);
 await page.evaluate(image=>window.captraw.update(image.id,1,image.adjustments,''),previous);
}));

test('session and single export reject an old snapshot before any confirmation dialog',()=>scenario(async({root,paths,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]),doc=snapshot(image);await mutate(paths[0]);
 const result=await page.evaluate(doc=>window.captraw.saveSession({sessionId:'stale',documents:[doc]}),doc);assert.match(result.results[0].error,/原片已变化/);
 await assert.rejects(page.evaluate(doc=>window.captraw.export({document:doc,format:'jpeg',colorSpace:'srgb'}),doc),/原片已变化/);
 assert(!(await readdir(root)).some(name=>/\.xmp$|\.jpg$/.test(name)));
}));

test('legacy recipe save verifies the captured source again after the native save dialog and retains old XMP',()=>scenario(async({root,paths,app,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]),target=join(root,'existing.xmp'),old='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>';await writeFile(target,old);
 await app.evaluate(({dialog},{source,target})=>{dialog.showSaveDialog=async()=>{const fs=process.getBuiltinModule('node:fs'),bytes=fs.readFileSync(source);bytes[bytes.length-1]^=1;fs.writeFileSync(source,bytes);return {canceled:false,filePath:target};};},{source:paths[0],target});
 await assert.rejects(page.evaluate(image=>window.captraw.save(image,''),image),/原片已变化/);assert.equal(await readFile(target,'utf8'),old);assert(!(await readdir(root)).some(name=>name.endsWith('.tmp')));
}));

test('actual single export completes worker rendering but rejects publication if its source changes',()=>scenario(async({root,paths,app,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]),target=join(root,'existing.jpg');await writeFile(target,'existing output');
 await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);await gate(app,'export',paths[0]);
 await assert.rejects(page.evaluate(doc=>window.captraw.export({document:doc,format:'jpeg',colorSpace:'srgb'}),snapshot(image)),/原片已变化/);
 assert.equal(await app.evaluate(()=>global.__sourceGate.reached),true);assert.equal(await readFile(target,'utf8'),'existing output');assert(!(await readdir(root)).some(name=>name.endsWith('.tmp')));
}));

test('AutoPerspective verifies identity before starting and before returning a real guided solution',()=>scenario(async({root,app,page})=>{
 const source=join(root,'guided.tiff');rendered(source,'tiff');const original=await readFile(source),image=await page.evaluate(path=>window.captraw.open(path),source);
 const request={id:'source-identity-auto',sessionId:image.id,direction:'horizontal',artProfile:'',adjustments:image.adjustments,lines:[{axis:'horizontal',start:{x:10,y:20},end:{x:150,y:25}},{axis:'horizontal',start:{x:10,y:60},end:{x:150,y:65}}]},before=structuredClone(request);
 const solved=await page.evaluate(request=>window.captraw.autoPerspective(request),request);assert.equal(solved.enabled,true);assert.deepEqual(await readFile(source),original);
 await gate(app,'autoPerspective',source);await assert.rejects(page.evaluate(request=>window.captraw.autoPerspective(request),request),/原片已变化/);assert.equal(await app.evaluate(()=>global.__sourceGate.reached),true,'the native solver must actually finish before the source changes');
 await gate(app,'open',source);await assert.rejects(page.evaluate(request=>window.captraw.autoPerspective(request),request),/原片已变化/);assert.equal(await app.evaluate(()=>global.__sourceGate.reached),false,'a stale source must be rejected before a worker decodes it');
 assert.deepEqual(request,before);
 const caches=await app.evaluate(({app})=>{const fs=process.getBuiltinModule('node:fs'),path=process.getBuiltinModule('node:path'),found=[];function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(!entry.isDirectory())continue;if(entry.name.startsWith('perspective-'))found.push(entry.name);scan(path.join(dir,entry.name));}}scan(path.join(app.getPath('userData'),'preview-cache'));return found;});assert.deepEqual(caches,[]);
}));

const comparison=image=>({artProfile:'',adjustments:image.adjustments,geometry:Object.fromEntries(['rotation','flipHorizontal','flipVertical','fineRotation','perspective','crop','lensCorrections','lensProfile','lensManualDistortion'].map(key=>[key,image.adjustments[key]]))});
async function watchComparison(page){await page.evaluate(()=>{window.__sourceEvents=[];window.captraw.onEvent(event=>{if(event.event.startsWith('comparison-'))window.__sourceEvents.push(event);});});}

test('unchanged source still produces an actual comparison frame',()=>scenario(async({paths,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]);await watchComparison(page);
 await page.evaluate(({image,settings})=>window.captraw.comparison(image.id,9,settings),{image,settings:comparison(image)});
 await page.waitForFunction(()=>window.__sourceEvents.some(e=>e.event==='comparison-preview'),{},{timeout:30000});
 const events=await page.evaluate(()=>window.__sourceEvents);assert(!events.some(e=>e.event==='comparison-error'));assert.equal(events.find(e=>e.event==='comparison-preview').frame.sessionId,image.id);
 await page.evaluate(id=>window.captraw.comparison(id,10,null),image.id);
}));

test('comparison rejects stale sources before open and changes after actual decode',()=>scenario(async({paths,app,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]);await watchComparison(page);await gate(app,'open',paths[0]);
 await assert.rejects(page.evaluate(({image,settings})=>window.captraw.comparison(image.id,10,settings),{image,settings:comparison(image)}),/原片已变化/);assert.equal(await app.evaluate(()=>global.__sourceGate.reached),true);
 await gate(app,'open',paths[0]);
 await assert.rejects(page.evaluate(({image,settings})=>window.captraw.comparison(image.id,11,settings),{image,settings:comparison(image)}),/原片已变化/);assert.equal(await app.evaluate(()=>global.__sourceGate.reached),false,'stale source must not be decoded');
 assert.deepEqual(await page.evaluate(()=>window.__sourceEvents.filter(e=>e.event==='comparison-preview')),[]);
}));

test('comparison verifies each real rendered frame before sending it',()=>scenario(async({paths,app,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]);await watchComparison(page);await gate(app,'preview',paths[0]);
 await page.evaluate(({image,settings})=>window.captraw.comparison(image.id,12,settings),{image,settings:comparison(image)});
 await page.waitForFunction(()=>window.__sourceEvents.some(e=>e.event==='comparison-error'),{},{timeout:30000});
 assert.equal(await app.evaluate(()=>global.__sourceGate.reached),true);const events=await page.evaluate(()=>window.__sourceEvents);assert.match(events.find(e=>e.event==='comparison-error').message,/原片已变化/);assert(!events.some(e=>e.event==='comparison-preview'));
}));

test('stopping comparison during frame verification suppresses the old frame after its await',()=>scenario(async({paths,app,page})=>{
 const image=await page.evaluate(path=>window.captraw.open(path),paths[0]);await watchComparison(page);
 await app.evaluate((_,source)=>{
  const fs=process.getBuiltinModule('node:fs/promises'),original=fs.open;let count=0;global.__sourceHeld=false;global.__sourceReleased=false;
  fs.open=async function(path,...args){const file=await original.call(this,path,...args);if(path===source&&++count===3){global.__sourceHeld=true;await new Promise(resolve=>{global.__releaseSource=resolve;});const close=file.close.bind(file);file.close=async()=>{await close();global.__sourceReleased=true;};}return file;};
 },paths[0]);
 await page.evaluate(({image,settings})=>window.captraw.comparison(image.id,13,settings),{image,settings:comparison(image)});
 await app.evaluate(async()=>{for(let i=0;i<3000;i++){if(global.__sourceHeld)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Actual comparison frame never reached verification');});
 await page.evaluate(id=>window.captraw.comparison(id,14,null),image.id);await app.evaluate(()=>global.__releaseSource());
 await app.evaluate(async()=>{for(let i=0;i<3000;i++){if(global.__sourceReleased){await new Promise(resolve=>setImmediate(resolve));return;}await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Old source verification did not settle');});
 assert.deepEqual(await page.evaluate(()=>window.__sourceEvents),[]);
}));
