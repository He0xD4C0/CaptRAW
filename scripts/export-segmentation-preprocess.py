"""Build a weight-free ONNX equivalent of SAM2Transforms RGB preprocessing.

Python is a build dependency only. Runtime uses the existing ONNX Runtime CPU
Resize operator (opset 18 antialias), not a second interpolation implementation.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
import onnx
from onnx import helper as H, numpy_helper as N, TensorProto as T


def export(path):
    constants = [
        N.from_array(np.array(255, np.float32), 'denominator'),
        N.from_array(np.array([1, 3, 1024, 1024], np.int64), 'size'),
        N.from_array(np.array([.485, .456, .406], np.float32).reshape(1, 3, 1, 1), 'mean'),
        N.from_array(np.array([.229, .224, .225], np.float32).reshape(1, 3, 1, 1), 'std'),
    ]
    nodes = [
        H.make_node('Cast', ['rgb'], ['float'], to=T.FLOAT),
        H.make_node('Transpose', ['float'], ['chw'], perm=[0, 3, 1, 2]),
        H.make_node('Div', ['chw', 'denominator'], ['unit']),
        H.make_node('Resize', ['unit', '', '', 'size'], ['resized'], mode='linear',
                    antialias=1, coordinate_transformation_mode='half_pixel', exclude_outside=1),
        H.make_node('Sub', ['resized', 'mean'], ['centered']),
        H.make_node('Div', ['centered', 'std'], ['image']),
    ]
    graph = H.make_graph(nodes, 'CaptRAW SAM2 RGB preprocessing',
        [H.make_tensor_value_info('rgb', T.UINT8, [1, 'height', 'width', 3])],
        [H.make_tensor_value_info('image', T.FLOAT, [1, 3, 1024, 1024])], constants)
    model = H.make_model(graph, opset_imports=[H.make_opsetid('', 18)], ir_version=10,
                         producer_name='CaptRAW', producer_version='1')
    onnx.checker.check_model(model, full_check=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, path)
    return {'path': str(path), 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'opset': 18,
            'reference': 'facebookresearch/sam2 2b90b9f SAM2Transforms',
            'input': 'sRGB uint8 NHWC; no crop or EXIF transform',
            'output': 'FP32 NCHW 1x3x1024x1024', 'weights': False}


if __name__ == '__main__':
    path = Path(__file__).resolve().parents[1] / 'build/segmentation/models/preprocess.onnx'
    print(json.dumps(export(path), indent=2))
