from pathlib import Path
import json,numpy as np,tifffile
from PIL import Image
root=Path(__file__).resolve().parents[1]/'artifacts/mask-preview'
read=lambda name:np.asarray(Image.open(root/(name+'-coverage.png'))).astype('int32')[:,:,3]
a,b=read('a'),read('b');add,subtract,intersect=map(read,['add','subtract','intersect'])
assert np.max(np.abs(add-np.maximum(a,b)))<=1
# Three independently rounded 8-bit coverage planes have <=1.5 levels of error.
assert np.max(np.abs(subtract-a*(1-b/255)))<=1.5
assert np.max(np.abs(intersect-a*b/255))<=1.5
assert np.max(np.abs(read('inverted')-(255-subtract)))<=1
assert np.count_nonzero((a>0)&(a<255))>1000,'Feather must have fractional coverage'
rotated=read('rotated');expected=np.rot90(a,-1)
assert rotated.shape==expected.shape
# Native rotated geometry can round at one-pixel boundaries.
iou=np.count_nonzero((rotated>127)&(expected>127))/np.count_nonzero((rotated>127)|(expected>127))
assert iou>.99
assert np.array_equal(tifffile.imread(root/'overlay-on.tiff'),tifffile.imread(root/'overlay-off.tiff'))
report=json.loads((root/'report.json').read_text());detail=report['frames']['detail']['mask'];d=read('detail');crop=read('crop')
x,y=int(detail['x']),int(detail['y']);h,w=d.shape
np.testing.assert_allclose(d,crop[y:y+h,x:x+w],atol=1)
base=np.asarray(Image.open(root/'baseline.png')).astype('int32');changed=np.asarray(Image.open(root/'hard.png')).astype('int32');hard=read('hard')
assert not np.any(changed[hard==0]!=base[hard==0]),'Zero mask coverage must leave pixels unchanged'
assert np.max(np.abs(changed[hard==255]-base[hard==255]))>5
result={'add':True,'subtract':True,'intersect':True,'inversion':True,'fractionalFeather':True,'rotationIoU':iou,'detailMatchesFit':True,'zeroCoverageLeavesPixelsUnchanged':True,'overlayDoesNotChangeExport':report['exportUnchanged']}
(root/'pixel-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
