"""Independent authored rendered/LinearRaw fixtures; historical inputs are read-only."""
from pathlib import Path
import json
import sys
import numpy as np
import tifffile
from PIL import Image
root = next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
out = Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
y,x = np.mgrid[:128,:192]
rgb = np.stack([x/191,y/127,(x+y)/318],axis=-1)
u8 = np.round(rgb*255).astype(np.uint8)
u16 = np.round((.1+.65*rgb)*65535).astype(np.uint16)
Image.fromarray(u8).save(out/'rendered.jpg',quality=97,subsampling=0)
Image.fromarray(u8).save(out/'rendered.png')
tifffile.imwrite(out/'rendered.tiff',u16,photometric='rgb',metadata=None)
tags=[(50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,3,0,0),False),
      (50708,'s',0,'Input kind linear fixture',False),(50714,'H',1,0,False),(50717,'I',1,65535,False),
      (50721,'2i',9,(1,1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1,1),False),
      (50728,'2I',3,(1,1,1,1,1,1),False),(50778,'H',1,21,False)]
tifffile.imwrite(out/'linear.dng',u16,photometric=34892,planarconfig='contig',metadata=None,extratags=tags)
with tifffile.TiffFile(out/'linear.dng') as linear:
    assert len(linear.pages)==1 and linear.pages[0].shape==(128,192,3) and linear.pages[0].samplesperpixel==3
(out/'linear-as-camera.nef').write_bytes((out/'linear.dng').read_bytes())
rows=[dict(path=str((root/'build/samples'/name).resolve()),expected='mosaic-raw') for name in ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF','synthetic.dng']]
rows += [dict(path=str(out/name),expected=kind) for name,kind in [('rendered.jpg','rendered'),('rendered.tiff','rendered'),('rendered.png','rendered'),('linear.dng','linear-raw'),('linear-as-camera.nef','linear-raw')]]
for name in ['stony-path-spherical-acr187.dng','stony-path-spherical-acr187-edited.dng']:
    path=root/'artifacts/stage-0/acr-reference/panorama'/name
    with tifffile.TiffFile(path) as file:
        candidates=[]
        def visit(pages):
            for page in pages:
                if int(page.photometric)==34892 and page.samplesperpixel==3:candidates.append(page)
                if page.pages:visit(page.pages)
        visit(file.pages)
        main=max(candidates,key=lambda page:page.imagewidth*page.imagelength)
        assert main.imagewidth==9660 and main.imagelength==5901
        evidence=dict(photometric=int(main.photometric),compression=int(main.compression),shape=list(main.shape),dngVersion=list(file.pages[0].tags['DNGVersion'].value))
    rows.append(dict(path=str(path),expected='linear-raw',historical=True,evidence=evidence))
(out/'fixtures.json').write_text(json.dumps(rows))
print('PASS independent TIFF/DNG primary-IFD evidence; no historical pixel decode or source write')
