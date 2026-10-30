from pathlib import Path
import os,sys,json,ctypes,math,io
import numpy as np
from PIL import Image,ImageCms
import tifffile
root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
if '--generate' in sys.argv:
    colors=np.array([[190,55,45],[200,80,50],[180,85,65],[50,170,70],[40,150,175],[60,70,185]],dtype=np.uint8)
    a=np.tile(np.repeat(colors,200,axis=0)[None,:,:],(400,1,1));a[200:]=(a[200:].astype(float)*.55).astype(np.uint8)
    Image.fromarray(a).save(root/'build/samples/color-range.png',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes());sys.exit(0)
out=root/os.environ.get('CAPTRAW_COLOR_RANGE_OUT','artifacts/color-range');report=json.loads((out/'report.json').read_text())
rgb=lambda n:np.asarray(Image.open(out/(n+'.png')).convert('RGB')).astype(int)
alpha=lambda n:np.asarray(Image.open(out/(n+'-mask.png')))[...,3].astype(int)
base=rgb('original');one=alpha('one');two=alpha('two');broad=alpha('broad')
assert one[100,100]==255 and one[100,700]<10
assert two[100,100]==255 and two[100,700]==255
assert np.all(broad>=one-1) and np.count_nonzero(broad>one+5)>1000
assert np.max(abs(one+alpha('inverse')-255))<=1
assert np.array_equal(rgb('disabled'),base) and np.array_equal(rgb('empty'),base)
change=abs(rgb('one')-base);assert change[one==255].max()>10 and change[one==0].max()==0
for mode,expected in [('add',np.maximum(one,alpha('light'))),('subtract',one*(1-alpha('light')/255)),('intersect',one*alpha('light')/255)]:assert np.max(abs(alpha(mode)-expected))<=2,mode
f=json.loads((out/'detail.json').read_text());x,y,w,h=(f[k] for k in ['x','y','width','height']);assert np.max(abs(alpha('detail')-one[y:y+h,x:x+w]))<=1;assert np.max(abs(rgb('detail')-rgb('detail-base')[y:y+h,x:x+w]))<=1
assert np.max(abs(alpha('rotated')-np.rot90(one,-1)))<=1
# Independently evaluate the ART adapter's range against LittleCMS CIEDE2000.
class Lab(ctypes.Structure):_fields_=[('L',ctypes.c_double),('a',ctypes.c_double),('b',ctypes.c_double)]
lib=ctypes.CDLL(str(root/'build/bundle/native/lib/liblcms2.2.dylib'));delta=lib.cmsCIE2000DeltaE;delta.argtypes=[ctypes.POINTER(Lab),ctypes.POINTER(Lab),ctypes.c_double,ctypes.c_double,ctypes.c_double];delta.restype=ctypes.c_double
samples=[next(s for s in report['samples'] if s['name']==f'patch-{i}') for i in range(6)]
def lab(s):return Lab(s['l'],s['c']*math.cos(math.radians(s['h'])),s['c']*math.sin(math.radians(s['h'])))
# An independent ICC transform checks sampled Lab against the known input colors.
fixture=Image.open(root/'build/samples/color-range.png');reference=ImageCms.profileToProfile(fixture,ImageCms.ImageCmsProfile(io.BytesIO(fixture.info['icc_profile'])),ImageCms.createProfile('LAB'),outputMode='LAB')
sample_error=0
for i,s in enumerate(samples):
    l,a,b=reference.getpixel((100+i*200,100));expected=[l*100/255,a-128,b-128];actual=[s['l'],s['c']*1.28173828125*math.cos(math.radians(s['h'])),s['c']*1.28173828125*math.sin(math.radians(s['h']))]
    sample_error=max(sample_error,max(abs(x-y) for x,y in zip(actual,expected)))
assert sample_error<.6 # The independent Lab reference is quantized to 8 bits.
ref=lab(samples[0]);errors=[];r=.25+15*.195
for i,s in enumerate(samples):
    color=lab(s);d=delta(ctypes.byref(ref),ctypes.byref(color),2,100/75,1)
    expected=1 if d<=r*.4 else 0 if d>=r*5 else 1-1/(1+100*math.exp(-1.5*(d-r)))
    error=abs(one[100,100+i*200]-expected*255);assert error<=1,(i,error,d);errors.append(float(error))
for n in ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']:
    with tifffile.TiffFile(out/(n+'.tiff')) as t:
        actual=t.asarray();assert actual.dtype==np.uint16 and t.pages[0].tags[34675].value
        assert np.array_equal(actual,tifffile.imread(out/(n+'-reference.tiff'))),n
texture_delta=abs(rgb('texture')-rgb('texture-base'));assert texture_delta[alpha('texture')==0].max()<=1
result={'sampleMaxErrorAgainst8bitICCLab':sample_error,'referenceCoverageMaxError8bit':max(errors),'selectedPixelsChange':int(change[one==255].max()),'unselectedPixelsChange':int(change[one==0].max()),'componentAndTransformChecks':True,'rawTIFF16WithICC':3,'old022ExportExact':True}
gui=os.environ.get('CAPTRAW_COLOR_RANGE_E2E_OUT')
if gui:
    a=tifffile.imread(root/gui/'desktop.tiff');b=tifffile.imread(root/gui/'independent.tiff');assert a.dtype==np.uint16 and np.array_equal(a,b)
    result['desktopTIFFMaximumDifference']=0
(out/'pixel-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
