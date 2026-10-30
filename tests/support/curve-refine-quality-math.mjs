// Independent output-ICC diagnostics. No engine, renderer or source mutation.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
export const iccLabPython=String.raw`
import ctypes as ct,hashlib,json,re,sys
from pathlib import Path
import numpy as np,tifffile
cache=Path('build/native/CMakeCache.txt').read_text()
match=re.search(r'^pkgcfg_lib_LCMS_lcms2:FILEPATH=(.+)$',cache,re.M)
assert match,'Missing configured LittleCMS library'
cms=ct.CDLL(match[1]);P=ct.c_void_p;U=ct.c_uint32
for name,result,args in [('cmsOpenProfileFromMem',P,[P,U]),('cmsCreateLab4Profile',P,[P]),('cmsCreateTransform',P,[P,U,P,U,U,U]),('cmsDoTransform',None,[P,P,P,U]),('cmsDeleteTransform',None,[P]),('cmsCloseProfile',None,[P])]:
 f=getattr(cms,name);f.restype=result;f.argtypes=args
RGB_FLOAT=(1<<22)|(4<<16)|(3<<3)|4
LAB_FLOAT=(1<<22)|(10<<16)|(3<<3)|4
def read_tiff(path):
 with tifffile.TiffFile(path) as f:
  a=f.asarray();assert a.dtype==np.uint16 and a.ndim==3 and a.shape[2]==3,(path,a.dtype,a.shape)
  assert 34675 in f.pages[0].tags,('Missing real output ICC',path)
  return a,f.pages[0].tags[34675].value
def to_lab(a,icc):
 buf=ct.create_string_buffer(icc);source=cms.cmsOpenProfileFromMem(buf,len(icc));destination=cms.cmsCreateLab4Profile(None)
 assert source and destination,'ICC handler rejected profile'
 transform=None
 try:
  # Real embedded profile, relative colorimetric, no optimization or cache.
  transform=cms.cmsCreateTransform(source,RGB_FLOAT,destination,LAB_FLOAT,1,0x0100|0x0040)
  assert transform,'Cannot create independent ICC-to-Lab transform'
  rgb=np.ascontiguousarray(a,dtype=np.float32)/np.float32(65535);out=np.empty_like(rgb)
  cms.cmsDoTransform(transform,rgb.ctypes.data,out.ctypes.data,a.shape[0]*a.shape[1]);assert np.isfinite(out).all()
  return out
 finally:
  if transform:cms.cmsDeleteTransform(transform)
  cms.cmsCloseProfile(source);cms.cmsCloseProfile(destination)
def gray_metrics(first,second,start):
 a,ai=read_tiff(first);b,bi=read_tiff(second);assert a.shape==b.shape and ai==bi
 a=a[start:];b=b[start:];d=b.astype(np.int32)-a.astype(np.int32)
 la=to_lab(a,ai);lb=to_lab(b,bi);delta=lb.astype(np.float64)-la;de=np.linalg.norm(delta,axis=2)
 return dict(iccSHA256=hashlib.sha256(ai).hexdigest(),perChannelMax16=np.abs(d).max((0,1)).tolist(),legacyGrayOutputMaxSpread16=int(np.ptp(a.astype(np.int32),axis=2).max()),maxDeltaE76=float(de.max()),p95DeltaE76=float(np.percentile(de,95)),maxAbsDeltaL=float(np.abs(delta[:,:,0]).max()),maxAbsDeltaA=float(np.abs(delta[:,:,1]).max()),maxAbsDeltaB=float(np.abs(delta[:,:,2]).max()))
`;
export function grayICC(first,second,start=128){
 return JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',iccLabPython+'\nprint(json.dumps(gray_metrics(sys.argv[1],sys.argv[2],int(sys.argv[3]))))',first,second,String(start)],{encoding:'utf8',maxBuffer:1024*1024}));
}
