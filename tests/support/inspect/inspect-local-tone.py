from pathlib import Path
import json,io
import numpy as np
import tifffile
from PIL import Image,ImageCms
out=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())/'artifacts/local-tone'
def png(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
base=png('baseline');responses={}
for key in ['blacks','shadows','highlights','whites']:
 for direction in ['up','down']:
  name=key+'-'+direction;image=png(name);coverage=np.asarray(Image.open(out/(name+'-mask.png')))[...,3]
  delta=image-base;diff=np.abs(delta)
  assert diff[coverage>0].max()>0,name
  assert diff[coverage==0].max()<=1,(name,'mask leakage')
  interior=coverage>250
  assert (delta[interior].mean()>0 if direction=='up' else delta[interior].mean()<0),(name,'direction')
  f=json.loads((out/(name+'-detail.json')).read_text());expected=image[f['y']:f['y']+f['height'],f['x']:f['x']+f['width']]
  assert np.array_equal(png(name+'-detail'),expected),(name,'1:1 region')
  assert np.array_equal(png(name+'-reset'),base) and np.array_equal(png(name+'-disabled'),base)
  profile=diff[350:420,:,0].mean(axis=0);peak=int(np.argmax(np.convolve(profile,np.ones(31)/31,mode='same')))
  responses[name]={'maximumPixelChange':int(diff.max()),'outsideMaskMaximumChange':int(diff[coverage==0].max()),'meanInteriorSignedChange':float(delta[interior].mean()),'strongestResponseX':peak}
# Controls must address distinct parts of the ramp, not four copies of exposure.
for direction in ['up','down']:
 peaks=[responses[key+'-'+direction]['strongestResponseX'] for key in ['blacks','shadows','highlights','whites']]
 assert peaks==sorted(peaks) and min(np.diff(peaks))>0,peaks
for name in ['combined','rotated']:
 image=png(name);f=json.loads((out/(name+'-detail.json')).read_text());assert np.array_equal(png(name+'-detail'),image[f['y']:f['y']+f['height'],f['x']:f['x']+f['width']]),name
for a,b in [('matrix-integer.tiff','matrix-neighbor.tiff'),('current.tiff','independent.tiff'),('current.tiff','reference.tif'),('raw.tiff','raw-reference.tif')]:
 first,second=tifffile.imread(out/a),tifffile.imread(out/b);assert first.dtype==np.uint16 and np.array_equal(first,second),(a,b)
with tifffile.TiffFile(out/'current.tiff') as f:
 assert f.pages[0].bitspersample==16
 assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
report={'responses':responses,'detailMaximumDifference':0,'independent16BitMaximumDifference':0,'ARTReferenceMaximumDifference':0,'RAWReferenceMaximumDifference':0}
desktop=out.parent/'local-tone-gui/local.tiff'
if desktop.exists() and (out/'desktop-independent.tiff').exists():
 assert np.array_equal(tifffile.imread(desktop),tifffile.imread(out/'desktop-independent.tiff'));report['desktopIndependentMaximumDifference']=0
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
