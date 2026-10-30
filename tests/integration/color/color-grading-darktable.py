"""Fixed official darktable CLI, isolated configuration, no GUI or user library."""
from pathlib import Path
import argparse,hashlib,json,re,struct,subprocess,os
import numpy as np
import tifffile
from PIL import Image,ImageCms
import io
root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
parser=argparse.ArgumentParser();parser.add_argument('--module',choices=['colorbalancergb','splittoning'],default='colorbalancergb');module=parser.parse_args().module
split=module=='splittoning';height=64 if split else 32
cache=root/'build/grading-research';out=root/'artifacts/color-grading-candidates'/('darktable-splittoning' if split else 'darktable');out.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
cli=cache/'darktable.app/Contents/MacOS/darktable-cli'
assert sha(cache/'darktable-5.6.2-arm64.dmg')=='6ff88e58a2a59cb07b0a1502fea7205e68cd783380a33a3ce7bda68ec29def0c'
source=cache/'darktable-5.6.2/src/iop'/(module+'.c')
assert sha(source)==('e0de41b2b849b08cd029f2b2e514e3ffb173b6edcc56ff3e611e1770cd4e3a78' if split else '12e11d05542382d2bd73f1daf3eca10751458403c064b06d301ab9c0a825fb77')
version=subprocess.check_output([str(cli),'--version'],text=True);assert 'darktable 5.6.2' in version
block=source.read_text().split('typedef struct dt_iop_'+module+'_params_t')[1].split('} dt_iop_'+module+'_params_t;')[0]
fields=re.findall(r'^  float (\w+);.*?\$DEFAULT:\s*([-\d.]+)',block,re.M);assert len(fields)==(6 if split else 32)
settings=dict((k,float(v)) for k,v in fields)
image=cache/('darktable-splittoning-input.png' if split else 'darktable-ramp.png');im=Image.new('RGB',(256,height))
pixels=[(x,x,x) for y in range(32) for x in range(256)]
if split:pixels.extend([(x,(x+85)%256,(x+170)%256) for y in range(32) for x in range(256)])
im.putdata(pixels);im.save(image);source_hash=sha(image)
for name in ['dt-config','dt-cache','dt-tmp']:(cache/name).mkdir(exist_ok=True)
cases=[('bypass',False,{}),('neutral',True,{}),*[(w+'-blue',True,{w+'_C':.1,w+'_H':240}) for w in ['shadows','midtones','highlights','global']],('global-luminance',True,{'global_Y':.1}),('midtones-luminance',True,{'midtones_Y':.1})]
if split:
    settings.update(shadow_saturation=0,highlight_saturation=0)
    mixed={'shadow_hue':2/3,'shadow_saturation':.7,'highlight_hue':0,'highlight_saturation':.7}
    cases=[('bypass',False,{}),('neutral',True,{}),('blue-shadows',True,{'shadow_hue':2/3,'shadow_saturation':.7}),('red-highlights',True,{'highlight_hue':0,'highlight_saturation':.7}),('mixed',True,mixed),('compress-0',True,{**mixed,'compress':0}),('compress-100',True,{**mixed,'compress':100}),('balance-25',True,{**mixed,'balance':.25}),('balance-75',True,{**mixed,'balance':.75})]
results=[]
for name,enabled,changes in cases:
    p={**settings,**changes};values=[p[k] for k,_ in fields];params=(struct.pack('<6f',*values) if split else struct.pack('<32fi',*values,1)).hex()
    xmp=out/(name+'.xmp');xmp.write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:darktable="http://darktable.sf.net/" darktable:xmp_version="4" darktable:auto_presets_applied="1" darktable:history_end="1" darktable:iop_order_version="5"><darktable:history><rdf:Seq><rdf:li darktable:num="0" darktable:operation="{module}" darktable:enabled="{int(enabled)}" darktable:modversion="{1 if split else 5}" darktable:params="{params}" darktable:multi_name="" darktable:multi_priority="0"/></rdf:Seq></darktable:history></rdf:Description></rdf:RDF></x:xmpmeta>\n''')
    target=out/(name+'.tif');target.unlink(missing_ok=True)
    args=['/usr/bin/sandbox-exec','-f',str(root/'tests/support/offline-native.sb'),str(cli),str(image),str(xmp),str(target),'--apply-custom-presets','false','--icc-type','SRGB','--verbose','--core','--disable-opencl','--configdir',str(cache/'dt-config'),'--cachedir',str(cache/'dt-cache'),'--tmpdir',str(cache/'dt-tmp'),'--conf','plugins/darkroom/workflow=none','--conf','plugins/imageio/format/tiff/bpp=16','-d','pipe']
    with (out/(name+'.log')).open('w') as log:subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=180,env={**os.environ,'DISPLAY':'','WAYLAND_DISPLAY':''})
    log=(out/(name+'.log')).read_text()
    modules=re.findall(r'process\s+CPU \[export\]\s+(\w+)',log)
    assert modules==(['colorin',module,'finalscale','colorout'] if enabled else ['colorin','finalscale','colorout']),(name,modules)
    assert 'linear Rec2020 RGB' in log
    a=tifffile.imread(target);assert a.dtype==np.uint16 and a.shape==(height,256,3),(name,a.shape,a.dtype)
    with tifffile.TiffFile(target) as f:icc=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(f.pages[0].tags[34675].value))).strip()
    assert icc=='sRGB'
    if name=='bypass':baseline=a.astype(np.int32)
    results.append({'name':name,'enabled':enabled,'changes':changes,'modules':modules,'blackRGB16':a[0,0].tolist(),'whiteRGB16':a[0,-1].tolist(),'middleRGB16':a[0,128].tolist(),'maximumDifferenceFromBaseline16':int(abs(a.astype(np.int32)-baseline).max()),'icc':icc,'pixelSHA256':hashlib.sha256(a.tobytes()).hexdigest(),'outputSHA256':sha(target),'xmpSHA256':sha(xmp)})
    if split:results[-1].update(maximumGrayDifference16=int(abs(a[:32].astype(np.int32)-baseline[:32]).max()),maximumColorDifference16=int(abs(a[32:].astype(np.int32)-baseline[32:]).max()))
    print('Rendered',name,results[-1]['blackRGB16'],results[-1]['whiteRGB16'],flush=True)
    (out/'report.json').write_text(json.dumps({'version':version.strip(),'module':module,'cliSHA256':sha(cli),'dmgSHA256':sha(cache/'darktable-5.6.2-arm64.dmg'),'moduleSourceSHA256':sha(source),'inputSHA256':source_hash,'noGUI':True,'offlineAndHomebrewDenied':True,'workingProfile':'linear Rec2020 RGB (verified from every render log)','sourceUnchanged':sha(image)==source_hash,'results':results},indent=2)+'\n')
assert sha(image)==source_hash
