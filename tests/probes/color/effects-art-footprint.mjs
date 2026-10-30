import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {EngineClient} from '../../support/engine-client.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-art-grain-')),python=process.env.CAPTRAW_PYTHON||resolve('build/qa-venv/bin/python');
const width=Number(process.env.CAPTRAW_GRAIN_WIDTH||3072),height=Number(process.env.CAPTRAW_GRAIN_HEIGHT||2048);
const repeats=Number(process.env.CAPTRAW_GRAIN_REPEATS||1);assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=50,'CAPTRAW_GRAIN_REPEATS must be 1–50');
const source=join(work,'flat.tif'),engine=new EngineClient({cache:join(work,'cache'),env:{OMP_NUM_THREADS:'8'}});let success=false,revision=0;
const py=(code,...args)=>execFileSync(python,['-c',code,...args.map(String)],{encoding:'utf8',maxBuffer:1024*1024});
try{
 py(`import numpy as np,tifffile,sys
tifffile.imwrite(sys.argv[1],np.full((int(sys.argv[3]),int(sys.argv[2]),3),45000,np.uint16),photometric='rgb')`,source,width,height);
 const t=performance.now(),image=await engine.call('open',{path:source,sessionId:'footprint',effectsDefaults:'current'});let lastProfile=image.artProfile;
 async function render(name,adjustments){const start=performance.now(),r=++revision,preview=engine.preview(r,'fit',120000);const result=await engine.call('update',{revision:r,adjustments,artProfile:lastProfile,linearPreview:true});const frame=await preview;lastProfile=result.artProfile;assert(frame.linear);copyFileSync(frame.linear.file,join(work,name+'.rgba16f'));return {result,frame,ms:performance.now()-start};}
 const base=await render('base',image.adjustments),firstMs=performance.now()-t;
 const measurements=[];
 const linearProfile=p=>p.replace(/(\nOutputProfile=)[^\n]+/,'$1RTv4_Linear_Rec709').replace(/(\nOutputBPC=)[^\n]+/,'$1false');
 async function output(name,profile,linear){const start=performance.now();await engine.call('export',{path:source,artProfile:linear?linearProfile(profile):profile,format:'tiff',output:join(work,name+'.tif'),...(linear?{}:{colorSpace:'srgb'})});return performance.now()-start;}
 await output('base',base.result.artProfile,true);
 for(const [size,roughness] of [[5,0],[25,50],[80,100]]){
  const a={...image.adjustments,grain:10,grainSize:size,grainRoughness:roughness};
  const fit=await render('fit',a),samplesMs=[fit.ms];
  for(let i=1;i<repeats;++i){
   // Alternate an actual adjustment; timing an unchanged document only measures cache reuse.
   const sample=await render('timing',{...a,grain:i%2?11:10});samplesMs.push(sample.ms);
  }
  if(repeats>1)await render('restored',a);
  const ordered=[...samplesMs].sort((a,b)=>a-b),fitP95Ms=ordered[Math.ceil(.95*ordered.length)-1];
  const exportMs=await output('grain',fit.result.artProfile,true);
  const detailPending=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,x:733,y:511,width:192,height:128});const detail=await detailPending;assert(detail.linear);copyFileSync(detail.linear.file,join(work,'detail.rgba16f'));
  const result=JSON.parse(py(`import numpy as np,tifffile,json,sys
from PIL import Image
from PIL.ImageCms import ImageCmsProfile
root,w,h,fw,fh,dw,dh,dx,dy=sys.argv[1:];w,h,fw,fh,dw,dh,dx,dy=map(int,[w,h,fw,fh,dw,dh,dx,dy])
def t(name):
 with tifffile.TiffFile(root+'/'+name+'.tif') as f:
  assert f.pages[0].dtype==np.uint16;icc=f.pages[0].tags[34675].value;assert len(icc)>128
 return tifffile.imread(root+'/'+name+'.tif').astype(np.float64)/65535
def raw(name,w,h):return np.fromfile(root+'/'+name+'.rgba16f',dtype='<f2').reshape(h,w,4)[:,:,:3].astype(np.float64)
b=t('base');g=t('grain');skip=w//fw;assert w==fw*skip and h==fh*skip
reference=(g-b).reshape(fh,skip,fw,skip,3).mean(axis=(1,3))
fitImage=raw('fit',fw,fh);fit=fitImage-raw('base',fw,fh)
imageReference=g.reshape(fh,skip,fw,skip,3).mean(axis=(1,3))
absoluteError=float(np.max(np.abs(fitImage-imageReference)))
quantizationBound=float(np.max(np.abs(np.spacing(imageReference.astype(np.float16)).astype(float))))/2+2/65535
# Exclude outer pixels for the input resampler's border handling.
r=reference[4:-4,4:-4,1];f=fit[4:-4,4:-4,1]
def stats(a):
 a=a-a.mean();var=np.mean(a*a);corr=np.mean(a[:,1:]*a[:,:-1])/var
 spectrum=np.abs(np.fft.rfft2(a))**2;fy=np.fft.fftfreq(a.shape[0])[:,None];fx=np.fft.rfftfreq(a.shape[1])[None,:]
 return dict(rms=float(np.sqrt(var)),correlation=float(corr),length=float(np.sqrt(2*var/np.mean(np.diff(a,axis=1)**2))),highFrequencyEnergy=float(spectrum[(fx*fx+fy*fy)>.35**2].sum()/spectrum.sum()))
rs,fs=stats(r),stats(f);ratio=fs['rms']/rs['rms'];error=float(np.sqrt(np.mean((r-f)**2))/rs['rms'])
d=raw('detail',dw,dh);delta=np.abs(d-g[dy:dy+dh,dx:dx+dw])
result=dict(skip=skip,reference=rs,fit=fs,rmsRatio=ratio,relativePixelError=error,detailMaxError=float(delta.max()),absoluteFitMaxError=absoluteError,quantizationBound=quantizationBound,linearICC=True)
print(json.dumps(result))
assert abs(ratio-1)<.03,result
assert absoluteError<=quantizationBound,result
assert abs(fs['highFrequencyEnergy']-rs['highFrequencyEnergy'])<.01,result
assert abs(fs['length']/rs['length']-1)<.03,result
assert delta.max()<.001,result`,work,width,height,fit.frame.width,fit.frame.height,detail.linear.width,detail.linear.height,detail.x,detail.y));
  measurements.push({size,roughness,fitMs:fit.ms,fitSamplesMs:samplesMs,fitP95Ms:repeats>=20?fitP95Ms:null,exportMs,...result});
 }
 await output('srgb',base.result.artProfile,false);
 const srgb=JSON.parse(py(`from PIL import ImageCms
import tifffile,io,json,sys
with tifffile.TiffFile(sys.argv[1]) as f:
 p=f.pages[0];assert p.dtype.name=='uint16';icc=p.tags[34675].value;name=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip();assert 'sRGB' in name
 print(json.dumps(dict(bits=16,icc=name)))`,join(work,'srgb.tif')));
 console.log(JSON.stringify({width,height,repeats,performanceNote:repeats>=20?'Requires an exclusive performance window; timings are not accepted during concurrent testing.':'Single samples only; not P95 acceptance.',firstMs,srgb,measurements},null,2));success=true;
}finally{await engine.stop();if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
