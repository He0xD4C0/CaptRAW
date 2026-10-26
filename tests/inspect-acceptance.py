from pathlib import Path
import json
import numpy as np
import tifffile
from PIL import Image,ImageCms
root=Path(__file__).resolve().parents[1]/'artifacts/native-acceptance'
report=json.loads((root/'report.json').read_text())
for item in report['images']:
 model={'nikon-d850.NEF':'D850','canon-r5.CR3':'EOS R5','fuji-xt4.RAF':'X-T4'}[item['source']]
 a=tifffile.imread(root/f'{model}.tiff');b=tifffile.imread(root/f'{model}-reference.tif')
 assert a.dtype==np.uint16 and a.shape==b.shape
 assert np.array_equal(a,b), f'{model} reference mismatch: {np.abs(a.astype(np.int32)-b).max()}'
 with tifffile.TiffFile(root/f'{model}.tiff') as f:
  icc=f.pages[0].tags[34675].value
  import io
  profile=ImageCms.ImageCmsProfile(io.BytesIO(icc))
  item['outputICC']=ImageCms.getProfileDescription(profile).strip()
  assert 'sRGB' in item['outputICC']
 item['referenceMaxDifference']=0
 item['bitsPerSample']=16
 if model=='D850':
  fit=Image.open(item['adjusted']['file']).convert('RGB')
  detail=item['detail'];fullw,fullh=item['adjusted']['fullWidth'],item['adjusted']['fullHeight']
  region=fit.resize((fullw,fullh),Image.Resampling.BILINEAR).crop((detail['x'],detail['y'],detail['x']+detail['width'],detail['y']+detail['height']))
  roi=Image.open(detail['file']).convert('RGB')
  # Blur suppresses demosaic/scale detail differences while retaining tone/color errors.
  from PIL import ImageFilter
  d=np.abs(np.asarray(region.filter(ImageFilter.GaussianBlur(8))).astype(float)-np.asarray(roi.filter(ImageFilter.GaussianBlur(8))).astype(float))
  item['fitDetailMeanDifference8bit']=float(d.mean())
  assert d.mean()<5, f'Fit/detail tone mismatch {d.mean()}'
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
