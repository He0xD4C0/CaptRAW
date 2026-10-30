"""Read-only structural checks of fixed Glow amount hypotheses, never a fit.

Nominal 10/30/70 below are conditional on additive global/local amount and a
shared operator. They are NOT independently captured global slider settings.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
import tifffile

ROOT = next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
REF = ROOT / 'artifacts/stage-0/acr-reference/glow-tiff-187'
CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/'
NAMES = ['global0-local0', 'global0-local-minus30', 'global0-local-plus30',
         'global40-local-minus30', 'global40-local0', 'global40-local-plus30',
         'diffusion40']
LEVELS = {10: 'global40-local-minus30', 30: 'global0-local-plus30',
          40: 'global40-local0', 70: 'global40-local-plus30'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    spec = importlib.util.spec_from_file_location('icc_math', ROOT / 'tests/probes/color/glow-composite-probe.py')
    math = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(math)
    manifest = json.loads((REF / 'pixels.json').read_text())
    arrays, profiles, verified, geometries = {}, {}, {}, []
    for row in manifest['rows']:
        path = REF / row['tiff']
        assert sha(path.read_bytes()) == row['sha256']
        with tifffile.TiffFile(path) as f:
            a = f.pages[0].asarray(maxworkers=1)
            icc = bytes(f.pages[0].tags[34675].value)
        assert sha(a.astype('<u2').tobytes()) == row['pixelSHA256']
        assert sha(icc) == row['iccSHA256']
        verified[row['name']] = row['sha256']
        if row['name'] in NAMES:
            arrays[row['name']], profiles[row['name']] = a, icc
        if row['name'].startswith('global'):
            tree = ET.parse(REF / row['xmp'])
            attrs = lambda e: {k.removeprefix('{'+CRS+'}'): v for k, v in e.attrib.items() if k.startswith('{'+CRS+'}')}
            gradients = [attrs(e) for e in tree.iter() if e.attrib.get('{'+CRS+'}What') == 'Mask/Gradient']
            corrections = [attrs(e) for e in tree.iter() if '{'+CRS+'}CorrectionAmount' in e.attrib]
            assert len(gradients) == len(corrections) == 1
            g, c = gradients[0], corrections[0]
            assert g['MaskActive'] == 'true' and g['MaskInverted'] == 'false' and g['MaskBlendMode'] == '0'
            assert float(c['CorrectionAmount']) == 1
            assert float(g['ZeroX']) == float(g['FullX']) and float(g['FullY']) > float(g['ZeroY'])
            geometries.append({k: g[k] for k in ['ZeroX', 'ZeroY', 'FullX', 'FullY']})
    assert len(verified) == 13 and len(geometries) == 6
    assert all(g == geometries[0] for g in geometries)
    assert np.array_equal(arrays['diffusion40'], arrays['global40-local0'])
    full_y = float(geometries[0]['FullY']) * 1024
    # Predeclared positions across the existing lower neutral ramp. All lie
    # geometrically beyond FullY; no inferred feather weights or selected ROIs.
    assert 864 > full_y
    x_positions = [200, 350, 500, 640, 800, 1000, 1200, 1400]
    baseline = arrays['global0-local0']
    xyz = {n: math.common(np.ascontiguousarray(a[864:896]), profiles[n], False)[:, :, 1]
           for n, a in arrays.items()}
    rows, intervals = [], {n: [] for n in [10, 30, 70]}
    for x in x_positions:
        roi = (slice(864, 896), slice(x, x+24))
        codes = {n: (arrays[name][roi].astype(np.int32)-baseline[roi].astype(np.int32)).mean((0, 1))
                 for n, name in LEVELS.items()}
        dy = {n: float((xyz[name]-xyz['global0-local0'])[:, x:x+24].mean())
              for n, name in LEVELS.items()}
        ratios = {n: float(dy[n]/dy[40]) for n in [10, 30, 70]}
        channel_intervals = {}
        for n in [10, 30, 70]:
            bounds = []
            for channel in range(3):
                denominator = float(codes[40][channel])
                assert abs(denominator) > 1
                numerator = float(codes[n][channel]) * (1 if denominator > 0 else -1)
                # Only tests a scalar mapping applied at final encoded RGB:
                # +/-1 difference-code covers two independent +/-0.5 roundings.
                bound = [(numerator-1)/(abs(denominator)+1),
                         (numerator+1)/(abs(denominator)-1)]
                bounds.append(bound)
                intervals[n].append(bound)
            channel_intervals[n] = bounds
        endpoint_counts = {n: int(np.count_nonzero((arrays[name][roi] == 0) | (arrays[name][roi] == 65535)))
                           for n, name in LEVELS.items()}
        rows.append({'roi': [x, 864, 24, 32], 'deltaY': dy, 'ratiosTo40Y': ratios,
                     'deltaRGB16': {n: a.tolist() for n, a in codes.items()},
                     'finalRGBScalarRatioIntervals': channel_intervals,
                     'outputEndpointSamples': endpoint_counts})
    tests = {}
    for n, bounds in intervals.items():
        lo, hi = max(b[0] for b in bounds), min(b[1] for b in bounds)
        tests[n] = {'universalFinalRGBScalarRatioIntersection': [lo, hi],
                    'nonemptyIntersection': lo <= hi,
                    'fixedLinearRatio': n/40, 'fixedQuadraticRatio': (n/40)**2,
                    'linearAdmissibleInEveryInterval': all(l <= n/40 <= h for l, h in bounds),
                    'quadraticAdmissibleInEveryInterval': all(l <= (n/40)**2 <= h for l, h in bounds)}
    partial_roi = (slice(528, 592), slice(608, 672))
    partial = {}
    for n in NAMES[:-1]:
        a = math.common(np.ascontiguousarray(arrays[n][partial_roi]), profiles[n], False)[:, :, 1]
        z = math.common(np.ascontiguousarray(baseline[partial_roi]), profiles[n], False)[:, :, 1]
        partial[n] = float((a-z).mean())
    result = {'referencesSHA256': verified, 'geometry': geometries[0],
              'globalDiffusion40EqualsGlobal40Local0Pixels': True,
              'conditionalNominalAmounts': LEVELS, 'fullCoverageRows': rows,
              'fixedStructuralTests': tests, 'partialCoverageGrayDeltaY': partial,
              'partialLinearSymmetryResidualY': partial['global40-local-plus30'] + partial['global40-local-minus30'] - 2*partial['global40-local0'],
              'inference': 'Under additive global/local amount and a shared separable output operator, final RGB response cannot use one universal scalar amount mapping across these fixed ROIs; even arbitrary nonlinear scalar ratios have empty intersections. Linear and quadratic witnesses reject without fitting.',
              'limits': ['Nominal10/30/70 are conditional, not standalone global captures',
                         'Cannot isolate amount mapping from global/local composition or operator order',
                         'Final RGB scalar rejection does not reject nonlinear processing after an upstream mapping',
                         'Partial-coverage pixels do not identify exact Adobe coverage or effective amounts',
                         'No parameter fitting, native run, production change or Adobe algorithm identity claim']}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
