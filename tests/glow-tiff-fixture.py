"""Materialize the fixed rendered-TIFF Glow input; never start an image engine.

Run: build/qa-venv/bin/python tests/glow-tiff-fixture.py
Keeps one input and manifest in a private temporary directory. Repeated writes
must be byte-identical; source pixels and ICC are never transformed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

import numpy as np
import tifffile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'artifacts/stage-0/acr-reference/controls-187/glow-zero.tif'
SOURCE_SHA256 = '1c56f4d3f0ba9a21486020cbc27ab36fa6ac0b02f00ef7db6f4c119878ef0a53'
PIXEL_SHA256 = 'fbaf80f2c709edada44284ed9380fef819a372642c5053767fb2f0affcefbd44'
ICC_SHA256 = '2b3aa1645779a9e634744faf9b01e9102b0c9b88fd6deced7934df86b949af7e'
TARGET_SHA256 = 'da7915588f6ac92cf3de084f7ba6aebf396e76017a77ae6a115d25786df7f379'
WRITER_VERSION = '2026.10.15'
ALLOWED_TAGS = {254, 256, 257, 258, 259, 262, 273, 274, 277, 278,
                279, 282, 283, 284, 296, 34675}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_input(path):
    with tifffile.TiffFile(path) as file:
        assert len(file.pages) == 1, 'Expected one TIFF image'
        page = file.pages[0]
        assert page.shape == (1024, 1536, 3) and page.dtype == np.uint16
        assert int(page.photometric) == 2 and int(page.planarconfig) == 1
        assert page.tags.get(274) is None or page.tags[274].value == 1
        pixels = page.asarray(maxworkers=1)
        icc = bytes(page.tags[34675].value)
        return pixels, icc, {tag.code for tag in page.tags.values()}


def write_input(path, pixels, icc):
    tifffile.imwrite(path, pixels, mode='x', byteorder='<', photometric='rgb',
                     planarconfig='contig', compression=None, rowsperstrip=1024,
                     subfiletype=0, metadata=None, software=False, datetime=False,
                     resolution=(300, 300), resolutionunit='INCH', iccprofile=icc,
                     extratags=[(274, 'H', 1, 1, False)], maxworkers=1, align=16)
    decoded, profile, tags = read_input(path)
    assert np.array_equal(decoded, pixels), 'Pixel data changed'
    assert profile == icc, 'ICC bytes changed'
    assert tags <= ALLOWED_TAGS, 'Unexpected metadata: ' + str(tags - ALLOWED_TAGS)
    return {'sha256': sha256(path.read_bytes()), 'bytes': path.stat().st_size,
            'pixelSha256': sha256(decoded.astype('<u2', copy=False).tobytes(order='C')),
            'iccSha256': sha256(profile), 'iccBytes': len(profile),
            'tagIds': sorted(tags)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / SOURCE)
    parser.add_argument('--output-dir', type=Path,
                        help='New directory only; default is a private temporary directory')
    args = parser.parse_args()
    assert tifffile.__version__ == WRITER_VERSION, 'Use the fixed build/qa-venv writer'
    source = args.source.resolve()
    assert sha256(source.read_bytes()) == SOURCE_SHA256, 'Source identity changed'
    pixels, icc, source_tags = read_input(source)
    assert sha256(pixels.astype('<u2', copy=False).tobytes(order='C')) == PIXEL_SHA256
    assert sha256(icc) == ICC_SHA256
    if args.output_dir:
        out = args.output_dir.absolute()
        out.mkdir(mode=0o700, parents=False, exist_ok=False)
    else:
        out = Path(tempfile.mkdtemp(prefix='captraw-glow-tiff-input-'))
    try:
        result = write_input(out / 'shared-input.tif', pixels, icc)
        repeat = Path(tempfile.mkdtemp(prefix='repeat-', dir=out))
        other = write_input(repeat / 'shared-input.tif', pixels, icc)
        assert result == other, 'Independent TIFF writes differ'
        assert result['sha256'] == TARGET_SHA256, 'Fixed TIFF container identity changed'
        shutil.rmtree(repeat)
        assert sha256(source.read_bytes()) == SOURCE_SHA256, 'Original source changed'
        manifest = {
            'schemaVersion': 1, 'localOnly': True, 'fixture': 'glow-shared-rendered-tiff-v1',
            'source': {'path': SOURCE, 'sha256': SOURCE_SHA256,
                       'origin': 'Existing ACR RAW-rendered zero-effect TIFF; used only as new input, never as the TIFF-effect target'},
            'input': {'file': 'shared-input.tif', **result, 'width': 1536, 'height': 1024,
                      'channels': 3, 'bitsPerSample': 16, 'orientation': 1, 'ppi': 300,
                      'pixelEncoding': 'row-major interleaved RGB uint16 little-endian',
                      'iccPolicy': 'Original embedded ICC bytes, unchanged',
                      'metadataPolicy': 'TIFF structural tags, orientation, PPI and ICC only; no XMP, EXIF, IPTC, Photoshop resources, camera or software metadata',
                      'removedSourceTagIds': sorted(source_tags - set(result['tagIds']))},
            'reproducibility': {'writer': 'tifffile', 'writerVersion': WRITER_VERSION,
                                'independentWrites': 2, 'containerIdentical': True,
                                'pixelIdenticalToSource': True, 'iccByteIdenticalToSource': True,
                                'originalSourceUnchanged': True},
            'acceptance': {'acrTiffReferences': 'pending-after-relative-WB-component',
                           'nativeZeroBaseline': 'pending-R-exclusive-window-release',
                           'artGaussianGlowAndHalation': 'pending-after-native-zero-baseline',
                           'rawGlowRendersAreTiffTargets': False,
                           'noEngineOrCUAInvoked': True}}
        with (out / 'manifest.json').open('x') as file:
            file.write(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'directory': str(out), 'input': result,
                          'reproducible': True, 'native': 'pending', 'acrTiff': 'pending'},
                         ensure_ascii=False))
    except BaseException:
        print('Failure retained: ' + str(out))
        raise


if __name__ == '__main__':
    main()
