from pathlib import Path
import os,json
import numpy as np
from PIL import Image,ImageCms
import tifffile,io
root=Path(__file__).resolve().parents[1];out=root/os.environ.get('CAPTRAW_PICKER_OUT','artifacts/luminance-picker');report=json.loads((out/'report.json').read_text())
def png(name):return np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(int)
gray=png('original-map');assert np.array_equal(gray[...,0],gray[...,1]) and np.array_equal(gray[...,1],gray[...,2])
x=np.arange(256).repeat(4)/255;Y=np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4);L=np.where(Y>216/24389,116*np.cbrt(Y)-16,24389/27*Y)
map_error=float(np.max(abs(gray[100,:,0]-L*2.55)));assert map_error<1
assert np.array_equal(gray,png('local-map')) and not np.array_equal(png('original'),png('local'))
sample_errors={}
for name in ['point','area','reverse','edge','after-local']:
 s=next(v for v in report['samples'] if v['name']==name);expected=L[s['x']:s['x']+s['width']];error=max(abs(s['minimum']-expected.min()),abs(s['maximum']-expected.max()));assert error<.05,(name,error);sample_errors[name]=float(error)
f=json.loads((out/'detail.json').read_text());x,y,w,h=(f[k] for k in ['x','y','width','height']);detail_error=int(np.max(abs(png('detail-map')-gray[y:y+h,x:x+w])));assert detail_error<=1
for name in ['context-detail','context-pan']:
 f=json.loads((out/(name+'.json')).read_text());x,y,w,h=(f[k] for k in ['x','y','width','height']);assert np.array_equal(png(name+'-map'),gray[y:y+h,x:x+w])
for rotation in [90,180,270]:assert np.max(abs(png('rotate-'+str(rotation)+'-map')-np.rot90(gray,-rotation//90)))<=1
assert np.array_equal(png('off'),png('original'))
result={'mapMaximumDifference8bit':map_error,'sampleMaximumErrorsLStar':sample_errors,'detailMapMaximumDifference8bit':detail_error,'displayOnlyPixelChange':0,'localAdjustmentContamination':0}
gui=os.environ.get('CAPTRAW_PICKER_E2E_OUT')
if gui:
 g=root/gui;a=tifffile.imread(g/'desktop.tiff');b=tifffile.imread(g/'independent.tiff');assert a.dtype==np.uint16 and np.array_equal(a,b)
 with tifffile.TiffFile(g/'desktop.tiff') as t:assert t.pages[0].bitspersample==16 and 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(t.pages[0].tags[34675].value)))
 result['desktopActualImageMaximumDifference16bit']=0
(out/'pixel-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
