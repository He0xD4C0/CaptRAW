from pathlib import Path
import json,io
import numpy as np
import tifffile
from PIL import Image,ImageCms,ImageFilter
out=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())/'artifacts/parametric-curve'
def png(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
base=png('baseline');responses={}
for field in ['highlights','lights','darks','shadows']:
 for direction in ['up','down']:
  name=field+'-'+direction;delta=png(name)-base
  signed=delta if direction=='up' else -delta
  assert signed.max()>3 and signed.mean()>.1,(name,signed.max(),signed.mean())
  assert signed.min()>=-1,(name,signed.min())
  responses[name]={'maximumChange':int(signed.max()),'meanChange':float(signed.mean()),'oppositeDirectionRounding':int(signed.min())}
raw=[]
for name in ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']:
 a=tifffile.imread(out/(name+'.tiff'));b=tifffile.imread(out/(name+'-reference.tif'))
 assert a.dtype==np.uint16 and np.array_equal(a,b),name
 with tifffile.TiffFile(out/(name+'.tiff')) as f:icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip();assert 'sRGB' in icc
 raw.append({'file':name,'bitsPerSample':16,'referenceMaxDifference':0,'outputICC':icc})
f=json.loads((out/'raw-detail.json').read_text());detail=Image.open(out/'raw-detail.png').convert('RGB')
fit=Image.open(out/'nikon-d850.NEF.png').convert('RGB').resize((f['fullWidth'],f['fullHeight']),Image.Resampling.BILINEAR).crop((f['x'],f['y'],f['x']+f['width'],f['y']+f['height']))
blur_difference=abs(np.asarray(detail.filter(ImageFilter.GaussianBlur(8))).astype(float)-np.asarray(fit.filter(ImageFilter.GaussianBlur(8)))).mean()
assert blur_difference<5,blur_difference
report={'responses':responses,'raw':raw,'fitDetailMeanDifference8bit':float(blur_difference)}
desktop=out.parent/'parametric-curve-gui/raw.tiff'
if desktop.exists() and (out/'desktop-independent.tiff').exists():
 a=tifffile.imread(desktop);b=tifffile.imread(out/'desktop-independent.tiff');assert a.dtype==np.uint16 and np.array_equal(a,b);report['desktopIndependentMaximumDifference']=0
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
