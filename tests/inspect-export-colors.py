from pathlib import Path
import io,json,os,hashlib,sys
import numpy as np
import tifffile
from PIL import Image,ImageCms

root=Path(__file__).resolve().parents[1]
profiles=root/'build/bundle/native/resources/iccprofiles/output'
if '--generate' in sys.argv:
    levels=np.linspace(.05,.95,17)
    a=np.array(np.meshgrid(levels,levels,levels,indexing='ij')).reshape(3,-1).T.reshape(17,289,3)
    a=np.rint(np.repeat(np.repeat(a,4,axis=0),2,axis=1)*65535).astype('uint16')
    icc=(profiles/'RTv4_Large.icc').read_bytes()
    path=root/'build/samples/export-wide-gamut.tiff';path.parent.mkdir(parents=True,exist_ok=True)
    tifffile.imwrite(path,a,photometric='rgb',metadata=None,extratags=[(34675,7,len(icc),icc,False)])
    print(path);sys.exit(0)
out=root/'artifacts/export-colors'
report=json.loads((out/'report.json').read_text())
assert len(report['checks'])==4 and report['offlineAndHomebrewDenied']
def tiff(path,profile):
    with tifffile.TiffFile(path) as f:
        a=f.asarray();icc=f.pages[0].tags[34675].value
        assert a.dtype==np.uint16 and icc==(profiles/(profile+'.icc')).read_bytes(),path
    return a
results=[]
srgb=tiff(out/'srgb.tiff','RTv4_sRGB')
for space,profile in report['spaces'].items():
    a=tiff(out/(space+'.tiff'),profile)
    assert np.array_equal(a,tiff(out/(space+'-reference.tiff'),profile))
    image=Image.open(out/(space+'.jpg'))
    assert image.mode=='RGB' and image.size==(a.shape[1],a.shape[0])
    assert image.info['icc_profile']==(profiles/(profile+'.icc')).read_bytes()
    if space!='srgb':assert not np.array_equal(a,srgb)
    description=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(image.info['icc_profile']))).strip()
    results.append({'space':space,'ICC':description,'embeddedProfileExact':True,'referenceMaximumDifference16bit':0,'clippedChannels':int(((a==0)|(a==65535)).sum())})
assert results[2]['clippedChannels']==0 and results[0]['clippedChannels']>0
for name in ['default','legacy']:assert np.array_equal(srgb,tiff(out/(name+'.tiff'),'RTv4_sRGB'))
for name in report['raw']:
    a=tiff(out/(name+'.tiff'),'RTv4_Large');assert a.shape==(384,512,3)
    assert np.array_equal(a,tiff(out/(name+'-reference.tiff'),'RTv4_Large'))
for path,sha in report['sources'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha
summary={'spaces':results,'defaultAnd017PixelsUnchanged':True,'rawProPhotoExact':report['raw'],'sourceHashesUnchanged':True}
gui=root/os.environ.get('CAPTRAW_EXPORT_E2E_OUT','artifacts/export-colors-gui')
if (gui/'report.json').exists():
    desktop=json.loads((gui/'report.json').read_text());assert len(desktop['checks'])==8 and not desktop['errors']
    for space,profile in report['spaces'].items():assert np.array_equal(tiff(gui/(space+'.tiff'),profile),tiff(out/(space+'.tiff'),profile))
    jpeg=Image.open(gui/'adobe-rgb.jpg');assert jpeg.info['icc_profile']==(profiles/'RTv4_Medium.icc').read_bytes()
    assert np.array_equal(np.asarray(jpeg),np.asarray(Image.open(out/'adobe-rgb.jpg')))
    raw=tiff(gui/'真实 RAW.tiff','RTv4_Large');assert raw.shape==(5504,8256,3)
    assert np.array_equal(raw,tiff(gui/'raw-independent.tiff','RTv4_Large'))
    summary['desktop']={'packaged':desktop['packaged'],'backgroundWindow':desktop['backgroundWindow'],'fiveTIFFsAndJPEGExact':True,'fullRawProPhotoExact':True,'width':raw.shape[1],'height':raw.shape[0]}
    (gui/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n')
(out/'pixel-report.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
