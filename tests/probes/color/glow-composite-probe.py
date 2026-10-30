"""Isolated Glow composition falsification; no engine/build or parameter search.

Run with build/qa-venv/bin/python. All reference files are read-only. The
post-render Lab/XYZ probes are not the native working pipeline or Adobe kernels.
"""
import ctypes as ct
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile

import numpy as np
import tifffile

ROOT = next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
REF = ROOT / 'artifacts/stage-0/acr-reference/glow-tiff-187'
cache = (ROOT / 'build/native/CMakeCache.txt').read_text()
library = re.search(r'^pkgcfg_lib_LCMS_lcms2:FILEPATH=(.+)$', cache, re.M)[1]
cms = ct.CDLL(library)
P, U = ct.c_void_p, ct.c_uint32
for name, result, args in [
    ('cmsOpenProfileFromMem', P, [P, U]), ('cmsCreateLab4Profile', P, [P]),
    ('cmsCreateXYZProfile', P, []),
    ('cmsCreateTransform', P, [P, U, P, U, U, U]),
    ('cmsDoTransform', None, [P, P, P, U]),
    ('cmsDeleteTransform', None, [P]), ('cmsCloseProfile', None, [P]),
]:
    f = getattr(cms, name)
    f.restype, f.argtypes = result, args
RGB16 = (4 << 16) | (3 << 3) | 2
LAB64 = (1 << 22) | (10 << 16) | (3 << 3)
XYZ64 = (1 << 22) | (9 << 16) | (3 << 3)
RGB64 = (1 << 22) | (4 << 16) | (3 << 3)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with tifffile.TiffFile(path) as f:
        p = f.pages[0]
        a, icc = p.asarray(maxworkers=1), bytes(p.tags[34675].value)
        assert a.shape == (1024, 1536, 3) and a.dtype == np.uint16
        return a, icc


def common(a, icc, lab):
    buffer = ct.create_string_buffer(icc)
    src = cms.cmsOpenProfileFromMem(buffer, len(icc))
    dst = cms.cmsCreateLab4Profile(None) if lab else cms.cmsCreateXYZProfile()
    transform = cms.cmsCreateTransform(src, RGB16, dst, LAB64 if lab else XYZ64,
                                       1, 0x100 | 0x40)
    assert src and dst and transform
    out = np.empty(a.shape, dtype=np.float64)
    try:
        cms.cmsDoTransform(transform, a.ctypes.data, out.ctypes.data,
                           a.shape[0] * a.shape[1])
    finally:
        cms.cmsDeleteTransform(transform)
        cms.cmsCloseProfile(src)
        cms.cmsCloseProfile(dst)
    assert np.isfinite(out).all()
    return out


def from_lab(a, icc):
    buffer = ct.create_string_buffer(icc)
    src = cms.cmsCreateLab4Profile(None)
    dst = cms.cmsOpenProfileFromMem(buffer, len(icc))
    transform = cms.cmsCreateTransform(src, LAB64, dst, RGB64, 1, 0x100 | 0x40)
    assert src and dst and transform
    out = np.empty_like(a)
    try:
        cms.cmsDoTransform(transform, a.ctypes.data, out.ctypes.data,
                           a.shape[0] * a.shape[1])
    finally:
        cms.cmsDeleteTransform(transform)
        cms.cmsCloseProfile(src)
        cms.cmsCloseProfile(dst)
    assert np.isfinite(out).all()
    return out


def gate(value):
    # Exactly the current range50 gate, evaluated in the explicitly named domain.
    t = np.clip((np.maximum(0, value) - .475) / .525, 0, 1)
    return t * t * (3 - 2 * t)


def gaussian_row(sigma):
    # ART rt_algo.cc build_gaussian_kernel: finite .005 support, Simpson samples.
    size = (math.floor(1 + 2 * math.sqrt(-2 * sigma**2 * math.log(.005))) + 1) | 1
    x = np.arange(size) - size // 2
    f = lambda q: np.exp(-q**2 / (2 * sigma**2))
    row = (f(x - .5) + 4 * f(x) + f(x + .5)) / 6
    return row / row.sum()


def blur(a, row):
    # Independent separable scalar reproduction. Interior comparisons only;
    # edge replication is not asserted to reproduce ART FFT padding.
    out = a.copy()
    r = len(row) // 2
    for axis in range(a.ndim):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r, r)
        padded = np.pad(out, pad, mode='edge')
        result = np.zeros_like(out)
        for i, weight in enumerate(row):
            region = [slice(None)] * a.ndim
            region[axis] = slice(i, i + a.shape[axis])
            result += weight * padded[tuple(region)]
        out = result
    return out


ROIS = {
    'gray': (slice(528, 592), slice(608, 672)),
    'brightCore': (slice(520, 600), slice(1080, 1210)),
    'outerHalo': (slice(520, 600), slice(960, 1030)),
    'red': (slice(48, 112), slice(96, 160)),
    'green': (slice(48, 112), slice(352, 416)),
    'blue': (slice(48, 112), slice(608, 672)),
}


def main():
    work = Path(tempfile.mkdtemp(prefix='captraw-glow-composite-'))
    success = False
    try:
        manifest = json.loads((REF / 'pixels.json').read_text())
        source, icc = read(REF / 'input.tif')
        assert digest((REF / 'input.tif').read_bytes()) == manifest['inputSHA256']
        sealed = []
        for item in manifest['rows']:
            path = REF / item['tiff']
            a, profile = read(path)
            assert digest(path.read_bytes()) == item['sha256']
            assert digest(a.astype('<u2').tobytes()) == item['pixelSHA256']
            assert digest(profile) == item['iccSHA256']
            sealed.append(item['name'])
        assert len(sealed) == 13  # 14 TIFFs including the shared input.
        base, bi = read(REF / 'inputs/controlled-glow-zero.tif')
        lab, xyz = common(source, icc, True), common(source, icc, False)
        baseline_lab, baseline_xyz = common(base, bi, True), common(base, bi, False)
        row = gaussian_row(6.4)  # Existing spread50 on 1536x1024; never fitted.
        y, lightness = xyz[:, :, 1], lab[:, :, 0] / 100
        e_y, e_l = y * gate(y), lightness * gate(lightness)
        b_y, b_l = blur(e_y, row), blur(e_l, row)
        fields = {
            'current-difference-Y': ('Y', .65 * (b_y - e_y)),
            'add-Y-same-emitter': ('Y', .65 * b_y),
            'screen-Y-same-emitter': ('Y', .65 * (1 - y) * b_y),
            'screen-Lstar-perceptual-emitter': ('Lstar', .65 * (1 - lightness) * b_l),
        }
        # Test the Lab candidate through the actual source ICC and quantized
        # output gamut before attributing colored-patch signs to its lightness.
        proposed = lab.copy()
        proposed[:, :, 0] += 100 * .4 * fields['screen-Lstar-perceptual-emitter'][1]
        rgb = from_lab(proposed, icc)
        clipped = np.rint(np.clip(rgb, 0, 1) * 65535).astype(np.uint16)
        base_rgb = from_lab(lab, icc)
        roundtrip = np.rint(np.clip(base_rgb, 0, 1) * 65535).astype(np.uint16)
        final_y = common(clipped, icc, False)[:, :, 1] - common(roundtrip, icc, False)[:, :, 1]
        sentinels = from_lab(np.array([[[50., 150., 150.], [120., 0., 0.]]]), icc)
        gamut = {'roundtripMaxCode': int(np.abs(roundtrip.astype(np.int32)-source).max()),
                 'outputICCClampsSentinels': sentinels.tolist(),
                 'unboundedGamutOracle': False,
                 'candidateNewEndpointChannels': int((((clipped == 0) | (clipped == 65535)) &
                                                       (roundtrip > 0) & (roundtrip < 65535)).sum()),
                 'regionsAfterOutputGamutDeltaY': {n: float(final_y[roi].mean()) for n, roi in ROIS.items()}}
        # ART ipsoftlight.cc uses Pegtop with blend==base. Test the mature
        # two-input expression using a normalized blurred layer, at fixed40.
        # This is encoded output RGB, NOT ART's gamma-encoded working RGB.
        b = source.astype(np.float64) / 65535
        layer = np.stack([blur(b[:, :, c], row) for c in range(3)], axis=2)
        pegtop = (1 - 2 * layer) * b * b + 2 * layer * b
        candidate = b + .4 * (pegtop - b)
        assert candidate.min() >= 0 and candidate.max() <= 1
        pegtop_y = common(np.rint(candidate*65535).astype(np.uint16), icc, False)[:, :, 1] - y
        pegtop_probe = {
            'amount': .4, 'domain': 'encoded output RGB surrogate, not native working RGB',
            'regionsDeltaY': {n: float(pegtop_y[roi].mean()) for n, roi in ROIS.items()},
            'notCompleteGlow': ['No Range/Warmth mapping', 'Black base stays black even with nonzero blurred light',
                                'HDR extension undefined; not eligible for production'],
        }
        geometry = next(r['gradients'][0] for r in manifest['rows']
                        if r['name'] == 'global0-local0')
        yy = (np.arange(1024) + .5) / 1024
        coverage = np.clip((yy - float(geometry['ZeroY'])) /
                           (float(geometry['FullY']) - float(geometry['ZeroY'])), 0, 1)[:, None]
        observations = []
        for item in manifest['rows']:
            name = item['name']
            a, profile = read(REF / item['tiff'])
            dl = (common(a, profile, True) - baseline_lab)[:, :, 0] / 100
            dy = (common(a, profile, False) - baseline_xyz)[:, :, 1]
            regions = {n: {'actualDeltaY': float(dy[roi].mean()),
                           'actualDeltaLstar100': float(dl[roi].mean())}
                       for n, roi in ROIS.items()}
            # Local coverage is an explicit coordinate hypothesis, not Adobe ease.
            diffusion = name == 'diffusion40' or name.startswith('global')
            if diffusion:
                global_amount = float(item['settings']['Glow']) / 100
                local = float(item['settings'].get('LocalGlow', 0))
                amount = np.clip(global_amount + local * coverage, 0, 1)
                for label, (domain, delta) in fields.items():
                    actual = dy if domain == 'Y' else dl
                    pred = amount * delta
                    for n, roi in ROIS.items():
                        regions[n][label] = {
                            'predictedDelta': float(pred[roi].mean()),
                            'meanAbsDeltaResidual': float(np.abs(pred[roi] - actual[roi]).mean()),
                        }
            observations.append({'case': name, 'regions': regions})
        constants = []
        for v in [.05, .381, .8, 1., 2., -.1]:
            signal = np.full(513, v)
            emitter = signal * gate(signal)
            scattered = blur(emitter, row)
            difference = .4 * .65 * (scattered - emitter)
            assert np.max(np.abs(difference)) < 1e-14
            constants.append({'domainValue': v, 'differenceDeltaMax': float(abs(difference).max()),
                              'addDelta': float(.4 * .65 * scattered[256]),
                              'screenDelta': float(.4 * .65 * (1-v) * scattered[256])})
        # Keep input-domain and post-gamut signs separate in the diagnostics.
        for v in [.05, .381, .8]:
            l = (116 * np.cbrt(v) - 16) / 100 if v > (6/29)**3 else 903.296296*v/100
            constants.append({'linearGrayY': v, 'Lstar100': l,
                              'perceptualScreenDeltaLstar100': float(.4*.65*(1-l)*l*gate(l))})
        impulse = np.zeros(513); impulse[256] = 1
        tail = blur(impulse, row)
        assert tail[256+len(row)//2+1] == 0
        result = {'sourceSHA256': manifest['inputSHA256'], 'referencesVerified': sealed,
                  'kernel': {'sigma': 6.4, 'radius': len(row)//2, 'sum': float(row.sum()),
                             'impulseAt40px': float(tail[296]), 'impulseAt80px': float(tail[336])},
                  'constants': constants, 'observations': observations,
                  'perceptualScreenOutputGamut': gamut,
                  'twoInputPegtopProbe': pegtop_probe,
                  'scope': 'Post-render scalar-domain probes; .4 amount and existing .65 gain fixed; no fitting, engine, native build or Adobe equivalence claim',
                  'localCoverage': 'Linear signed-add-clamp hypothesis only; not actual coverage/strength proof',
                  'productionChanged': False}
        print(json.dumps(result, ensure_ascii=False))
        success = True
    except BaseException as error:
        (work / 'failure.json').write_text(json.dumps({'error': str(error)}))
        print('Failure retained:', work)
        raise
    finally:
        if success:
            shutil.rmtree(work)


if __name__ == '__main__':
    main()
