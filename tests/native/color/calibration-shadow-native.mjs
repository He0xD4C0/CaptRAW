import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CRS,lookup,encodeAdjustments} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {ENGINE_VERSION} from '@captraw/contracts';
const root=await mkdtemp(join(tmpdir(),'captraw-shadow-native-')),checks=[];
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const engine=new EngineClient({cache:join(root,'engine')}),sync=new Synchronizer(binary,resources,join(root,'sync'),()=>{});
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),store=new Presets(join(root,'presets'),engine,join(root,'assets'),xmp);
const sha=b=>createHash('sha256').update(b).digest('hex'),neutral={redHue:0,redSaturation:0,greenHue:0,greenSaturation:0,blueHue:0,blueSaturation:0};
const pass=s=>{checks.push(s);console.log('PASS',s);};let success=false;
async function render(path,adjustments,profile=''){
 const image=await engine.call('open',{path,sessionId:'shadow'}),result=await engine.call('compose',{path,width:image.width,height:image.height,adjustments:adjustments||image.adjustments,artProfile:profile||image.artProfile});
 const output=join(root,'render.tiff');await engine.call('export',{path,artProfile:result.artProfile,output,format:'tiff'});
 const pixels=JSON.parse(execFileSync('build/qa-venv/bin/python',['-c','import sys,json,hashlib,tifffile;a=tifffile.imread(sys.argv[1]);assert str(a.dtype)=="uint16";print(json.dumps({"sha256":hashlib.sha256(a.tobytes()).hexdigest(),"shape":list(a.shape),"dtype":str(a.dtype)}))',output],{encoding:'utf8'}));
 return {...result,image,pixels,output};
}
try{
 assert((await readFile(binary)).includes(Buffer.from('CaptRAWShadowTint')),'Main thread must build the new shadow-calibration native code before this test.');
 const baseline=JSON.parse(await readFile('artifacts/stage-0/acr-reference/calibration-shadow-baseline.json','utf8'));
 for(const sample of baseline.samples){
  assert.equal(sha(await readFile(sample.path)),sample.sourceSHA256);const path=join(root,sample.path.endsWith('.dng')?'旧 RAW.dng':'旧 图像.png');await copyFile(sample.path,path);
  const absent=await render(path);assert.deepEqual(absent.pixels,sample.pixels);assert(!absent.artProfile.includes('CaptRAWShadowTint='));
  const zero=await render(path,{...absent.image.adjustments,calibration:{...neutral,shadowTint:0}});assert.deepEqual(zero.pixels,sample.pixels);assert(!zero.artProfile.includes('CaptRAWShadowTint='));
 }
 pass('absent and explicit zero keep exact pre-change TIFF16 pixels for RAW and rendered input');
 const input=join(root,'灰阶.png');execFileSync('build/qa-venv/bin/python',['-c','import sys,numpy as np;from PIL import Image,ImageCms;a=np.broadcast_to(np.linspace(0,255,256,dtype=np.uint8)[None,:,None],(64,256,3));Image.fromarray(a).save(sys.argv[1],icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())',input]);
 const base=await render(input);await copyFile(base.output,join(root,'baseline.tiff'));
 const shifted={...base.image.adjustments,calibration:{...neutral,shadowTint:75}},positive=await render(input,shifted);await copyFile(positive.output,join(root,'positive.tiff'));
 assert.match(positive.artProfile,/CaptRAWShadowTint=75/);assert.notEqual(positive.pixels.sha256,base.pixels.sha256);
 const projected=await engine.call('adjustmentBase',{artProfile:positive.artProfile,groups:['calibration']});assert.equal(projected.calibration.shadowTint,75);
 assert.deepEqual((await render(input,{...base.image.adjustments,...projected},positive.artProfile)).pixels,positive.pixels);
 await render(input,{...shifted,calibration:{...neutral,shadowTint:-75}});await copyFile(join(root,'render.tiff'),join(root,'negative.tiff'));
 execFileSync('build/qa-venv/bin/python',['-c',`import sys,numpy as np,tifffile;from pathlib import Path
p=Path(sys.argv[1]);b=tifffile.imread(p/'baseline.tiff').astype(float);pos=tifffile.imread(p/'positive.tiff').astype(float);neg=tifffile.imread(p/'negative.tiff').astype(float)
def tint(a):return (a[:,:,0]+a[:,:,2])/2-a[:,:,1]
assert np.mean(tint(pos)[:,32:96]-tint(b)[:,32:96])>0
assert np.mean(tint(neg)[:,32:96]-tint(b)[:,32:96])<0
dark=np.mean(np.abs(pos[:,32:64]-b[:,32:64]))/max(1,np.mean(b[:,32:64]));bright=np.mean(np.abs(pos[:,192:224]-b[:,192:224]))/max(1,np.mean(b[:,192:224]));assert dark>bright
`,root]);
 for(const shadowTint of [-101,101,.5])await assert.rejects(engine.call('compose',{path:input,width:base.image.width,height:base.image.height,artProfile:base.artProfile,adjustments:{...shifted,calibration:{shadowTint}}}),/shadowTint|Calibration/);
 pass('positive/negative ART shadow chroma changes actual pixels, is stronger relative to shadows, persists and rejects invalid values');
 const live=await engine.call('open',{path:input,sessionId:'history'});
 const fit=async(revision,adjustments)=>{const pending=engine.preview(revision);await engine.call('update',{revision,adjustments,artProfile:''});return sha(await readFile((await pending).file));};
 const original=await fit(1,live.adjustments);assert.notEqual(await fit(2,{...live.adjustments,calibration:{shadowTint:75}}),original);assert.equal(await fit(3,live.adjustments),original);
 pass('undo to a legacy snapshot without calibration and without an ARP clears the previous native shadow tint');
 const raw=join(root,'照片 一.dng'),other=join(root,'照片 二.dng');await copyFile('build/samples/synthetic.dng',raw);await copyFile(raw,other);
 const first=await render(raw),firstAdjustments={...first.image.adjustments,calibration:{...neutral,shadowTint:-20,redHue:9}},firstProfile=(await engine.call('compose',{path:raw,width:first.image.width,height:first.image.height,adjustments:firstAdjustments,artProfile:first.artProfile})).artProfile;
 const targets=[{image:{...first.image,path:raw},profile:firstProfile,adjustments:firstAdjustments},{image:{...first.image,path:other,id:'other'},profile:firstProfile,adjustments:{...firstAdjustments,calibration:{...firstAdjustments.calibration,blueHue:12}}}];
 const packet=await xmp.call('write','',encodeAdjustments({calibration:{shadowTint:33}})),presetFile=join(root,'阴影.xmp');await writeFile(presetFile,packet.packet);
 const preset=await store.importFile(presetFile),result=await store.applyMany({id:preset.id,targets,operationId:'shadow'},sync);assert.equal(result.results.length,2);
 for(const row of result.results){const before=targets.find(t=>t.image.path===row.path);assert.deepEqual(row.adjustments.calibration,{...before.adjustments.calibration,shadowTint:33});assert.match(row.profile,/CaptRAWShadowTint=33/);}
 const exported=join(root,'预设导出.xmp');await store.exportFile(preset.id,exported);assert.equal(lookup((await xmp.read(exported)).properties,CRS,'ShadowTint').value,'33');
 const red=await xmp.call('write','',encodeAdjustments({calibration:{redHue:17}})),redPath=join(root,'原色.xmp');await writeFile(redPath,red.packet);const sparse=await store.importFile(redPath),applied=await store.applyMany({id:sparse.id,targets,operationId:'sparse'},sync);assert(applied.results.every(r=>r.adjustments.calibration.shadowTint===-20));
 const document={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:input,size:(await readFile(input)).length,sha256:sha(await readFile(input))},artProfile:positive.artProfile,adjustments:shifted},saved=join(root,'保存.xmp');await writeFile(saved,await documents.serialize(document));
 const reopened=await documents.read(saved);assert.equal(reopened.adjustments.calibration.shadowTint,75);assert.deepEqual((await render(input,reopened.adjustments,reopened.artProfile)).pixels,positive.pixels);
 pass('standard XMP, sparse multi-photo presets/sync preserve other calibration fields and document reopening reproduces TIFF16 pixels');
 success=true;
}finally{sync.cancel();await engine.stop();if(engine.child.exitCode===null&&engine.child.signalCode===null)await new Promise(done=>engine.child.once('exit',done));if(success)await rm(root,{recursive:true,force:true});else console.error('Retained shadow native failure:',root);}
