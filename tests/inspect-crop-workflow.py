from pathlib import Path
import json,io,math
import numpy as np
import tifffile
from PIL import ImageCms
out=Path(__file__).resolve().parents[1]/'artifacts/crop-workflow'
gui=out.parent/'crop-workflow-gui';recipe=json.loads((gui/'durable.captraw.json').read_text());a=recipe['adjustments'];c=a['crop']
w,h=c['width']*8280,c['height']*5512
if a['rotation']%180:w,h=h,w
expected=[math.floor(h+.5),math.floor(w+.5),3]
images=[tifffile.imread(p) for p in [gui/'crop.tiff',out/'independent.tiff',out/'previous.tiff']]
for image in images:assert image.dtype==np.uint16 and list(image.shape)==expected
assert np.array_equal(images[0],images[1]) and np.array_equal(images[0],images[2])
with tifffile.TiffFile(gui/'crop.tiff') as f:icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip();assert 'sRGB' in icc
assert a['masks']==json.loads((gui/'initial.captraw.json').read_text())['adjustments']['masks']
r={'shape':expected,'bitsPerSample':16,'outputICC':icc,'desktopIndependentMaximumDifference':0,'previousEngineMaximumDifference':0,'maskCoordinatesUnchanged':True};(out/'pixel-report.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
