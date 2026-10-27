from pathlib import Path
import json, io
import numpy as np
import tifffile
from PIL import Image, ImageCms
out=Path(__file__).resolve().parents[1]/'artifacts/repair'
def png(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
base,clone=png('baseline'),png('clone')
assert np.array_equal(base,png('disabled')) and np.array_equal(base,png('transparent'))
# Clone center reproduces clean source and leaves distant pixels unchanged.
clone_center_max=int(np.max(np.abs(clone[190:210,706:726]-base[190:210,246:266])));assert clone_center_max<=1
assert np.array_equal(clone[600:700],base[600:700])
half=png('half');assert np.max(np.abs(half[200,716]-clone[200,716]))>5 and np.max(np.abs(half[200,716]-base[200,716]))>5
assert np.count_nonzero(png('hard')!=clone)>100
heal=png('heal');dust_clone=png('dust-clone')
# Healing adapts copied texture to the target brightness instead of copying source tone.
expected=base[460,740].mean();before=base[460,716].mean();healed=heal[460,716].mean();copied=dust_clone[460,716].mean()
assert abs(healed-expected)<abs(before-expected)/3,(expected,before,healed)
assert abs(healed-expected)<abs(copied-expected),(expected,healed,copied)
rotations=[]
for angle in [90,180,270]:
 r=png('rotate-'+str(angle));reference=np.rot90(clone,-angle//90)
 # Compare neighborhoods away from upstream one-pixel edge conventions.
 delta=np.abs(r-reference);rotations.append({'rotation':angle,'meanDifference':float(delta.mean()),'p99':float(np.quantile(delta,.99))})
 assert delta.mean()<.5,rotations[-1]
f=json.loads((out/'detail.json').read_text());detail=png('detail');detail_max=int(np.max(np.abs(detail-clone[f['y']:f['y']+f['height'],f['x']:f['x']+f['width']])));assert detail_max<=1
pairs=[('clone.tiff','independent.tiff'),('clone.tiff','reference.tif'),('raw.tiff','raw-reference.tif')]+[('raw.tiff',f'threads-{n}.tiff') for n in [1,2,8]]
for a,b in pairs:
 x,y=tifffile.imread(out/a),tifffile.imread(out/b);assert x.dtype==np.uint16 and np.array_equal(x,y),a
with tifffile.TiffFile(out/'clone.tiff') as f:
 assert f.pages[0].bitspersample==16
 assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
report=json.loads((out/'report.json').read_text());report.update(cloneCenterMaximumDifference=clone_center_max,unaffectedRegionIdentical=True,healing={'targetReference':float(expected),'before':float(before),'heal':float(healed),'clone':float(copied)},rotations=rotations,detailMaximumDifference=detail_max,independentExportMaximumDifference=0,ARTReferenceMaximumDifference=0,rawARTReferenceMaximumDifference=0,tiffBits=16,healingThreadCounts=[1,2,8],threadMaximumDifference=0)
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
