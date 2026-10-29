import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DEFAULT_EXPORT_OPTIONS} from '@captraw/contracts/export-options';
import {EngineClient} from './engine-client.mjs';

const scratch=mkdtempSync(join(tmpdir(),'captraw-export-settings-')),source=join(scratch,'颜色 中文.tiff');
const python=resolve('build/qa-venv/bin/python'),engine=new EngineClient({cache:join(scratch,'cache')});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let passed=false;
try{
 execFileSync(python,['-c',`import numpy as np,tifffile,sys
y,x=np.mgrid[:320,:480];r=np.random.default_rng(42)
a=np.clip(np.stack([x*100+y*30,y*150+x*20,(x+y)*65],axis=-1)+r.normal(0,1500,(320,480,3)),0,65535).astype(np.uint16)
tifffile.imwrite(sys.argv[1],a,photometric='rgb')`,source]);
 const original=hash(source),opened=await engine.call('open',{path:source,sessionId:'export-settings',baselineVersion:4});
 const {artProfile}=await engine.call('compose',{width:opened.width,height:opened.height,adjustments:opened.adjustments,artProfile:opened.artProfile});
 for(const [name,format,patch] of [['zip','tiff',{resolution:240}],['none','tiff',{tiffCompression:'none',resolution:72}],['low','jpeg',{jpegQuality:2,resolution:72}],['high','jpeg',{jpegQuality:12,resolution:300}]]){
  await engine.call('export',{path:source,artProfile,output:join(scratch,name+'.'+(format==='tiff'?'tiff':'jpg')),format,colorSpace:'srgb',options:{...structuredClone(DEFAULT_EXPORT_OPTIONS),...patch}});
 }
 const result=execFileSync(python,['-c',`import numpy as np,tifffile,json,sys
from PIL import Image
from pathlib import Path
d=Path(sys.argv[1]);images={}
for name,ppi in [('zip',240),('none',72),('low',72),('high',300)]:
 p=d/(name+('.tiff' if name in ['zip','none'] else '.jpg'));im=Image.open(p);assert im.size==(480,320)
 assert im.info.get('icc_profile');exif=im.getexif();assert int(exif[296])==2
 assert abs(float(exif[282])-ppi)<.001 and abs(float(exif[283])-ppi)<.001
 packet=im.info.get('xmp') or im.info.get('XML:com.adobe.xmp') or (im.tag_v2.get(700) if hasattr(im,'tag_v2') else b'') or b''
 if isinstance(packet,str):packet=packet.encode()
 assert b'XResolution' in packet and b'YResolution' in packet
 images[name]=np.asarray(im)
for name,compression in [('zip',8),('none',1)]:
 with tifffile.TiffFile(d/(name+'.tiff')) as t:
  assert t.asarray().dtype==np.uint16;assert t.pages[0].compression==compression
assert np.array_equal(tifffile.imread(d/'zip.tiff'),tifffile.imread(d/'none.tiff'))
ref=images['none'].astype(float);low=((images['low'].astype(float)-ref)**2).mean();high=((images['high'].astype(float)-ref)**2).mean()
assert high<low,(high,low);assert (d/'high.jpg').stat().st_size>(d/'low.jpg').stat().st_size
print(json.dumps(dict(tiff16CompressionPixelDifference=0,jpegMSE={'quality2':low,'quality12':high},ppi=[72,240,300],icc=True,pixelDimensions=[480,320])))`,scratch],{encoding:'utf8'});
 console.log(result.trim());
 for(const patch of [{resolution:0},{resolution:72.5},{resolution:1000},{jpegQuality:13},{tiffCompression:'lossy'},{tiffCompression:'lzw'}]){
  const output=join(scratch,'invalid.tiff');await assert.rejects(engine.call('export',{path:source,artProfile,output,format:'tiff',options:{...structuredClone(DEFAULT_EXPORT_OPTIONS),...patch}}));assert(!existsSync(output));
 }
 assert.equal(hash(source),original);passed=true;console.log('PASS real codec, PPI, ICC, unchanged dimensions/pixels/source and native boundary validation');
}finally{
 await engine.stop();if(passed)rmSync(scratch,{recursive:true,force:true});else console.error('Failure retained:',scratch);
}
