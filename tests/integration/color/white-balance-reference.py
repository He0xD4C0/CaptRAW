"""Independent Colour Science reference and authored dual-illuminant DNGs (CC0)."""
from pathlib import Path
import json
import subprocess
import hashlib
import numpy as np
import tifffile
from PIL import ImageCms
from colour.temperature import CCT_to_uv_Robertson1968, uv_to_CCT_Robertson1968
from colour.temperature.robertson1968 import ISOTEMPERATURE_LINES_ROBERTSON1968

out = Path('artifacts/white-balance-reference').resolve()
out.mkdir(parents=True, exist_ok=True)
# ART and the DNG reference use the historical value; Colour corrects this entry.
# Keep that single data difference explicit, without modifying either implementation.
ISOTEMPERATURE_LINES_ROBERTSON1968[19].u = .24702
pairs = [[t, s] for t in [2000, 2500, 3000, 3200, 4000, 5000, 6500, 9000, 20000, 50000]
         for s in [-150, -25, 0, 25, 150]]
rows = json.loads(subprocess.check_output(['build/native/captraw-wb-probe'], input=json.dumps(pairs), text=True))
def white(t, s):
    u, v = CCT_to_uv_Robertson1968([t, s / 3000])
    return np.array([1.5 * u, v]) / (u - 4 * v + 2), (u, v)
for row in rows:
    xy, uv = white(*row['input'])
    inverse = uv_to_CCT_Robertson1968(uv) * [1, 3000]
    assert np.max(np.abs(xy - row['xy'])) < 1e-12, row
    assert np.max(np.abs(inverse - row['inverse'])) < 1e-7, row
fixtures = []
matrices = [np.diag([.9, 1., 1.1]), np.diag([1.1, 1., .8])]
def matrix(t):
    weight = np.clip((1/t-1/6500)/(1/2850-1/6500), 0, 1)
    return matrices[0]*weight + matrices[1]*(1-weight)
def rationals(values):
    return tuple(n for v in np.ravel(values) for n in [int(round(v*1000000)), 1000000])
for t, s in [(2850, -20), (4000, 25), (6500, 0)]:
    xy, uv = white(t, s)
    xyz = np.array([xy[0]/xy[1], 1, (1-xy.sum())/xy[1]])
    neutral = matrix(float(uv_to_CCT_Robertson1968(uv)[0])) @ xyz
    neutral /= neutral[1]
    neutral = np.round(neutral*1000000)/1000000
    raw = np.empty((192, 256), np.uint16)
    for dy, dx, channel in [(0,0,0),(0,1,1),(1,0,1),(1,1,2)]:
        raw[dy::2, dx::2] = round(512 + .15*neutral[channel]*(16383-512))
    file = out / f'dual-{t}-{s}.dng'
    tags = [(33421,'H',2,(2,2),False),(33422,'B',4,(0,1,1,2),False),
            (50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,3,0,0),False),
            (50708,'s',0,'CaptRAW WB reference',False),(50714,'H',1,512,False),
            (50717,'I',1,16383,False),(50721,'2i',9,rationals(matrices[0]),False),
            (50722,'2i',9,rationals(matrices[1]),False),(50728,'2I',3,rationals(neutral),False),
            (50778,'H',1,17,False),(50779,'H',1,21,False)]
    tifffile.imwrite(file, raw, photometric=32803, metadata=None, extratags=tags)
    # ART uses xy->CCT for matrix interpolation; the Robertson forward/inverse are approximate inverses.
    expected = 1/(matrix(float(uv_to_CCT_Robertson1968(uv)[0]))@xyz);expected/=expected[1]
    fixtures.append(dict(path=str(file),sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
                         temperature=t,tint=s,multipliers=expected.tolist()))
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
icc_file = out/'embedded-icc-and-dcp.dng'
tifffile.imwrite(icc_file, raw, photometric=32803, metadata=None,
                 extratags=tags+[(50831, 'B', len(icc), icc, False)])
report = dict(reference='colour-science 0.4.6 (BSD-3-Clause), historical 325-mired table entry',
              whitepoints=rows,fixtures=fixtures,embeddedICC=str(icc_file),scope='Coordinate and camera-matrix reference, not ACR pixels')
(out/'reference.json').write_text(json.dumps(report,indent=2)+'\n')
print('PASS 50 independent whitepoints and inverse projections; wrote 3 dual-illuminant DNG fixtures')
