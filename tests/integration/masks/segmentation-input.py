"""Native PNG -> official-equivalent SAM2 tensor -> mask, without GUI windows.

Torch/Pillow run only as independent test references. Every native invocation is
network denied and cannot read Homebrew. Installed application stays unchanged.
"""
from pathlib import Path
import sys, json, hashlib, subprocess, struct, zlib, gc, tempfile, shutil
from importlib.util import spec_from_file_location, module_from_spec
import numpy as np
import torch
from PIL import Image, PngImagePlugin
import onnxruntime as ort

ROOT = next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
WORK = ROOT / 'build/segmentation'
OUT = ROOT / 'artifacts/segmentation-input'
sys.path.insert(0, str(WORK / 'upstream/sam2-2b90b9f5ceec907a1c18123530e92e794ad901a4'))
spec = spec_from_file_location('preprocess_export', ROOT / 'scripts/export-segmentation-preprocess.py')
generator = module_from_spec(spec)
spec.loader.exec_module(generator)
export = generator.export
from sam2.utils.transforms import SAM2Transforms

OUT.mkdir(exist_ok=True)
torch.set_num_threads(8)
ort.disable_telemetry_events()
options = ort.SessionOptions()
options.intra_op_num_threads = 8
options.inter_op_num_threads = 1
options.enable_mem_pattern = False
graph = export(WORK / 'models/preprocess.onnx')
assert export(WORK / 'models/preprocess.onnx') == graph, 'Graph is not reproducible'
preprocessor = ort.InferenceSession(graph['path'], options, providers=['CPUExecutionProvider'])
transform = SAM2Transforms(1024, 0, max_hole_area=0, max_sprinkle_area=0)
binary = WORK / 'runtime-probe'
checks, preparations, comparisons, invalid, fixtures, tensor_regressions = [], [], [], [], [], []
hash_file = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def native(args, name, success=True):
    command = ['/usr/bin/time', '-l', '/usr/bin/sandbox-exec', '-f',
               str(ROOT / 'tests/support/offline-native.sb'), str(binary), *map(str, args)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    (OUT / (name + '.log')).write_text(result.stdout + result.stderr)
    assert (result.returncode == 0) == success, (command, result.stderr, result.stdout)
    if not success:
        return result.stderr
    row = json.loads(result.stdout)
    row['peakRSSBytes'] = int(next(s.strip().split()[0] for s in result.stderr.splitlines()
                                  if 'maximum resident set size' in s))
    return row


def png(name, pixels):
    path = OUT / 'inputs' / (name + '.png')
    info = PngImagePlugin.PngInfo()
    info.add(b'sRGB', b'\x01')
    Image.fromarray(pixels).save(path, pnginfo=info)
    fixtures.append(path)
    return path


for source in ['canon-r5.CR3', 'fuji-xt4.RAF', 'nikon-d850.NEF']:
    image = np.asarray(Image.open(ROOT / 'artifacts/segmentation/inputs' / (source + '.jpg')).convert('RGB'))
    png(source + '-reference', image)
engine = json.loads((OUT / 'engine-inputs.json').read_text())
assert engine['offlineAndHomebrewDenied']
for row in engine['rows']:
    assert hash_file(row['source']) == row['sourceSHA256']
    assert hash_file(row['input']) == row['inputSHA256']
    fixtures.append(Path(row['input']))
for h, w in [(1, 1), (1, 17), (19, 1), (17, 31), (1024, 1024), (1201, 800),
             (2053, 2049), (3, 2048), (2048, 3)]:
    png(f'random-{w}x{h}', np.random.default_rng(h * w).integers(0, 256, (h, w, 3), np.uint8))
for name, h, w in [('gradient', 333, 501), ('large-45mp', 5504, 8256)]:
    x, y = np.arange(w, dtype=np.uint16), np.arange(h, dtype=np.uint16)[:, None]
    image = np.empty((h, w, 3), np.uint8)
    image[:, :, 0] = x % 256
    image[:, :, 1] = y % 256
    image[:, :, 2] = (x + y) % 256
    png(name, image)
    del image, x, y
pattern = ((np.arange(3072)[:, None] + np.arange(4096)) % 2 * 255).astype(np.uint8)
png('checkerboard', np.repeat(pattern[:, :, None], 3, axis=2))
del pattern
for value in [0, 255]:
    png(f'constant-{value}', np.full((13, 29, 3), value, np.uint8))
primaries = np.zeros((65, 97, 3), np.uint8)
for channel in range(3):
    primaries[:, channel * 32:(channel + 1) * 32, channel] = 255
png('颜色 三原色', primaries)
for h, w in [(257, 509), (999, 1001), (511, 1023)]:
    bands = np.zeros((h, w, 3), np.uint8)
    for c in range(3):
        bands[:, c * (w // 3):(c + 1) * (w // 3), c] = 255
    png(f'color-edges-{w}x{h}', bands)

for path in fixtures:
    a = np.asarray(Image.open(path).convert('RGB'))
    output = OUT / (path.stem + '.f32')
    stats = native(['--preprocess', path, graph['path'], output], path.stem + '-preprocess')
    actual = np.fromfile(output, np.float32).reshape(1, 3, 1024, 1024)
    with torch.inference_mode():
        expected = transform(a).numpy()[None]
    error = np.abs(actual - expected)
    # ORT derives inverse coordinates from FP32 output/input scales; Torch AA
    # uses input/output scale directly. Sharp upsampled edges expose roundoff.
    # Bound this to 1/64 of a single RGB8 quantization level, then independently
    # require selected mask IoU > .9999 and score error < 1e-4 below.
    rgb_error = error * np.array([.229, .224, .225], np.float32).reshape(1, 3, 1, 1) * 255
    assert np.isfinite(actual).all() and rgb_error.max() < 1/64, (path, error.max(), rgb_error.max())
    # Distinguishes decoding/ABI changes from reference interpolation roundoff.
    python_ort = preprocessor.run(None, {'rgb': a[None]})[0]
    assert np.array_equal(actual, python_ort), path
    preparations.append({'input': str(path), 'inputSHA256': hash_file(path),
        'shape': list(a.shape), 'tensorSHA256': hash_file(output),
        'torchMaximumDifference': float(error.max()), 'torchMeanDifference': float(error.mean()),
        'equivalentRGB8LevelDifference': float(rgb_error.max()),
        'pythonORTByteExact': True, **stats})
    print('PREPROCESS', path.name, float(error.max()), flush=True)
    del a, actual, expected, error, rgb_error, python_ort
    gc.collect()
checks.append('24 RGB8 previews and synthetic cases stay within 1/64 RGB8 level of the official transform; native/Python ORT are bit exact')

# Retain all ten old inference cases and add real engine preview inputs.
for model in ['tiny', 'small']:
    directory = WORK / 'models' / model
    encoder = ort.InferenceSession(str(directory / 'encoder.onnx'), options, providers=['CPUExecutionProvider'])
    decoder = ort.InferenceSession(str(directory / 'decoder.onnx'), options, providers=['CPUExecutionProvider'])
    old = json.loads((ROOT / 'artifacts/segmentation' / (model + '-report.json')).read_text())
    cases = []
    for row in old['cases']:
        path = OUT / 'inputs' / (Path(row['input']).name.removesuffix('.jpg') + '-reference.png')
        prompts = json.loads((ROOT / 'artifacts/segmentation/inputs' / (row['case'] + '-prompts.json')).read_text())
        cases.append((row['case'], path, prompts, row))
    for row, base_case in zip(engine['rows'], ['sky', 'apple', 'chart-box']):
        path = Path(row['input'])
        original = json.loads((ROOT / 'artifacts/segmentation/inputs' / (base_case + '-prompts.json')).read_text())
        prompts = {'width': row['width'], 'height': row['height'], 'labels': original['labels'],
                   'points': [[x / original['width'] * row['width'], y / original['height'] * row['height']]
                              for x, y in original['points']]}
        cases.append(('engine-' + base_case, path, prompts, None))
    for name, path, prompts, old_case in cases:
        pp = OUT / (name + '-prompts.json')
        pp.write_text(json.dumps(prompts))
        prefix = OUT / (model + '-' + name)
        stats = native([directory, path, pp, prefix], model + '-' + name)
        a = np.asarray(Image.open(path).convert('RGB'))
        with torch.inference_mode():
            tensor = transform(a).numpy()[None]
        features = encoder.run(None, {'image': tensor})
        coords = np.array(prompts['points'], np.float32).reshape(1, -1, 2)
        coords *= np.array([1024 / prompts['width'], 1024 / prompts['height']], np.float32)
        inputs = dict(zip(['image_features_0', 'image_features_1', 'image_embeddings'], features))
        inputs.update(point_coords=coords, point_labels=np.array(prompts['labels'], np.int32).reshape(1, -1),
                      input_masks=np.zeros((1, 1, 256, 256), np.float32), has_input_masks=np.zeros((1,), np.float32),
                      original_image_size=np.array([prompts['height'], prompts['width']], np.int32))
        masks, scores, _ = decoder.run(None, inputs)
        selected = int(scores[0].argmax())
        actual = np.asarray(Image.open(str(prefix) + '.png')) > 0
        expected = masks[0, selected]
        iou = float(np.logical_and(actual, expected).sum() / max(1, np.logical_or(actual, expected).sum()))
        assert selected == stats['selected'] and iou > .9999, (name, model, iou, selected, stats)
        score_error = float(np.max(np.abs(np.array(stats['scores']) - scores[0])))
        assert score_error < 1e-4, (model, name, score_error)
        raw = np.fromfile(str(prefix) + '.mask', np.uint8).reshape(actual.shape)
        assert np.array_equal(raw, actual * 255) and actual.any() and not actual.all()
        if old_case:
            prior = np.asarray(Image.open(old_case['mask'])) > 0
            assert np.array_equal(prior, expected), 'Reference inputs changed'
        comparisons.append({'model': model, 'case': name, 'input': str(path), 'inputSHA256': hash_file(path),
            'maskSHA256': hash_file(str(prefix) + '.png'), 'referenceIoU': iou,
            'changedPixels': int(np.count_nonzero(actual != expected)),
            'scoreMaximumDifference': score_error, **stats})
        print('INFERENCE', model, name, iou, flush=True)
    # Prepared FP32 diagnostic mode remains compatible with the prior probe.
    row = old['cases'][0]
    tensor_path = ROOT / 'artifacts/segmentation/inputs' / (Path(row['input']).name + '.f32')
    prefix = OUT / (model + '-tensor-regression')
    stats = native([directory, tensor_path, OUT / 'apple-prompts.json', prefix], model + '-tensor-regression')
    assert np.array_equal(np.asarray(Image.open(str(prefix) + '.png')), np.asarray(Image.open(row['mask'])))
    assert stats['selected'] == int(np.array(row['scores']).argmax())
    tensor_regressions.append({'model': model, 'maskByteExact': True, **stats})
    del encoder, decoder
    gc.collect()
checks.append('16 prompted inferences compare native RGB input with official Torch preprocessing plus the verified ONNX models')


def raw_png(path, width, height, depth, color, raw=b''):
    def chunk(name, data):
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, depth, color, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


bad_inputs = []
for name, shape in [('gray', (8, 8)), ('alpha', (8, 8, 4))]:
    path = OUT / (name + '.png')
    Image.fromarray(np.zeros(shape, np.uint8)).save(path)
    bad_inputs.append(path)
for name, w, h, depth, color, raw in [('rgb16', 2, 2, 16, 2, b'\0' * 26),
                                   ('too-wide', 65001, 1, 8, 2, b''),
                                   ('too-many-pixels', 8001, 8000, 8, 2, b'')]:
    path = OUT / (name + '.png')
    raw_png(path, w, h, depth, color, raw)
    bad_inputs.append(path)
for name, data in [('corrupt', b'not a PNG'), ('truncated', fixtures[0].read_bytes()[:100])]:
    path = OUT / (name + '.png')
    path.write_bytes(data)
    bad_inputs.append(path)
bad_inputs.append(OUT / 'missing.png')
for path in bad_inputs:
    output = OUT / 'keep.f32'
    output.write_bytes(b'preserve output')
    message = native(['--preprocess', path, graph['path'], output], path.stem + '-rejected', False)
    assert output.read_bytes() == b'preserve output'
    invalid.append({'input': str(path), 'error': message.splitlines()[0]})
good_prompt = json.loads((OUT / 'apple-prompts.json').read_text())
for name, change in [('dimensions', {'width': 0}), ('mismatch', {'width': 700}),
                     ('integer-overflow', {'width': 4294968832}),
                     ('fractional-size', {'width': 1536.5}), ('outside', {'points': [[-1, 100]]}),
                     ('label', {'labels': [9]}), ('fractional-label', {'labels': [1.5]}),
                     ('scalar-label', {'labels': 1}), ('empty', {'points': [], 'labels': []}),
                     ('too-many', {'points': [[0, 0]] * 65, 'labels': [1] * 65})]:
    path = OUT / ('bad-' + name + '.json')
    path.write_text(json.dumps({**good_prompt, **change}))
    prefix = OUT / ('bad-' + name)
    Path(str(prefix) + '.png').write_bytes(b'preserve mask')
    message = native([WORK / 'models/tiny', fixtures[0], path, prefix], 'bad-' + name, False)
    assert Path(str(prefix) + '.png').read_bytes() == b'preserve mask'
    invalid.append({'prompt': str(path), 'error': message.splitlines()[0]})
for name, pixels in [('short', np.zeros(10, np.float32)), ('nan', np.full(3 * 1024 * 1024, np.nan, np.float32))]:
    path = OUT / ('bad-' + name + '.f32')
    pixels.tofile(path)
    prefix = OUT / ('bad-tensor-' + name)
    Path(str(prefix) + '.png').write_bytes(b'preserve mask')
    message = native([WORK / 'models/tiny', path, OUT / 'apple-prompts.json', prefix], 'bad-tensor-' + name, False)
    assert Path(str(prefix) + '.png').read_bytes() == b'preserve mask'
    invalid.append({'tensor': str(path), 'error': message.splitlines()[0]})
checks.append('20 malformed image/prompt/tensor cases fail before touching existing outputs')

# Run a copied bundle outside the repository, denying all reads from the repo.
with tempfile.TemporaryDirectory(prefix='captraw-segmentation-') as temporary:
    folder = Path(temporary) / '独立 运行'
    (folder / 'models/tiny').mkdir(parents=True)
    files = {name: WORK / name for name in ['runtime-probe', 'libonnxruntime.1.dylib', 'libpng16.16.dylib']}
    files.update({'models/tiny/' + name: WORK / 'models/tiny' / name for name in ['encoder.onnx', 'decoder.onnx']})
    files.update({'models/preprocess.onnx': Path(graph['path']), 'input.png': fixtures[0], 'prompts.json': OUT / 'apple-prompts.json'})
    for name, source in files.items():
        shutil.copy2(source, folder / name)
        assert hash_file(source) == hash_file(folder / name)
    policy = folder / 'offline.sb'
    policy.write_text('(version 1)\n(allow default)\n(deny network*)\n(deny file-read* (subpath "/opt/homebrew") (subpath "/usr/local") (subpath ' + json.dumps(str(ROOT)) + '))\n')
    result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(policy), str(folder / 'runtime-probe'),
                             str(folder / 'models/tiny'), str(folder / 'input.png'), str(folder / 'prompts.json'),
                             str(folder / 'result')], cwd=folder, capture_output=True, text=True, timeout=120)
    (OUT / 'standalone.log').write_text(result.stdout + result.stderr)
    assert result.returncode == 0, result.stderr
    assert np.array_equal(np.asarray(Image.open(folder / 'result.png')), np.asarray(Image.open(OUT / 'tiny-apple.png')))
    standalone = {'sourceRepositoryReadsDenied': True, 'networkAndHomebrewDenied': True,
                  'copiedFiles': {name: hash_file(source) for name, source in files.items()},
                  'result': json.loads(result.stdout), 'maskByteExact': True}
checks.append('a copied Unicode-path bundle runs with network, Homebrew and all repository reads denied')

receipt = {'checks': checks, 'graph': graph, 'binarySHA256': hash_file(binary),
           'offlineAndHomebrewDenied': True, 'pythonIsTestReferenceOnly': True,
           'preprocessing': preparations, 'inference': comparisons, 'invalid': invalid,
           'tensorRegressions': tensor_regressions, 'standalone': standalone,
           'limits': ['Not installed UI integration', 'Input is an already oriented sRGB RGB8 engine preview',
                      'No model-quality, source-coordinate or ACR parity acceptance',
                      'No persistent/cancellable inference worker yet']}
(OUT / 'report.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('PASS', len(preparations), 'preprocessing cases,', len(comparisons), 'inferences,', len(invalid), 'rejections')
