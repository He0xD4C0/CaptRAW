import hashlib
import json
import os
from pathlib import Path
import numpy as np
import tifffile

root = Path(os.environ.get('CAPTRAW_EXTERNAL_OUT', 'artifacts/external-masks'))
report = json.loads((root / 'report.json').read_text())
pairs = []
for pair in report['pairs']:
    actual, expected = (tifffile.imread(pair[key]) for key in ('actual', 'expected'))
    assert actual.dtype == expected.dtype == np.uint16
    assert actual.shape == expected.shape and np.array_equal(actual, expected), pair
    with tifffile.TiffFile(pair['actual']) as image:
        assert image.pages[0].tags.get(34675), 'Missing ICC'
    pairs.append({**pair, 'shape': list(actual.shape), 'maximumPixelDifference': 0,
                  'sha256': hashlib.sha256(Path(pair['actual']).read_bytes()).hexdigest()})
gui = Path('artifacts/external-masks-gui/恢复.tiff')
if gui.exists():
    with tifffile.TiffFile(gui) as image:
        assert image.asarray().dtype == np.uint16 and image.pages[0].tags.get(34675)
(root / 'pixels.json').write_text(json.dumps({'reference': 'Installed CaptRAW 0.25', 'pairs': pairs,
    'guiTIFF16WithICC': gui.exists()}, indent=2) + '\n')
print(f'PASS {len(pairs)} TIFF16/ICC pairs exactly match 0.25')
