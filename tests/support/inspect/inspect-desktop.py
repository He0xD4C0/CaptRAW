from pathlib import Path
import hashlib,json,io
import numpy as np
import tifffile
from PIL import Image,ImageCms
root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
gui=tifffile.imread(root/'artifacts/gui-export.tiff')
native=tifffile.imread(root/'artifacts/headless-export.tiff')
assert gui.dtype==np.uint16 and np.array_equal(gui,native)
with tifffile.TiffFile(root/'artifacts/gui-export.tiff') as f:
 assert f.pages[0].bitspersample==16
 assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
jpeg=Image.open(root/'artifacts/workbench/中文 空格.jpg')
assert jpeg.format=='JPEG' and jpeg.mode=='RGB' and 'icc_profile' in jpeg.info
assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(jpeg.info['icc_profile'])))
for fixture in json.loads((root/'tests/fixtures/fixtures.json').read_text()):
 assert hashlib.sha256((root/'build/samples'/fixture['name']).read_bytes()).hexdigest()==fixture['sha256']
report={'desktopHeadlessMaxDifference':0,'tiffBits':16,'tiffICC':'sRGB','jpegICC':'sRGB','allSourceChecksumsUnchanged':True}
(root/'artifacts/desktop-pixel-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
