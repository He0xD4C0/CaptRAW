import {EngineClient} from '../../support/engine-client.mjs';
import {InputProfiles} from '@captraw/desktop-core/profiles';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {resolve,join,dirname,basename} from 'node:path';
import {readFileSync,writeFileSync,rmSync,mkdirSync,copyFileSync,cpSync,readdirSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const fixtures=resolve('artifacts/profile-assets'),out=resolve(process.env.CAPTRAW_PROFILE_OUT||'artifacts/profile-assets/native');mkdirSync(out,{recursive:true});
rmSync(join(out,'library'),{recursive:true,force:true});
const core=new EngineClient({cache:join(out,'cache')});core.on('error',()=>{});
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'))),library=new InputProfiles(join(out,'library'),core);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const checks=[],pairs=[],pass=s=>{checks.push(s);console.log('PASS',s);};
const save=(path,recipe)=>saveRecipeWithMasks(core,path,recipe,r=>documents.serialize(r));
try{
 const source=resolve('build/samples/synthetic.dng'),image=await core.call('open',{path:source,sessionId:'profile-assets'});
 const profileDirectory=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources','dcpprofiles');let checked=0;for(const file of readdirSync(profileDirectory).filter(f=>/\.dcp$/i.test(f))){assert.equal((await core.call('inspectInputProfile',{path:join(profileDirectory,file)})).kind,'dcp');++checked;}pass(`all ${checked} bundled DCP profiles pass the standalone inspector`);
 const supplied=join(out,'临时 输入.dcp');copyFileSync(join(fixtures,'有效 配置.dcp'),supplied);
 const p=await library.importFile(supplied,image.profileCamera||image.camera,true);assert.equal(p.name,'CaptRAW Test Profile');assert.equal(p.kind,'dcp');assert.equal(p.cameraModel,image.profileCamera||image.camera);assert.equal(p.dcp.toneCurve,true);assert.deepEqual(p.dcp.illuminants,[{id:1,temperature:6500}]);
 const duplicate=await library.importFile(supplied,image.profileCamera||image.camera,true);assert.equal(duplicate.reference,p.reference);assert.equal((await library.list()).items.length,1);rmSync(supplied);assert.equal((await library.inspect(p.reference)).name,p.name);pass('DCP metadata, exact camera identity, immutable import and content deduplication');
 const pinned={...image.adjustments,colorProfile:{...image.adjustments.colorProfile,mode:'inherited',reference:p.reference}};
 const pinnedARP=(await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:'',adjustments:pinned})).artProfile;
 const pinnedFile=p.reference.slice(5),originalBytes=readFileSync(pinnedFile);writeFileSync(pinnedFile,Buffer.concat([originalBytes,Buffer.from('changed')]));
 await assert.rejects(library.inspect(p.reference),/校验失败/);await assert.rejects(core.call('validate',{artProfile:pinnedARP,adjustments:pinned}),/校验失败/);
 await assert.rejects(core.call('export',{path:source,artProfile:pinnedARP,output:join(out,'bad-profile.tiff'),format:'tiff'}),/校验失败/);
 const protectedXMP=join(out,'protected.xmp');writeFileSync(protectedXMP,'unchanged');await assert.rejects(save(protectedXMP,{artProfile:pinnedARP,adjustments:pinned}),/校验失败/);assert.equal(readFileSync(protectedXMP,'utf8'),'unchanged');writeFileSync(pinnedFile,originalBytes);
 pass('changed imported bytes reject inspect, warm native validation, export and atomic save without silently repinning identity');
 const externalFile=join(out,'external.dcp');writeFileSync(externalFile,originalBytes);
 const snapshot=await restoreRecipeMasks(core,join(out,'external.xmp'),{artProfile:'',adjustments:{...image.adjustments,colorProfile:{...image.adjustments.colorProfile,mode:'inherited',reference:'file:'+externalFile}}},join(out,'external-cache'));
 writeFileSync(externalFile,'changed original');assert.equal(hash(snapshot.adjustments.colorProfile.reference.slice(5)),hash(pinnedFile));await core.call('validate',{artProfile:snapshot.artProfile,adjustments:snapshot.adjustments});pass('an external absolute reference is snapshotted on open and survives original-file changes');


 for(const [name,pattern] of [['错误机型.dcp',/不匹配/],['损坏.dcp',/./],['不可用 LAB.icc',/RGB/]])await assert.rejects(library.importFile(join(fixtures,name),image.profileCamera||image.camera,true),pattern);
 await assert.rejects(library.importFile(join(fixtures,'有效 配置.dcp'),image.profileCamera||image.camera,false),/仅适用于 RAW/);assert.equal((await library.list()).items.length,1);pass('invalid DCP, incompatible camera, non-RGB ICC and DCP-on-rendered-image reject without library pollution');
 const icc=await library.importFile(join(fixtures,'显示 RGB.icc'),image.profileCamera||image.camera,true);assert.equal(icc.kind,'icc');assert(!icc.dcp);const alias=join(out,'same.icm');copyFileSync(join(fixtures,'显示 RGB.icc'),alias);assert.equal((await library.importFile(alias,image.profileCamera||image.camera,true)).reference,icc.reference);pass('RGB ICC is inspected and ICC/ICM aliases deduplicate independently of DCP');
 for(const [name,info] of [['dcp',p],['icc',icc]]){
  const settings={...image.adjustments.colorProfile,mode:'inherited',reference:info.reference,toneCurve:true};
  const a={...image.adjustments,colorProfile:settings};
  const artProfile=(await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:'',adjustments:a})).artProfile;
  const recipe={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:readFileSync(source).length,sha256:hash(source)},adjustments:a,artProfile};
  const original=join(out,name+'-reference.tiff');await core.call('export',{path:source,artProfile,output:original,format:'tiff'});
  const saved=join(out,name+'.xmp');await save(saved,recipe);const stored=await documents.read(saved);
  assert(stored.inputProfileAsset);assert.equal(stored.adjustments.colorProfile.reference,'captraw-profile:'+stored.inputProfileAsset.id);assert(!stored.artProfile.includes(info.reference));
  const moved=join(out,'移动 后 '+name);mkdirSync(moved,{recursive:true});const relocated=join(moved,'重命名.xmp');copyFileSync(saved,relocated);cpSync(saved+'.assets',join(moved,basename(saved)+'.assets'),{recursive:true});
  rmSync(info.reference.slice(5));
  const restored=await restoreRecipeMasks(core,relocated,await documents.read(relocated),join(out,'fresh-'+name));
  const actual=join(out,name+'-moved.tiff');await core.call('export',{path:source,artProfile:restored.artProfile,output:actual,format:'tiff'});pairs.push([actual,original]);
  const asset=join(dirname(relocated),stored.inputProfileAsset.path),data=readFileSync(asset);writeFileSync(asset,'corrupt');await assert.rejects(restoreRecipeMasks(core,relocated,stored,join(out,'fresh-'+name)),/校验值/);writeFileSync(asset,data);
  for(const change of [r=>r.inputProfileAsset.path='../escape.dcp',r=>r.inputProfileAsset.bytes++,r=>r.adjustments.colorProfile.reference='captraw-profile:'+'0'.repeat(64),r=>delete r.inputProfileAsset]){const bad=structuredClone(stored);change(bad);await assert.rejects(restoreRecipeMasks(core,relocated,bad,join(out,'fresh-'+name)));}
  rmSync(asset);symlinkSync(join(fixtures,name==='dcp'?'有效 配置.dcp':'显示 RGB.icc'),asset);await assert.rejects(restoreRecipeMasks(core,relocated,stored,join(out,'fresh-'+name)));rmSync(asset);writeFileSync(asset,data);
  const as=join(out,name+'-saved-as.xmp');await save(as,restored);assert.equal((await documents.read(as)).inputProfileAsset.id,stored.inputProfileAsset.id);
  pass(name+' portable XMP survives original/library deletion, relocation, rename and Save As; tampering and symlinks reject with warm cache');
 }
 const restricted=await library.importFile(join(fixtures,'禁止随附.dcp'),image.profileCamera||image.camera,true);
 const a={...image.adjustments,colorProfile:{...image.adjustments.colorProfile,mode:'inherited',reference:restricted.reference}},saved=join(out,'dcp.xmp'),before=readFileSync(saved);
 await assert.rejects(save(saved,{artProfile:'',adjustments:a}),/限制随附/);assert.deepEqual(readFileSync(saved),before);pass('restricted DCP never replaces an existing XMP or publishes a sidecar copy');
 const still=await library.list();assert.equal(still.errors.length,0);assert.equal(still.items.length,1);pass('library reflects actual stored files after document recovery');
}finally{writeFileSync(join(out,'report.json'),JSON.stringify({checks,pairs},null,2)+'\n');await core.stop();}
