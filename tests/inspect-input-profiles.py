from pathlib import Path
import json
import numpy as np
import tifffile
from PIL import Image

out = Path(__file__).resolve().parents[1] / 'artifacts/input-profiles'
report = json.loads((out / 'report.json').read_text())
for item in report['images']:
    base = np.asarray(Image.open(out / (item['file'] + '-auto.png'))).astype(np.int32)
    item['pixelDifferences'] = {}
    for name in item['actualPixelChanges']:
        image = np.asarray(Image.open(out / (item['file'] + '-' + name + '.png'))).astype(np.int32)
        difference = np.abs(image - base)
        assert difference.max() > 0
        item['pixelDifferences'][name] = {'maximum8bitDifference': int(difference.max()),
                                        'mean8bitDifference': float(difference.mean())}
a, b = tifffile.imread(out / 'matrix.tiff'), tifffile.imread(out / 'matrix-reference.tif')
assert a.dtype == b.dtype == np.uint16 and np.array_equal(a, b)
report['matrixReferenceMaximumDifference'] = 0
with tifffile.TiffFile(out / 'matrix.tiff') as f:
    assert f.pages[0].bitspersample == 16 and 34675 in f.pages[0].tags
report['tiffBits'] = 16
desktop = out.parent / 'input-profiles-gui/matrix.tiff'
if desktop.exists():
    gui = tifffile.imread(desktop)
    assert gui.dtype == np.uint16 and np.array_equal(gui, a)
    report['desktopMatrixMaximumDifference'] = 0
(out / 'pixel-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
