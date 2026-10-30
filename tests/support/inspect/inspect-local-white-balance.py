from pathlib import Path
import json,re,io
import numpy as np
import tifffile
from PIL import Image,ImageCms
out=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())/'artifacts/local-white-balance'
def png(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
base=png('baseline');responses={}
for key in ['warm','cool','magenta','green','combined']:
 image=png(key);coverage=np.asarray(Image.open(out/(key+'-mask.png')))[...,3];diff=np.abs(image-base)
 assert diff[coverage>0].max()>5,key
 assert diff[coverage==0].max()<=1,(key,'mask leakage',diff[coverage==0].max())
 f=json.loads((out/(key+'-detail.json')).read_text());expected=image[f['y']:f['y']+f['height'],f['x']:f['x']+f['width']]
 roi_difference=np.abs(png(key+'-detail')-expected)
 assert roi_difference.max()<=1,(key,'ROI mismatch')
 assert np.array_equal(png(key+'-full-detail'),image),(key,'full-resolution color mismatch')
 assert np.array_equal(png(key+'-reset'),base)
 assert np.array_equal(png(key+'-disabled'),base)
 mean=image[380:450,480:550].mean((0,1));responses[key]={'maximumPixelChange8bit':int(diff.max()),'outsideMaskMaximumChange8bit':int(diff[coverage==0].max()),'neutralPatchRGB':mean.tolist(),'detailMaximumDifference':int(roi_difference.max()),'detailDifferingChannels':int(np.count_nonzero(roi_difference))}
 assert image.min()>=0 and image.max()<=255
warm=np.array(responses['warm']['neutralPatchRGB']);cool=np.array(responses['cool']['neutralPatchRGB']);magenta=np.array(responses['magenta']['neutralPatchRGB']);green=np.array(responses['green']['neutralPatchRGB'])
assert warm[0]>warm[2] and cool[2]>cool[0]
assert (magenta[0]+magenta[2])/2>magenta[1] and (green[0]+green[2])/2<green[1]
assert np.array_equal(base,png('neutral'))
f=json.loads((out/'rotated-detail.json').read_text());image=png('rotated');rotated_difference=np.abs(png('rotated-detail')-image[f['y']:f['y']+f['height'],f['x']:f['x']+f['width']]);assert rotated_difference.max()<=1
for path in ['independent.tiff','reference.tif']:
 a,b=tifffile.imread(out/'current.tiff'),tifffile.imread(out/path);assert a.dtype==np.uint16 and np.array_equal(a,b),path
with tifffile.TiffFile(out/'current.tiff') as f:
 assert f.pages[0].bitspersample==16
 assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
a,b=tifffile.imread(out/'raw.tiff'),tifffile.imread(out/'raw-reference.tif');assert np.array_equal(a,b) and a.dtype==np.uint16
# Independently conjugate each saved working-RGB matrix back to XYZ.
# A correct chromatic adaptation must describe the same transform in every basis.
header=(out.parents[1]/'build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine/iccmatrices.h').read_text()
header=re.sub(r'/\*.*?\*/|//[^\n]*','',header,flags=re.S)
def basis(name):
 body=re.search(r'constexpr float '+name+r'\[3\]\[3\] = (.*?);',header,re.S)[1]
 return np.array([float(v) for v in re.findall(r'[-+]?\d*\.\d+(?:e[-+]?\d+)?',body)]).astype(np.float32).astype(float).reshape(3,3)
transforms=[]
for name,key in [('sRGB','xyz_sRGB'),('Adobe-RGB','xyz_adobe'),('ProPhoto','xyz_prophoto')]:
 text=(out/('space-'+name+'.arp')).read_text();m=np.array([float(v) for v in re.search(r'CaptRAWWhiteBalanceMatrix_1=([^\n]+)',text)[1].split(';') if v]).reshape(3,3)
 w=basis(key);transforms.append(w@m@np.linalg.inv(w))
basis_error=max(float(np.max(np.abs(t-transforms[0]))) for t in transforms)
assert basis_error<2e-6,basis_error
report={'responses':responses,'directionsCorrect':True,'neutralMaximumDifference':0,'independent16BitMaximumDifference':0,'ARTReferenceMaximumDifference':0,'RAWReferenceMaximumDifference':0,'workingSpaceXYZMaximumDifference':basis_error}
desktop=out.parent/'local-white-balance-gui/local.tiff'
if desktop.exists():
 independent=out/'desktop-independent.tiff'
 if independent.exists():
  assert np.array_equal(tifffile.imread(desktop),tifffile.imread(independent));report['desktopIndependentMaximumDifference']=0
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
