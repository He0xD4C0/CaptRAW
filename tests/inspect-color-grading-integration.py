from pathlib import Path
import io,json,hashlib
import numpy as np
import tifffile
from PIL import Image,ImageCms
out=Path(__file__).resolve().parents[1]/'artifacts/color-grading-integration'
report=json.loads((out/'report.json').read_text())
def read(name):
    path=out/(name+('.tif' if name.endswith('-cli') else '.tiff'))
    with tifffile.TiffFile(path) as f:
        a=f.asarray();assert a.dtype==np.uint16
        icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value)))
        assert 'sRGB' in icc
    return a.astype(np.int32)
base=read('baseline');results=[]
for name in ['shadows','midtones','highlights','global']:
    a=read(name);delta=abs(a-base)
    assert delta.max()>1000,name
    endpoints=int(delta[:,[0,-1]].max());assert endpoints<=2,(name,endpoints)
    results.append({'case':name,'maximumDifference16':int(delta.max()),'endpointDifference16':endpoints})
mono=read('black-white');graded=read('black-white-graded')
assert np.ptp(graded,axis=2).max()>1000 and np.ptp(mono,axis=2).max()<50
assert np.array_equal(graded,read('restarted'))
assert np.array_equal(graded,read('black-white-graded-cli'))
for case in report['raw']:
    name=case['fixture'];a=read(name)
    preview=np.asarray(Image.open(out/(name+'-detail.png')).convert('RGB'))
    assert a.shape==preview.shape
    delta=abs(preview.astype(np.int32)-np.rint(a/257))
    assert delta.max()==0,(name,delta.max())
    assert np.array_equal(a,read(name+'-cli')),name
    results.append({'case':name,'bitsPerSample':16,'detailOutputMaximumDifference8bit':0})
summary={'scope':'Native Stage 3 integration, no GUI or ACR equivalence claim','results':results,'blackWhiteTintSurvives':True,'crossProcessOutputExact':True,'artCLIPartialProfileOutputExact':True,
         'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.glob('*')) if p.suffix in ['.png','.tiff','.tif','.arp']}}
(out/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n')
print('PASS: four tint endpoints, B&W post-processing, exact independent reload, three exact 1:1/TIFF16 comparisons')
