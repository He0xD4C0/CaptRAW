from pathlib import Path
import io, json, os
import numpy as np
import tifffile
from PIL import Image, ImageCms

out = Path(os.environ.get('CAPTRAW_GRADING_E2E_OUT', 'artifacts/color-grading-gui'))
report = json.loads((out / 'report.json').read_text())
assert len(report['checks']) == 13 and not report['errors'] and report['backgroundWindow']
recipe = json.loads((out / '真实 RAW 分级.captraw.json').read_text())
frame = report['frames'][0]
crop = recipe['adjustments']['crop']
x = frame['x'] - round(crop['x'] * frame['fullWidth'])
y = frame['y'] - round(crop['y'] * frame['fullHeight'])
rendered = tifffile.imread(out / 'raw.tiff')
independent = tifffile.imread(out / 'raw-independent.tiff')
assert rendered.dtype == np.uint16 and np.array_equal(rendered, independent)
with tifffile.TiffFile(out / 'raw.tiff') as f:
    icc = ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip()
assert 'sRGB' in icc
preview = np.asarray(Image.open(out / 'raw-detail.png').convert('RGB'))
region = rendered[y:y + frame['height'], x:x + frame['width']]
assert preview.shape == region.shape and np.array_equal(preview, np.rint(region.astype(np.float64) / 257))
result = {'packaged': report['packaged'], 'backgroundWindow': True, 'bitsPerSample': 16, 'outputICC': icc,
          'desktopIndependentMaximumDifference16bit': 0, 'detailOutputMaximumDifference8bit': 0,
          'width': frame['width'], 'height': frame['height']}
(out / 'pixel-report.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
