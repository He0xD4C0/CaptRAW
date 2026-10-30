from pathlib import Path
import json,io
import numpy as np
import tifffile
from PIL import Image,ImageCms
out=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())/'artifacts/global-details'
def png(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
base=png('baseline');responses={};area=(slice(350,480),slice(440,560));baseline_std=float(base[area].std())
for key in ['texture','clarity']:
 for direction in ['up','down']:
  name=key+'-'+direction;image=png(name);diff=np.abs(image-base)
  assert diff.max()>2,name
  # Whole-image adjustments must reach texture on both sides, outside the local test mask.
  assert diff[350:480,50:100].max()>0 and diff[350:480,924:974].max()>0,name
  deviation=float(image[area].std());assert (deviation>baseline_std if direction=='up' else deviation<baseline_std),(name,deviation,baseline_std)
  for suffix in ['', '-pan']:
   f=json.loads((out/(name+suffix+'-detail.json')).read_text());expected=image[f['y']:f['y']+f['height'],f['x']:f['x']+f['width']];assert np.array_equal(png(name+suffix+'-detail'),expected),(name,suffix,'detail mismatch')
  assert np.array_equal(png(name+'-reset'),base),name
  responses[name]={'maximumPixelChange':int(diff.max()),'regionalStandardDeviation':deviation,'detailMaximumDifference':0}
for name in ['combined','global-local','rotated']:
 image=png(name);f=json.loads((out/(name+'-detail.json')).read_text());assert np.array_equal(png(name+'-detail'),image[f['y']:f['y']+f['height'],f['x']:f['x']+f['width']]),name
assert np.array_equal(png('neutral'),base)
assert np.array_equal(png('global-removed'),png('legacy-local')) and np.array_equal(png('local-removed'),png('combined'))
for a,b in [('current.tiff','independent.tiff'),('current.tiff','reference.tif'),('raw.tiff','raw-reference.tif')]:
 first,second=tifffile.imread(out/a),tifffile.imread(out/b);assert first.dtype==np.uint16 and np.array_equal(first,second),(a,b)
with tifffile.TiffFile(out/'current.tiff') as f:
 assert f.pages[0].bitspersample==16
 assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
report={'responses':responses,'baselineRegionalStandardDeviation':baseline_std,'independent16BitMaximumDifference':0,'ARTReferenceMaximumDifference':0,'RAWReferenceMaximumDifference':0}
desktop=out.parent/'global-details-gui/global.tiff'
if desktop.exists() and (out/'desktop-independent.tiff').exists():
 assert np.array_equal(tifffile.imread(desktop),tifffile.imread(out/'desktop-independent.tiff'));report['desktopIndependentMaximumDifference']=0
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
