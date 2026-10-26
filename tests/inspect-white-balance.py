from pathlib import Path
import json
import numpy as np
import tifffile
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'artifacts'
native = root / 'white-balance'
report = {}
for name in ['nikon-d850.NEF', 'fuji-xt4.RAF']:
    original = np.asarray(Image.open(native / f'{name}-initial.png')).astype(np.int32)
    for mode in ['auto', 'preset']:
        changed = np.asarray(Image.open(native / f'{name}-{mode}.png')).astype(np.int32)
        difference = np.abs(changed - original)
        assert difference.max() > 0, f'{name}: {mode} has no pixel effect'
        report[f'{name}:{mode}'] = {'maximum8bitDifference': int(difference.max()),
                                   'mean8bitDifference': float(difference.mean())}

for key, first, second in [
    ('legacyBayerPixelsUnchanged', native / 'legacy.tiff', native / 'legacy-reference.tiff'),
    ('independentSavedProfilePixelsIdentical', native / 'sampled.tiff', native / 'sampled-independent.tiff'),
    ('desktopLegacyExportPixelsIdentical', root / 'white-balance-gui/legacy.tiff', native / 'legacy-reference.tiff'),
]:
    a, b = tifffile.imread(first), tifffile.imread(second)
    assert a.dtype == b.dtype == np.uint16 and a.shape == b.shape
    assert np.array_equal(a, b), f'{key}: pixels differ'
    report[key] = True

(native / 'pixel-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
