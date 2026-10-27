from pathlib import Path
import os,json,io
import numpy as np
import tifffile
from PIL import ImageCms
root=Path(__file__).resolve().parents[1];out=root/os.environ.get('CAPTRAW_SYNC_OUT','artifacts/synchronize')
results={}
def check(a,b):
 x=tifffile.imread(a);y=tifffile.imread(b);assert x.dtype==np.uint16 and np.array_equal(x,y)
 with tifffile.TiffFile(a) as f:
  assert f.pages[0].bitspersample==16
  assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
 return {'maximumDifference16bit':0,'shape':list(x.shape),'ICC':'sRGB'}
for i in range(2):
 results['native-'+str(i)]=check(out/f'target-{i}.tiff',out/f'reference-{i}.tiff')
 for prefix in ['reference','target']:
  warm=tifffile.imread(out/f'warm-{prefix}-{i}.tiff').astype(int);cold=tifffile.imread(out/f'{prefix}-{i}.tiff').astype(int);d=abs(warm-cold)
  results[f'{prefix}-WarmPreviewVsFreshExport-{i}']={'maximumDifference16bit':int(d.max()),'differentChannels':int(np.count_nonzero(d)),'meanDifference16bit':float(d.mean()),'status':'diagnostic only; desktop uses fresh export process'}
gui=os.environ.get('CAPTRAW_SYNC_E2E_OUT')
if gui:
 g=root/gui;results['desktop']=check(g/'desktop.tiff',g/'independent.tiff')
(out/'pixel-report.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
