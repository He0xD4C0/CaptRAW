"""Record candidate behavior, not a claim that rejected candidates meet ACR."""
from pathlib import Path
import hashlib,io,json
import numpy as np
import tifffile
from PIL import ImageCms
out=Path(__file__).resolve().parents[1]/'artifacts/color-grading-candidates'
base=tifffile.imread(out/'art-baseline.tiff').astype(np.int32)
results=[]
for name in ['baseline','neutral-hsl','slope-blue','offset-blue','power-blue']:
    path=out/('art-'+name+'.tiff');a=tifffile.imread(path)
    assert a.dtype==np.uint16 and a.shape==(32,256,3)
    with tifffile.TiffFile(path) as f:
        icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip()
    assert 'sRGB' in icc
    delta=abs(a.astype(np.int32)-base)
    results.append({'name':name,'blackRGB16':a[0,0].tolist(),'whiteRGB16':a[0,-1].tolist(),'middleRGB16':a[0,128].tolist(),'maximumDifferenceFromBaseline16':int(delta.max()),'outputICC':icc,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
assert results[0]['blackRGB16']==[0,0,0]
assert max(results[3]['blackRGB16'])>10000,'The previously observed offset endpoint mismatch changed'
assert results[2]['whiteRGB16']!=results[0]['whiteRGB16']
rapid=json.loads((out/'rapidraw.json').read_text())
assert rapid['backgroundWindow'] and not rapid['passesACREndpointGate']
darktable=json.loads((out/'darktable/report.json').read_text())
assert len(darktable['results'])==8 and darktable['noGUI'] and darktable['sourceUnchanged']
for row in darktable['results']:
    path=out/'darktable'/(row['name']+'.tif')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==row['outputSHA256']
    pixels=tifffile.imread(path)
    assert hashlib.sha256(pixels.tobytes()).hexdigest()==row['pixelSHA256']
assert darktable['results'][5]['whiteRGB16'][0]<40000
split=json.loads((out/'darktable-splittoning/report.json').read_text())
assert len(split['results'])==9 and split['noGUI'] and split['sourceUnchanged']
for row in split['results']:
    path=out/'darktable-splittoning'/(row['name']+'.tif')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==row['outputSHA256']
assert split['results'][1]['maximumGrayDifference16']==0
assert split['results'][1]['maximumColorDifference16']>10000
order=[]
for name in ['baseline','film','black-white','film-black-white']:
    path=out/'art-order'/(name+'.tiff');a=tifffile.imread(path)
    assert a.dtype==np.uint16 and a.shape==(32,256,3)
    with tifffile.TiffFile(path) as f:
        icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip()
    assert 'sRGB' in icc
    order.append({'name':name,'maximumChannelSpread16':int(np.ptp(a.astype(np.int32),axis=2).max()),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
assert order[1]['maximumChannelSpread16']>1000
assert order[3]['maximumChannelSpread16']<=order[2]['maximumChannelSpread16']+3
ocio=json.loads((out/'ocio/report.json').read_text())
assert len(ocio['results'])==39 and ocio['noGUI']
for row in ocio['results']:
    path=out/'ocio'/(row['style'].lower()+'-'+row['case']+'.npy')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==row['outputSHA256']
    assert np.isfinite(np.load(path)).all()
adapter=json.loads((out/'adapter/report.json').read_text())
assert adapter['noGUI'] and len(adapter['cases'])==21 and len(adapter['workingSpaces'])==16
for row in adapter['cases']:
    path=out/'adapter'/(row['case']+'.npy')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==row['outputSHA256']
    assert np.isfinite(np.load(path)).all()
assert np.array_equal(np.load(out/'adapter/neutral.npy'),np.load(out/'adapter/inputs.npy'))
for row in adapter['wideWorkingCubes']:
    path=out/'adapter'/(row['space']+'-working-cube.npy')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==row['outputSHA256']
    assert np.isfinite(np.load(path)).all()
assert adapter['transferReference']['samples']==4109
assert all(row['maximumScaledError']<2e-6 and row['maximumRoundtripScaledError']<2e-6 for row in adapter['transferReference']['results'])
assert len(adapter['iccOutputProbe']['results'])==8
for row in adapter['iccOutputProbe']['results']:
    path=out/'adapter'/(row['space']+'-'+row['fixture']+'-icc.npy')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==row['outputSHA256']
    assert np.load(path).dtype==np.uint16
    if row['fixture']=='ramps':assert row['neutralEndpointsDelta16']<=1
report={'art':results,'artDirectHSLPassesACREndpointGate':False,'rapidrawKernelPassesACREndpointGate':False,
    'darktableDirectControlsPassACREndpointGate':False,
    'darktable':{'renderedCases':8,'workingProfile':darktable['workingProfile'],'moduleEnabledVerified':True,'noGUI':True},
    'darktableSplitToning':{'renderedCases':9,'zeroSaturationGrayDifference16':split['results'][1]['maximumGrayDifference16'],'zeroSaturationColorDifference16':split['results'][1]['maximumColorDifference16'],'directControlMappingAccepted':False},
    'artFilmBeforeBlackWhite':{'renders':order,'finding':'Existing film simulation, even AfterToneCurve=true, loses the diagnostic tint during subsequent B&W conversion. A final grading stage must also cover B&W inputs.'},
    'ocio':{'renderedCases':39,'samplesPerCase':ocio['inputsPerCase'],'finding':ocio['componentFinding'],'finalRouteSelected':False},
    'experimentalAdapter':{'nativeCases':21,'workingSpaceCases':16,'wideGamutCases':4,'transferReferenceSamples':4109,'iccComponentCases':8,'overlapCounts':adapter['overlapCounts'],'productionAccepted':False,'reason':'Extended-sRGB transfer independently checked; ICC component only, wide-gamut perceptual quality and ART integration unresolved.'},
    'scope':'Native ART and darktable TIFF16, unmodified RapidRAW WGSL on Metal, and native OCIO CPU float RGB. Adobe behavior taken from official documentation; no ACR output image was measured.',
    'releaseUnchanged':'0.16.0'}
(out/'pixel-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
