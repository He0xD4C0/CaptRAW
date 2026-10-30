import {EngineClient} from '../../support/engine-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync,cpSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=resolve('artifacts/camera-crop');mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const engine=new EngineClient({cache:'build/camera-crop-cache'});
engine.on('error',()=>{});let revision=0;const results=[],checks=[];
const reference=resolve('build/reference/Contents/MacOS/captraw-art-reference');
mkdirSync(resolve('build/reference/Contents/MacOS'),{recursive:true});cpSync('build/native/captraw-art-reference',reference);
mkdirSync(resolve('build/reference/settings'),{recursive:true});cpSync('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/data/options/options.osx','build/reference/settings/options');
if(!existsSync(resolve('build/reference/Contents/Resources')))symlinkSync(resolve('build/native/resources'),resolve('build/reference/Contents/Resources'));
const pass=s=>{checks.push(s);console.log('PASS',s);};
const manifest=JSON.parse(readFileSync('build/upstream/redlamp-libraw-3b20539d3faa766a370e93a529a3b87edffbf0f6/redlamp/bench/samples.json'));
const sources=manifest.samples.filter(s=>['HE','HE*'].includes(s.mode)).map(s=>resolve('build/samples/nikon-he',s.name+'.NEF')).filter(existsSync);sources.push(resolve('build/samples/nikon-d850.NEF'));
async function render(client,image,adjustments=image.adjustments){const next=++revision,p=client.preview(next);const r=await client.call('update',{revision:next,adjustments});return {profile:r.artProfile,frame:await p};}
try{
 const metadata=JSON.parse(execFileSync('exiftool',['-j','-n','-CropArea','-Orientation',...sources],{encoding:'utf8'}));
 for(const m of metadata){const source=m.SourceFile,before=hash(source),image=await engine.call('open',{path:source,sessionId:source});assert.equal(image.baselineVersion,4);assert(image.cameraCrop,'Missing camera crop: '+source);assert.deepEqual(image.cameraCrop,image.adjustments.crop);
  const area=m.CropArea.split(' ').map(Number),actual=[Math.round(image.cameraCrop.width*image.width),Math.round(image.cameraCrop.height*image.height)],expected=[area[2],area[3]];if([6,8].includes(m.Orientation))expected.reverse();assert.deepEqual(actual,expected,source);
  results.push({source,sha256:before,orientation:m.Orientation,tag:area,usable:[image.width,image.height],crop:image.cameraCrop,output:actual,sourceUnchanged:hash(source)===before});
 }
 pass('camera tag dimensions agree for every available Nikon sample, including D850');
 const source=resolve('build/samples/nikon-he/Z5_2_3x2_HE_196971ea.NEF'),image=await engine.call('open',{path:source,sessionId:'fresh'}),initial=await render(engine,image);
 cpSync(initial.frame.file,join(out,'fresh.png'));writeFileSync(join(out,'fresh.arp'),initial.profile);
 // Metadata-only copies exercise EXIF orientation without modifying the original RAW.
 for(const [orientation,rotation] of [[6,90],[3,180],[8,270]]){
  const copy=join(out,'orientation-'+orientation+'.NEF');cpSync(source,copy);execFileSync('exiftool',['-overwrite_original','-Orientation#='+orientation,copy],{stdio:'pipe'});
  const r=await engine.call('open',{path:copy,sessionId:String(orientation)}),c=image.cameraCrop,expected=rotation===90?{x:1-c.y-c.height,y:c.x,width:c.height,height:c.width}:rotation===180?{x:1-c.x-c.width,y:1-c.y-c.height,width:c.width,height:c.height}:{x:c.y,y:1-c.x-c.width,width:c.height,height:c.width};
  for(const k of Object.keys(expected))assert(Math.abs(r.cameraCrop[k]-expected[k])<1e-12,'EXIF '+rotation+' '+k);
 }
 pass('90, 180 and 270 degree EXIF orientations retain the correct sensor crop');
 const reopened=await engine.call('open',{path:source,sessionId:'export'});for(const rotation of [0,90]){
  const rendered=await render(engine,reopened,{...reopened.adjustments,rotation}),file=join(out,'crop-'+rotation+'.tiff'),profile=join(out,'crop-'+rotation+'.arp');
  await engine.call('export',{path:source,artProfile:rendered.profile,output:file,format:'tiff'});writeFileSync(profile,rendered.profile);
  execFileSync(reference,['-a','-o',join(out,'art-reference-'+rotation+'.tif'),'-p',profile,'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:'pipe'});
  const meta=JSON.parse(execFileSync('exiftool',['-j','-n','-ImageWidth','-ImageHeight','-BitsPerSample',file],{encoding:'utf8'}))[0];assert.equal(meta.ImageWidth,rotation?2656:3984);assert.equal(meta.ImageHeight,rotation?3984:2656);
 }
 execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np
from pathlib import Path
p=Path(${JSON.stringify(out)})
for r in (0,90):
 a=tifffile.imread(p/f'crop-{r}.tiff');b=tifffile.imread(p/f'art-reference-{r}.tif')
 assert a.dtype==np.uint16 and np.array_equal(a,b)
 with tifffile.TiffFile(p/f'crop-{r}.tiff') as f: assert f.pages[0].bitspersample==16 and 34675 in f.pages[0].tags
`]);pass('cropped 16-bit ICC exports have exact camera dimensions and zero pixel difference from the fixed ART CLI using the same profile');
 for(const file of ['canon-r5.CR3','fuji-xt4.RAF','synthetic.dng']){const r=await engine.call('open',{path:resolve('build/samples',file),sessionId:file});assert.equal(r.cameraCrop,null);assert.equal(r.adjustments.crop,null);}
 pass('non-Nikon inputs retain their original usable area');
 for(const baselineVersion of [2,3,5])await assert.rejects(engine.call('open',{path:source,sessionId:'bad',baselineVersion}),/Unsupported baseline/);
 pass('obsolete baselines are rejected instead of silently changing camera framing');
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',checks,results},null,2)+'\n');
}finally{await engine.stop();}
