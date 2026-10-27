from pathlib import Path
import json, io
import numpy as np
import tifffile
from PIL import Image, ImageCms
out = Path(__file__).resolve().parents[1] / 'artifacts/black-white'
report = json.loads((out/'report.json').read_text())
def png(name): return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
for item in report['images']:
    mono = png(item['file']+'-mono')
    assert np.max(np.ptp(mono, axis=2)) <= 2
    assert np.array_equal(png(item['file']+'-color'), png(item['file']+'-restored'))
base = png('swatches-neutral')
responses = []
for i in range(8):
    image = png('band-'+str(i))
    means = [float((image[30:220, j*192+32:(j+1)*192-32]-base[30:220, j*192+32:(j+1)*192-32]).mean()) for j in range(9)]
    assert means[i] > 1, (i, means)
    assert np.argmax(means[:8]) == i, (i, means)
    assert abs(means[8]) <= 1, (i, means)
    responses.append(means)
assert np.array_equal(png('edited-color'), png('edited-restored'))
for first, second in [('raw-mono.tiff','raw-reference.tif'),('current.tiff','saved.tiff'),('legacy.tiff','legacy-reference.tiff')]:
    a, b = tifffile.imread(out/first), tifffile.imread(out/second)
    assert a.dtype == np.uint16 and np.array_equal(a,b), first
with tifffile.TiffFile(out/'raw-mono.tiff') as f:
    assert f.pages[0].bitspersample == 16
    assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
report.update(bandResponseMeans=responses, rawReferenceMaximumDifference=0, independentSavedMaximumDifference=0, legacyMaximumDifference=0, tiffBits=16)
desktop = out.parent/'black-white-gui/mixed.tiff'
if desktop.exists() and (out/'desktop-independent.tiff').exists():
    assert np.array_equal(tifffile.imread(desktop),tifffile.imread(out/'desktop-independent.tiff'))
    report['desktopMaximumDifference'] = 0
(out/'pixel-report.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
