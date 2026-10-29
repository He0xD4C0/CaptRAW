"""Author one deterministic, synthetic stage-0 RAW chart; never camera data.

Run with build/qa-venv/bin/python tests/acr-reference-fixtures.py --tiff.
--output-dir permits isolated reproducibility checks, without touching baselines.

DNG 1.4 sections 2-4: Orientation is required (p20); primary RAW uses
NewSubFileType=0; a thumbnail is recommended, not mandatory (p13).
The old synthetic.dng lacks Orientation and NewSubFileType. Its identity
ColorMatrix1 is not an XYZ-to-sRGB matrix, but is not itself illegal DNG.
These facts do not establish ACR's internal rejection reason or acceptance
of this candidate. Only the independent real ACR UI check can establish that.

Primary specifications (no SDK or camera profile is copied or linked):
https://www.kronometric.org/phot/processing/DNG/dng_spec_1.4.0.0.pdf
https://registry.color.org/rgb-registry/srgb
"""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import tempfile

import numpy as np
from PIL import ImageCms
import tifffile


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 1536, 1024
BLACK, WHITE = 512, 65535
MODEL = 'CaptRAW Synthetic Chart v1'
# Authored linear RGB values, row-major; not a measured commercial chart.
PATCHES = np.array([
    [.8, .02, .02], [.02, .8, .02], [.02, .02, .8],
    [.8, .8, .02], [.02, .8, .8], [.8, .02, .8],
    [.6, .15, .05], [.6, .35, .05], [.3, .6, .05],
    [.05, .6, .3], [.05, .3, .6], [.3, .05, .6],
    [.45, .20, .12], [.65, .4, .3], [.12, .25, .45],
    [.15, .35, .12], [.4, .15, .3], [.35, .4, .6],
    [.02, .02, .02], [.05, .05, .05], [.18, .18, .18],
    [.4, .4, .4], [.7, .7, .7], [.95, .95, .95],
], dtype=np.float64)


def chart():
    rgb = np.full((HEIGHT, WIDTH, 3), .18, dtype=np.float64)
    for i, color in enumerate(PATCHES):
        y, x = (i // 6) * 160, (i % 6) * 256
        rgb[y + 12:y + 148, x + 12:x + 244] = color
    for i in range(16):
        rgb[640:832, i * 96:(i + 1) * 96] = i / 15
    rgb[832:928] = np.linspace(0, 1, WIDTH)[None, :, None]
    rgb[928:1024] = np.exp2(np.linspace(-12, 0, WIDTH))[None, :, None]
    return rgb


def color_matrix():
    # Derive linear RGB -> XYZ from ICC sRGB primaries and D65 chromaticity.
    xy = np.array([[.64, .33], [.30, .60], [.15, .06]])
    basis = np.array([xy[:, 0] / xy[:, 1], np.ones(3),
                      (1 - xy.sum(axis=1)) / xy[:, 1]])
    white_xyz = np.array([.3127 / .3290, 1, (1 - .3127 - .3290) / .3290])
    rgb_to_xyz = basis * np.linalg.solve(basis, white_xyz)
    # DNG ColorMatrix1 direction is XYZ -> reference camera, NOT the inverse.
    numerators = np.rint(np.linalg.inv(rgb_to_xyz) * 1000000).astype(np.int32)
    matrix = numerators.astype(np.float64) / 1000000
    np.testing.assert_allclose(matrix @ white_xyz, np.ones(3), atol=2e-6)
    rationals = tuple(v for n in numerators.flat for v in (int(n), 1000000))
    return matrix, rationals


def srgb_encode(rgb):
    return np.where(rgb <= .0031308, 12.92 * rgb,
                    1.055 * rgb ** (1 / 2.4) - .055)


def icc_profile():
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    # lcms writes the creation clock into ICC headers. Fix it for reproducibility.
    profile[24:36] = struct.pack('>6H', 2000, 1, 1, 0, 0, 0)
    profile[84:100] = bytes(16)  # Optional ICC profile ID is unset.
    return bytes(profile)


def verify(path, raw, matrix):
    with tifffile.TiffFile(path) as f:
        assert not f.is_bigtiff and f.byteorder == '<' and len(f.pages) == 1
        preview = f.pages[0]
        assert preview.tags[254].value == 1 and preview.tags[274].value == 1
        assert preview.tags[50706].value == bytes((1, 4, 0, 0))
        assert preview.tags[50708].value == MODEL
        assert preview.asarray().shape == (HEIGHT // 4, WIDTH // 4, 3)
        assert len(preview.pages) == 1
        page = preview.pages[0]
        assert page.tags[254].value == 0 and page.tags[274].value == 1
        assert page.photometric == 32803 and page.compression == 1
        assert page.bitspersample == 16 and page.samplesperpixel == 1
        assert page.tags[33421].value == (2, 2)
        assert page.tags[33422].value == bytes((0, 1, 1, 2))
        assert page.tags[50710].value == bytes((0, 1, 2))
        assert page.tags[50713].value == (1, 1)
        assert page.tags[50714].value == (BLACK, 1)
        assert page.tags[50717].value == WHITE
        assert page.tags[50719].value == (0, 0)
        assert page.tags[50720].value == (WIDTH, HEIGHT)
        assert page.tags[50829].value == (0, 0, HEIGHT, WIDTH)
        assert preview.tags[50728].value == (1, 1, 1, 1, 1, 1)
        values = np.array(preview.tags[50721].value).reshape(9, 2)
        np.testing.assert_array_equal((values[:, 0] / values[:, 1]).reshape(3, 3), matrix)
        np.testing.assert_array_equal(page.asarray(), raw)
        for offset, count in zip(page.dataoffsets, page.databytecounts):
            assert offset + count <= path.stat().st_size
        assert sum(page.databytecounts) == raw.nbytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path,
                        default=ROOT / 'artifacts/stage-0/acr-reference/source')
    parser.add_argument('--tiff', action='store_true', help='Also write a 16-bit sRGB ICC TIFF')
    args = parser.parse_args()
    rgb = chart()
    matrix, rationals = color_matrix()
    # RGGB mosaic of the exact authored scene; no noise, lens model or EXIF fiction.
    raw = np.empty((HEIGHT, WIDTH), dtype='<u2')
    for y, x, c in ((0, 0, 0), (0, 1, 1), (1, 0, 1), (1, 1, 2)):
        raw[y::2, x::2] = np.rint(BLACK + (WHITE - BLACK) * rgb[y::2, x::2, c])
    provenance = {
        'source': 'Authored mathematical chart, not a camera capture or measured color target',
        'generator': 'tests/acr-reference-fixtures.py',
        'generator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'dependencies': {'numpy': np.__version__, 'tifffile': tifffile.__version__},
        'size_wh': [WIDTH, HEIGHT], 'linear_range': [0, 1],
        'raw_encoding': 'uint16 round(512 + 65023 * linear_channel); RGGB at origin',
        'raw_range': [int(raw.min()), int(raw.max())],
        'black_level': BLACK, 'white_level': WHITE, 'illuminant': 'D65 (21)',
        'native_channels': 'Synthetic scene-linear RGB using sRGB primaries, D65 white',
        'color_matrix1_xyz_to_native': matrix.tolist(),
        'matrix_rational_denominator': 1000000, 'as_shot_neutral': [1, 1, 1],
        'matrix_source': 'https://registry.color.org/rgb-registry/srgb',
        'dng_source': 'https://www.kronometric.org/phot/processing/DNG/dng_spec_1.4.0.0.pdf',
        'patches': {'grid': [4, 6], 'cell_wh': [256, 160], 'inset': 12,
                    'linear_rgb_row_major': PATCHES.tolist()},
        'gray_steps': {'y': [640, 832], 'cell_width': 96,
                       'linear_values': [i / 15 for i in range(16)]},
        'linear_ramp': {'y': [832, 928], 'function': 'x / 1535'},
        'stop_ramp': {'y': [928, 1024], 'function': '2 ** (-12 + 12 * x / 1535)'},
        'preview': '4x4 area mean of source linear RGB, then sRGB transfer, uint8',
        'tiff': 'Same source RGB, sRGB transfer, uint16, embedded sRGB ICC; not RAW',
        'acceptance': 'Structural/readback checks only; real ACR UI acceptance is external',
    }
    description = json.dumps(provenance, sort_keys=True, separators=(',', ':'))
    global_tags = [
        (271, 's', 0, 'CaptRAW', False), (272, 's', 0, 'Synthetic Chart v1', False),
        (274, 'H', 1, 1, False),
        (50706, 'B', 4, (1, 4, 0, 0), False),
        (50707, 'B', 4, (1, 3, 0, 0), False),
        (50708, 's', 0, MODEL, False),
        (50721, '2i', 9, rationals, False),
        (50728, '2I', 3, (1, 1, 1, 1, 1, 1), False),
        (50730, '2i', 1, (0, 1), False),  # BaselineExposure: no exposure offset.
        (50778, 'H', 1, 21, False),
    ]
    raw_tags = [
        (274, 'H', 1, 1, False),
        (33421, 'H', 2, (2, 2), False), (33422, 'B', 4, (0, 1, 1, 2), False),
        (50710, 'B', 3, (0, 1, 2), False), (50711, 'H', 1, 1, False),
        (50713, 'H', 2, (1, 1), False), (50714, '2I', 1, (BLACK, 1), False),
        (50717, 'I', 1, WHITE, False),
        (50718, '2I', 2, (1, 1, 1, 1), False),
        (50719, 'I', 2, (0, 0), False), (50720, 'I', 2, (WIDTH, HEIGHT), False),
        (50829, 'I', 4, (0, 0, HEIGHT, WIDTH), False),
    ]
    preview = rgb.reshape(HEIGHT // 4, 4, WIDTH // 4, 4, 3).mean(axis=(1, 3))
    preview = np.rint(srgb_encode(preview) * 255).astype('uint8')
    icc = icc_profile()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    # Only validated results become visible at the final paths; no variants survive.
    with tempfile.TemporaryDirectory(prefix='.acr-chart-', dir=args.output_dir) as temp:
        candidate = Path(temp) / 'acr-chart.dng'
        with tifffile.TiffWriter(candidate, byteorder='<', bigtiff=False) as writer:
            writer.write(preview, photometric='rgb', subfiletype=1, subifds=1,
                         compression=None, metadata=None, datetime=False,
                         software='CaptRAW chart generator v1', description=description,
                         extratags=global_tags)
            writer.write(raw, photometric=32803, subfiletype=0, compression=None,
                         rowsperstrip=64, metadata=None, datetime=False,
                         software=False, extratags=raw_tags)
        verify(candidate, raw, matrix)
        if args.tiff:
            fallback = Path(temp) / 'acr-chart.tif'
            encoded = np.rint(srgb_encode(rgb) * 65535).astype('<u2')
            tifffile.imwrite(fallback, encoded, photometric='rgb', byteorder='<',
                             compression=None, metadata=None, datetime=False,
                             description=description, software='CaptRAW chart generator v1',
                             iccprofile=icc, extratags=[(274, 'H', 1, 1, False)])
            with tifffile.TiffFile(fallback) as f:
                np.testing.assert_array_equal(f.pages[0].asarray(), encoded)
                assert f.pages[0].tags[34675].value == icc
            fallback.replace(args.output_dir / fallback.name)
        candidate.replace(args.output_dir / candidate.name)
    for name in ('acr-chart.dng', 'acr-chart.tif') if args.tiff else ('acr-chart.dng',):
        path = args.output_dir / name
        print(json.dumps({'file': str(path.resolve()), 'bytes': path.stat().st_size,
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
