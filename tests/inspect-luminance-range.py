from pathlib import Path
import os,sys,json,io
import numpy as np
import tifffile
from PIL import Image,ImageCms
root=Path(__file__).resolve().parents[1]
if '--generate' in sys.argv:
    # Owned neutral ramp: constant rows isolate brightness selection from position.
    levels=np.arange(256,dtype=np.uint8).repeat(4)
    a=np.broadcast_to(levels[None,:,None],(256,1024,3)).copy()
    Image.fromarray(a).save(root/'build/samples/luminance-range.png',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    yy,xx=np.indices((256,1024));texture=np.rint(np.clip(a.astype(float)+12*np.sin(xx*1.7)[...,None]+8*np.sin(yy*1.3)[...,None],0,255)).astype(np.uint8)
    Image.fromarray(texture).save(root/'build/samples/luminance-texture.png',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    sys.exit(0)
out=root/os.environ.get('CAPTRAW_RANGE_OUT','artifacts/luminance-range')
def rgb(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(int)
def alpha(name):return np.asarray(Image.open(out/(name+'-mask.png')))[...,3].astype(int)
base=rgb('original');neutral=rgb('neutral');assert np.abs(base-neutral).max()<=1
results={}
for name in ['middle','shadows','highlights','hard','full']:
    a=alpha(name);d=abs(rgb(name)-base)
    assert a.max()==255
    if name=='full':assert a.min()==255
    else:
        assert a.min()==0
        assert d[a==0].max()<=1,(name,'leakage',d[a==0].max())
    assert d[a>0].max()>10
    if name not in ['full','hard']:assert len(np.unique(a))>20,(name,'falloff not smooth')
    assert np.array_equal(rgb(name),rgb(name+'-restored'))
    results[name]={'coverageLevels':len(np.unique(a)),'maximumPixelChange':int(d.max()),'outsideMaximumDifference':int(d[a==0].max()) if (a==0).any() else None}
    if name=='shadows':assert a[100,0]==255 and a[100,-1]==0
    if name=='highlights':assert a[100,0]==0 and a[100,-1]==255
assert np.max(abs(alpha('middle')+alpha('inverted')-255))<=1
assert np.array_equal(rgb('disabled'),base)
r=alpha('radial')/255;m=alpha('middle')/255
for name,expected in [('add',np.maximum(r,m)),('subtract',r*(1-m)),('intersect',r*m)]:
    error=np.max(abs(alpha(name)-expected*255));assert error<=2,(name,error);results[name]={'coverageMaximumDifference8bit':float(error)}
f=json.loads((out/'detail.json').read_text());x,y,w,h=(f[k] for k in ['x','y','width','height'])
detail_mask_error=int(np.max(abs(alpha('detail')-alpha('middle')[y:y+h,x:x+w])));assert detail_mask_error<=1
detail_error=int(np.max(abs(rgb('detail')-rgb('middle')[y:y+h,x:x+w])));assert detail_error<=1
# Rotation changes spatial placement, not the brightness criterion.
rotation_error=int(np.max(abs(alpha('rotated')-np.rot90(alpha('middle'),-1))));assert rotation_error<=1
# Independent sRGB transfer and CIE L* verify that thresholds select brightness,
# not image coordinates or already-adjusted output pixels.
x=np.arange(256).repeat(4)/255;Y=np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4);L=np.where(Y>216/24389,116*np.cbrt(Y)-16,24389/27*Y)
thresholds={}
for name,bounds in [('middle',[20,35,65,80]),('shadows',[0,0,25,45]),('highlights',[55,75,100,100]),('hard',[30,30,70,70])]:
    a=alpha(name)[100];nz=np.flatnonzero(a>0);full=np.flatnonzero(a==255);measured=L[[nz[0],full[0],full[-1],nz[-1]]];error=float(np.max(abs(measured-bounds)))
    assert error<1.1,(name,measured,error)
    thresholds[name]={'measuredLStar':measured.tolist(),'maximumErrorLStar':error}
for name in ['middle','shadows','highlights','hard','full','rotated','nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF','local-texture','local-clarity','local-noise']:
    a=tifffile.imread(out/(name+'.tiff'));b=tifffile.imread(out/(name+'-reference.tiff'))
    assert a.dtype==np.uint16 and np.array_equal(a,b),name
    with tifffile.TiffFile(out/(name+'.tiff')) as t:assert t.pages[0].bitspersample==16 and 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(t.pages[0].tags[34675].value)))
local={}
for key in ['texture','clarity','noise']:
    d=abs(rgb('local-'+key)-rgb('texture-base'));coverage=alpha('texture-base');outside=int(d[coverage==0].max());inside=int(d[coverage==255].max())
    assert outside<=1 and inside>5,(key,outside,inside)
    assert np.array_equal(rgb('local-'+key),rgb('local-'+key+'-restored'))
    local[key]={'outsideMaximumDifference8bit':outside,'insideMaximumDifference8bit':inside,'independent018MaximumDifference16bit':0}
report={'localRangeReuse':local,'ranges':results,'neutralMaximumDifference8bit':int(abs(base-neutral).max()),'independent018MaximumDifference16bit':0,'thresholds':thresholds,'ROIImageMaximumDifference8bit':detail_error,'ROICoverageMaximumDifference8bit':detail_mask_error,'rotationCoverageMaximumDifference8bit':rotation_error,'allExports16BitAndSRGB':True}
gui=os.environ.get('CAPTRAW_RANGE_E2E_OUT')
if gui:
    g=root/gui;desktop=tifffile.imread(g/'desktop.tiff');independent=tifffile.imread(g/'independent.tiff');assert np.array_equal(desktop,independent) and desktop.dtype==np.uint16
    report['desktopIndependentMaximumDifference16bit']=0
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
