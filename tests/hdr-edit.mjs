import {Documents} from '@captraw/desktop-core/documents';
import {XMP,CRS,lookup} from '@captraw/desktop-core/xmp';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {EngineClient} from './engine-client.mjs';
const out=resolve(process.env.CAPTRAW_HDR_EDIT_OUT||'artifacts/hdr-edit'),source=resolve(process.env.CAPTRAW_HDR_SOURCE||'build/samples/synthetic.dng');mkdirSync(out,{recursive:true});const work=mkdtempSync(join(out,'run-'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),sourceHash=hash(source),checks=[],measurements=[],pass=message=>{checks.push(message);console.log('PASS',message);};let revision=0,complete=false;
const engine=new EngineClient({cache:join(work,'core')}),previous=join(homedir(),'Applications/CaptRAW-0.63.app/Contents/Resources/native'),old=new EngineClient({executable:join(previous,'captraw-engine'),resources:join(previous,'resources'),cache:join(work,'old')});
async function update(adjustments,artProfile='',linearPreview=false){const next=++revision,wait=engine.preview(next,'fit',120000),result=await engine.call('update',{revision:next,adjustments,artProfile,linearPreview});return {...result,frame:await wait};}
function stats(frame,name){
 const result=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import numpy as np,json,sys
frame=json.load(sys.stdin);p=frame['linear'];a=np.fromfile(p['file'],dtype='<f2').astype(np.float64).reshape(p['height'],p['width'],4)[:,:,:3];assert np.isfinite(a).all()
y=a@np.array([.2126,.7152,.0722]);result=dict(minimum=float(a.min()),maximum=float(a.max()),luminanceP99=float(np.quantile(y,.99)),overWhite=int(np.count_nonzero(y>1.001)))
if 'histogram' in p:
 h=p['histogram'];positive=np.maximum(a,0);encoded=np.where(positive<=.0031308,12.92*positive,1.055*positive**(1/2.4)-.055)
 coordinate=np.where(positive<1,.5*encoded,.5+.5*np.log2(np.maximum(positive,1))/h['headroom']);indices=np.clip(np.floor(coordinate*512).astype(int),0,511)
 for c in range(3):
  assert np.array_equal(np.bincount(indices[:,:,c].ravel(),minlength=512),h['bins'][c]),c
  assert h['below'][c]==int(np.count_nonzero(a[:,:,c]<0))
  assert h['above'][c]==int(np.count_nonzero(a[:,:,c]>2**h['headroom']))
 result['histogramExact']=True
print(json.dumps(result))`],{input:JSON.stringify(frame),encoding:'utf8'}));measurements.push({name,...result});return result;
}
try{
 const image=await engine.call('open',{path:source,sessionId:'hdr-edit'}),base={...image.adjustments,exposure:3},sdr=await update(base),older=await old.call('open',{path:source,sessionId:'hdr-edit'});
 let wait=old.preview(1,'fit',120000),prior=await old.call('update',{revision:1,adjustments:{...older.adjustments,exposure:3}}),priorFrame=await wait;assert.equal(hash(sdr.frame.file),hash(priorFrame.file));assert.equal(sdr.artProfile,prior.artProfile);pass('default SDR pixels and complete ART profile remain byte-identical to installed 0.63');
 const enabled={...base,hdrEnabled:true,hdrHeadroom:3},hdr=await update(enabled),hdrStats=stats(hdr.frame,'HDR 3 EV');assert.match(hdr.artProfile,/\nWhitePoint=8\n/);assert.match(hdr.artProfile,/\nCaptRAWHDREditMode=true\n/);assert.equal(hdrStats.histogramExact,true);assert(hdrStats.luminanceP99>1.1);pass('actual HDR adjustments enable native floating preview and an independently exact 512-bin extended histogram');
 const low=await update({...enabled,hdrHeadroom:1},hdr.artProfile),lowStats=stats(low.frame,'HDR 1 EV');assert.match(low.artProfile,/\nWhitePoint=2\n/);assert(hdrStats.luminanceP99>lowStats.luminanceP99+.1);pass('editing EV alone invalidates the cached processing and changes actual high-range luminance');
 const restored=await update(enabled,low.artProfile);assert.equal(hash(restored.frame.linear.file),hash(hdr.frame.linear.file));pass('restoring the HDR headroom recovers exact floating pixels');
 const grading=structuredClone(base.colorGrading);grading.global.luminance=20;const graded=await update({...enabled,colorGrading:grading},hdr.artProfile),gradedStats=stats(graded.frame,'HDR global luminance +20');assert(gradedStats.luminanceP99>hdrStats.luminanceP99);pass('peak-relative HDR grading brightens the super-white range instead of moving it toward SDR white');
 grading.global.saturation=40;grading.global.hue=40;const tinted=await update({...enabled,colorGrading:grading},hdr.artProfile);stats(tinted.frame,'HDR global tint');assert.notEqual(hash(tinted.frame.linear.file),hash(graded.frame.linear.file));pass('HDR tint produces actual finite floating changes');
 const sdrGraded=await update({...base,colorGrading:grading},sdr.artProfile);wait=old.preview(2,'fit',120000);const priorGraded=await old.call('update',{revision:2,adjustments:{...base,colorGrading:grading},artProfile:sdr.artProfile});assert.equal(hash(sdrGraded.frame.file),hash((await wait).file));assert.equal(sdrGraded.artProfile,priorGraded.artProfile);pass('non-neutral SDR grading retains exact 0.63 pixels and complete native profile');
 const legacyProfile=hdr.artProfile.replace(/\nCaptRAWHDREditMode=true\n/,'\n'),legacy=await update({...base,colorGrading:grading},legacyProfile,true);wait=old.preview(3,'fit',120000);await old.call('update',{revision:3,adjustments:{...base,colorGrading:grading},artProfile:legacyProfile});const legacyOld=await wait;assert.equal(hash(legacy.frame.file),hash(legacyOld.file));pass('legacy ART high-white-point grading keeps its previous rendered appearance without the new explicit domain marker');
 const off=await update({...base,hdrEnabled:false,hdrHeadroom:3},graded.artProfile);assert.equal(off.frame.linear,null);assert.equal(hash(off.frame.file),hash(sdr.frame.file));assert.equal(off.artProfile,sdr.artProfile);const deleted=await update(base,graded.artProfile);assert.equal(deleted.artProfile,sdr.artProfile);assert.equal(hash(deleted.frame.file),hash(sdr.frame.file));pass('disabling or removing managed HDR restores the original SDR profile and pixels without leaking cached HDR state');
 for(const patch of [{hdrEnabled:'yes'},{hdrEnabled:true,hdrHeadroom:0},{hdrEnabled:true,hdrHeadroom:4.1},{hdrEnabled:true,redCurve:[{x:0,y:0},{x:.5,y:.7},{x:1,y:1}]}])await assert.rejects(engine.call('validate',{artProfile:sdr.artProfile,adjustments:{...base,...patch}}));
 const legacyContrast=sdr.artProfile.replace(/\nWhitePoint=1\n/,'\nWhitePoint=1\nContrastLegacyMode=true\n');await assert.rejects(engine.call('validate',{artProfile:legacyContrast,adjustments:enabled}),/HDR/);pass('invalid modes, out-of-range headroom and known incompatible curves fail explicitly');
 const target=join(work,'must-not-exist.tif');await assert.rejects(engine.call('export',{path:source,artProfile:hdr.artProfile,output:target,format:'tiff',colorSpace:'srgb'}),/仅支持 SDR/);assert.equal(existsSync(target),false);pass('SDR export cannot silently clip an HDR recipe or create a misleading output');
 const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),packet='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:u="https://example.invalid/hdr/" u:Opaque="keep" crs:HDREditMode="1" crs:HDRMaxValue="2.5" crs:SDRBrightness="0.25"/></rdf:RDF></x:xmpmeta>';
 const document={source:{path:source,size:readFileSync(source).length,sha256:sourceHash},artProfile:hdr.artProfile,adjustments:enabled,xmpPacket:packet},serialized=await documents.serialize(document),properties=(await xmp.call('read',serialized)).properties;
 assert.equal(lookup(properties,CRS,'HDREditMode').value,'1');assert.equal(lookup(properties,CRS,'HDRMaxValue').value,'2.5');assert.equal(lookup(properties,CRS,'SDRBrightness').value,'0.25');assert.equal(lookup(properties,'https://example.invalid/hdr/','Opaque').value,'keep');const saved=join(work,'HDR 编辑.xmp');writeFileSync(saved,serialized);const decoded=await documents.read(saved);assert.equal(decoded.adjustments.hdrEnabled,true);assert.equal(decoded.adjustments.hdrHeadroom,3);assert.equal(decoded.artProfile,hdr.artProfile);assert(decoded.warnings.some(value=>value.includes('HDRMaxValue')&&value.includes('SDRBrightness')));pass('the actual Adobe XMP toolkit preserves unimplemented HDR/SDR fields and opaque RDF while round-tripping the supported edit state');
 const disabledPacket=await documents.serialize({...document,xmpPacket:serialized,adjustments:{...enabled,hdrEnabled:false}}),disabledProperties=(await xmp.call('read',disabledPacket)).properties;assert.equal(lookup(disabledProperties,CRS,'HDREditMode').value,'0');assert.equal(lookup(disabledProperties,CRS,'HDRMaxValue').value,'2.5');pass('disabling HDR updates its standard XMP mode without guessing or overwriting Adobe headroom units');
 const opened=await engine.call('open',{path:source,sessionId:'fresh'}),fresh=await update(opened.adjustments);assert.equal(fresh.frame.linear,null);assert.equal(hash(source),sourceHash);pass('a fresh image clears HDR state and leaves the source unchanged');complete=true;
}finally{
 await engine.stop();await old.stop();writeFileSync(join(out,'report.json'),JSON.stringify({complete,checks,measurements,sourceHash,engineSHA256:hash(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),nativeSandboxed:false,hdrFeatureAccepted:false,physicalDisplayVerified:false,...(!complete?{work}:{})},null,2)+'\n');if(complete)rmSync(work,{recursive:true,force:true});else console.error('Failure workspace:',work);
}
