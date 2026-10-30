// Numerical source fixture only: no native executable, compiler, contracts/dist,
// renderer or upstream mutation. Reuses the read-only ART equation ports.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function compareCurveRefineChains(){
 const diagnostic=readFileSync(new URL('../probes/color/curve-refine-native-candidates.mjs',import.meta.url),'utf8');
 const start=diagnostic.indexOf(' def srgb_encode('),end=diagnostic.indexOf(' def scalar_metrics(',start);
 if(start<0||end<0)throw new Error('Missing read-only ART equation ports');
 const ports=diagnostic.slice(start,end).split('\n').map(line=>line.startsWith(' ')?line.slice(1):line).join('\n');
 return JSON.parse(execFileSync(process.env.CAPTRAW_CURVE_REFINE_PYTHON||resolve('build/qa-venv/bin/python'),['-c',`import numpy as np,json
${ports}
# ART iptonecurve.cc::ContrastCurve/get_contrast_curve/DoubleCurve and
# curves.cc::ToneCurve::Set. All cases retain nonzero actual Contrast math.
def contrast_curve(amount):
 pivot=.18;c=(abs(amount)/100)**1.5*16;b=1+c if amount>0 else 1/(1+c)
 a=np.log((np.exp(np.log(b)*pivot)-1)/(b-1))/np.log(pivot)
 return lambda x:np.log(np.maximum(np.minimum(x,1),0)**a*(b-1)+1)/np.log(b)
def tone_lut(curve):
 return curve(np.arange(65536,dtype=np.float32)/np.float32(65535)).astype(np.float32)*np.float32(65535)
def apply_lut(lut,pixels):return lookup(lut,np.asarray(pixels,dtype=np.float32))
def triangle(a,a1,b,black=0.,white=65535.):
 out=a1.copy();neq=a!=b;lower=neq&(b<a);upper=neq&~lower;d=a1-a
 out[lower]=b[lower]+d[lower]*b[lower]/a[lower]
 out[upper]=b[upper]+d[upper]*(np.float32(65535)-b[upper])/(np.float32(65535)-a[upper])
 if black!=0. or white!=65535.:
  t=b[lower].astype(np.float64)/a[lower];out[lower]=((1-t)*black+t*a1[lower]).astype(np.float32)
  t=(65535.-b[upper].astype(np.float64))/(65535.-a[upper]);out[upper]=((1-t)*white+t*a1[upper]).astype(np.float32)
 return out
def weighted(lut,pixels,legacy=False):
 original=np.clip(pixels,0,65535);own=apply_lut(lut,original);terms=[]
 for channel in range(3):
  columns=[]
  for anchor in range(3):
   value=triangle(original[:,anchor],own[:,anchor],original[:,channel],*([] if legacy else [float(lut[0]),float(lut[-1])]))
   columns.append(value*np.float32(.5 if channel==anchor else .25))
  value=columns[0]+columns[1]+columns[2]
  terms.append(np.clip(value,0,65535) if legacy or (lut[0]==0 and lut[-1]==65535) else value)
 return np.stack(terms,axis=1).astype(np.float32)
def refine(lut,pixels,amount):
 # Same baseline/delta specification as the frozen kernel; clamp only the
 # compensation coordinates, never the original STD output.
 baseline=apply_lut(lut,pixels);c=np.clip(pixels,0,65535)
 delta=weighted(lut,c)-apply_lut(lut,c);strength=np.float32(amount/100)
 bypass=(pixels[:,0]==pixels[:,1])&(pixels[:,1]==pixels[:,2])
 if amount==0:bypass[:]=True
 active=(delta!=0)&~bypass[:,None]&np.isfinite(pixels).all(axis=1)[:,None]&np.isfinite(baseline).all(axis=1)[:,None]&np.isfinite(delta).all(axis=1)[:,None]
 result=baseline.copy();result[active]+=strength*delta[active]
 return result
points=lambda values:[dict(x=x/255,y=y/255) for x,y in values]
medium=catmull(points([(0,0),(32,22),(64,56),(128,128),(192,196),(255,255)]),G,IG,raw_curve=True)
strong=catmull(points([(0,0),(32,16),(64,50),(128,128),(192,202),(255,255)]),G,IG,raw_curve=True)
identity=lambda x:x
gray=np.arange(65535,dtype=np.float32)+np.float32(.25)
rgb=np.array([[.02,.1,.3],[.18,.21,.22],[.7,.5,.2],[.94,.88,.82]],dtype=np.float32)*np.float32(65535)
rows=[]
for contrast,primary,second,label in [(25,medium,identity,'Contrast25/Medium/identity2'),(25,medium,strong,'Contrast25/Medium/Strong2'),(-40,strong,medium,'Contrast-40/Strong/Medium2')]:
 cc=contrast_curve(contrast);c= tone_lut(cc);p=tone_lut(primary);q=tone_lut(second)
 combined=tone_lut(lambda x:second(primary(cc(x))))
 baseline=apply_lut(combined,gray)
 separated=apply_lut(q,apply_lut(p,apply_lut(c,gray)))
 drift=separated.astype(np.float64)-baseline
 original=apply_lut(combined,rgb);pre=apply_lut(c,rgb);std=apply_lut(p,pre);after_std=apply_lut(q,std)
 gray_rgb=np.repeat(gray[:,None],3,axis=1);gray_pre=apply_lut(c,gray_rgb);gray_std=apply_lut(p,gray_pre)
 amounts=[]
 for amount in [0,.0001,1,50,100]:
  mixed=refine(p,pre,amount)
  delta=apply_lut(q,mixed)-after_std
  anchored=np.where(delta==0,original,original+delta).astype(np.float32)
  if amount==0:assert np.array_equal(anchored.view(np.uint32),original.view(np.uint32))
  gray_mix=refine(p,gray_pre,amount)
  gray_delta=apply_lut(q,gray_mix)-apply_lut(q,gray_std)
  gray_baseline=np.repeat(baseline[:,None],3,axis=1)
  anchored_gray=np.where(gray_delta==0,gray_baseline,gray_baseline+gray_delta).astype(np.float32)
  assert np.array_equal(anchored_gray.view(np.uint32),gray_baseline.view(np.uint32))
  amounts.append(dict(amount=amount,anchoredRGBMaxChange16=float(np.abs(anchored-original).max()),anchoredGrayChangedSamples=int(np.count_nonzero(np.any(anchored_gray!=gray_baseline,axis=1)))))
 rows.append(dict(case=label,graySamples=len(gray),oldDraftGrayMAE16=float(np.abs(drift).mean()),oldDraftGrayMax16=float(np.abs(drift).max()),oldDraftGrayChangedSamples=int(np.count_nonzero(drift)),amounts=amounts))
# Endpoint proofs use the same interpolated float LUT, without compiling or
# mutating ART. Keep the original Triangle available to expose the root cause.
corner_rows=[]
for label,values in [('lifted-black',[(0,16),(32,16),(64,50),(128,128),(192,202),(255,255)]),('lowered-white',[(0,0),(32,16),(64,50),(128,128),(192,202),(255,240)])]:
 lut=tone_lut(catmull(points(values),G,IG,raw_curve=True));boundary=0. if label=='lifted-black' else 65535.
 old=[];new=[]
 for fraction in [1e-4,1e-6]:
  v=np.array([[boundary-65535*fraction,boundary,.04*65535],[boundary+65535*fraction,boundary,.04*65535]],dtype=np.float32)
  base=apply_lut(lut,v);legacy=base+weighted(lut,v,legacy=True)-apply_lut(lut,np.clip(v,0,65535));actual=refine(lut,v,100)
  old.append(float(np.abs(np.diff(legacy-base,axis=0)).max()));new.append(float(np.abs(np.diff(actual-base,axis=0)).max()))
 assert old[1]>1 and old[1]>old[0]*.25
 assert not(new[1]>1 and new[1]>new[0]*.25)
 corner_rows.append(dict(case=label,legacyExtraJump16=old,reanchoredExtraJump16=new))
# Flat/equal, reversed and ordinary endpoint spans require no division by
# H-L and no clipping of authored output. Affine curves need no refinement.
samples=np.array([[0,13,65535],[2,400,65000],[12000,40000,60000],[65535,65535,0]],dtype=np.float32)
for black,white in [(0,65535),(4096,61439),(32000,32000),(60000,1000)]:
 lut=(black+(white-black)*(np.arange(65536,dtype=np.float64)/65535)).astype(np.float32)
 result=refine(lut,samples,100);base=apply_lut(lut,samples)
 assert np.isfinite(result).all() and np.abs(result-base).max()<.02
 assert result.min()>=min(black,white)-.02 and result.max()<=max(black,white)+.02
print(json.dumps(dict(scope='Source-equation numerical fixture; not compiled C++ or product pixel acceptance',rows=rows,corners=corner_rows)))`],{encoding:'utf8',maxBuffer:1024*1024}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(compareCurveRefineChains()));
