from pathlib import Path
import json,io
import numpy as np
import tifffile
from PIL import Image, ImageCms
out=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())/'artifacts/local-details'
def png(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
base=png('baseline');responses={}
for key in ['hue','texture','clarity','noise']:
 image=png(key);coverage=np.asarray(Image.open(out/(key+'-mask.png')))[...,3];d=np.abs(image-base)
 assert d[coverage>0].max()>5,key
 assert d[coverage==0].max()<=1,(key,'outside mask')
 frame=json.loads((out/(key+'-detail.json')).read_text());detail=png(key+'-detail');expected=image[frame['y']:frame['y']+frame['height'],frame['x']:frame['x']+frame['width']]
 assert np.array_equal(detail,expected),(key,'detail context',np.abs(detail-expected).max())
 pan=json.loads((out/(key+'-pan.json')).read_text());expected_pan=image[pan['y']:pan['y']+pan['height'],pan['x']:pan['x']+pan['width']]
 assert np.array_equal(png(key+'-pan'),expected_pan),(key,'cached pan')
 if (out/(key+'-pan-mask.png')).exists():
  actual=np.asarray(Image.open(out/(key+'-pan-mask.png')))[...,3];expected_mask=coverage[pan['y']:pan['y']+pan['height'],pan['x']:pan['x']+pan['width']]
  assert np.max(np.abs(actual.astype(int)-expected_mask.astype(int)))<=1,(key,'pan mask')
 responses[key]={'maximumChange':int(d.max()),'outsideMaskMaximumChange':int(d[coverage==0].max()),'detailMaximumDifference':0}
# Fixed-region standard deviation: amplification and smoothing act in opposite directions.
region=(slice(350,480),slice(440,560));baseline_std=float(base[region].std())
texture_std=float(png('texture')[region].std());noise_std=float(png('noise')[region].std())
assert texture_std>baseline_std and noise_std<baseline_std,(baseline_std,texture_std,noise_std)
assert np.array_equal(png('baseline'),png('neutral'))
for key in ['hue','texture','clarity','noise']:assert np.array_equal(base,png(key+'-reverted'))
for path in ['independent.tiff','reference.tif']:
 a,b=tifffile.imread(out/'current.tiff'),tifffile.imread(out/path);assert a.dtype==np.uint16 and np.array_equal(a,b),path
with tifffile.TiffFile(out/'current.tiff') as f:
 assert f.pages[0].bitspersample==16
 assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
rotated=png('rotated');frame=json.loads((out/'rotated-detail.json').read_text());assert np.array_equal(png('rotated-detail'),rotated[frame['y']:frame['y']+frame['height'],frame['x']:frame['x']+frame['width']])
raw,reference=tifffile.imread(out/'raw-local.tiff'),tifffile.imread(out/'raw-local-reference.tif');assert raw.dtype==np.uint16 and np.array_equal(raw,reference),'RAW local output'
report=json.loads((out/'report.json').read_text());report.update(responses=responses,regionalStandardDeviation={'baseline':baseline_std,'texture':texture_std,'noise':noise_std},independentMaximumDifference=0,ARTReferenceMaximumDifference=0,tiffBits=16,rawARTReferenceMaximumDifference=0)
if (out.parent/'local-details-gui/local.tiff').exists() and (out/'desktop-independent.tiff').exists():
 assert np.array_equal(tifffile.imread(out.parent/'local-details-gui/local.tiff'),tifffile.imread(out/'desktop-independent.tiff'));report['desktopMaximumDifference']=0
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
