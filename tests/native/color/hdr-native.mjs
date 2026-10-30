import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {EngineClient} from '../../support/engine-client.mjs';
const out=resolve(process.env.CAPTRAW_HDR_NATIVE_OUT||'artifacts/hdr-native');mkdirSync(out,{recursive:true});const work=mkdtempSync(join(out,'run-'));
const source=resolve(process.env.CAPTRAW_HDR_SOURCE||'build/samples/synthetic.dng'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source);
const engine=new EngineClient({cache:join(work,'core')}),python=resolve('build/qa-venv/bin/python'),checks=[],pass=message=>{checks.push(message);console.log('PASS',message);};let complete=false;const results=[];
const change=(profile,group,key,value)=>{
 const start=profile.indexOf('['+group+']'),end=profile.indexOf('\n[',start);assert(start>=0,group);const section=profile.slice(start,end<0?undefined:end),pattern=new RegExp('(^|\\n)'+key+'=[^\\n]*');assert(pattern.test(section),key);
 return profile.slice(0,start)+section.replace(pattern,(_match,prefix)=>prefix+key+'='+value)+(end<0?'':profile.slice(end));
};
try{
 const root=join(work,'reference'),mac=join(root,'Contents/MacOS'),binary=join(mac,'captraw-art-reference');mkdirSync(mac,{recursive:true});mkdirSync(join(root,'settings'));symlinkSync(resolve('build/bundle/native/lib'),join(mac,'lib'));symlinkSync(resolve('build/bundle/native/resources'),join(root,'Contents/Resources'));copyFileSync('build/native/captraw-art-reference',binary);
 copyFileSync('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/data/options/options.osx',join(root,'settings/options'));
 const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:4*1024*1024});
 for(const dependency of run('otool',['-L',binary]).split('\n').slice(1).map(line=>line.trim().split(' (')[0]).filter(Boolean)){
  if(dependency.startsWith('/System/Library/')||dependency.startsWith('/usr/lib/'))continue;
  assert(existsSync(join(mac,'lib',basename(dependency))),dependency);run('install_name_tool',['-change',dependency,'@loader_path/lib/'+basename(dependency),binary]);
 }
 for(const match of run('otool',['-l',binary]).matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g))if(match[1].startsWith('/opt/')||match[1].startsWith('/Users/'))run('install_name_tool',['-delete_rpath',match[1],binary]);run('codesign',['--force','--sign','-',binary]);
 const image=await engine.call('open',{path:source,sessionId:'hdr-probe'}),adjustments={...image.adjustments,exposure:3};
 const wheel={hue:0,saturation:0,luminance:0},grade={shadows:{hue:220,saturation:30,luminance:0},midtones:wheel,highlights:wheel,global:{hue:40,saturation:10,luminance:20},blending:50,balance:0};
 const cases=[{name:'sdr-white-1',white:1},{name:'hdr-white-8',white:8},{name:'hdr-half-white-8',white:8,half:true},{name:'hdr-point-curve',white:8,patch:{curve:[{x:0,y:0},{x:.45,y:.65},{x:1,y:1}]}},{name:'hdr-color-grading',white:8,patch:{colorGrading:grade}},{name:'hdr-local-exposure',white:8,patch:{masks:[{id:'hdr-radial',name:'radial',type:'radial',enabled:true,inverted:false,initialized:true,referenceAngle:0,feather:30,brightness:1,contrast:0,saturation:0,points:[],start:{x:.2,y:.2},end:{x:.8,y:.8}}]}}];
 for(const test of cases){
  const composed=await engine.call('compose',{path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:{...adjustments,...test.patch}});
  let profile=change(composed.artProfile,'ToneCurve','WhitePoint',test.white);profile=change(profile,'Color Management','OutputProfile','RTv4_Linear_Rec709');profile=change(profile,'Color Management','OutputBPC','false');
  for(const [key,value] of Object.entries({Enabled:'true',DataSpecified:3,Width:2048,Height:2048,AllowUpscaling:'false'}))profile=change(profile,'Resize',key,value);
  const path=join(work,test.name+'.arp'),output=join(work,test.name+'.tif');writeFileSync(path,profile);
  let log;
  try{log=execFileSync('/usr/bin/sandbox-exec',['-f',resolve('tests/support/offline-native.sb'),binary,'-a','-o',output,'-p',path,'-t',test.half?'-b16f':'-b32','-Y','-c',source],{encoding:'utf8',maxBuffer:4*1024*1024,env:{...process.env,OMP_NUM_THREADS:'8',ART_SETTINGS:join(root,'settings'),ART_CACHE:join(root,'cache')}});}
  catch(error){writeFileSync(join(work,test.name+'.log'),String(error.stdout||'')+String(error.stderr||''));throw error;}
  writeFileSync(join(work,test.name+'.log'),log);
  const stats=JSON.parse(execFileSync(python,['-c',`import tifffile,numpy as np,json,sys,io
from PIL import ImageCms
a=tifffile.imread(sys.argv[1]);assert a.dtype in [np.float32,np.float16] and np.isfinite(a).all()
with tifffile.TiffFile(sys.argv[1]) as t:
 tags=t.pages[0].tags;icc=tags[34675].value;sample_format=tags[339].value
description=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip();y=a.astype(np.float64)@np.array([.2126,.7152,.0722])
print(json.dumps(dict(shape=list(a.shape),dtype=str(a.dtype),minimum=float(a.min()),maximum=float(a.max()),overWhiteThreshold=1.001,overWhiteChannels=int(np.count_nonzero(a>1.001)),overWhiteUniqueValues=int(np.unique(a[a>1.001]).size),luminanceMaximum=float(y.max()),luminanceP99=float(np.quantile(y,.99)),overWhiteLuminancePixels=int(np.count_nonzero(y>1.001)),iccBytes=len(icc),iccDescription=description,sampleFormat=list(sample_format) if isinstance(sample_format,tuple) else int(sample_format))))`,output],{encoding:'utf8'}));
  assert.equal(stats.iccDescription,'Linear Rec.709');assert(stats.shape[0]<=2048&&stats.shape[1]<=2048);
  results.push({name:test.name,whitePoint:test.white,...stats,profileSHA256:hash(path),outputSHA256:hash(output)});console.log(test.name,JSON.stringify(stats));
  if(test.name==='hdr-white-8')copyFileSync(output,join(out,'linear-rec709-hdr-f32.tif'));
  if(test.name==='hdr-half-white-8')copyFileSync(output,join(out,'linear-rec709-hdr-f16.tif'));
 }
 // Gamut conversion and post-curve resizing can overshoot even with white point 1.
 // A single RGB channel above 1 is therefore insufficient evidence of HDR.
 assert(results[1].luminanceP99>results[0].luminanceP99+.1&&results[1].overWhiteLuminancePixels>results[0].overWhiteLuminancePixels+100&&results[1].overWhiteUniqueValues>100,'Raising the white point must extend actual luminance beyond the SDR control, not just create out-of-gamut RGB channels');pass('raising the pinned ART white point extends high-percentile luminance and preserves distinct super-white float values relative to the SDR control');
 const effects=JSON.parse(execFileSync(python,['-c',`import tifffile,numpy as np,json,sys
base=tifffile.imread(sys.argv[1]);result=[]
for path in sys.argv[2:]:
 a=tifffile.imread(path);delta=np.abs(a-base);assert np.any(delta>1e-5) and np.count_nonzero(a>1.001)>100
 result.append(dict(changedChannels=int(np.count_nonzero(delta>1e-5)),maximumDifference=float(delta.max())))
print(json.dumps(result))`,join(work,'hdr-white-8.tif'),...['hdr-point-curve','hdr-color-grading','hdr-local-exposure'].map(name=>join(work,name+'.tif'))],{encoding:'utf8'}));
 pass('point curves, existing SDR grading and radial local adjustment change actual float pixels without eliminating all headroom; HDR semantics remain unverified');
 const error=JSON.parse(execFileSync(python,['-c',`import tifffile,numpy as np,json,sys
a=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);nearest=a.astype(np.float16);expected=nearest.copy();ties=0
# ART DNG_FloatToHalf rounds midpoint ties away from zero, NumPy ties to even.
for direction,sign in [(np.inf,1),(-np.inf,-1)]:
 neighbor=np.nextafter(nearest,np.float16(direction));midpoint=(nearest.astype(np.float64)+neighbor.astype(np.float64))/2
 mask=(a*sign>0)&(a.astype(np.float64)==midpoint);expected[mask]=neighbor[mask];ties+=int(mask.sum())
assert np.array_equal(expected,b)
print(json.dumps(dict(maximumHalfQuantizationError=float(np.max(np.abs(a.astype(np.float64)-b.astype(np.float64)))),halfTiesAwayFromZero=ties,halfConversionExact=True)))`,join(work,'hdr-white-8.tif'),join(work,'hdr-half-white-8.tif')],{encoding:'utf8'}));
 pass('float16 output exactly matches the float32 reference quantized with ART midpoint-tie semantics and retains headroom');assert.equal(hash(source),sourceHash);complete=true;
 writeFileSync(join(out,'report.json'),JSON.stringify({probeComplete:true,hdrFeatureAccepted:false,checks,source,sourceHash,artCommit:'1e0e12c62e4f329d30bb5624d62a23a663ffbe6b',cliSandboxed:true,results,effects,...error,scope:'Pinned patched ART CLI with a generated current-core profile, resized within 2048 pixels after RAW processing; not the installed CaptRAW export API, HDR GUI or physical HDR display acceptance. A white point of 1 can still produce output-channel and luminance overshoots after gamut conversion/resizing; single maxima are not HDR evidence. Grading still uses the experimental SDR algorithm.'},null,2)+'\n');
}finally{await engine.stop();if(complete)rmSync(work,{recursive:true,force:true});else{writeFileSync(join(out,'report.json'),JSON.stringify({probeComplete:false,hdrFeatureAccepted:false,checks,results,sourceHash,work},null,2)+'\n');console.error('Failure workspace:',work);}}
