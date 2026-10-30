"""Independent small RAW frames: ActiveArea, DefaultCrop and LinearRaw differ."""
from pathlib import Path
import sys
import numpy as np
import tifffile
from PIL import Image

out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
y,x=np.mgrid[:128,:192]
rgb=np.stack([.1+.6*x/191,.1+.6*y/127,.15+.5*(x+y)/318],axis=-1)
tags=[(50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,3,0,0),False),
      (50708,'s',0,'Source frame fixture',False),(50714,'H',1,0,False),(50717,'I',1,65535,False),
      (50721,'2i',9,(1,1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1,1),False),
      (50728,'2I',3,(1,1,1,1,1,1),False),(50778,'H',1,21,False)]
cfa=np.array([[0,1],[1,2]])
raw=np.rint(rgb[y,x,cfa[y%2,x%2]]*65535).astype(np.uint16)
bayer=[(33421,'H',2,(2,2),False),(33422,'B',4,(0,1,1,2),False)]
for name,extra in [('bayer',[]),('inset',[(50829,'I',4,(4,6,124,186),False),(50719,'I',2,(8,6),False),(50720,'I',2,(160,100),False)]),('rotated',[(274,'H',1,6,False)])]:
    tifffile.imwrite(out/(name+'.dng'),raw,photometric=32803,metadata=None,extratags=tags+bayer+extra)
tifffile.imwrite(out/'linear.dng',np.rint(rgb*65535).astype(np.uint16),photometric=34892,planarconfig='contig',metadata=None,extratags=tags)
Image.fromarray(np.rint(rgb*255).astype(np.uint8)).save(out/'rendered.png')
with tifffile.TiffFile(out/'inset.dng') as f:
    assert f.pages[0].tags['ActiveArea'].value==(4,6,124,186)
    assert f.pages[0].tags['DefaultCropOrigin'].value==(8,6)
    assert f.pages[0].tags['DefaultCropSize'].value==(160,100)
print('PASS independent source-frame fixture tags')
