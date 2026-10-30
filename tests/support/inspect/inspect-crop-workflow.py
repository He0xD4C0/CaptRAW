from pathlib import Path
import subprocess
import json,io,math
import numpy as np
import tifffile
from PIL import ImageCms
root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
def read_document(path):
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", "import {readDocument} from './tests/support/xmp-test.mjs'; console.log(JSON.stringify(await readDocument(process.argv[1])));", str(path.resolve())],cwd=root,text=True))
out=root/'artifacts/crop-workflow'
gui=out.parent/'crop-workflow-gui';recipe=read_document(gui/'durable.xmp');a=recipe['adjustments'];c=a['crop']
w,h=c['width']*8280,c['height']*5512
if a['rotation']%180:w,h=h,w
expected=[math.floor(h+.5),math.floor(w+.5),3]
images=[tifffile.imread(p) for p in [gui/'crop.tiff',out/'independent.tiff',out/'previous.tiff']]
for image in images:assert image.dtype==np.uint16 and list(image.shape)==expected
assert np.array_equal(images[0],images[1]) and np.array_equal(images[0],images[2])
with tifffile.TiffFile(gui/'crop.tiff') as f:icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip();assert 'sRGB' in icc
assert a['masks']==read_document(gui/'initial.xmp')['adjustments']['masks']
r={'shape':expected,'bitsPerSample':16,'outputICC':icc,'desktopIndependentMaximumDifference':0,'previousEngineMaximumDifference':0,'maskCoordinatesUnchanged':True};(out/'pixel-report.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
