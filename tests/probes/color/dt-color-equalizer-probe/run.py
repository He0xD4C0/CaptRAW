"""Run only the independently compiled full CPU module; never build it.

The five-case bridge is a declared unit diagnostic, not Adobe equivalence:
native Hue degrees = CRS number; native S/B gain = 1 + CRS/100. No fitting.
"""
import argparse
import ctypes as C
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as E

import numpy as np
import tifffile

p = argparse.ArgumentParser()
p.add_argument('--probe', required=True, type=Path)
p.add_argument('--work', required=True, type=Path, help='Private compile directory')
p.add_argument('--root', required=True, type=Path)
p.add_argument('--phase', choices=['check', 'zero', 'references'], default='zero')
p.add_argument('--zero-report', type=Path)
p.add_argument('--report', type=Path)
a = p.parse_args()
scratch = Path(tempfile.mkdtemp(prefix='captraw-dt-color-equalizer-run-'))
ok = False
digest = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
try:
    manifest = json.loads((a.work/'manifest.json').read_text())
    for path, h in manifest['sharedIdentities'].items():
        assert digest(path) == h, 'Shared freeze changed: '+path
    for path, h in manifest['privateInputs'].items():
        assert digest(a.work/path) == h, 'Private input changed: '+path
    ref = a.root/'artifacts/stage-0/acr-reference/tat-interaction-187'
    red = a.root/'artifacts/stage-0/acr-reference/hsl-red-luminance-187'
    source = ref/'inputs/controlled-tat.tif'
    assert digest(source) == 'da7915588f6ac92cf3de084f7ba6aebf396e76017a77ae6a115d25786df7f379'
    working_profile = a.root/'build/native/resources/iccprofiles/output/RTv4_Linear_Rec2020.icc'
    working_icc = working_profile.read_bytes()
    source_files = [source, working_profile, ref/'controlled-tat-neutral.xmp', ref/'inputs/controlled-tat-neutral.tif']
    ns = '{http://ns.adobe.com/camera-raw-settings/1.0/}'
    def settings(path):
        tree = E.parse(path)
        fields = {k[len(ns):]: v for n in tree.iter() for k, v in n.attrib.items() if k.startswith(ns)}
        for n in tree.iter():
            if n.tag.startswith(ns):
                fields[n.tag[len(ns):]] = tuple(''.join(c.itertext()).strip() for c in n if c.tag.endswith('Seq'))
        return fields
    base_settings = settings(ref/'controlled-tat-neutral.xmp')
    cases = []
    for name in ['hue-up80', 'hue-down80-valid', 'saturation-up80', 'luminance-down80', 'red-luminance40']:
        xmp = red/'red-luminance40.xmp' if name == 'red-luminance40' else ref/('controlled-tat-'+name+'.xmp')
        image = red/'inputs/controlled-tat-red-luminance40.tif' if name == 'red-luminance40' else ref/'inputs'/('controlled-tat-'+name+'.tif')
        values = settings(xmp)
        different = {k: [base_settings.get(k), values.get(k)] for k in base_settings.keys() | values.keys() if base_settings.get(k) != values.get(k)}
        assert values['Version'] == '18.7'
        assert all(k.startswith(('HueAdjustment', 'SaturationAdjustment', 'LuminanceAdjustment')) for k in different), different
        bands = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']
        crs = {key: [int(values[prefix+'Adjustment'+band]) for band in bands] for key, prefix in [('hue', 'Hue'), ('saturation', 'Saturation'), ('brightness', 'Luminance')]}
        native = {'hueDegrees': crs['hue'], 'saturationGain': [1+v/100 for v in crs['saturation']], 'brightnessGain': [1+v/100 for v in crs['brightness']]}
        cases.append({'id': name, 'xmp': str(xmp), 'acr': str(image), 'crs': crs, 'native': native})
        source_files.extend([xmp, image])
    source_hashes = {str(f): digest(f) for f in source_files}
    libfile = Path(subprocess.check_output(['pkg-config', '--variable=libdir', 'lcms2'], text=True).strip())/'liblcms2.dylib'
    lib = C.CDLL(str(libfile))
    lib.cmsOpenProfileFromMem.argtypes = [C.c_void_p, C.c_uint32]
    lib.cmsOpenProfileFromMem.restype = C.c_void_p
    lib.cmsCreateXYZProfile.restype = C.c_void_p
    lib.cmsCreateTransform.argtypes = [C.c_void_p, C.c_uint32, C.c_void_p, C.c_uint32, C.c_uint32, C.c_uint32]
    lib.cmsCreateTransform.restype = C.c_void_p
    lib.cmsDoTransform.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p, C.c_uint32]
    lib.cmsDeleteTransform.argtypes = lib.cmsCloseProfile.argtypes = [C.c_void_p]
    rgb_type, xyz_type = (1 << 22) | (4 << 16) | (3 << 3) | 4, (1 << 22) | (9 << 16) | (3 << 3) | 4
    def transform(rgb, source_icc, target_icc=None):
        ib = C.create_string_buffer(source_icc)
        ip = lib.cmsOpenProfileFromMem(ib, len(source_icc))
        ob = C.create_string_buffer(target_icc) if target_icc else None
        op = lib.cmsOpenProfileFromMem(ob, len(target_icc)) if target_icc else lib.cmsCreateXYZProfile()
        t = lib.cmsCreateTransform(ip, rgb_type, op, rgb_type if target_icc else xyz_type, 1, 0x140)
        assert t
        data = np.ascontiguousarray(rgb, dtype=np.float32)
        out = np.empty_like(data)
        try:
            lib.cmsDoTransform(t, data.ctypes.data, out.ctypes.data, data.shape[0]*data.shape[1])
        finally:
            lib.cmsDeleteTransform(t)
            lib.cmsCloseProfile(ip)
            lib.cmsCloseProfile(op)
        assert np.isfinite(out).all()
        return out
    def load(path):
        with tifffile.TiffFile(path) as f:
            page = f.pages[0]
            image, icc = page.asarray(), bytes(page.tags[34675].value)
        assert image.shape == (1024, 1536, 3) and image.dtype == np.uint16
        return image, icc
    tags = {}
    for i in range(struct.unpack_from('>I', working_icc, 128)[0]):
        key, offset, size = struct.unpack_from('>4sII', working_icc, 132+12*i)
        tags[key] = working_icc[offset:offset+size]
    matrix = np.column_stack([np.array(struct.unpack_from('>iii', tags[k], 8))/65536 for k in [b'rXYZ', b'gXYZ', b'bXYZ']])
    assert all(tags[k][:4] == b'para' and struct.unpack_from('>H', tags[k], 8)[0] == 0
               and struct.unpack_from('>i', tags[k], 12)[0] == 65536 for k in [b'rTRC', b'gTRC', b'bTRC']), 'Working ICC must have actual gamma-1 TRCs'
    matrixfile = scratch/'matrix.txt'
    np.savetxt(matrixfile, np.concatenate([matrix.ravel(), np.linalg.inv(matrix).ravel()]), fmt='%.12g')
    src, src_icc = load(source)
    linear = transform(src.astype(np.float32)/65535, src_icc, working_icc)
    rgba = np.concatenate([linear, np.ones((*linear.shape[:2], 1), np.float32)], axis=2)
    request = {'sourceHashes': source_hashes, 'module': manifest['sourcePin'], 'defaults': manifest['defaultParameters'], 'cases': cases,
               'bridge': 'DIAGNOSTIC ONLY: native degrees=CRS number; native S/B gain=1+CRS/100; native fixed UCS nodes unchanged. This is not a validated Adobe parameter or band mapping.'}
    if a.phase == 'check':
        print(json.dumps({'prepared': True, 'cases': len(cases), 'compilerOrNativeRun': False, 'bridge': request['bridge']}))
        ok = True
    else:
        binary_sha = digest(a.probe)
        results = []
        def run(name, data, native):
            inp, out, params = scratch/(name+'-input.f32'), scratch/(name+'-output.f32'), scratch/(name+'-params.txt')
            np.ascontiguousarray(data, dtype='<f4').tofile(inp)
            np.savetxt(params, np.array(native['hueDegrees']+native['saturationGain']+native['brightnessGain']), fmt='%.9g')
            cp = subprocess.run([str(a.probe), str(inp), str(out), str(data.shape[1]), str(data.shape[0]), str(matrixfile), str(params), '1'], text=True, capture_output=True, timeout=180)
            (scratch/(name+'-stdout.log')).write_text(cp.stdout)
            (scratch/(name+'-stderr.log')).write_text(cp.stderr)
            assert cp.returncode == 0, name+': '+cp.stderr[-1500:]
            image = np.fromfile(out, dtype='<f4').reshape(data.shape)
            assert np.isfinite(image).all() and np.array_equal(image[:, :, 3], data[:, :, 3])
            results.append({'id': name, 'native': native, 'runtime': json.loads(cp.stdout), 'floatPixelSHA256': hashlib.sha256(image.tobytes()).hexdigest()})
            return image[:, :, :3]
        neutral = {'hueDegrees': [0]*8, 'saturationGain': [1]*8, 'brightnessGain': [1]*8}
        zero = run('zero', rgba, neutral)
        def stats(v):
            return {'mean': float(np.mean(v)), 'p95': float(np.percentile(v, 95)), 'max': float(np.max(v))}
        if a.phase == 'zero':
            gray = np.empty((256, 512, 4), dtype=np.float32)
            gray[:, :, :3] = np.linspace(0, 1, 512)[None, :, None]
            gray[:, :, 3] = 1
            gz = run('gray-neutral', gray, neutral)
            stress = run('gray-stress', gray, {'hueDegrees': [45]*8, 'saturationGain': [2]*8, 'brightnessGain': [2]*8})
            diagnostic = {'zeroWorkingRGBAbsoluteDifference': stats(abs(zero-linear)),
                          'grayZeroAbsoluteDifference': stats(abs(gz-gray[:, :, :3])),
                          'grayStressVsZeroAbsoluteDifference': stats(abs(stress-gz)),
                          'grayStressChannelSpread': stats(np.max(stress, 2)-np.min(stress, 2)),
                          'appearanceIdentityVerified': False,
                          'note': 'Observed differences only; original UCS conversion and gamut soft clipping remain active even with neutral controls. No production zero-bypass added.'}
        else:
            assert a.zero_report and a.zero_report.exists(), 'Run/review zero+gray phase first and pass --zero-report'
            prior = json.loads(a.zero_report.read_text())
            assert prior['binarySHA256'] == binary_sha and prior['phase'] == 'zero' and prior['sourceHashes'] == source_hashes, 'Zero cohort differs'
            base, base_icc = load(ref/'inputs/controlled-tat-neutral.tif')
            base_xyz = transform(base.astype(np.float32)/65535, base_icc)
            zero_xyz = transform(zero, working_icc)
            output = transform(zero, working_icc, base_icc)
            zero_codes = np.rint(np.clip(output, 0, 1)*65535).astype(np.int32)
            rois = [(f'patch-{i:02d}', np.s_[(i//6)*160+32:(i//6)*160+128, (i%6)*256+32:(i%6)*256+224]) for i in range(24)]
            diagnostic = {'zeroBaselineXYZD50': stats(np.linalg.norm(zero_xyz-base_xyz, axis=2)), 'cases': []}
            for case in cases:
                image = run(case['id'], rgba, case['native'])
                xyz = transform(image, working_icc)
                actual, icc = load(Path(case['acr']))
                assert icc == base_icc
                ax = transform(actual.astype(np.float32)/65535, icc)
                encoded = transform(image, working_icc, base_icc)
                codes = np.rint(np.clip(encoded, 0, 1)*65535).astype(np.int32)
                tifffile.imwrite(scratch/(case['id']+'.tif'), codes.astype(np.uint16), photometric='rgb', metadata=None, extratags=[(34675,'B',len(icc),icc,False)])
                rows = []
                for name, roi in rois:
                    n, b = codes[roi], zero_codes[roi]
                    ac, ab = actual[roi].astype(np.int32), base[roi].astype(np.int32)
                    rows.append({'id': name, 'nativeDeltaRGB16': (n-b).mean((0, 1)).tolist(), 'acrDeltaRGB16': (ac-ab).mean((0, 1)).tolist(),
                                 'effectResidualXYZD50': stats(np.linalg.norm((xyz-zero_xyz)[roi]-(ax-base_xyz)[roi], axis=2)),
                                 'addedNativeClipPixels': int(((((n==0)&(b>0))|((n==65535)&(b<65535))).any(2)).sum()),
                                 'addedACRClipPixels': int(((((ac==0)&(ab>0))|((ac==65535)&(ab<65535))).any(2)).sum())})
                diagnostic['cases'].append({'id': case['id'], 'crs': case['crs'], 'native': case['native'], 'rois': rows})
        for path, h in source_hashes.items():
            assert digest(path) == h, path
        for path, h in manifest['sharedIdentities'].items():
            assert digest(path) == h, path
        assert digest(a.probe) == binary_sha
        report = {'phase': a.phase, 'scope': manifest['scope'], 'binarySHA256': binary_sha, 'sharedIdentities': manifest['sharedIdentities'],
                  'sourceHashes': source_hashes, 'request': request, 'results': results, 'diagnostic': diagnostic,
                  'lcmsSHA256': digest(libfile), 'fullModuleRuntimeEvidence': True, 'adobeEquivalenceVerified': False}
        target = a.report or Path('/tmp/captraw-dt-color-equalizer-'+a.phase+'.json')
        target.write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps({'report': str(target), 'phase': a.phase, 'cases': len(results), 'adobeEquivalenceVerified': False}))
        ok = True
finally:
    if ok:
        shutil.rmtree(scratch)
    else:
        print('Last failed run preserved:', scratch)
