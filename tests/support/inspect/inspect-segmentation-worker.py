"""Compare every native candidate against independent Python ONNX inference."""
from pathlib import Path
import json, hashlib, gc
import numpy as np
import onnxruntime as ort
from PIL import Image
ROOT = next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
OUT = ROOT / 'artifacts/segmentation-worker'
report = json.loads((OUT / 'report.json').read_text())
ort.disable_telemetry_events()
options = ort.SessionOptions()
options.intra_op_num_threads = 8
options.inter_op_num_threads = 1
options.enable_mem_pattern = False
rows = []
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
for model in ['tiny', 'small']:
    directory = ROOT / 'build/segmentation/models' / model
    pre = ort.InferenceSession(str(directory / 'preprocess.onnx'), options, providers=['CPUExecutionProvider'])
    encoder = ort.InferenceSession(str(directory / 'encoder.onnx'), options, providers=['CPUExecutionProvider'])
    decoder = ort.InferenceSession(str(directory / 'decoder.onnx'), options, providers=['CPUExecutionProvider'])
    features, previous = None, None
    for row in [r for r in report['nativeRows'] if r['model'] == model]:
        p, result = row['request'], row['result']
        assert sha(p['path']) == p['imageSha256']
        if previous != p['imageSha256']:
            rgb = np.asarray(Image.open(p['path']))
            tensor = pre.run(None, {'rgb': rgb[None]})[0]
            features = encoder.run(None, {'image': tensor})
            previous = p['imageSha256']
        coords = np.array(p['points'], np.float32).reshape(1, -1, 2)
        coords *= np.float32(1024)
        coords /= np.array([p['width'], p['height']], np.float32)
        inputs = dict(zip(['image_features_0', 'image_features_1', 'image_embeddings'], features))
        inputs.update(point_coords=coords, point_labels=np.array(p['labels'], np.int32).reshape(1, -1),
                      input_masks=np.zeros((1, 1, 256, 256), np.float32), has_input_masks=np.zeros(1, np.float32),
                      original_image_size=np.array([p['height'], p['width']], np.int32))
        masks, scores = decoder.run(['masks', 'iou_predictions'], inputs)
        assert result['selected'] == int(scores[0].argmax())
        for candidate in result['candidates']:
            assert sha(candidate['file']) == candidate['sha256']
            actual = np.asarray(Image.open(candidate['file']))
            expected = masks[0, candidate['index']].astype(np.uint8) * 255
            changed = int(np.count_nonzero(actual != expected))
            score_error = abs(candidate['score'] - float(scores[0, candidate['index']]))
            assert changed == 0 and score_error < 1e-6, (model, row['name'], candidate['index'], changed, score_error)
            assert np.count_nonzero(actual) == candidate['pixels']
            rows.append({'model': model, 'case': row['name'], 'candidate': candidate['index'],
                         'changedPixels': changed, 'scoreDifference': score_error})
        print('PASS', model, row['name'], 'all three masks exact', flush=True)
    del pre, encoder, decoder, features
    gc.collect()
assert len(rows) == 48
(OUT / 'pixel-report.json').write_text(json.dumps({'candidateCount': len(rows), 'comparisons': rows,
    'scope': 'Implementation equivalence, not semantic ground truth or ACR quality.'}, indent=2) + '\n')
