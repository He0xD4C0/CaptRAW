"""Authored neutral DNGs from externally evaluated whitepoints, not product output."""
import json
import sys
from pathlib import Path
import numpy as np
import tifffile
out = Path(sys.argv[1])
rows = json.loads((out / 'sdk-whitepoints.json').read_text())
matrix = np.diag([.9, 1., 1.1])
def rationals(values):
    return tuple(n for v in np.ravel(values) for n in [int(round(float(v)*1000000)), 1000000])
fixtures = []
for row in rows:
    temperature, tint = row['input']
    if tint != 0 or temperature not in [1500, 1750, 1999]:
        continue
    x, y = row['xy']
    neutral = matrix @ np.array([x/y, 1., (1.-x-y)/y])
    neutral /= neutral[1]
    neutral = np.round(neutral*1000000)/1000000
    raw = np.empty((192, 256), np.uint16)
    for dy, dx, channel in [(0,0,0),(0,1,1),(1,0,1),(1,1,2)]:
        raw[dy::2,dx::2] = round(.5*neutral[channel]*65535)
    file = out / f'low-neutral-{temperature}.dng'
    tags = [(33421,'H',2,(2,2),False),(33422,'B',4,(0,1,1,2),False),
            (50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,3,0,0),False),
            (50708,'s',0,'Low temperature neutral reference',False),
            (50714,'H',1,0,False),(50717,'I',1,65535,False),
            (50721,'2i',9,rationals(matrix),False),(50728,'2I',3,rationals(neutral),False),
            (50778,'H',1,17,False)]
    tifffile.imwrite(file,raw,photometric=32803,metadata=None,extratags=tags)
    expected = 1/(matrix @ np.array([x/y,1.,(1.-x-y)/y]))
    expected /= expected[1]
    fixtures.append(dict(path=str(file),temperature=temperature,multipliers=expected.tolist()))
(out / 'neutral-fixtures.json').write_text(json.dumps(fixtures))
