// Isolated measurements of the existing renderer; no replacement HSL kernel.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-hsl-tat-research-')),ref=resolve('artifacts/stage-0/acr-reference/tat-interaction-187');
const source=join(ref,'inputs/controlled-tat.tif'),binary=process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source),engineHash=hash(binary);
const python=process.env.CAPTRAW_PYTHON||resolve('build/qa-venv/bin/python');let core,success=false;
const lcms=process.env.CAPTRAW_LCMS||join(execFileSync('pkg-config',['--variable=libdir','lcms2'],{encoding:'utf8'}).trim(),process.platform==='darwin'?'liblcms2.dylib':'liblcms2.so');
try{
 assert.equal(sourceHash,'da7915588f6ac92cf3de084f7ba6aebf396e76017a77ae6a115d25786df7f379');
 core=new EngineClient({cache:join(work,'engine'),env:{OMP_NUM_THREADS:'2'}});
 const image=await core.call('open',{path:source,sessionId:'hsl-research',sourceFramePolicy:'active-area-v1',whiteBalanceDefaults:'current'});
 const zero={hue:Array(8).fill(0),saturation:Array(8).fill(0),luminance:Array(8).fill(0)};
 const base={...image.adjustments,crop:null,exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,saturation:0,vibrance:0,
  texture:0,clarity:0,dehaze:0,glow:0,grain:0,vignette:0,sharpening:0,luminanceNoise:0,colorNoise:0,lensCorrections:false,masks:[],spots:[],hsl:zero};
 const cases=[{id:'zero',hsl:zero}];
 for(const mode of process.env.CAPTRAW_HSL_FIXED_ONLY?[]:['hue','saturation','luminance'])for(const [index,name]of ['red','orange','yellow'].entries()){
  const hsl=structuredClone(zero);hsl[mode][index]=40;cases.push({id:mode+'-'+name+'40',hsl});
 }
 const actual=JSON.parse(execFileSync(python,['-c',`import pathlib,xml.etree.ElementTree as E,json,sys
p=pathlib.Path(sys.argv[1]);ns='{http://ns.adobe.com/camera-raw-settings/1.0/}'
out=[]
def settings(path):
 root=E.parse(path);f={k[len(ns):]:v for n in root.iter() for k,v in n.attrib.items() if k.startswith(ns)}
 for n in root.iter():
  if n.tag.startswith(ns):f[n.tag[len(ns):]]=tuple(''.join(c.itertext()).strip() for c in n if c.tag.endswith('Seq'))
 return f
neutral=settings(p/'controlled-tat-neutral.xmp')
for name in ['hue-up80','hue-down80-valid','saturation-up80','luminance-down80']:
 fields=settings(p/('controlled-tat-'+name+'.xmp'))
 assert fields['Version']=='18.7' and fields['IncrementalTemperature']=='0' and fields['IncrementalTint']=='0'
 assert all(neutral.get(k)==fields.get(k) for k in neutral.keys()|fields.keys() if not k.startswith(('HueAdjustment','SaturationAdjustment','LuminanceAdjustment'))),name+' base settings differ'
 hsl={mode:[int(fields.get(prefix+'Adjustment'+band,'0')) for band in ['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta']] for mode,prefix in [('hue','Hue'),('saturation','Saturation'),('luminance','Luminance')]}
 out.append({'id':name,'hsl':hsl,'acr':str(p/'inputs'/('controlled-tat-'+name+'.tif'))})
if sys.argv[2]:
 extra=json.loads(sys.argv[2]);base=settings(extra['neutralXmp']);fields=settings(extra['xmp'])
 assert base==neutral,'New red reference neutral settings differ from the fixed neutral'
 differences={k:(base.get(k),fields.get(k)) for k in base.keys()|fields.keys() if base.get(k)!=fields.get(k)}
 assert set(differences)=={'LuminanceAdjustmentRed'} and int(fields['LuminanceAdjustmentRed'])==40,differences
 hsl={mode:[40 if mode=='luminance' and i==0 else 0 for i in range(8)] for mode in ['hue','saturation','luminance']}
 out.append({'id':'red-luminance40','hsl':hsl,'acr':extra['tiff'],'acrBaseline':extra['neutralTiff']})
print(json.dumps(out))`,ref,process.env.CAPTRAW_HSL_RED_REFERENCE||''],{encoding:'utf8'}));cases.push(...actual);
 for(const c of cases){
  const profile=await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:{...base,hsl:c.hsl}});
  c.native=join(work,c.id+'.tif');await core.call('export',{path:source,artProfile:profile.artProfile,output:c.native,format:'tiff',colorSpace:'srgb'});
 }
 const result=JSON.parse(execFileSync(python,['-c',`import ctypes as C,tifffile,numpy as np,json,sys,pathlib,hashlib
cases=json.loads(sys.argv[1]);ref=pathlib.Path(sys.argv[2]);lib=C.CDLL(sys.argv[3])
lib.cmsOpenProfileFromMem.argtypes=[C.c_void_p,C.c_uint32];lib.cmsOpenProfileFromMem.restype=C.c_void_p
lib.cmsCreateXYZProfile.restype=C.c_void_p
lib.cmsCreateTransform.argtypes=[C.c_void_p,C.c_uint32,C.c_void_p,C.c_uint32,C.c_uint32,C.c_uint32];lib.cmsCreateTransform.restype=C.c_void_p
lib.cmsDoTransform.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_uint32]
lib.cmsDeleteTransform.argtypes=[C.c_void_p];lib.cmsCloseProfile.argtypes=[C.c_void_p]
rgbtype=(1<<22)|(4<<16)|(3<<3)|4;xyztype=(1<<22)|(9<<16)|(3<<3)|4
def load(path):
 with tifffile.TiffFile(path) as f:
  page=f.pages[0];a=page.asarray();icc=bytes(page.tags[34675].value)
  assert a.shape==(1024,1536,3) and a.dtype==np.uint16
 profileBytes=C.create_string_buffer(icc);ip=lib.cmsOpenProfileFromMem(profileBytes,len(icc));op=lib.cmsCreateXYZProfile()
 transform=lib.cmsCreateTransform(ip,rgbtype,op,xyztype,1,0x140);assert transform
 rgb=np.ascontiguousarray(a,dtype=np.float32)/65535.;xyz=np.empty_like(rgb)
 try:lib.cmsDoTransform(transform,rgb.ctypes.data,xyz.ctypes.data,a.shape[0]*a.shape[1])
 finally:lib.cmsDeleteTransform(transform);lib.cmsCloseProfile(ip);lib.cmsCloseProfile(op)
 assert np.isfinite(xyz).all()
 return a.astype(np.int32),xyz.astype(np.float64),hashlib.sha256(icc).hexdigest()
nb,nx,nicc=load(cases[0]['native']);ab,ax,aicc=load(ref/'inputs/controlled-tat-neutral.tif')
patches=[('orange',128,240),('midgray166',640,550),('darkGray',384,550),('red',128,80),('yellow',896,80)]
def patches_of(delta):return {name:delta[y-4:y+4,x-4:x+4].mean((0,1)).tolist() for name,x,y in patches}
def lab(xyz):
 t=xyz/np.array([.9642,1.,.8249]);f=np.where(t>(6/29)**3,np.cbrt(t),t/(3*(6/29)**2)+4/29)
 return np.stack([116*f[:,:,1]-16,500*(f[:,:,0]-f[:,:,1]),200*(f[:,:,1]-f[:,:,2])],axis=-1)
nl,al=lab(nx),lab(ax)
tiles=[('patch-%02d'%i,slice((i//6)*160+32,(i//6)*160+128),slice((i%6)*256+32,(i%6)*256+224)) for i in range(24)]
tiles += [('gray-steps',slice(660,812),slice(16,1520)),('gray-linear-ramp',slice(848,912),slice(16,1520)),('gray-log-ramp',slice(944,1008),slice(16,1520))]
def metric(v):return {'mean':float(np.mean(v)),'p95':float(np.percentile(v,95)),'max':float(np.max(v))}
def roi_rows(a,x,ac=None,xc=None,acrbase=ab,acrxyz=ax):
 l=lab(x);lc=lab(xc) if xc is not None else None;acr_lab=lab(acrxyz);out=[]
 for name,ys,xs in tiles:
  d=a[ys,xs]-nb[ys,xs];dx=x[ys,xs]-nx[ys,xs];dl=l[ys,xs]-nl[ys,xs]
  row={'id':name,'nativeRGB16Mean':a[ys,xs].mean((0,1)).tolist(),'nativeBaseRGB16Mean':nb[ys,xs].mean((0,1)).tolist(),
   'nativeDeltaRGB16Mean':d.mean((0,1)).tolist(),'nativeDeltaRGB16Absolute':metric(abs(d)),
   'nativeDeltaXYZD50Mean':dx.mean((0,1)).tolist(),'nativeDeltaLabMean':dl.mean((0,1)).tolist(),
   'nativeAddedLowClipByChannel':(((a[ys,xs]==0)&(nb[ys,xs]>0)).sum((0,1))).tolist(),
   'nativeAddedHighClipByChannel':(((a[ys,xs]==65535)&(nb[ys,xs]<65535)).sum((0,1))).tolist(),
   'nativeAddedClipPixels':int(((((a[ys,xs]==0)&(nb[ys,xs]>0))|((a[ys,xs]==65535)&(nb[ys,xs]<65535))).any(2)).sum())}
  if ac is not None:
   ad=ac[ys,xs]-acrbase[ys,xs];adx=xc[ys,xs]-acrxyz[ys,xs];adl=lc[ys,xs]-acr_lab[ys,xs]
   row.update(acrRGB16Mean=ac[ys,xs].mean((0,1)).tolist(),acrBaseRGB16Mean=acrbase[ys,xs].mean((0,1)).tolist(),acrDeltaRGB16Mean=ad.mean((0,1)).tolist(),acrDeltaRGB16Absolute=metric(abs(ad)),
    acrDeltaXYZD50Mean=adx.mean((0,1)).tolist(),acrDeltaLabMean=adl.mean((0,1)).tolist(),
    effectResidualXYZD50=metric(np.linalg.norm(dx-adx,axis=2)),effectResidualLab76=metric(np.linalg.norm(dl-adl,axis=2)),
    acrAddedClipPixels=int(((((ac[ys,xs]==0)&(acrbase[ys,xs]>0))|((ac[ys,xs]==65535)&(acrbase[ys,xs]<65535))).any(2)).sum()))
  out.append(row)
 return out
rows=[]
for case in cases[1:]:
 a,x,icc=load(case['native']);assert icc==nicc
 row={'id':case['id'],'hsl':case['hsl'],'nativePixelSHA256':hashlib.sha256(a.astype('<u2').tobytes()).hexdigest(),'nativeDeltaRGB16':patches_of(a-nb),'nativeDeltaXYZD50':patches_of(x-nx)}
 if 'acr' in case:
  ac,xc,ic=load(case['acr']);assert ic==aicc
  arb,arx,aricc=load(case['acrBaseline']) if 'acrBaseline' in case else (ab,ax,aicc);assert aricc==aicc
  row['acrDeltaRGB16']=patches_of(ac-arb);row['acrDeltaXYZD50']=patches_of(xc-arx)
  row['effectResidualXYZD50']=patches_of((x-nx)-(xc-arx))
  row['rois']=roi_rows(a,x,ac,xc,arb,arx)
  row['referenceSHA256']=hashlib.sha256(pathlib.Path(case['acr']).read_bytes()).hexdigest()
 else:row['rois']=roi_rows(a,x)
 rows.append(row)
print(json.dumps({'scope':'Actual existing ART operators; output ICCs independently converted by LittleCMS float32 to XYZ D50. Different zero baselines and effects remain separate; no scalar fit or quality acceptance.',
 'nativeICC':nicc,'acrICC':aicc,'nativeZeroPixelSHA256':hashlib.sha256(nb.astype('<u2').tobytes()).hexdigest(),
 'baselineDeltaRGB16':patches_of(nb-ab),'baselineDeltaXYZD50':patches_of(nx-ax),
 'baselineROIs':[{'id':name,'deltaRGB16Absolute':metric(abs(nb[ys,xs]-ab[ys,xs])),'deltaXYZD50':metric(np.linalg.norm(nx[ys,xs]-ax[ys,xs],axis=2))} for name,ys,xs in tiles],'rows':rows}))`,JSON.stringify(cases),ref,lcms],{encoding:'utf8',maxBuffer:8*1024*1024}));
 assert.equal(hash(source),sourceHash);assert.equal(hash(binary),engineHash);result.engineSHA256=engineHash;result.sourceSHA256=sourceHash;result.lcms={path:lcms,sha256:hash(lcms)};
 const report=process.argv[2]||join(tmpdir(),'captraw-hsl-tat-research.json');writeFileSync(report,JSON.stringify(result,null,2));
 console.log(JSON.stringify({report,cases:cases.length,sourceUnchanged:true,scope:result.scope}));success=true;
}finally{if(core)await core.stop();if(success)rmSync(work,{recursive:true,force:true});else console.error('Research failure retained:',work);}
