"""Deterministic linear Bayer DNG for numerical and mask regression tests."""
from pathlib import Path
import numpy as np
import tifffile
import struct

out = Path(__file__).resolve().parents[1] / 'build/samples'
out.mkdir(parents=True, exist_ok=True)
h, w = 768, 1024
y, x = np.mgrid[0:h, 0:w]
linear = 0.05 + 0.75 * x / (w - 1)
raw = (512 + linear * (16383 - 512)).astype(np.uint16)
# Neutral illuminant: the same sample value at each CFA channel.
tags = [
    (33421, 'H', 2, (2, 2), False),
    (33422, 'B', 4, (0, 1, 1, 2), False),
    (50706, 'B', 4, (1, 4, 0, 0), False),
    (50707, 'B', 4, (1, 3, 0, 0), False),
    (50708, 's', 0, 'CaptRAW Synthetic Bayer', False),
    (50714, 'H', 1, 512, False),
    (50717, 'I', 1, 16383, False),
    (50721, '2i', 9, (1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1), False),
    (50728, '2I', 3, (1, 1, 1, 1, 1, 1), False),
    (50778, 'H', 1, 21, False),
]
tifffile.imwrite(out / 'synthetic.dng', raw, photometric=32803, metadata=None, extratags=tags)
with tifffile.TiffFile(out/'synthetic.dng') as f:
    offset=f.pages[0].tags['Compression'].valueoffset
    byteorder=f.byteorder
unsupported=bytearray((out/'synthetic.dng').read_bytes())
struct.pack_into(byteorder+'H',unsupported,offset,65000)
(out/'unsupported-compression.dng').write_bytes(unsupported)
print(out / 'synthetic.dng')
