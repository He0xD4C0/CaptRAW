from pathlib import Path
import subprocess
import io,json
import numpy as np
import tifffile
from PIL import Image,ImageCms
root=Path(__file__).resolve().parents[1]
def read_document(path):
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", "import {readDocument} from './tests/xmp-test.mjs'; console.log(JSON.stringify(await readDocument(process.argv[1])));", str(path.resolve())],cwd=root,text=True))
out=root/'artifacts/preview-output-acceptance'
report=json.loads((out/'report.json').read_text())
assert len(report['results'])==14 and report['sourceHashesUnchanged']
results=[]
for case in report['results']:
    name=case['name']
    preview=np.asarray(Image.open(out/(name+'.png')).convert('RGB')).astype(np.int32)
    rendered=tifffile.imread(out/(name+'.tiff'))
    assert rendered.dtype==np.uint16 and rendered.shape==preview.shape,name
    with tifffile.TiffFile(out/(name+'.tiff')) as f:
        icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip()
    assert 'sRGB' in icc,(name,icc)
    delta=abs(preview-np.rint(rendered.astype(np.float64)/257))
    assert delta.max()==0,(name,delta.max(),delta.mean())
    result={'name':name,'bitsPerSample':16,'outputICC':icc,'previewOutputMaximumDifference8bit':0}
    reference=out/(name+'-camera-reference.tiff')
    if reference.exists():
        # Camera and explicit multipliers are different ART modes. Record, do not equate them.
        alternative=tifffile.imread(reference)
        d=abs(rendered.astype(np.int32)-alternative.astype(np.int32))
        result['cameraModeReference']={'maximumDifference16bit':int(d.max()),'meanDifference16bit':float(d.mean())}
        if name=='D850-camera':assert d.max()==0
    results.append(result)
summary={'cases':results,'offlineAndHomebrewDenied':report['offlineAndHomebrewDenied']}
(out/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n')
print('PASS: 14 exact preview/TIFF16 comparisons, ICC and precision; D850 Camera reference exact')

gui=root/'artifacts/preview-output-gui'
gui_report=json.loads((gui/'report.json').read_text())
assert len(gui_report['checks'])==7 and not gui_report['errors']
desktop=[]
for entry in gui_report['frames']:
    name=entry['name'].replace('-detail','')
    if name=='restarted':continue
    f=entry['frame']
    recipe=read_document(gui/('restored-input.xmp' if name=='input' else name+'.xmp'))
    crop=recipe['adjustments']['crop']
    x=f['x']-round(crop['x']*f['fullWidth']);y=f['y']-round(crop['y']*f['fullHeight'])
    preview=np.asarray(Image.open(gui/(entry['name']+'.png')).convert('RGB')).astype(np.int32)
    rendered=tifffile.imread(gui/(name+'.tiff'))
    assert rendered.dtype==np.uint16
    region=rendered[y:y+f['height'],x:x+f['width']]
    assert preview.shape==region.shape and np.array_equal(preview,np.rint(region.astype(np.float64)/257)),name
    desktop.append({'name':name,'width':f['width'],'height':f['height'],'previewOutputMaximumDifference8bit':0})
summary['installedDesktop']=desktop
(out/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n')
print('PASS: 3 installed desktop full-resolution TIFF/detail comparisons')
