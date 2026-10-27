import {XMP,CRS,CT,lookup,encodeAdjustments,decodeAdjustments,encode,property,readExtension} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ENGINE_VERSION} from '@captraw/contracts';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {EngineClient} from './engine-client.mjs';
const out=resolve(process.env.CAPTRAW_XMP_DOCUMENTS_OUT||'artifacts/xmp-documents');mkdirSync(out,{recursive:true});
const binary=resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'),xmp=new XMP(binary),documents=new Documents(xmp),e=new EngineClient({cache:join(out,'core')}),sync=new Synchronizer(resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),join(out,'sync'),()=>{});
e.on('error',()=>{});const root=join(out,'library');rmSync(root,{recursive:true,force:true});const store=new Presets(root,e,join(out,'cache'),xmp);
const checks=[],pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const fixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="fixture" xmlns:c="${CRS}" xmlns:u="https://example.invalid/unknown/" c:ProcessVersion="15.4" c:Exposure2012="1.25" c:Highlights2012="-35" u:Opaque="保留 &amp; 未知"><c:Name><rdf:Alt><rdf:li xml:lang="x-default">Adobe 测试预设</rdf:li><rdf:li xml:lang="en-US">English preset name</rdf:li></rdf:Alt></c:Name><c:MaskGroupBasedCorrections><rdf:Seq><rdf:li rdf:parseType="Resource"><c:CorrectionName>未接入选区</c:CorrectionName><u:Unknown>keep</u:Unknown></rdf:li></rdf:Seq></c:MaskGroupBasedCorrections></rdf:Description></rdf:RDF></x:xmpmeta>`;
try{
 const source=resolve('build/samples/synthetic.dng'),before=hash(source),image=await e.call('open',{path:source,sessionId:'xmp'}),profile=(await e.call('save')).artProfile;
 const external=join(out,'adobe.xmp');writeFileSync(external,fixture);const read=await documents.read(external);assert.deepEqual({...read.adjustments},{exposure:1.25});assert(read.warnings.some(x=>x.includes('Highlights2012')));pass('standard exposure imports without manufacturing absent defaults; unsupported fields are disclosed');
 const curveFields={curve:'ToneCurvePV2012',redCurve:'ToneCurvePV2012Red',greenCurve:'ToneCurvePV2012Green',blueCurve:'ToneCurvePV2012Blue'},identity=[{x:0,y:0},{x:1,y:1}],bent=[{x:0,y:0},{x:64/255,y:96/255},{x:1,y:1}];
 const linearCurves=Object.fromEntries(Object.keys(curveFields).map(key=>[key,identity]));
 const curvePacket=(name,values={})=>fixture.replace(' c:Exposure2012="1.25"',name===undefined?'':` c:ToneCurveName2012="${name}"`).replace('<c:Name>',Object.entries(values).map(([key,items])=>`<c:${key}><rdf:Seq>${items.map(value=>`<rdf:li>${value}</rdf:li>`).join('')}</rdf:Seq></c:${key}>`).join('')+'<c:Name>');
 const curveInput=join(out,'curve-input.xmp'),readCurvePacket=async packet=>{writeFileSync(curveInput,packet);return documents.read(curveInput);};
 for(const [values,name] of [[{exposure:.75},undefined],[{curve:identity},'Custom'],[{redCurve:identity},'Custom'],[{redCurve:bent},'Custom'],[linearCurves,'Linear'],[{...linearCurves,curve:bent},'Custom'],[{...linearCurves,redCurve:bent},'Custom'],[{...linearCurves,greenCurve:bent},'Custom'],[{...linearCurves,blueCurve:bent},'Custom'],[{...linearCurves,curve:[{x:0,y:0},{x:.5,y:.5},{x:1,y:1}]},'Custom']]){
  const result=await xmp.call('write',curvePacket(name===undefined?undefined:name==='Linear'?'Custom':'Linear'),encodeAdjustments(values));
  const properties=(await xmp.call('read',result.packet)).properties;
  assert.equal(lookup(properties,CRS,'ToneCurveName2012')?.value,name);
  for(const [key,field] of Object.entries(curveFields))assert.equal(!!lookup(properties,CRS,field),values[key]!==undefined,field);
  assert.deepEqual(decodeAdjustments(properties).adjustments,values);
 }
 pass('only four endpoint identity curves save as Linear; partial or edited curves replace stale names with Custom; absent curves stay absent');
 for(const name of ['Linear','Medium Contrast','Strong Contrast','Custom','Vendor Curve']){
  const packet=curvePacket(name),named=await readCurvePacket(packet);assert.deepEqual(named.adjustments,{});
  assert(named.warnings.some(v=>v.includes('ToneCurveName2012')&&v.includes('尚未应用')&&v.includes('没有 PV2012 曲线坐标')));
  const retained=await xmp.call('write',packet,encodeAdjustments({exposure:.25}));assert.equal(lookup((await xmp.call('read',retained.packet)).properties,CRS,'ToneCurveName2012').value,name);
  await assert.rejects(store.importFile(curveInput),/尚无可应用的调节.*尚未应用/);
 }
 pass('name-only presets never manufacture curves and clearly disclose the unapplied name');
 const rawBent=['0, 0','64, 96','255, 255'];
 const conflict=await readCurvePacket(curvePacket('Linear',{ToneCurvePV2012Red:rawBent}));assert.deepEqual(conflict.adjustments,{redCurve:bent});
 assert(conflict.warnings.some(v=>v.includes('坐标不一致')&&v.includes('Adobe')&&v.includes('优先级尚未验证')));
 for(const name of ['Medium Contrast','Strong Contrast','Vendor Curve']){
  const named=await readCurvePacket(curvePacket(name,{ToneCurvePV2012:rawBent}));assert.deepEqual(named.adjustments,{curve:bent});
  assert(named.warnings.some(v=>v.includes(name)&&v.includes('对应关系尚未验证')&&v.includes('优先级尚未验证')));
 }
 const custom=await readCurvePacket(curvePacket('Custom',{ToneCurvePV2012:['0, 0','255, 255'],ToneCurvePV2012Red:rawBent}));assert.deepEqual(custom.adjustments,{curve:identity,redCurve:bent});assert(!custom.warnings.some(v=>v.includes('ToneCurveName2012')));
 const collinear=await readCurvePacket(curvePacket('Linear',{ToneCurvePV2012:['0, 0','128, 128','255, 255']}));assert(!collinear.warnings.some(v=>v.includes('坐标不一致')));assert.equal(collinear.adjustments.curve.length,3);
 pass('conflicting Linear and unverified named curves disclose CaptRAW coordinate use without claiming Adobe precedence; Custom may have a straight master and bent RGB');
 const valid=await readCurvePacket(curvePacket(undefined,{ToneCurvePV2012:[' +0 , 0 ','6.4e1, +9.6e1','255, 255']}));assert.deepEqual(valid.adjustments,{curve:bent});
 for(const value of ['', ' ', ', 0', '0,', ' , 0', '0, ', '0,,0', '0,0,0', 'NaN,0', 'Infinity,0', '1e309,0', '0x10,0', '0b10,0', '0o10,0', '64oops,0', '1_0,0', '-1,0', '256,0', '0,256', '0,-1', '0,NaN', '1e,0', '64 65,0'])await assert.rejects(readCurvePacket(curvePacket(undefined,{ToneCurvePV2012:[value,'255,255']})),/XMP 曲线点无效/);
 for(const items of [[],['0,0'],['0,0','64,96','64,100','255,255'],['64,96','0,0'],Array.from({length:129},(_,i)=>`${i},${i}`)])await assert.rejects(readCurvePacket(curvePacket(undefined,{ToneCurvePV2012:items})),/XMP 曲线点/);
 pass('real RDF parsing accepts decimal coordinates and rejects empty, non-decimal, non-finite, out-of-range, duplicate and unordered coordinates');
 const adjustments={...image.adjustments,exposure:.75,contrast:17,curve:[{x:0,y:0},{x:.4,y:.6},{x:1,y:1}],crop:{x:.1,y:.1,width:.8,height:.8},rotation:90,spots:[{id:'repair',name:'修复点',enabled:true,method:'clone',source:{x:.3,y:.3},target:{x:.6,y:.6},radius:20,feather:50,opacity:100,detail:0,retainTexture:false}]};
 const document={xmpPacket:fixture,engineVersion:ENGINE_VERSION,source:{path:source,size:readFileSync(source).length,sha256:before},artProfile:profile,adjustments,baselineVersion:4};
 const versionFile=join(out,'engine-version.xmp'),currentPacket=await documents.serialize(document);
 for(const version of ['CaptRAW-20_ART-1.26.10_LibRaw-3b20539','CaptRAW-21_ART-1.26.10_LibRaw-3b20539',ENGINE_VERSION]){
  const packet=(await xmp.call('write',currentPacket,[property(CT,'EngineVersion',encode(version))])).packet;
  writeFileSync(versionFile,packet);const originalHash=hash(versionFile),loaded=await documents.read(versionFile);
  assert.equal(loaded.engineVersion,version);assert.equal(loaded.artProfile,profile);assert.deepEqual(loaded.adjustments,adjustments);
  const resaved=await documents.serialize(loaded);assert.equal(readExtension((await xmp.call('read',resaved)).properties,'EngineVersion'),ENGINE_VERSION);
  const presetInput=join(out,'engine-version-preset-input.xmp');
  writeFileSync(presetInput,(await xmp.call('write',fixture,[property(CT,'EngineVersion',encode(version))])).packet);const presetHash=hash(presetInput);
  const importedVersion=await store.importFile(presetInput),exportedVersion=join(out,'engine-version-preset.xmp');
  await store.exportFile(importedVersion.id,exportedVersion);assert.equal(readExtension((await xmp.read(exportedVersion)).properties,'EngineVersion'),ENGINE_VERSION);
  assert.equal(hash(versionFile),originalHash);assert.equal(hash(presetInput),presetHash);
 }
 for(const version of ['CaptRAW-19_ART-1.26.10_LibRaw-3b20539','CaptRAW-23_ART-1.26.10_LibRaw-3b20539']){
  writeFileSync(versionFile,(await xmp.call('write',currentPacket,[property(CT,'EngineVersion',encode(version))])).packet);
  await assert.rejects(documents.read(versionFile),/不支持的 ART 显影版本/);await assert.rejects(store.importFile(versionFile),/不支持的 ART 显影版本/);
 }
 pass('version 20, 21 and 22 XMP documents/presets read without modifying source, save as current version, and reject unsupported older/future renderers');
 const saved=join(out,'中文 空格.xmp');await saveRecipeWithMasks(e,saved,document,v=>documents.serialize(v));const restored=await documents.read(saved);assert.deepEqual({...restored.adjustments},adjustments);assert.equal(restored.artProfile,profile);assert(!readFileSync(saved,'utf8').includes('"adjustments"'));assert(readFileSync(saved,'utf8').includes('crs:Exposure2012'));const props=(await xmp.read(saved)).properties;assert.equal(lookup(props,CRS,'Highlights2012').value,'-35');assert.equal(lookup(props,'https://example.invalid/unknown/','Opaque').value,'保留 & 未知');assert.deepEqual(lookup(props,CRS,'MaskGroupBasedCorrections'),lookup((await xmp.read(external)).properties,CRS,'MaskGroupBasedCorrections'));pass('XMP restores the full ART edit state and preserves untouched Adobe masks and unknown metadata');
 const a=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments,artProfile:profile}),b=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:restored.adjustments,artProfile:restored.artProfile});
 await e.call('export',{path:source,artProfile:a.artProfile,output:join(out,'before.tiff'),format:'tiff'});await e.call('export',{path:source,artProfile:b.artProfile,output:join(out,'restored.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np,json;from pathlib import Path\np=Path(${JSON.stringify(out)});a=tifffile.imread(p/'before.tiff');b=tifffile.imread(p/'restored.tiff');assert a.dtype==np.uint16;assert np.array_equal(a,b);print('equal TIFF16 pixels',a.shape)`],{stdio:'inherit'});pass('XMP save/reopen produces exactly equal native 16-bit TIFF pixels');
 const edited=join(out,'external-curve.xmp'),editedPacket=await xmp.call('write',readFileSync(saved,'utf8'),[{ns:CRS,name:'ToneCurvePV2012',node:{items:rawBent.map(value=>({value})),options:0x600}},{ns:CRS,name:'ToneCurveName2012',node:{value:'Linear'}}]);writeFileSync(edited,editedPacket.packet);
 const editedRead=await documents.read(edited);assert.deepEqual(editedRead.adjustments,{...adjustments,curve:bent});assert(editedRead.warnings.some(v=>v.includes('坐标不一致')));
 const editedProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:editedRead.adjustments,artProfile:editedRead.artProfile});await e.call('export',{path:source,artProfile:editedProfile.artProfile,output:join(out,'external-curve.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});assert not np.array_equal(tifffile.imread(p/'before.tiff'),tifffile.imread(p/'external-curve.tiff'))`]);
 writeFileSync(edited,await documents.serialize(editedRead));assert.equal(lookup((await xmp.read(edited)).properties,CRS,'ToneCurveName2012').value,'Custom');pass('external standard curve edits override the stored ART profile, change native TIFF pixels and replace conflicting Linear on save');
 // 0.34 packets stored fractional coordinates without ToneCurveName2012; retain that existing representation's precision.
 const decimals=['0, 0','82.875, 110.125','85.000000000001, 127.5','254.99999999999997, 254.5','255, 255'],fractional=decimals.map(value=>{const [x,y]=value.split(',').map(Number);return {x:x/255,y:y/255};});
 const legacyFile=join(out,'legacy-0.34-fractional.xmp'),legacyPacket=await xmp.call('write',readFileSync(saved,'utf8'),[{ns:CRS,name:'ToneCurvePV2012',node:{items:decimals.map(value=>({value})),options:0x600}},{ns:CRS,name:'ToneCurveName2012',node:null}]);writeFileSync(legacyFile,legacyPacket.packet);
 for(let round=0;round<3;round++){
  const legacy=await documents.read(legacyFile);assert.deepEqual(legacy.adjustments,{...adjustments,curve:fractional});assert.equal(legacy.engineVersion,ENGINE_VERSION);
  writeFileSync(legacyFile,await documents.serialize(legacy));const properties=(await xmp.read(legacyFile)).properties;
  assert.deepEqual(lookup(properties,CRS,'ToneCurvePV2012').items.map(item=>item.value),decimals);assert.equal(lookup(properties,CRS,'ToneCurveName2012').value,'Custom');
 }
 pass('0.34 fractional XMP coordinates, including real near-integer decimals, survive three document save/reopen cycles exactly');
 const wbPreview=e.preview(17);await e.call('update',{revision:17,adjustments:image.adjustments,artProfile:profile});await wbPreview;
 const wb=await e.call('whiteBalance',{mode:'camera'}),wbFile=join(out,'camera-white-balance.xmp');
 await saveRecipeWithMasks(e,wbFile,{...document,adjustments:{...adjustments,...wb}},v=>documents.serialize(v));
 const changedWB=await xmp.call('write',readFileSync(wbFile,'utf8'),[{ns:CRS,name:'Temperature',node:{value:'4500'}}]);writeFileSync(wbFile,changedWB.packet);
 const wbRead=await documents.read(wbFile);assert.equal(wbRead.adjustments.temperature,4500);assert.equal(wbRead.adjustments.wbMode,'custom');assert.equal(wbRead.adjustments.wbMultipliers,null);
 const tintFile=join(out,'tint-edited.xmp');await saveRecipeWithMasks(e,tintFile,{...document,adjustments:{...adjustments,...wb}},v=>documents.serialize(v));
 const tintPacket=await xmp.call('write',readFileSync(tintFile,'utf8'),[{ns:CRS,name:'Tint',node:{value:'25'}}]);writeFileSync(tintFile,tintPacket.packet);const tintRead=await documents.read(tintFile);
 assert.equal(tintRead.adjustments.tint,25);assert.equal(tintRead.adjustments.temperature,wb.temperature);assert.equal(tintRead.adjustments.wbMultipliers,null);assert.equal(tintRead.adjustments.wbMode,'custom');pass('external Tint edit invalidates exact coefficients while preserving Temperature');
 const wbOriginal=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,...wb},artProfile:profile}),wbChanged=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:wbRead.adjustments,artProfile:wbRead.artProfile});
 await e.call('export',{path:source,artProfile:wbOriginal.artProfile,output:join(out,'wb-before.tiff'),format:'tiff'});await e.call('export',{path:source,artProfile:wbChanged.artProfile,output:join(out,'wb-after.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});assert not np.array_equal(tifffile.imread(p/'wb-before.tiff'),tifffile.imread(p/'wb-after.tiff'))`]);pass('external standard Temperature edit invalidates camera multipliers and changes actual native pixels');
 const qualified=fixture.replace(' c:Exposure2012="1.25"','').replace('<c:Name>','<c:Exposure2012 rdf:parseType="Resource"><rdf:value>1.25</rdf:value><u:Source>retain qualifier</u:Source></c:Exposure2012><c:Name>');
 const qualifiedResult=await xmp.call('write',qualified,[{ns:CRS,name:'Exposure2012',node:{value:'0.25'}}]);assert(qualifiedResult.packet.includes('retain qualifier'));pass('editing a standard scalar preserves its unknown RDF qualifier');
 const imported=await store.importFile(external),target={image,profile,adjustments:{...image.adjustments,contrast:23,highlights:12,saturation:-17}};
 const curveTarget={...target,adjustments:{...target.adjustments,curve:adjustments.curve,greenCurve:[{x:0,y:0},{x:.5,y:.48},{x:1,y:1}],blueCurve:[{x:0,y:0},{x:.5,y:.52},{x:1,y:1}]}};
 const redOnly=join(out,'red-only.xmp');writeFileSync(redOnly,curvePacket('Linear',{ToneCurvePV2012Red:rawBent}));const redBefore=hash(redOnly),redPreset=await store.importFile(redOnly),redApplied=(await store.apply(redPreset.id,curveTarget,sync))[0];
 assert.deepEqual(redApplied.adjustments,{...curveTarget.adjustments,redCurve:bent});assert.equal(hash(redOnly),redBefore);assert(redPreset.warnings.some(v=>v.includes('坐标不一致')));
 const redExport=join(out,'red-only-exported.xmp');await store.exportFile(redPreset.id,redExport);const redProps=(await xmp.read(redExport)).properties;
 assert.equal(lookup(redProps,CRS,'ToneCurveName2012').value,'Custom');assert.deepEqual((await documents.read(redExport)).adjustments,{redCurve:bent});
 for(const field of ['ToneCurvePV2012','ToneCurvePV2012Green','ToneCurvePV2012Blue','Temperature','Tint'])assert.equal(lookup(redProps,CRS,field),undefined);
 pass('R-only preset import/apply/export keeps master, G/B curves, color and white balance unchanged without injecting missing channels');
 const tintOnly=join(out,'tint-only.xmp');writeFileSync(tintOnly,fixture.replace(' c:Exposure2012="1.25"',' c:WhiteBalance="Custom" c:Tint="25"'));
 const tintPreset=await store.importFile(tintOnly),tintApplied=(await store.apply(tintPreset.id,target,sync))[0];assert.equal(tintApplied.adjustments.tint,25);assert.equal(tintApplied.adjustments.temperature,target.adjustments.temperature);assert.equal(tintApplied.adjustments.exposure,target.adjustments.exposure);assert.equal(tintApplied.adjustments.wbMultipliers,null);assert(!tintPreset.warnings.some(v=>v.includes('尚未参与显影：')&&v.includes('Tint')));pass('Tint-only Adobe preset preserves temperature and exposure and resolves new camera coefficients');
 const applied=(await store.apply(imported.id,target,sync))[0];assert.equal(applied.adjustments.exposure,1.25);for(const key of ['contrast','highlights','saturation'])assert.equal(applied.adjustments[key],target.adjustments[key]);assert(imported.warnings.length);pass('exposure-only Adobe preset leaves contrast, highlights and saturation unchanged');
 await store.rename(imported.id,'改名','分组');const translated=join(out,'translated.xmp');await store.exportFile(imported.id,translated);const translatedProps=(await xmp.read(translated)).properties;assert.equal(lookup(translatedProps,CRS,'Name').items.find(n=>n.lang==='en-US').value,'English preset name');for(const field of [...Object.values(curveFields),'ToneCurveName2012'])assert.equal(lookup(translatedProps,CRS,field),undefined);pass('renaming and exporting an exposure-only preset preserves alternate-language names without adding curves or a curve name');
 const colorPreset=await store.create({name:'仅色彩',group:'分组',groups:['color'],adjustments:{...adjustments,saturation:44}}),colorExport=join(out,'color-only.xmp');await store.exportFile(colorPreset.id,colorExport);
 const colorProps=(await xmp.read(colorExport)).properties;for(const field of [...Object.values(curveFields),'ToneCurveName2012'])assert.equal(lookup(colorProps,CRS,field),undefined);
 const colorApplied=(await store.apply(colorPreset.id,curveTarget,sync))[0];assert.deepEqual(colorApplied.adjustments,{...curveTarget.adjustments,saturation:44,vibrance:adjustments.vibrance});pass('new color-only presets contain no curves or curve name and preserve target curves on apply');
 const own=await store.create({name:'自己的预设',group:'分组',groups:['light','curves'],adjustments});const exported=join(out,'预设.xmp');await store.exportFile(own.id,exported);assert.equal((await store.importFile(exported)).name,'自己的预设');await store.rename(own.id,'已重命名','第二组');await store.update(own.id,{name:'更新',group:'第二组',groups:['color'],adjustments:{...adjustments,saturation:44}});const updated=(await store.apply(own.id,target,sync))[0];assert.equal(updated.adjustments.saturation,44);assert.equal(updated.adjustments.exposure,target.adjustments.exposure);await store.remove(own.id);assert(!(await store.list()).items.some(p=>p.id===own.id));pass('XMP preset create, import, export, rename, selective update and delete work without JSON files');
 const raster=join(out,'mask.png');execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image\nImage.new('L',(64,64),180).save(${JSON.stringify(raster)})`]);
 const masks=[{id:'raster',name:'栅格',type:'raster',enabled:true,inverted:false,feather:0,points:[],start:{x:0,y:0},end:{x:1,y:1},brightness:.5,contrast:0,saturation:0,raster:{path:raster,sha256:hash(raster),width:64,height:64}}];
 const masked=join(out,'蒙版.xmp');await saveRecipeWithMasks(e,masked,{...document,adjustments:{...adjustments,masks}},v=>documents.serialize(v));rmSync(raster);const restoredMask=await restoreRecipeMasks(e,masked,await documents.read(masked),join(out,'mask-cache'));assert.equal(hash(restoredMask.adjustments.masks[0].raster.path),masks[0].raster.sha256);pass('XMP structured mask state and content-addressed raster assets survive original asset removal');
 const original=readFileSync(saved);await assert.rejects(saveRecipeWithMasks(e,saved,document,async()=>{throw new Error('serialization failed');}));assert.deepEqual(readFileSync(saved),original);pass('failed serialization leaves the prior XMP file intact');
 for(const body of ['{}','<broken>','<!DOCTYPE x>'+fixture]){const file=join(out,'invalid.xmp');writeFileSync(file,body);await assert.rejects(documents.read(file));await assert.rejects(store.importFile(file));}pass('old JSON content, broken XML and DTD declarations are rejected');
 const cancelled=store.apply(imported.id,target,sync);store.cancel();sync.cancel();assert.equal(await cancelled,null);assert.equal(hash(source),before);assert.equal(readFileSync(external,'utf8'),fixture);pass('cancellation prevents late apply; source RAW and imported Adobe XMP remain unchanged');
 writeFileSync(join(out,'report.json'),JSON.stringify({checks,sourceSHA256:before,binarySHA256:hash(binary),scope:'Partial CRS mapping; full ART state persisted as typed RDF extension. No Adobe pixel equivalence claim.'},null,2)+'\n');
}finally{sync.cancel();await e.stop();}
