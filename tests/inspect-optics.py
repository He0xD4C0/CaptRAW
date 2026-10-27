from pathlib import Path
import io,json,os
import numpy as np
import tifffile
from PIL import Image,ImageCms
root=Path(__file__).resolve().parents[1]
out=root/os.environ.get('CAPTRAW_OPTICS_OUT','artifacts/optics')
report=json.loads((out/'report.json').read_text())
assert len(report['checks'])==7
results=[]
def read_tiff(path):
    image=tifffile.imread(path)
    assert image.dtype==np.uint16,path
    with tifffile.TiffFile(path) as f:
        icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip()
    assert 'sRGB' in icc,(path,icc)
    return image,icc
for case in report['pairs']:
    name=case['file'];actual,icc=read_tiff(out/(name+'.tiff'));reference,_=read_tiff(out/(name+'-reference.tiff'))
    assert np.array_equal(actual,reference),name
    preview=np.asarray(Image.open(out/(name+'-detail.png')).convert('RGB'))
    assert np.array_equal(preview,np.rint(actual.astype(float)/257)),name
    results.append({'file':name,'shape':list(actual.shape),'dtype':'uint16','icc':icc,'previousCoreMaximumDifference':0,'detailMaximumDifference8bit':0})
base=np.array(Image.open(out/'controls-none.png')).astype(np.int32)
responses={}
for key in report['responses']:
    applied=np.array(Image.open(out/f'control-{key}.png')).astype(np.int32)
    restored=np.array(Image.open(out/f'control-{key}-off.png'))
    delta=np.abs(base-applied)
    assert delta.max()>0 and np.array_equal(base,restored),key
    responses[key]={'maxDifference8bit':int(delta.max()),'changedPixels':int(np.any(delta>0,axis=2).sum()),'disabledMaximumDifference':0}
summary={'raw':results,'independentControls':responses}
gui=root/os.environ.get('CAPTRAW_OPTICS_E2E_OUT','artifacts/optics-gui')
if (gui/'report.json').exists():
    gr=json.loads((gui/'report.json').read_text());assert len(gr['checks'])==8 and not gr['errors']
    actual,icc=read_tiff(gui/'desktop.tiff');reference,_=read_tiff(gui/'independent.tiff')
    assert np.array_equal(actual,reference)
    frame=json.loads((gui/'detail.json').read_text());preview=np.array(Image.open(gui/'detail.png'))
    region=actual[frame['y']:frame['y']+frame['height'],frame['x']:frame['x']+frame['width']]
    assert np.array_equal(preview,np.rint(region.astype(float)/257))
    summary['desktop']={'packaged':gr['packaged'],'shape':list(actual.shape),'icc':icc,'previousCoreMaximumDifference':0,'detailMaximumDifference8bit':0,'backgroundWindow':gr['backgroundWindow']}
(out/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
