from pathlib import Path
import os,json
import numpy as np
import tifffile
out=Path(os.environ.get('CAPTRAW_PRESETS_E2E_OUT','artifacts/presets-installed-0.31'))
with tifffile.TiffFile(out/'preset.tiff') as f:
    image=f.asarray()
    assert image.dtype==np.uint16 and 34675 in f.pages[0].tags
reference=tifffile.imread(out/'reference.tiff')
assert image.shape==reference.shape and np.array_equal(image,reference)
scope='Native preset output equals independently composed expected settings in 0.28.' if os.environ.get('CAPTRAW_PRESETS_KIND')=='core' else 'Installed preset edit export equals independent 0.28 rendering of the saved recipe.'
result={'shape':list(image.shape),'dtype':str(image.dtype),'ICC':True,'changedPixels':0,'scope':scope+' Not Adobe preset or ACR quality equivalence.'}
(out/'pixels.json').write_text(json.dumps(result,indent=2)+'\n')
print(result)
