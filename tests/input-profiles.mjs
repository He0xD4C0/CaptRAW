import {EngineClient,explicitFreshCurveMode} from './engine-client.mjs';
import {readFileSync,writeFileSync,mkdirSync,cpSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=resolve('artifacts/input-profiles');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:'build/input-profile-cache'});engine.on('error',()=>{});
const legacy=new EngineClient({executable:process.env.CAPTRAW_PROFILE_LEGACY_ENGINE||process.env.HOME+'/Applications/CaptRAW-0.4.app/Contents/Resources/native/captraw-engine',resources:process.env.CAPTRAW_PROFILE_LEGACY_RESOURCES||process.env.HOME+'/Applications/CaptRAW-0.4.app/Contents/Resources/native/resources',cache:'build/input-profile-legacy'});legacy.on('error',()=>{});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let revision=0;
const report={engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,images:[],checks:[]};
async function render(image,settings,name,artProfile=''){
 const pending=engine.preview(++revision),adjustments={...image.adjustments,colorProfile:settings};
 const result=await engine.call('update',{revision,adjustments,artProfile}),frame=await pending;
 cpSync(frame.file,join(out,name+'.png'));writeFileSync(join(out,name+'.arp'),result.artProfile);
 return {frame,profile:result.artProfile,sha256:hash(frame.file)};
}
try{
 for(const file of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const source=resolve('build/samples',file),image=await engine.call('open',{path:source,sessionId:file,baselineVersion:3});
  const auto=image.inputProfiles.find(p=>p.id==='auto');assert.equal(auto.kind,'dcp');assert(auto.dcp.hueSatMap);assert.equal(auto.dcp.illuminants.length,2);
  const baseline=await render(image,image.adjustments.colorProfile,file+'-auto');
  const old=await legacy.call('open',{path:source,sessionId:'legacy'}),pending=legacy.preview(1);
  const oldResult=await legacy.call('update',{revision:1,adjustments:old.adjustments});const oldFrame=await pending;
  assert.equal(baseline.sha256,hash(oldFrame.file),'Default preview changed');assert.equal(baseline.profile,explicitFreshCurveMode(oldResult.artProfile),'Default ART parameters changed');
  const settings=image.adjustments.colorProfile,changes=[['matrix',{mode:'matrix'}],['no-color-table',{hueSatMap:false}],['light-1',{illuminant:1}],['light-2',{illuminant:2}]];
  const cases=[];
  for(const [name,change] of changes){const result=await render(image,{...settings,...change},file+'-'+name);assert.notEqual(result.sha256,baseline.sha256,'Profile control has no pixel effect: '+name);cases.push(name);}
  if(file==='nikon-d850.NEF'){
   writeFileSync(join(out,'legacy-default.captraw.json'),JSON.stringify({schemaVersion:1,engineVersion:'CaptRAW-3_ART-1.26.10_LibRaw-3b20539',baselineVersion:3,source:{path:source,size:readFileSync(source).length,sha256:hash(source)},artProfile:oldResult.artProfile,adjustments:old.adjustments},null,2));
   const matrixProfile=readFileSync(join(out,file+'-matrix.arp'),'utf8');
   await engine.call('export',{path:source,artProfile:matrixProfile,output:join(out,'matrix.tiff'),format:'tiff'});
   execFileSync(resolve('build/reference/Contents/MacOS/captraw-art-reference'),['-o',join(out,'matrix-reference.tif'),'-p',join(out,file+'-matrix.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:['ignore','pipe','pipe']});
   const inherited=baseline.profile.replace('InputProfile=(cameraICC)','InputProfile=file:'+resolve('build/native/resources/dcpprofiles/NIKON D850.dcp'));
   const oldAdjustments={...image.adjustments};delete oldAdjustments.colorProfile;
   const restored=await engine.call('validate',{artProfile:inherited,adjustments:oldAdjustments});assert.equal(restored.colorProfile.mode,'inherited');
   const custom=await render(image,restored.colorProfile,'inherited',inherited);assert.equal(custom.sha256,baseline.sha256);
   await render(image,{...settings,mode:'matrix'},'inherited-switched',custom.profile);
   const undone=await render(image,restored.colorProfile,'inherited-restored');assert.equal(undone.sha256,baseline.sha256,'Inherited profile was lost after switching and undo');
   const missing=inherited.replace('InputProfile=file:'+resolve('build/native/resources/dcpprofiles/NIKON D850.dcp'),'InputProfile=file:'+resolve('build/missing-input.dcp'));
   await assert.rejects(engine.call('validate',{artProfile:missing,adjustments:oldAdjustments}),/输入配置文件不可用/);
   await assert.rejects(engine.call('export',{path:source,artProfile:missing,output:join(out,'missing.tiff'),format:'tiff'}),/输入配置文件不可用/);
   const temporary=resolve('build/input-profile-cache/临时 相机.icc');cpSync('build/native/resources/iccprofiles/input/Nikon D7000.icc',temporary);
   const cachedICC=inherited.replace(/InputProfile=file:[^\n]+/,'InputProfile=file:'+temporary);
   await engine.call('validate',{artProfile:cachedICC,adjustments:oldAdjustments});unlinkSync(temporary);
   await assert.rejects(engine.call('validate',{artProfile:cachedICC,adjustments:oldAdjustments}),/输入配置文件不可用/);
   writeFileSync(join(out,'inherited.captraw.json'),JSON.stringify({schemaVersion:1,engineVersion:'CaptRAW-3_ART-1.26.10_LibRaw-3b20539',baselineVersion:3,source:{path:source,size:readFileSync(source).length,sha256:hash(source)},artProfile:inherited,adjustments:oldAdjustments},null,2));
   await assert.rejects(engine.call('update',{revision:++revision,adjustments:{...image.adjustments,colorProfile:{...settings,mode:'embedded'}}}));
   for(const change of [{mode:'invalid'},{illuminant:-1},{illuminant:3},{illuminant:1.5}])await assert.rejects(engine.call('validate',{artProfile:'',adjustments:{...image.adjustments,colorProfile:{...settings,...change}}}));
  }
  report.images.push({file,profiles:image.inputProfiles,defaultMatches04:true,actualPixelChanges:cases});console.log('PASS',file,cases.join(', '));
 }
 const dng=await engine.call('open',{path:resolve('build/samples/synthetic.dng'),sessionId:'dng'});assert.equal(dng.inputProfiles.find(p=>p.id==='auto').kind,'matrix');assert.equal(dng.inputProfiles.find(p=>p.id==='embedded').kind,'dcp');
 await render(dng,{...dng.adjustments.colorProfile,mode:'embedded'},'embedded-dng');report.checks.push('DNG embedded profile is detected and renders');
 const png=await engine.call('open',{path:resolve('build/samples/embedded-srgb.png'),sessionId:'png'});assert(!png.inputProfiles.some(p=>p.id==='matrix'));assert.equal(png.inputProfiles.find(p=>p.id==='auto').kind,'icc');
 const first=await render(png,png.adjustments.colorProfile,'icc-auto'),second=await render(png,{...png.adjustments.colorProfile,mode:'embedded'},'icc-embedded');assert.equal(first.sha256,second.sha256);report.checks.push('non-RAW ICC is detected; embedded and automatic rendering agree');
 report.checks.push('inherited profile survives switching and restoration','invalid settings and unavailable embedded profile are rejected','missing custom profile is rejected instead of silently substituting a matrix','a deleted ICC is rejected even when the profile is cached');
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}finally{await engine.stop();await legacy.stop();}
