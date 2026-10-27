import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {EngineClient} from './engine-client.mjs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,statSync,utimesSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const out=resolve(process.env.CAPTRAW_EXTERNAL_OUT||'artifacts/external-masks');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:join(out,'cache')}),old=join(homedir(),'Applications/CaptRAW-0.25.app/Contents/Resources/native');
const reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference')});
const checks=[],pairs=[],events=[],sources={},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
engine.on('error',e=>events.push(e));reference.on('error',()=>{});let revision=0;
const pass=s=>{checks.push(s);console.log('PASS',s);};
const original=resolve('artifacts/segmentation/tiny/apple-mask.png'),asset=join(out,'蒙版 文件.png'),missing=join(out,'missing.png'),corrupt=join(out,'corrupt.png');
copyFileSync(original,asset);rmSync(missing,{force:true});writeFileSync(corrupt,'invalid PNG');
function local(profile,filename,extra={}){
 const values={Enabled:true,Contrast:40,ExternalMaskEnabled:true,ExternalMaskFilename:pathToFileURL(filename).href,...extra};
 return profile.replace(/(\[Local Contrast\]\n)([^\[]*)/,(_,head,body)=>head+Object.entries(values).reduce((b,[k,v])=>{const r=new RegExp('^'+k+'=.*$','m');return r.test(b)?b.replace(r,k+'='+v):b+k+'='+v+'\n';},body));
}
async function render(image,artProfile){const wait=engine.preview(++revision,'fit',120000);const result=await engine.call('update',{revision,adjustments:image.adjustments,artProfile});return {...result,frame:await wait};}
async function rejectedExport(path,artProfile,name){const output=join(out,name+'.tiff');writeFileSync(output,'preserve destination');await assert.rejects(engine.call('export',{path,artProfile,output,format:'tiff'}),/蒙版/);assert.equal(readFileSync(output,'utf8'),'preserve destination');}
try{
 for(const [source,name] of [['canon-r5.CR3','apple'],['fuji-xt4.RAF','chart-box'],['nikon-d850.NEF','sky']]){
  const path=resolve('artifacts/segmentation/inputs',source+'.jpg');sources[path]=hash(path);
  for(const kind of ['base','selected','inverted']){
   const artProfile=readFileSync(resolve('artifacts/segmentation/art',name+'-'+kind+'.arp'),'utf8');
   const actual=join(out,name+'-'+kind+'.tiff'),expected=join(out,name+'-'+kind+'-reference.tiff');
   await engine.call('export',{path,artProfile,output:actual,format:'tiff'});await reference.call('export',{path,artProfile,output:expected,format:'tiff'});pairs.push({actual,expected});
  }
  await rejectedExport(path,readFileSync(resolve('artifacts/segmentation/art',name+'-missing.arp'),'utf8'),name+'-missing');
 }
 pass('three external masks and inversion render; missing assets reject before touching an existing export');
 const path=resolve('artifacts/segmentation/inputs/canon-r5.CR3.jpg'),image=await engine.call('open',{path,sessionId:'assets'});
 const base=await render(image,''),profile=local(base.artProfile,asset),valid=await render(image,profile);
 assert.notEqual(hash(base.frame.file),hash(valid.frame.file));
 const saved=(await engine.call('save')).artProfile;
 for(const filename of [missing,corrupt,'']){
  const invalid=local(saved,filename,{ExternalMaskFilename:filename?pathToFileURL(filename).href:''});
  for(const method of ['validate','compose','update'])await assert.rejects(engine.call(method,{artProfile:invalid,adjustments:image.adjustments,width:image.width,height:image.height,revision:++revision}),/蒙版/);
  assert.equal((await engine.call('save')).artProfile,saved);
  await rejectedExport(path,invalid,'invalid-'+(filename===missing?'missing':filename===corrupt?'corrupt':'empty'));
 }
 pass('missing, corrupt and empty active assets reject validation, compose and update without replacing current parameters');
 // Same file size and timestamp must not resurrect a cached valid mask.
 const st=statSync(asset),bytes=readFileSync(asset);writeFileSync(asset,Buffer.alloc(bytes.length,120));utimesSync(asset,st.atime,st.mtime);
 await assert.rejects(engine.call('validate',{artProfile:saved,adjustments:image.adjustments}),/蒙版/);
 await assert.rejects(engine.call('save'),/蒙版/);
 await assert.rejects(engine.call('viewport',{revision:++revision,x:0,y:0,width:300,height:200}),/蒙版/);
 writeFileSync(asset,bytes);utimesSync(asset,st.atime,st.mtime);await engine.call('validate',{artProfile:saved,adjustments:image.adjustments});
 pass('content-addressed cache detects same-size same-timestamp corruption; save and 1:1 do not bypass validation');
 for(const change of [{Enabled:false},{MaskEnabled:false},{ExternalMaskEnabled:false}]){
  const inactive=local(saved,missing,change);await engine.call('validate',{artProfile:inactive,adjustments:image.adjustments});await render(image,inactive);
  await engine.call('export',{path,artProfile:inactive,output:join(out,'inactive-'+Object.keys(change)[0]+'.tiff'),format:'tiff'});
 }
 pass('disabled tools, regions and external components do not require unused files');
 for(const mode of [0,1,2]){
  const nested=local(saved,missing,{ExternalMaskEnabled:false,CaptRAWComponentCount:1,CaptRAWComponent0_Operation:mode,CaptRAWComponent0_MaskEnabled:true,CaptRAWComponent0_ExternalMaskEnabled:true,CaptRAWComponent0_ExternalMaskFilename:pathToFileURL(missing).href});
  await assert.rejects(engine.call('validate',{artProfile:nested,adjustments:image.adjustments}),/蒙版/);await rejectedExport(path,nested,'nested-'+mode);
 }
 pass('nested additive, subtractive and intersected components are validated recursively');
 await render(image,profile);rmSync(asset);await assert.rejects(engine.call('save'),/蒙版/);copyFileSync(original,asset);
 const restored=await render(image,profile);assert.equal(hash(restored.frame.file),hash(valid.frame.file));
 const recipe={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path,size:statSync(path).size,sha256:hash(path)},adjustments:image.adjustments,artProfile:restored.artProfile};
 writeFileSync(join(out,'valid.xmp'),await documents.serialize(recipe));writeFileSync(join(out,'missing.xmp'),await documents.serialize({...recipe,artProfile:local(recipe.artProfile,missing)}));
 pass('restoring a deleted asset recovers identical preview pixels and a reusable recipe');
 // Delete after preflight, at ART's first actual processing progress notification.
 const raw=resolve('build/samples/nikon-d850.NEF');sources[raw]=hash(raw);
 const rawImage=await engine.call('open',{path:raw,sessionId:'race'}),rawBase=await render(rawImage,''),rawProfile=local(rawBase.artProfile,asset);
 const output=join(out,'race.tiff');writeFileSync(output,'preserve destination');let removed=false;
 const remove=()=>{if(!removed){rmSync(asset);removed=true;}};
 engine.on('progress',remove);await assert.rejects(engine.call('export',{path:raw,artProfile:rawProfile,output,format:'tiff'}),/处理期间/);engine.off('progress',remove);
 assert(removed);assert.equal(readFileSync(output,'utf8'),'preserve destination');assert(events.some(e=>e.message.includes('处理期间')));
 pass('deletion after export preflight raises a terminal error and never writes the destination');
 copyFileSync(original,asset);removed=false;const start=events.length,frames=[];const capture=e=>frames.push(e.frame);engine.on('preview',capture);engine.on('progress',remove);
 await engine.call('update',{revision:++revision,adjustments:rawImage.adjustments,artProfile:rawProfile});
 await new Promise((res,rej)=>{const until=Date.now()+120000;const poll=()=>{if(events.length>start)res();else if(Date.now()>until)rej(new Error('No runtime mask failure'));else setTimeout(poll,20);};poll();});
 await engine.call('cancel');engine.off('progress',remove);engine.off('preview',capture);assert(removed);assert.equal(frames.length,0);
 copyFileSync(original,asset);const recovered=await render(rawImage,rawProfile);assert(recovered.frame.width>0);assert.notEqual(hash(recovered.frame.file),hash(rawBase.frame.file));
 pass('deletion during preview publishes no faulty frame; restoring the asset restarts full processing');
 for(const [p,h]of Object.entries(sources))assert.equal(hash(p),h);
}finally{await engine.stop();await reference.stop();writeFileSync(join(out,'report.json'),JSON.stringify({checks,pairs,sources,events,engine:process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine'),offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE},null,2)+'\n');}
