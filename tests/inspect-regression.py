from pathlib import Path
import json
import numpy as np
import tifffile
from PIL import Image
root=Path(__file__).resolve().parents[1]/'artifacts/regression'
images={p.stem:tifffile.imread(p).astype(np.int32) for p in root.glob('*.tiff')}
b=images['baseline'];h,w=b.shape[:2]
def diff(name):return np.abs(images[name]-b).mean(axis=2)
summary={}
for name in ['exposure','radial','disabled','inverted','linear','brush','erased','restored']:
 d=diff(name);summary[name]={'mean':float(d.mean()),'max':int(d.max()),'changed':int((d>2).sum())}
assert summary['exposure']['mean']>100
assert summary['disabled']['max']<=1
assert summary['restored']['max']<=1
assert summary['radial']['changed']>1000
assert diff('radial')[int(h*.45),int(w*.35)]>100
assert diff('radial')[int(h*.9),int(w*.9)]<=1
assert diff('inverted')[int(h*.45),int(w*.35)]<=1
assert diff('inverted')[int(h*.9),int(w*.9)]>100
assert summary['brush']['changed']>100
assert summary['erased']['mean']<summary['brush']['mean']*.2
rot=np.rot90(images['radial'],k=-1)
expected=np.abs(rot-np.rot90(b,k=-1)).mean(2)>100
actual=np.abs(images['rotated']-np.rot90(b,k=-1)).mean(2)>100
# ART rasterizes ellipse boundaries at integer coordinates; allow one-pixel edge rounding.
overlap=float((expected&actual).sum()/(expected|actual).sum())
assert overlap>.99, 'Mask does not follow image rotation'
summary['rotation']={'maskIoU':overlap}
assert images['crop'].shape[:2]==(round(w*.5),round(h*.4))
with tifffile.TiffFile(root/'baseline.tiff') as f:
 assert f.pages[0].dtype==np.uint16
 assert len(f.pages[0].tags[34675].value)>100
 assert len(np.unique(b[:,:,0]))>256
preview=Image.open(json.loads((root/'results.json').read_text())[0]['frame']['file'])
assert 'srgb' in preview.info
(root/'pixel-report.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
