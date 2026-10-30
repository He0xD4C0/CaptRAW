"""Numerical integration of the production float conversion, not GUI acceptance."""
import ctypes
import ctypes.util
import itertools
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
# Independent D65 matrices derived from the xy primaries, per CSS Color 4.
# https://www.w3.org/TR/css-color-4/#color-conversion-code
WHITE = np.array([.3127 / .3290, 1., (1. - .3127 - .3290) / .3290])
def matrix(primaries):
    columns = np.array([[x / y, 1., (1. - x - y) / y] for x, y in primaries]).T
    return columns @ np.diag(np.linalg.solve(columns, WHITE))
P3 = matrix([(.680, .320), (.265, .690), (.150, .060)])
REC2020 = matrix([(.708, .292), (.170, .797), (.131, .046)])
SRGB = matrix([(.640, .330), (.300, .600), (.150, .060)])
# Gray/dark/gradient and full P3 gamut, including colors outside sRGB.
expected = np.array(list(itertools.product([0., .001, .01, .1, .5, 1.], repeat=3)))
source = expected @ P3.T @ np.linalg.inv(REC2020).T
# Preserve signed/extended values until the final SDR presentation boundary.
extended = np.array([[-.1, .2, .3], [1.5, .5, .25]])
source = np.vstack([source, extended])
expected = np.vstack([expected, extended @ REC2020.T @ np.linalg.inv(P3).T])
proofLinear = np.clip(source @ REC2020.T @ np.linalg.inv(SRGB).T, 0., 1.) @ SRGB.T @ np.linalg.inv(P3).T
proofExpected = np.sign(proofLinear) * np.where(np.abs(proofLinear) <= .0031308, 12.92 * np.abs(proofLinear), 1.055 * np.abs(proofLinear) ** (1 / 2.4) - .055)
root = Path(tempfile.mkdtemp(prefix='captraw-p3-numeric-'))
passed = False
try:
    command = [os.environ.get('CAPTRAW_COLOR_PROBE', str(ROOT / 'build/native/captraw-color-chain-probe')),
               os.environ.get('CAPTRAW_RESOURCES', str(ROOT / 'build/native/resources')), str(root / 'cache')]
    result = subprocess.run(command, input=json.dumps(source.tolist()), text=True, capture_output=True, check=True)
    response = json.loads(result.stdout)
    actual = np.array(response['pixels'])
    encoded = np.array(response['displayPixels'])
    proof = np.array(response['proofPixels'])
    absolute = np.abs(encoded)
    decoded = np.sign(encoded) * np.where(absolute <= .04045, absolute / 12.92, ((absolute + .055) / 1.055) ** 2.4)
    assert actual.shape == expected.shape and np.isfinite(actual).all()
    assert actual[-2, 0] < 0 and actual[-1].max() > 1, 'hidden pre-display clipping'
    np.testing.assert_allclose(actual, expected, atol=.002, rtol=.002)
    np.testing.assert_allclose(proof, proofExpected, atol=.002, rtol=.002)
    def lab(rgb):
        xyz = rgb @ P3.T / WHITE
        f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
        return np.column_stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])])
    class Lab(ctypes.Structure):
        _fields_ = [('L', ctypes.c_double), ('a', ctypes.c_double), ('b', ctypes.c_double)]
    library = ctypes.CDLL(os.environ.get('CAPTRAW_LCMS') or ctypes.util.find_library('lcms2') or str(ROOT / 'build/bundle/native/lib/liblcms2.2.dylib'))
    delta = library.cmsCIE2000DeltaE
    delta.argtypes = [ctypes.POINTER(Lab), ctypes.POINTER(Lab), ctypes.c_double, ctypes.c_double, ctypes.c_double]
    delta.restype = ctypes.c_double
    errors = np.array([delta(ctypes.byref(Lab(*a)), ctypes.byref(Lab(*b)), 1., 1., 1.)
                       for a, b in zip(lab(actual[:-2]), lab(expected[:-2]))])
    assert errors.mean() <= .2 and errors.max() <= 1, (errors.mean(), errors.max())
    display_errors = np.array([delta(ctypes.byref(Lab(*a)), ctypes.byref(Lab(*b)), 1., 1., 1.)
                               for a, b in zip(lab(decoded[:-2]), lab(expected[:-2]))])
    assert display_errors.mean() <= .2 and display_errors.max() <= 1, (display_errors.mean(), display_errors.max())
    proof_absolute = np.abs(proof)
    proof_decoded = np.sign(proof) * np.where(proof_absolute <= .04045, proof_absolute / 12.92, ((proof_absolute + .055) / 1.055) ** 2.4)
    proof_errors = np.array([delta(ctypes.byref(Lab(*a)), ctypes.byref(Lab(*b)), 1., 1., 1.)
                             for a, b in zip(lab(proof_decoded[:-2]), lab(np.clip(source[:-2] @ REC2020.T @ np.linalg.inv(SRGB).T, 0., 1.) @ SRGB.T @ np.linalg.inv(P3).T))])
    assert proof_errors.mean() <= .2 and proof_errors.max() <= 1, (proof_errors.mean(), proof_errors.max())
    print(json.dumps({'samples': len(errors), 'meanDeltaE00': float(errors.mean()),
                      'maxDeltaE00': float(errors.max()), 'displayMeanDeltaE00': float(display_errors.mean()),
                      'displayMaxDeltaE00': float(display_errors.max()), 'proofMeanDeltaE00': float(proof_errors.mean()),
                      'proofMaxDeltaE00': float(proof_errors.max()), 'signedAndExtendedPreserved': True,
                      'reference': 'independent D65 xy matrices; sRGB proof clips to unit range; LittleCMS only for CIEDE2000 metric'}))
    passed = True
finally:
    if passed:
        shutil.rmtree(root)
    else:
        print('Retained color-chain failure:', root)
