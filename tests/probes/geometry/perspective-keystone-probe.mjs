// Read-only diagnostics of one observed ACR V20 state. No production adapter,
// formula selection, shared build or Adobe automation.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CRS,lookup,decodeAdjustments} from '@captraw/desktop-core/xmp';
const run=promisify(execFile),root=await mkdtemp(join(tmpdir(),'captraw-keystone-probe-')),sha=b=>createHash('sha256').update(b).digest('hex');
const source=resolve('artifacts/stage-0/acr-reference/source/acr-geometry-keystone.tif'),refs=resolve('artifacts/stage-0/acr-reference/geometry-manual-187'),binary=resolve('build/native/captraw-engine'),python=resolve('build/qa-venv/bin/python');
const files=[binary,source,join(refs,'geometry-keystone.xmp'),...['unconstrained','constrained'].flatMap(n=>[join(refs,'inputs/geometry-keystone-v20-'+n+'.tif'),join(refs,'geometry-keystone-v20-'+n+'.xmp')])];
const cohort=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])));let core,passed=false,revision=0;
const analyze=String.raw`
import json,sys,numpy as np,tifffile
from pathlib import Path
# Connected white interiors are independent location features, never image alpha.
def features(path):
 a=tifffile.imread(path);assert a.dtype==np.uint16 and a.shape[2]==3
 mask=(a.min(2)>45000)&((a.max(2).astype(float)-a.min(2))<5000)
 parents=[];runs=[];prev=[]
 def find(i):
  while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
  return i
 for y,row in enumerate(mask):
  padded=np.r_[False,row,False];edges=np.flatnonzero(padded[1:]!=padded[:-1]);current=[]
  for left,right in zip(edges[::2],edges[1::2]):
   i=len(parents);parents.append(i);runs.append((y,int(left),int(right)));current.append(i)
   for j in prev:
    _,lo,hi=runs[j]
    if hi>left and lo<right:parents[find(i)]=find(j)
  prev=current
 groups={}
 for i,(y,l,r) in enumerate(runs):
  n=r-l;g=groups.setdefault(find(i),[0,0.,0.,l,y,r,y+1]);g[0]+=n;g[1]+=(l+r-1)*n/2;g[2]+=y*n;g[3]=min(g[3],l);g[4]=min(g[4],y);g[5]=max(g[5],r);g[6]=max(g[6],y+1)
 result=[];h,w=mask.shape
 for n,sx,sy,l,t,r,b in groups.values():
  if 500<n<6500 and 35<r-l<100 and 35<b-t<100 and l>15 and t>15 and r<w-15 and b<h-15:result.append(dict(point=[sx/n,sy/n],area=n,box=[l,t,r,b]))
 return a.shape,sorted(result,key=lambda f:(f['point'][1],f['point'][0]))
def transform(h,p):
 a=np.c_[p,np.ones(len(p))]@h.T;return a[:,:2]/a[:,2,None]
def matrix(p,q):
 # Coordinate normalization fixes conditioning, not registration of candidates.
 p=np.asarray(p);q=np.asarray(q);c=np.array([500.,400.]);s=1000.;p=(p-c)/s;q=(q-c)/s
 rows=[];rhs=[]
 for (x,y),(u,v) in zip(p,q):rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);rhs.extend([u,v])
 h=np.r_[np.linalg.lstsq(rows,rhs,rcond=None)[0],1].reshape(3,3);t=np.array([[1/s,0,-c[0]/s],[0,1/s,-c[1]/s],[0,0,1]])
 h=np.linalg.inv(t)@h@t;return h/h[2,2]
def match(pred,candidates,limit):
 c=np.array([f['point'] for f in candidates]);pred=np.asarray(pred);d=np.linalg.norm(pred[:,None,:]-c[None,:,:],axis=2);idx=d.argmin(1);return {i:int(j) for i,j in enumerate(idx) if d[i,j]<limit and d[:,j].argmin()==i}
def error(a,b):
 e=np.linalg.norm(np.asarray(a)-b,axis=1);return dict(count=len(e),rmsePixels=float(np.sqrt(np.mean(e*e))),maxPixels=float(e.max()))
if sys.argv[1]=='features':
 shape,f=features(sys.argv[2]);print(json.dumps(dict(shape=shape,features=f)));sys.exit()
plan=json.loads(Path(sys.argv[2]).read_text());src=np.array([f['point'] for f in plan['sourceFeatures']]);_,acr=features(plan['adobe']);ac=match(src,acr,40);assert len(ac)>=25,len(ac)
ids=sorted(ac);observed=np.array([acr[ac[i]]['point'] for i in ids]);p=src[ids]
# Estimate this observed V20 matrix only. No Adobe-parameter function is fitted.
train=np.arange(len(ids))%2==0;h=matrix(p[train],observed[train]);check=error(transform(h,p[~train]),observed[~train]);assert check['maxPixels']<1.25,check
center=np.array([[1,0,500],[0,1,400],[0,0,1.]]);hc=np.linalg.inv(center)@h@center;hc/=hc[2,2];kv=hc[2,1]*800
prepared=[]
for row in plan['native']:
 _,f=features(row['path']);mapped=np.array(row['points']);nm=match(mapped,f,3);prepared.append((row,f,mapped,nm))
shared=sorted(set(ids).intersection(*(set(nm) for _,_,_,nm in prepared)));assert len(shared)>=30,len(shared)
rows=[]
for row,f,mapped,nm in prepared:
 common=[i for i in ids if i in nm];assert len(common)>=20,(row['id'],len(common))
 direct=error(mapped[common],[acr[ac[i]]['point'] for i in common]);raster=error([f[nm[i]]['point'] for i in common],[acr[ac[i]]['point'] for i in common]);validation=error(mapped[common],[f[nm[i]]['point'] for i in common]);hn=matrix(src,mapped);hnc=np.linalg.inv(center)@hn@center;hnc/=hnc[2,2]
 rows.append(dict(id=row['id'],native=row['perspective'],sharedFeaturesCoordinateVsAdobe=error(mapped[shared],[acr[ac[i]]['point'] for i in shared]),nativeCoordinateVsAdobe=direct,nativeRasterVsAdobe=raster,nativeCoordinateVsOwnRaster=validation,centeredDenominator=hnc[2].tolist(),matrix=hn.tolist()))
cropShape,cropped=features(plan['adobeCrop']);assert cropShape==(745,931,3);crop=plan['crop'];scale=np.array([cropShape[1]/(1000*(crop[2]-crop[0])),cropShape[0]/(800*(crop[3]-crop[1]))]);pred=(observed-np.array([1000*crop[0],800*crop[1]]))*scale;cm=match(pred,cropped,3);assert len(cm)>=20,len(cm)
crop_error=error([pred[i] for i in cm],[cropped[cm[i]]['point'] for i in cm])
print(json.dumps(dict(sourceFeatures=len(src),adobeMatchedFeatures=len(ids),observedV20Matrix=h.tolist(),observedV20CenteredMatrix=hc.tolist(),observedMatrixValidation=check,observedEquivalentAshiftVertical=200*float(np.arctanh(kv/2)),native=rows,unconstrainedToConstrainedUsingRecordedCrop=crop_error,crop=crop,limitations=['Observed V20 homography is not an Adobe parameter formula','Candidate coordinates/raster positions are compared without fitted registration','White-component centroid/threshold location precision is approximately half a pixel','The constrained reference is predicted from its recorded crop, never fitted','No H/Rotate nonzero reference is present; no standard H/V/Rotate adapter is enabled'])))
`;
try{
 const script=join(root,'analyze.py');await writeFile(script,analyze);
 const extracted=JSON.parse((await run(python,[script,'features',source])).stdout);assert.deepEqual(extracted.shape,[800,1000,3]);
 const xmp=new XMP(resolve('build/xmp/captraw-xmp')),packet=await xmp.read(join(refs,'geometry-keystone.xmp')),decoded=decodeAdjustments(packet.properties);assert.equal(lookup(packet.properties,CRS,'AlreadyApplied').value,'False');assert.equal(Number(lookup(packet.properties,CRS,'PerspectiveVertical').value),20);assert.equal(decoded.adjustments.perspective,undefined);
 const cropPacket=await xmp.read(join(refs,'geometry-keystone-v20-constrained.xmp')),crop=['CropLeft','CropTop','CropRight','CropBottom'].map(name=>Number(lookup(cropPacket.properties,CRS,name).value));assert.deepEqual(crop,[.034569,.034569,.965431,.965431]);
 core=new EngineClient({executable:binary,cache:join(root,'cache'),env:{OMP_NUM_THREADS:'2'}});const image=await core.call('open',{path:source,sessionId:'keystone',effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
 const neutral={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1,manualModel:'art-perspective-v1',scale:1,offsetX:0,offsetY:0,constrainCrop:false},native=[];
 for(const [id,perspective] of [['standard-V-ignored-full-canvas-isolation',{...neutral}],['art-V20-no-fill',{...neutral,vertical:20}],['art-Vminus20-no-fill',{...neutral,vertical:-20}],['art-V20-fill',{...neutral,vertical:20,constrainCrop:true}]]){
  const adjustments={...image.adjustments,crop:null,rotation:0,fineRotation:0,flipHorizontal:false,flipVertical:false,lensCorrections:false,lensManualDistortion:0,masks:[],spots:[],perspective},wait=core.preview(++revision),result=await core.call('update',{revision,artProfile:image.artProfile,adjustments});await wait;
  const mapped=await core.call('coordinates',{sessionId:image.id,revision,from:'source',to:'display',points:extracted.features.map(f=>({x:f.point[0],y:f.point[1]}))}),output=join(root,id+'.tif');await core.call('export',{path:source,artProfile:result.artProfile,output,format:'tiff',colorSpace:'srgb'});native.push({id,perspective,path:output,points:mapped.points.map(p=>[p.x,p.y])});
 }
 const plan={sourceFeatures:extracted.features,adobe:join(refs,'inputs/geometry-keystone-v20-unconstrained.tif'),adobeCrop:join(refs,'inputs/geometry-keystone-v20-constrained.tif'),crop,native};await writeFile(join(root,'plan.json'),JSON.stringify(plan));
 const {stdout}=await run(python,[script,'analyze',join(root,'plan.json')],{maxBuffer:4*1024*1024});const report=JSON.parse(stdout);for(const [path,hash] of Object.entries(cohort))assert.equal(sha(await readFile(path)),hash,path+' changed during diagnostics');
 passed=true;console.log(JSON.stringify({cohort,unsupportedStandardWarnings:decoded.warnings,...report,scratchCleaned:true},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),stderr:error.stderr,stdout:error.stdout,cohort,diagnostics:core?.diagnostics},null,2));throw error;}finally{await core?.stop();if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained keystone probe:',root);}
