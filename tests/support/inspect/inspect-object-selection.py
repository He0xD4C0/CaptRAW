from pathlib import Path
import subprocess
import os,json
import numpy as np
import tifffile
from PIL import Image
out=Path(os.environ.get('CAPTRAW_BOX_E2E_OUT' if os.environ.get('CAPTRAW_OBJECT_KIND')=='box' else 'CAPTRAW_OBJECT_E2E_OUT','artifacts/object-box-gui' if os.environ.get('CAPTRAW_OBJECT_KIND')=='box' else 'artifacts/object-selection-gui'))
box=os.environ.get('CAPTRAW_OBJECT_KIND')=='box'
root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
path=out/('box.xmp' if box else 'committed.xmp')
r=json.loads(subprocess.check_output(["node", "--input-type=module", "-e", "import {readDocument} from './tests/support/xmp-test.mjs'; console.log(JSON.stringify(await readDocument(process.argv[1])));", str(path.resolve())],cwd=root,text=True))
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
