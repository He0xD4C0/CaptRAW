"""Authored CC0 DCP/ICC inputs and independent TIFF16 comparison."""
from pathlib import Path
import sys, json
import numpy as np
import tifffile
from PIL import ImageCms
out = Path('artifacts/profile-assets').resolve()
out.mkdir(parents=True, exist_ok=True)
if len(sys.argv) > 1:
    report = json.loads(Path(sys.argv[1]).read_text())
    results = []
    for actual, expected in report['pairs']:
        with tifffile.TiffFile(actual) as a, tifffile.TiffFile(expected) as b:
            ap, bp = a.asarray(), b.asarray()
            assert ap.dtype == np.uint16 and np.array_equal(ap, bp), (actual, expected)
            assert a.pages[0].tags.get(34675), actual
            results.append(dict(actual=actual, expected=expected, shape=list(ap.shape), maxDifference=0))
    Path(sys.argv[1]).with_name('pixels.json').write_text(json.dumps(results, indent=2)+'\n')
else:
    matrix = [1,1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1,1]
    for filename, camera, policy in [('有效 配置', 'CaptRAW Synthetic Bayer', 0), ('错误机型','Different Camera',0), ('禁止随附','CaptRAW Synthetic Bayer',2), ('无机型','',0)]:
        tags = [(50721,'2i',9,matrix,False),(50778,'H',1,21,False),
                (50936,'s',0,'CaptRAW Test Profile',False),(50941,'I',1,policy,False),
                (50940,'f',6,(0,0,.5,.65,1,1),False)]
        if camera: tags.append((50708,'s',0,camera,False))
        path = out/(filename+'.dcp')
        tifffile.imwrite(path, np.zeros((1,1),np.uint8), metadata=None, extratags=tags)
        data = bytearray(path.read_bytes());data[2:4] = b'RC';path.write_bytes(data)
    (out/'显示 RGB.icc').write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    (out/'不可用 LAB.icc').write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile('LAB')).tobytes())
    (out/'损坏.dcp').write_bytes(b'bad dcp')
    print(out)
