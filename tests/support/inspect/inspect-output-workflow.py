from pathlib import Path
import json,os,hashlib,sys
import numpy as np
import tifffile
from PIL import Image
root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
out=root/os.environ.get('CAPTRAW_OUTPUT_OUT','artifacts/output-workflow')
gui=root/os.environ.get('CAPTRAW_OUTPUT_E2E_OUT','artifacts/output-workflow-gui')
icc=(root/'build/bundle/native/resources/iccprofiles/output/RTv4_sRGB.icc').read_bytes()
if '--generate' in sys.argv:
    y,x=np.mgrid[:384,:512]
    detail=.35+.18*np.tanh((x-256+.2*y)/2)+.03*np.sin(2*np.pi*(x/8+y/7))
    a=np.stack([detail,detail*.85+.06,detail*.7+.12],axis=-1)
    tifffile.imwrite(root/'build/samples/output-detail.tiff',np.rint(a*65535).astype('uint16'),photometric='rgb',metadata=None,extratags=[(34675,7,len(icc),icc,False)])
    sys.exit(0)
def read(path,dimensions=None):
    with tifffile.TiffFile(path) as f:
        a=f.asarray();assert a.dtype==np.uint16,path
        assert f.pages[0].tags[34675].value==icc,path
    if dimensions:assert (a.shape[1],a.shape[0])==tuple(dimensions),(path,a.shape,dimensions)
    return a
report=json.loads((out/'report.json').read_text());assert len(report['checks'])==7
pairs=[]
for p in report['pairs']:
    a=read(p['actual'],p['dimensions']);b=read(p['expected'],p['dimensions']);assert np.array_equal(a,b),p
    pairs.append({'file':p['actual'],'dimensions':p['dimensions'],'referenceMaximumDifference16bit':0})
sharp=np.abs(read(report['responses']['off']).astype('int32')-read(report['responses']['on']).astype('int32'))
assert sharp.max()>0
raw_sharp=np.abs(read(report['responses']['rawOff']).astype('int32')-read(report['responses']['rawOn']).astype('int32'));assert raw_sharp.max()>0
detail_sharp=np.abs(read(report['responses']['detailOff']).astype('int32')-read(report['responses']['detailOn']).astype('int32'));assert detail_sharp.max()>1000
assert np.array_equal(read(out/'sharp-off.tiff'),read(out/'sharp-zero.tiff'))
assert np.array_equal(read(out/'original.tiff'),read(out/'explicit-original.tiff'))
# An 8-bit preview quantized to uint16 would use multiples of 257, which these outputs do not.
precision=read(out/'nikon-d850.NEF-short.tiff');assert np.unique(precision).size>256 and np.any(precision%257)
for path,sha in report['sources'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha
summary={'independent024Comparisons':pairs,'sharpMaximumDifference16bit':int(sharp.max()),'sharpChangedSamples':int(np.count_nonzero(sharp)),'rawSharpMaximumDifference16bit':int(raw_sharp.max()),'controlledTextureSharpMaximumDifference16bit':int(detail_sharp.max()),'zeroAmountExact':True,'sourceHashesUnchanged':True,'uint16NotExpandedRGB8':True}
if (gui/'report.json').exists():
    g=json.loads((gui/'report.json').read_text());assert len(g['checks'])==10 and not g['errors'],g
    for item in g['outputs']:
        p=Path(item['path'])
        if p.suffix=='.tiff':a=read(p,item['dimensions'])
        else:
            im=Image.open(p);assert im.size==tuple(item['dimensions']);assert im.info['icc_profile']==icc
        if item.get('reference'):assert np.array_equal(a,read(item['reference'],item['dimensions']))
    summary['desktop']={'packaged':g['packaged'],'backgroundWindow':g['backgroundWindow'],'outputs':g['outputs'],'checks':len(g['checks'])}
    (gui/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n')
(out/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
