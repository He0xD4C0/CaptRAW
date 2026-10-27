from pathlib import Path
import os,json
import numpy as np
import tifffile
from PIL import Image
out=Path(os.environ.get('CAPTRAW_OBJECT_E2E_OUT','artifacts/object-selection-installed-0.29'))
box=os.environ.get('CAPTRAW_OBJECT_KIND')=='box'
r=json.loads((out/('box.captraw.json' if box else 'committed.captraw.json')).read_text())
asset=np.asarray(Image.open(out/r['maskAssets']['files'][0]['path']))
coverage=np.asarray(Image.open(out/'selected-candidate.png')) if box else np.asarray(Image.open(out/'committed-coverage.png'))[:,:,3]
assert asset.shape==coverage.shape
changed=int(np.count_nonzero(asset!=coverage));assert changed==0,changed
with tifffile.TiffFile(out/'object.tiff') as f:
 actual=f.asarray();assert actual.dtype==np.uint16 and 34675 in f.pages[0].tags
reference=tifffile.imread(out/'reference.tiff');assert actual.shape==reference.shape
assert np.array_equal(actual,reference)
result={'maskShape':list(asset.shape),('candidateChangedPixels' if box else 'coverageChangedPixels'):changed,'outputShape':list(actual.shape),'outputDtype':str(actual.dtype),'ICC':True,'outputChangedPixels':0,'scope':'Selected candidate reaches the development core unchanged; installed RAW export equals independent 0.28 rendering. No semantic ground truth or ACR quality claim.'}
(out/'pixels.json').write_text(json.dumps(result,indent=2)+'\n');print(result)
