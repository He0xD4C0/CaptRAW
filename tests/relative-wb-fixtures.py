"""Authored inputs for the versioned ART relative-WB candidate, not Adobe output."""
from pathlib import Path
import sys,json
import numpy as np
import tifffile
from PIL import Image,ImageCms

root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
icc=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
rec=np.array([[.6734241,.1656411,.1251286],[.2790177,.6753402,.0456377],[-.0019300,.0299784,.7973330]])
srgb=np.array([[.4360747,.3850649,.1430804],[.2225045,.7168786,.0606169],[.0139322,.0971045,.7141733]])
def white(t,tint=0):
    v=1000/t
    x=(-.2661239*v**3-.2343589*v*v+.8776956*v+.179910) if t<=4000 else (-3.0258469*v**3+2.1070379*v*v+.2226347*v+.24039)
    y=(-.9549476*x**3-1.37418593*x*x+2.09137015*x-.16748867) if t<=4000 else (3.081758*x**3-5.8733867*x*x+3.75112997*x-.37001483)
    return np.array([x,y,1-x-y])
def gains(t,tint):
    kelvin=5000-(20 if t>0 else 50)*t
    xy=white(kelvin);hi=white(kelvin-100);angle=np.arctan(-(hi[0]-xy[0])/(hi[1]-xy[1]))
    xy[:2]+=np.array([np.cos(angle),np.sin(angle)])*(tint/1000);xy[2]=1-xy[0]-xy[1]
    ref=white(5000);g=(np.linalg.solve(rec,xy/xy[1]))/np.linalg.solve(rec,ref/ref[1])
    return g/(rec[1]@g)
def encoded(t,tint):
    rgb=np.linalg.solve(srgb,rec@(.18/gains(t,tint)))
    assert np.all((rgb>0)&(rgb<1)),rgb
    return np.where(rgb<=.0031308,12.92*rgb,1.055*rgb**(1/2.4)-.055)
rows=[]
for name,t,tint in [('neutral',0,0),('warm',25,-15),('cool',-25,15)]:
    rgb=np.broadcast_to(encoded(t,tint),(64,96,3))
    for ext in ['jpg','tif']:
        p=root/(name+'.'+ext)
        if ext=='jpg':Image.fromarray(np.rint(rgb*255).astype(np.uint8)).save(p,quality=100,subsampling=0,icc_profile=icc)
        else:tifffile.imwrite(p,np.rint(rgb*65535).astype(np.uint16),photometric='rgb',metadata=None,extratags=[(34675,'B',len(icc),icc,False)])
        rows.append(dict(path=str(p),temperature=t,tint=tint,kind='rendered'))
split=np.empty((64,96,3));split[:,:48]=encoded(25,-15);split[:,48:]=encoded(-25,15)
tifffile.imwrite(root/'split.tif',np.rint(split*65535).astype(np.uint16),photometric='rgb',metadata=None,extratags=[(34675,'B',len(icc),icc,False)])
tifffile.imwrite(root/'black.tif',np.zeros((64,96,3),np.uint16),photometric='rgb',metadata=None,extratags=[(34675,'B',len(icc),icc,False)])
y,x=np.mgrid[:64,:96];raw=np.rint((.15+.4*x/95+.15*y/63)*65535).astype(np.uint16)
tags=[(33421,'H',2,(2,2),False),(33422,'B',4,(0,1,1,2),False),(50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,3,0,0),False),(50708,'s',0,'Relative WB RAW bypass',False),(50714,'H',1,0,False),(50717,'I',1,65535,False),(50721,'2i',9,(1,1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1,1),False),(50728,'2I',3,(1,1,1,1,1,1),False),(50778,'H',1,21,False)]
tifffile.imwrite(root/'raw.dng',raw,photometric=32803,metadata=None,extratags=tags)
(root/'fixtures.json').write_text(json.dumps(rows))
