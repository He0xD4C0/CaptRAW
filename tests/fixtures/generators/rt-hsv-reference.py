"""Read-only ICC-linear diagnosis of the fixed ACR red-luminance reference.

No candidate implementation, fitted normalization or native rendering occurs.
"""
import ctypes as C
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import xml.etree.ElementTree as E

import numpy as np
import tifffile

root = next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file()) / 'artifacts/stage-0/acr-reference'
rt_source_pin = json.loads((Path(__file__).resolve().parents[1] / 'rt-hsv-source-pin.json').read_text())
old = root / 'tat-interaction-187'
new = root / 'hsl-red-luminance-187'
source = old / 'inputs/controlled-tat.tif'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'da7915588f6ac92cf3de084f7ba6aebf396e76017a77ae6a115d25786df7f379'
ns = '{http://ns.adobe.com/camera-raw-settings/1.0/}'


def settings(path):
    tree = E.parse(path)
    fields = {k[len(ns):]: v for n in tree.iter() for k, v in n.attrib.items() if k.startswith(ns)}
    for node in tree.iter():
        if node.tag.startswith(ns):
            fields[node.tag[len(ns):]] = tuple(''.join(c.itertext()).strip() for c in node if c.tag.endswith('Seq'))
    return fields


before = settings(old / 'controlled-tat-neutral.xmp')
after = settings(new / 'red-luminance40.xmp')
diff = {k: [before.get(k), after.get(k)] for k in before.keys() | after.keys() if before.get(k) != after.get(k)}
assert diff == {'LuminanceAdjustmentRed': ['0', '+40']}, diff
assert before['Version'] == '18.7' and before['IncrementalTemperature'] == before['IncrementalTint'] == '0'
libpath = Path(subprocess.check_output(['pkg-config', '--variable=libdir', 'lcms2'], text=True).strip())
libpath /= 'liblcms2.dylib' if sys.platform == 'darwin' else 'liblcms2.so'
lib = C.CDLL(str(libpath))
lib.cmsOpenProfileFromMem.argtypes = [C.c_void_p, C.c_uint32]
lib.cmsOpenProfileFromMem.restype = C.c_void_p
lib.cmsCreateXYZProfile.restype = C.c_void_p
lib.cmsCreateTransform.argtypes = [C.c_void_p, C.c_uint32, C.c_void_p, C.c_uint32, C.c_uint32, C.c_uint32]
lib.cmsCreateTransform.restype = C.c_void_p
lib.cmsDoTransform.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p, C.c_uint32]
lib.cmsDeleteTransform.argtypes = lib.cmsCloseProfile.argtypes = [C.c_void_p]


def load(path):
    with tifffile.TiffFile(path) as f:
        page = f.pages[0]
        a, icc = page.asarray(), bytes(page.tags[34675].value)
    assert a.shape == (1024, 1536, 3) and a.dtype == np.uint16
    assert hashlib.sha256(icc).hexdigest() == '2b3aa1645779a9e634744faf9b01e9102b0c9b88fd6deced7934df86b949af7e'
    tags = {}
    for i in range(struct.unpack_from('>I', icc, 128)[0]):
        key, offset, size = struct.unpack_from('>4sII', icc, 132 + 12*i)
        tags[key] = icc[offset:offset+size]
    matrix = np.column_stack([np.array(struct.unpack_from('>iii', tags[k], 8))/65536 for k in [b'rXYZ', b'gXYZ', b'bXYZ']])
    buf = C.create_string_buffer(icc)
    ip, op = lib.cmsOpenProfileFromMem(buf, len(icc)), lib.cmsCreateXYZProfile()
    transform = lib.cmsCreateTransform(ip, (1 << 22) | (4 << 16) | (3 << 3) | 4, op, (1 << 22) | (9 << 16) | (3 << 3) | 4, 1, 0x140)
    assert transform
    rgb = np.ascontiguousarray(a, dtype=np.float32)/65535
    xyz = np.empty_like(rgb)
    try:
        lib.cmsDoTransform(transform, rgb.ctypes.data, xyz.ctypes.data, a.shape[0]*a.shape[1])
    finally:
        lib.cmsDeleteTransform(transform)
        lib.cmsCloseProfile(ip)
        lib.cmsCloseProfile(op)
    return a, xyz @ np.linalg.inv(matrix).T


bp, ap = old/'inputs/controlled-tat-neutral.tif', new/'inputs/controlled-tat-red-luminance40.tif'
b, bl = load(bp)
a, al = load(ap)
rows = []
for name, x, y in [('red', 128, 80), ('orange', 128, 240), ('gray', 640, 550)]:
    roi = np.s_[y-32:y+32, x-32:x+32]
    rows.append({'id': name, 'baselineRGB16': b[roi].mean((0, 1)).tolist(), 'acrRGB16': a[roi].mean((0, 1)).tolist(),
                 'iccLinearRGBGain': (al[roi]/bl[roi]).mean((0, 1)).tolist(),
                 'unclippedGB': bool(((a[roi][:, :, 1:] > 0) & (a[roi][:, :, 1:] < 65535) & (b[roi][:, :, 1:] > 0) & (b[roi][:, :, 1:] < 65535)).all())})
result = {'scope': 'Identical matrix/TRC sRGB ICC -> XYZ D50 float32 -> inverse embedded colorants. Red R is output-clipped; its hidden gain is not inferred.',
          'rtSourcePin': rt_source_pin,
          'referenceHashes': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [source, bp, ap, old/'controlled-tat-neutral.xmp', new/'red-luminance40.xmp']},
          'settingsDifference': diff, 'lcmsSHA256': hashlib.sha256(libpath.read_bytes()).hexdigest(), 'rows': rows,
          'rtNativeValueBound': 'For normalized in-gamut working RGB and legal curve ordinate q in [.5,1], p=(q-.5)*(1-(1-min(s,1))^4), Vnew/V=1+p*(1-V)<=1.5. This is scalar working-RGB gain; it does not establish target-gamut safety or Adobe equivalence.'}
assert rows[0]['unclippedGB'] and all(v > 1.5 for v in rows[0]['iccLinearRGBGain'][1:])
target = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/captraw-rt-hsv-reference.json')
target.write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({'report': str(target), 'rows': rows}))
