"""Probe the pinned native OCIO processor, without an ACR parameter mapping or UI."""
from pathlib import Path
import hashlib,json,zipfile
import numpy as np
import PyOpenColorIO as ocio

root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
cache=root/'build/grading-research'
out=root/'artifacts/color-grading-candidates/ocio';out.mkdir(parents=True,exist_ok=True)
sha=lambda data:hashlib.sha256(data).hexdigest()
wheel=cache/'opencolorio-2.4.2-cp313-cp313-macosx_11_0_arm64.whl'
assert sha(wheel.read_bytes())=='d5c3b7d56907a74ac5cf488b27748910053d9076d2366a72fc06bd821d5325b0'
assert ocio.GetVersion()=='2.4.2'
native={}
with zipfile.ZipFile(wheel) as archive:
    for name in ['PyOpenColorIO.so','libOpenColorIO.dylib']:
        installed=(Path(ocio.__file__).parent/name).read_bytes()
        assert installed==archive.read('PyOpenColorIO/'+name)
        native[name]=sha(installed)
sources={
    'ocio-GradingToneOpCPU.cpp':'6c88c177b7763b0c37253c33986d36031898aab14b7e6bfeeda196bd91f8d0d5',
    'ocio-OpenColorTransforms.h':'6d79e98db25f0eb089576f4e232565e045324d56ca43897b30ce03ab25d1eea8',
    'ocio-GradingTone.cpp':'ba2611d92df0b8bacce49f11bbcbe3f0a0836336fb275aae2a83c719cc5bd31f',
    'OpenColorIO-LICENSE':'82a40c52065ee968aa62015735e84378ac11425db7a233e6a2dcd2c83fc24276',
}
for name,digest in sources.items():assert sha((cache/name).read_bytes())==digest
config=ocio.Config.CreateRaw()
gray=np.repeat(np.linspace(0,1,4097,dtype=np.float32)[:,None],3,axis=1)
extended=np.repeat(np.array([-1,-.01,0,.18,.5,1,1.01,2,16],dtype=np.float32)[:,None],3,axis=1)
levels=np.linspace(0,1,17,dtype=np.float32)
colors=np.stack(np.meshgrid(levels,levels,levels,indexing='ij'),axis=-1).reshape(-1,3)
inputs=np.concatenate([gray,extended,colors]);np.save(out/'inputs.npy',inputs)
cases=[]
for style in ['VIDEO','LIN','LOG']:
    cases.append((style,'neutral',{}))
    for region in ['shadows','midtones','highlights']:
        for field in ['blue','master']:
            cases.append((style,region+'-'+field,{region:{field:1.2}}))
for region in ['shadows','midtones','highlights']:
    bounds=[.1,1.9] if region=='midtones' else [.2,1.8]
    for strength in bounds:cases.append(('VIDEO',region+'-strong-'+str(strength),{region:{'blue':strength}}))
for limit in [.35,.6,1]:cases.append(('VIDEO','shadow-range-'+str(limit),{'shadows':{'blue':1.2,'start':limit}}))
for limit in [0,.2,.65]:cases.append(('VIDEO','highlight-range-'+str(limit),{'highlights':{'blue':1.2,'start':limit}}))
for width in [.3,.7,1]:cases.append(('VIDEO','mid-range-'+str(width),{'midtones':{'blue':1.2,'start':.5,'width':width}}))
cases.extend([
    ('VIDEO','lift-black',{'blacks':{'master':1.2}}),
    ('VIDEO','lower-white',{'whites':{'master':.8}}),
    ('VIDEO','three-ranges',{'shadows':{'blue':1.2},'midtones':{'green':1.2},'highlights':{'red':1.2}}),
])
results=[]
for style,name,changes in cases:
    transform=ocio.GradingToneTransform(getattr(ocio,'GRADING_'+style));value=transform.getValue()
    for region,fields in changes.items():
        control=getattr(value,region)
        for field,number in fields.items():setattr(control,field,number)
        setattr(value,region,control)
    transform.setValue(value);transform.validate()
    processor=config.getProcessor(transform).getDefaultCPUProcessor()
    rendered=inputs.copy();processor.applyRGB(rendered)
    assert np.isfinite(rendered).all(),(style,name)
    if name=='neutral':assert np.array_equal(rendered,inputs),(style,name)
    path=out/(style.lower()+'-'+name+'.npy');np.save(path,rendered)
    tint_only=style=='VIDEO' and name not in ['lift-black','lower-white'] and not name.endswith('-master')
    endpoint_error=float(abs(rendered[[0,4096]]-inputs[[0,4096]]).max())
    if tint_only:assert endpoint_error<2e-6,(name,endpoint_error)
    minimum_step=float(np.diff(rendered[:4097],axis=0).min())
    assert minimum_step>=-2e-6,(style,name,minimum_step)
    transform.setDirection(ocio.TRANSFORM_DIR_INVERSE)
    recovered=rendered.copy();config.getProcessor(transform).getDefaultCPUProcessor().applyRGB(recovered)
    results.append({'style':style,'case':name,'parameters':str(value),'changes':changes,
        'blackRGB':rendered[0].tolist(),'whiteRGB':rendered[4096].tolist(),'middleRGB':rendered[2048].tolist(),
        'endpointError':endpoint_error,'minimumGrayStep':minimum_step,'maximumGrayStep':float(np.diff(rendered[:4097],axis=0).max()),
        'maximumRoundTripError':float(abs(recovered-inputs).max()),'allOutputsFinite':True,
        'extendedGrayRGB':rendered[4097:4106].tolist(),'outputSHA256':sha(path.read_bytes())})
    print(style,name,'endpoints',endpoint_error,'roundtrip',results[-1]['maximumRoundTripError'])
report={'version':ocio.GetVersion(),'commit':'6918fad3f5d22ac3ef2397c754bf4268c2b58dd0','license':'BSD-3-Clause','wheelSHA256':sha(wheel.read_bytes()),
    'nativeFiles':native,'sourceFiles':sources,'noGUI':True,'inputSHA256':sha((out/'inputs.npy').read_bytes()),
    'inputsPerCase':len(inputs),'scope':'Unmodified native CPU GradingToneTransform via official Python wheel; raw float RGB, no ICC conversion, no ACR output comparison, not an ART integration or final route.',
    'componentFinding':'VIDEO tint cases preserve endpoints and are monotonic on the tested gray ramp. LIN defaults do not share the SDR endpoint behavior. Range controls act per RGB channel, not pixel luminance. No native ACR Blending/Balance or global color wheel.',
    'results':results}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('Recorded',len(results),'cases; no production grading implementation selected.')
