import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,cpSync,existsSync,symlinkSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
const out=resolve('artifacts/color-grading-integration');mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const engine=new EngineClient({cache:'build/grading-integration-cache'}),checks=[],raw=[];let revision=0;
const wheel=(hue=0,saturation=0,luminance=0)=>({hue,saturation,luminance});
const neutral={shadows:wheel(),midtones:wheel(),highlights:wheel(),global:wheel(),blending:50,balance:0};
const mixed={...neutral,shadows:wheel(220,30,0),midtones:wheel(35,12,0),highlights:wheel(40,20,-5),blending:65,balance:10};
const pass=s=>{checks.push(s);console.log('PASS',s);};
async function render(adjustments,name,artProfile=''){
 const pending=engine.preview(++revision,'fit',120000);
 const r=await engine.call('update',{revision,adjustments,artProfile});const frame=await pending;
 cpSync(frame.file,join(out,name+'.png'));writeFileSync(join(out,name+'.arp'),r.artProfile);
 return {...r,hash:hash(frame.file),frame};
}
async function exportFile(path,profile,name,client=engine){await client.call('export',{path,artProfile:profile,format:'tiff',output:join(out,name+'.tiff')});}
function referenceCLI(){
 const root=resolve('build/grading-reference'),mac=join(root,'Contents/MacOS'),binary=join(mac,'captraw-art-reference');
 mkdirSync(mac,{recursive:true});mkdirSync(join(root,'settings'),{recursive:true});
 for(const [link,target] of [[join(mac,'lib'),resolve('build/bundle/native/lib')],[join(root,'Contents/Resources'),resolve('build/bundle/native/resources')]])if(!existsSync(link))symlinkSync(target,link);
 cpSync('build/native/captraw-art-reference',binary);
 cpSync('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/data/options/options.osx',join(root,'settings/options'));
 const run=(c,a)=>execFileSync(c,a,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 for(const dep of run('otool',['-L',binary]).split('\n').slice(1).map(s=>s.trim().split(' (')[0]).filter(Boolean)){
  if(dep.startsWith('/usr/lib/')||dep.startsWith('/System/Library/'))continue;
  assert(existsSync(join(mac,'lib',basename(dep))),dep);
  run('install_name_tool',['-change',dep,'@loader_path/lib/'+basename(dep),binary]);
 }
 for(const match of run('otool',['-l',binary]).matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g))if(match[1].startsWith('/opt/')||match[1].startsWith('/Users/'))run('install_name_tool',['-delete_rpath',match[1],binary]);
 run('codesign',['--force','--sign','-',binary]);
 return (source,name)=>{
  const args=['-a','-o',join(out,name+'-cli.tif'),'-p',join(out,name+'.arp'),'-t','-b16','-Y','-c',source];
  const profile=process.env.CAPTRAW_SANDBOX_PROFILE;
  const log=execFileSync(profile?'/usr/bin/sandbox-exec':binary,profile?['-f',profile,binary,...args]:args,{encoding:'utf8',env:{...process.env,OMP_NUM_THREADS:'8',ART_SETTINGS:join(root,'settings'),ART_CACHE:join(root,'cache')},maxBuffer:4*1024*1024});
  writeFileSync(join(out,name+'-cli.log'),log);
  assert(existsSync(join(out,name+'-cli.tif')));
 };
}
try{
 const reference=referenceCLI();
 const path=resolve('build/grading-research/order-input.png'),inputHash=hash(path);
 const image=await engine.call('open',{path,sessionId:'grading'}),base=image.adjustments;
 assert.deepEqual(base.colorGrading,neutral);
 const initial=await render(base,'baseline');assert(!initial.artProfile.includes('[CaptRAW Color Grading]'));
 const oldRoot=join(homedir(),'Applications/CaptRAW-0.16.app/Contents/Resources/native');
 const old=new EngineClient({executable:join(oldRoot,'captraw-engine'),resources:join(oldRoot,'resources'),cache:'build/grading-legacy-cache'});
 try{
  const before=await old.call('open',{path,sessionId:'legacy'}),pending=old.preview(1);
  const oldResult=await old.call('update',{revision:1,adjustments:before.adjustments});
  assert.equal(initial.artProfile,oldResult.artProfile);assert.equal(initial.hash,hash((await pending).file));
 }finally{await old.stop();}
 const absent={...base};delete absent.colorGrading;
 assert.equal((await render(absent,'absent')).hash,initial.hash);
 assert.equal((await render({...base,colorGrading:{...neutral,global:wheel(300),balance:80}},'neutral-hue')).hash,initial.hash);
 pass('absent and neutral grading preserve exact installed 0.16 profile and preview');
 await exportFile(path,initial.artProfile,'baseline');
 for(const region of ['shadows','midtones','highlights','global']){
  const r=await render({...base,colorGrading:{...neutral,[region]:wheel(240,70)}},region);
  assert.notEqual(r.hash,initial.hash);assert(r.artProfile.includes('[CaptRAW Color Grading]'));
  await exportFile(path,r.artProfile,region);
 }
 pass('all four wheels update cached previews and actual TIFF16 pixels');
 const bw={...base.blackWhite,enabled:true};
 const mono=await render({...base,blackWhite:bw},'black-white');await exportFile(path,mono.artProfile,'black-white');
 const bwGraded=await render({...base,blackWhite:bw,colorGrading:mixed},'black-white-graded');await exportFile(path,bwGraded.artProfile,'black-white-graded');
 reference(path,'black-white-graded');
 assert.notEqual(mono.hash,bwGraded.hash);
 const checked=await engine.call('validate',{artProfile:bwGraded.artProfile,adjustments:{...absent,blackWhite:bw}});
 assert.deepEqual(checked.colorGrading,mixed);
 assert.equal((await render({...absent,blackWhite:bw},'inherited',bwGraded.artProfile)).hash,bwGraded.hash);
 assert.equal((await render(base,'reset',bwGraded.artProfile)).hash,initial.hash);
 const replay=await render({...absent,blackWhite:bw},'replay',bwGraded.artProfile);assert.equal(replay.hash,bwGraded.hash);
 const restart=new EngineClient({cache:'build/grading-restart-cache'});
 try{await exportFile(path,bwGraded.artProfile,'restarted',restart);}finally{await restart.stop();}
 pass('B&W tint survives, full profile restores grading, reset and inherited changes invalidate previews');
 for(const invalid of [null,[],{}, {...neutral,blending:101},{...neutral,balance:-101},{...neutral,shadows:wheel(-1,1)}, {...neutral,global:wheel(0,101)}, {...neutral,global:wheel(0,1,101)}, {...neutral,global:{hue:'240',saturation:20,luminance:0}}])
  await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...base,colorGrading:invalid}}));
 for(const profile of [bwGraded.artProfile.replace('Version=1\nValues=','Version=2\nValues='),bwGraded.artProfile.replace(/^Values=.*$/m,'Values=1;2;'),bwGraded.artProfile.replace(/^Values=.*$/m,'Values=nan;0;0;0;0;0;0;0;0;0;0;0;50;0;')])
  await assert.rejects(engine.call('validate',{artProfile:profile,adjustments:absent}));
 pass('malformed JSON, profile versions, parameter counts and nonfinite values rejected');
 assert.equal(hash(path),inputHash);
 for(const fixture of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const source=resolve('build/samples',fixture),sourceHash=hash(source),im=await engine.call('open',{path:source,sessionId:fixture});
  const x=Math.floor(im.width*.4),y=Math.floor(im.height*.4),width=512,height=384;
  const a={...im.adjustments,colorGrading:mixed,crop:{x:x/im.width,y:y/im.height,width:width/im.width,height:height/im.height}};
  const r=await render(a,fixture),pending=engine.preview(revision,'detail',120000);
  await engine.call('viewport',{revision,x,y,width,height});const detail=await pending;cpSync(detail.file,join(out,fixture+'-detail.png'));
  const independent=new EngineClient({cache:'build/grading-export-cache'});
  try{await exportFile(source,r.artProfile,fixture,independent);}finally{await independent.stop();}
  reference(source,fixture);
  assert.equal(hash(source),sourceHash);
  raw.push({fixture,sourceSHA256:sourceHash,fitMs:r.frame.elapsedMs,detailMs:detail.elapsedMs,sourceUnchanged:true});
 }
 pass('real NEF, CR3 and X-Trans detail previews, independent TIFF16 exports and ART CLI profile loading');
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',engineSHA256:hash(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,noGUI:true,checks,raw},null,2)+'\n');
}finally{await engine.stop();}
