// Default: verify/crop frozen public inputs only. --run requires a frozen engine
// SHA; no build, download, GUI, source write or parameter fitting occurs here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,createReadStream,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {EngineClient} from '../../support/engine-client.mjs';
import {POINT_CURVE_PRESETS} from '@captraw/contracts';
import {iccLabPython} from '../../support/curve-refine-quality-math.mjs';
const {values:options}=parseArgs({options:{run:{type:'boolean'},'engine-sha':{type:'string'},'review-dir':{type:'string'},'review-only':{type:'boolean'}}});
if(options.run)assert.match(options['engine-sha']??'',/^[a-f0-9]{64}$/,'--run needs --engine-sha from the coordinated build');
assert(!options['review-dir']||options.run,'Review output requires actual native renders');
assert(!options['review-only']||(options.run&&options['review-dir']),'--review-only requires --run, a frozen SHA and a new --review-dir');
const work=mkdtempSync(join(tmpdir(),'captraw-curve-refine-photo-')),python=resolve('build/qa-venv/bin/python'),root=resolve('artifacts/stage-0/acr-reference'),photo=join(root,'curves-refine-photo-187'),textureReference=join(root,'curves-refine-texture-187');
const read=p=>JSON.parse(readFileSync(p,'utf8')),py=(code,...args)=>JSON.parse(execFileSync(python,['-c',code,...args],{encoding:'utf8',maxBuffer:8*1024*1024}));
async function sha(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
const fixtures=read('tests/fixtures/fixtures.json'),nasa=read(join(photo,'sources.json')),texture=read(join(root,'output-sharpen-holdout-187/sources.json')),rendered=read(join(root,'rendered-references.json'));
const canon=fixtures.find(f=>f.name==='canon-r5.CR3'),fuji=fixtures.find(f=>f.name==='fuji-xt4.RAF');
assert.equal(canon.license,'CC0-1.0');assert.equal(fuji.license,'CC0-1.0');assert.match(nasa.license,/Public domain/);
const sources=[
 {id:'astronaut',path:join(photo,'input.tif'),sha256:'4d896792cbee8b6188c69f2d291524f9ac89beccf749978c9c2d670d491a2221',url:nasa.source,license:nasa.license,rawPath:join(photo,'source/astronaut.png'),rawSHA:'88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5',iccSHA:nasa.iccSHA256,precision:'512x512 original RGB8 multiplied by257: no added detail, no RAW/high-resolution skin claim',rois:{face:[176,72,104,102],cheek:[191,112,28,24],fabric:[30,246,154,118],helmetSpecular:[305,350,184,144]}},
 {id:'leaf-wood',path:join(root,'output-sharpen-holdout-187/inputs/texture-holdout-rendered-roi.tif'),sha256:'df8409808971dbb014552fdb49d15753abb5fce77673103b5ddcade4a1fb6b88',url:fuji.url,license:fuji.license,rawPath:resolve('build/samples/fuji-xt4.RAF'),rawSHA:fuji.sha256,iccSHA:texture.files.find(f=>f.file==='texture-holdout-rendered-roi.tif').iccSHA256,precision:'Pixel-exact crop of existing ACR TIFF16; source RAW sharpening40/ColorNR25 already baked; no new denoise/sharpening',rois:{leaves:[80,100,900,760],woodEdge:[1300,100,210,760]}},
 {id:'fruit',path:join(root,'renders/canon-r5-neutral.tif'),sha256:'f4ee526a77db2191c0613fab4cf2ca07320056939eeef7240aae78bf7e21dd35',url:canon.url,license:canon.license,rawPath:resolve('build/samples/canon-r5.CR3'),rawSHA:canon.sha256,iccSHA:rendered.references.find(f=>f.path.endsWith('canon-r5-neutral.tif')).iccSHA256,crop:[3200,2300,2048,2048],precision:'Pixel-exact crop of existing ACR TIFF16 fruit photograph; baked RAW rendering retained, no resampling',rois:{fruit:[0,0,2048,2048]}},
];
const prepare=String.raw`
from PIL import Image
s=json.loads(sys.argv[1]);path=sys.argv[2];a,icc=read_tiff(s['path'])
assert hashlib.sha256(icc).hexdigest()==s['iccSHA']
if s['id']=='astronaut':
 original=np.asarray(Image.open(s['rawPath'])).astype(np.uint16);assert a.shape==(512,512,3) and np.array_equal(a,original*257)
if s.get('crop'):
 x,y,w,h=s['crop'];a=a[y:y+h,x:x+w].copy();assert a.shape==(h,w,3)
assert np.isfinite(a).all()
for name,(x,y,w,h) in s['rois'].items():assert x>=0 and y>=0 and w>0 and h>0 and x+w<=a.shape[1] and y+h<=a.shape[0],name
tifffile.imwrite(path,a,photometric='rgb',extratags=[(34675,'B',len(icc),icc,False)])
print(json.dumps(dict(width=a.shape[1],height=a.shape[0],pixelSHA256=hashlib.sha256(a.tobytes()).hexdigest(),iccSHA256=hashlib.sha256(icc).hexdigest(),sourceMaxChannelSpread16=int(np.ptp(a.astype(np.int32),axis=2).max()))))
`;
// Diagnostic conversion only: derive final working/output RGB from the existing
// full-resolution SDR linear-Rec709 transport. Propagate half ULP uncertainty;
// never treat an uncertain boundary as certified inside/outside.
const gamutPython=String.raw`
import struct
matrix_source=Path('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine/iccmatrices.h').read_text()
matrix_source=re.sub(r'/\*.*?\*/','',matrix_source,flags=re.S)
body=re.search(r'constexpr float xyz_rec2020\[3\]\[3\] = \{(.*?)\};',matrix_source,re.S)[1]
working_matrix=np.array([float(x) for x in re.findall(r'-?\d+\.\d+',body)],np.float32).reshape(3,3).astype(float)
def profile_matrix(icc):
 tags={}
 for k in range(struct.unpack_from('>I',icc,128)[0]):
  key,offset,size=struct.unpack_from('>4sII',icc,132+12*k);tags[key]=icc[offset:offset+size]
 return np.column_stack([np.array(struct.unpack_from('>iii',tags[key],8))/65536 for key in [b'rXYZ',b'gXYZ',b'bXYZ']])
linear_icc=Path('build/native/resources/iccprofiles/output/RTv4_Linear_Rec709.icc').read_bytes()
linear_matrix=profile_matrix(linear_icc)
def stage_gamut(meta,base_meta,base,actual,output_icc):
 assert meta['encoding']=='rgba16float-le' and meta['colorSpace']=='rec709-linear'
 h,w=actual.shape[:2];assert (meta['height'],meta['width'])==(h,w)
 assert (base_meta['height'],base_meta['width'])==(h,w)
 pixels=np.memmap(meta['file'],dtype='<f2',mode='r',shape=(h,w,4))
 previous=np.memmap(base_meta['file'],dtype='<f2',mode='r',shape=(h,w,4))
 to_working=np.linalg.inv(working_matrix)@linear_matrix
 to_output=np.linalg.inv(profile_matrix(output_icc))@linear_matrix
 added=((actual==0)&(base>0))|((actual==65535)&(base<65535));new_mask=added.any(2)
 counts=dict(pixels=h*w,addedOutputClipPixels=int(new_mask.sum()),workingDefiniteOutsidePixels=0,newWorkingDefiniteOutsideVsBaseline=0,newClipWorkingCertifiedInteriorPixels=0,newClipWorkingDefiniteOutsidePixels=0,newClipWorkingUncertainPixels=0,newClipTargetLinearDefiniteOutsidePixels=0,newClipTargetLinearUncertainPixels=0,newClipTargetLinearCertifiedInteriorPixels=0)
 deficit=[];maximum=0.
 def convert(v,matrix):
  v=v.astype(np.float64);assert np.isfinite(v).all()
  half=v.astype(np.float16);up=np.nextafter(half,np.float16(np.inf)).astype(float);down=np.nextafter(half,np.float16(-np.inf)).astype(float)
  error=.5*np.maximum(up-v,v-down)
  mapped=v@matrix.T
  bound=error@np.abs(matrix).T+8*np.finfo(np.float32).eps*(np.abs(v)@np.abs(matrix).T)
  inside=((mapped-bound>=0)&(mapped+bound<=1)).all(2)
  outside=((mapped+bound<0)|(mapped-bound>1)).any(2)
  return mapped,bound,inside,outside
 for start in range(0,h,64):
  end=min(start+64,h);v=pixels[start:end,:,:3];old=previous[start:end,:,:3];mask=new_mask[start:end]
  work,bound,inside,outside=convert(v,to_working);old_work,old_bound,old_inside,old_outside=convert(old,to_working)
  target,target_bound,target_inside,target_outside=convert(v,to_output)
  counts['workingDefiniteOutsidePixels']+=int(outside.sum());counts['newWorkingDefiniteOutsideVsBaseline']+=int((outside&old_inside).sum())
  counts['newClipWorkingCertifiedInteriorPixels']+=int((mask&inside).sum());counts['newClipWorkingDefiniteOutsidePixels']+=int((mask&outside).sum());counts['newClipWorkingUncertainPixels']+=int((mask&~inside&~outside).sum())
  counts['newClipTargetLinearDefiniteOutsidePixels']+=int((mask&target_outside).sum());counts['newClipTargetLinearCertifiedInteriorPixels']+=int((mask&target_inside).sum());counts['newClipTargetLinearUncertainPixels']+=int((mask&~target_inside&~target_outside).sum())
  # Target-linear overshoot is an estimate before output encoding; unlike the
  # STD code margin, it actually describes the unbounded signal's excursion.
  excursion=np.maximum(np.maximum(-target,target-1),0).max(2)
  if mask.any():deficit.append(excursion[mask]);maximum=max(maximum,float(excursion[mask].max()))
 q=np.concatenate(deficit) if deficit else np.array([])
 return dict(**counts,targetLinearExcursionAtNewClip=None if not len(q) else dict(p50=float(np.median(q)),p95=float(np.percentile(q,95)),max=maximum),transport='Final pre-output pipeline via full-resolution rgba16float Rec709; inverse matrix plus half interval, not raw primary-stage pixels; target-linear estimate excludes output BPC/TRC and integer quantization')
`;
const analyze=String.raw`
from PIL import Image,ImageDraw,ImageCms
import io
scene=json.loads(sys.argv[1]);renders=json.loads(sys.argv[2]);references=json.loads(sys.argv[3]);review=sys.argv[4];rows=[];findings=[]
source,source_icc=read_tiff(scene['input']);source_lab=to_lab(source,source_icc)
source_chroma=np.linalg.norm(source_lab[:,:,1:],axis=2)
masks={'all':np.ones(source.shape[:2],bool),'source-high-chroma':source_chroma>=40,'source-near-neutral':(source_chroma<5)&(source_lab[:,:,0]>5)&(source_lab[:,:,0]<95),'source-highlights':source_lab[:,:,0]>=85}
for name,(x,y,w,h) in scene['rois'].items():
 m=np.zeros(source.shape[:2],bool);m[y:y+h,x:x+w]=True;masks[name]=m
wrap=lambda a:(a+180)%360-180
def stats(a):
 return None if not a.size else dict(mean=float(np.mean(a)),p95=float(np.percentile(a,95)),max=float(np.max(a)))
def change(a,b,ai,bi,eligible):
 la=to_lab(a,ai);lb=to_lab(b,bi);delta=lb.astype(np.float64)-la;ca=np.linalg.norm(la[:,:,1:],axis=2);cb=np.linalg.norm(lb[:,:,1:],axis=2)
 hue=np.abs(wrap(np.degrees(np.arctan2(lb[:,:,2],lb[:,:,1])-np.arctan2(la[:,:,2],la[:,:,1]))));valid=eligible&(ca>=5)&(cb>=5)
 added=(((b==0)&(a>0))|((b==65535)&(a<65535)));recovered=(((a==0)&(b>0))|((a==65535)&(b<65535)))
 # Central luminance differences measure edge/texture changes; source masks and
 # ROIs remain fixed for every candidate/reference, never selected after render.
 gax=la[1:-1,2:,0]-la[1:-1,:-2,0];gay=la[2:,1:-1,0]-la[:-2,1:-1,0]
 gbx=lb[1:-1,2:,0]-lb[1:-1,:-2,0];gby=lb[2:,1:-1,0]-lb[:-2,1:-1,0]
 ga=np.hypot(gax,gay);gb=np.hypot(gbx,gby)
 out={}
 for name,m in masks.items():
  if not m.any():out[name]=dict(pixels=0);continue
  inner=m[1:-1,1:-1];ma=float(ga[inner].mean()) if inner.any() else None;mb=float(gb[inner].mean()) if inner.any() else None
  energy_a=float((gax[inner].astype(float)**2+gay[inner].astype(float)**2).sum());energy_b=float((gbx[inner].astype(float)**2+gby[inner].astype(float)**2).sum());dot=float((gax[inner].astype(float)*gbx[inner]+gay[inner].astype(float)*gby[inner]).sum())
  out[name]=dict(fixedHueEligiblePixels=int((m&eligible).sum()),refinedChromaBelow5Pixels=int((m&eligible&(cb<5)).sum()),gradientVectorCosine=dot/np.sqrt(energy_a*energy_b) if energy_a and energy_b else None,gradientEnergyRatio=np.sqrt(energy_b/energy_a) if energy_a else None,pixels=int(m.sum()),deltaE76=stats(np.linalg.norm(delta[m],axis=1)),absDeltaL=stats(np.abs(delta[:,:,0][m])),signedChromaDeltaMean=float((cb-ca)[m].mean()),hueEligiblePixels=int((m&valid).sum()),absHueDeltaDeg=stats(hue[m&valid]),addedClippedPixels=int(np.any(added,axis=2)[m].sum()),addedClippedChannels=int(added[m].sum()),recoveredClippedPixels=int(np.any(recovered,axis=2)[m].sum()),maxSTDMarginAtNewClip16=int(np.where(b==0,a.astype(np.int32),65535-a.astype(np.int32))[added&m[:,:,None]].max()) if (added&m[:,:,None]).any() else 0,baselineMeanLuminanceGradient=ma,refinedMeanLuminanceGradient=mb,gradientRatio=mb/ma if ma else None)
 return out
def fair_clipping(native0,native,acr0,acr):
 def added(a,b):return ((b==0)&(a>0))|((b==65535)&(a<65535))
 own=added(native0,native);other=added(acr0,acr)
 common=(native0>0)&(native0<65535)&(acr0>0)&(acr0<65535)
 out={}
 for name,m in masks.items():
  if not m.any():out[name]=dict(pixels=0);continue
  mm=m[:,:,None];own_common=own&common&mm;acr_common=other&common&mm
  def margin(a,b,mask):
   values=np.where(b==0,a,65535-a)[mask]
   return stats(values) # baseline code headroom, never physical overshoot depth
  out[name]=dict(pixels=int(m.sum()),nativeNewPixels=int(own.any(2)[m].sum()),acrNewPixels=int(other.any(2)[m].sum()),newMaskOverlapPixels=int((own.any(2)&other.any(2))[m].sum()),nativeNewCommonSafePixels=int(own_common.any(2).sum()),acrNewCommonSafePixels=int(acr_common.any(2).sum()),nativeNewCommonSafeLowByRGB=(own_common&(native==0)).sum((0,1)).tolist(),nativeNewCommonSafeHighByRGB=(own_common&(native==65535)).sum((0,1)).tolist(),nativeCommonSafeBaselineMargin16=margin(native0,native,own_common),acrCommonSafeBaselineMargin16=margin(acr0,acr,acr_common))
 return out

def display_crop(path,box):
 a,icc=read_tiff(path);x,y,w,h=box;im=Image.fromarray(np.rint(a[y:y+h,x:x+w]/257).astype(np.uint8))
 return ImageCms.profileToProfile(im,ImageCms.ImageCmsProfile(io.BytesIO(icc)),ImageCms.createProfile('sRGB'),renderingIntent=1,outputMode='RGB')

for family in ['Linear','Medium Contrast','Strong Contrast']:
 group=[r for r in renders if r['family']==family];old=next(r for r in group if r['amount']=='legacy');base,bi=read_tiff(old['path'])
 assert base.shape==source.shape
 for row in group:
  a,ai=read_tiff(row['path']);assert a.shape==base.shape and ai==bi
  if row['amount'] in ['legacy',0] or family=='Linear':assert np.array_equal(a,base),('Legacy/zero/identity changed',scene['id'],family,row['amount'])
  if row['amount']=='legacy':continue
  eligible=(source_chroma>=5)&(np.linalg.norm(to_lab(base,bi)[:,:,1:],axis=2)>=5)
  ref=next((r for r in references if r['curve']==family and (r['refine'] is None if family=='Linear' else r['refine']==row['amount'])),None)
  if ref:
   target,ti=read_tiff(ref['path']);assert target.shape==a.shape
   lowref=next(r for r in references if r['curve']==family and (r['refine'] is None if family=='Linear' else r['refine']==0));low,li=read_tiff(lowref['path'])
   eligible&=np.linalg.norm(to_lab(low,li)[:,:,1:],axis=2)>=5
  quality=change(base,a,bi,ai,eligible);gamut=stage_gamut(row['linear'],old['linear'],base,a,ai)
  # Output-gamut clipping is diagnostic: actual ACR also introduces clips.
  # Keep physical working-range evidence separate, with explicit uncertainty.
  # Exact legacy/zero/identity and source/profile checks remain hard assertions.
  if row['amount']==0 or family=='Linear':assert Path(row['linear']['file']).read_bytes()==Path(old['linear']['file']).read_bytes(),('Zero/identity float transport changed',scene['id'],family)
  result=dict(scene=scene['id'],curve=family,amount=row['amount'],vsSameCurveLegacy=quality,pipelineGamut=gamut,outputICC_SHA256=hashlib.sha256(ai).hexdigest())
  if quality['all']['addedClippedPixels'] or gamut['newWorkingDefiniteOutsideVsBaseline']:
   findings.append(dict(scene=scene['id'],curve=family,amount=row['amount'],addedClippedPixels=quality['all']['addedClippedPixels'],newWorkingDefiniteOutsideVsBaseline=gamut['newWorkingDefiniteOutsideVsBaseline'],qualityAcceptance='pending'))
  if ref:
   result['vsActualACR187']=change(target,a,ti,ai,eligible)
   result['actualACR187RefineDelta']=change(low,target,li,ti,eligible)
   result['matchedBaselineClipping']=fair_clipping(base,a,low,target)
  rows.append(result)
 if review:
  # Display-only RGB8 crops, with the native output ICC. Analysis above always
  # uses original uint16 files; a contact sheet cannot establish extra detail.
  shown=[dict(path=r['path'],label='Native '+str(r['amount'])) for r in group if r['amount'] in ['legacy',100]]
  for amount in ([None] if family=='Linear' else [0,100]):
   reference=next((r for r in references if r['curve']==family and r['refine']==amount),None)
   if reference:shown.append(dict(path=reference['path'],label='ACR '+str(amount)))
  for name,box in scene['rois'].items():
   # Equal display scale and compact columns; magnified small ROIs use nearest
   # neighbor and do not invent detail. Analysis uses native pixels above.
   tw=max(1,round(box[2]*384/max(box[2:])));th=max(1,round(box[3]*384/max(box[2:])))
   sheet=Image.new('RGB',(tw*len(shown),th+24),'#222222');draw=ImageDraw.Draw(sheet)
   for i,r in enumerate(shown):
    im=display_crop(r['path'],box);im=im.resize((tw,th),Image.Resampling.NEAREST if max(box[2:])<384 else Image.Resampling.LANCZOS);sheet.paste(im,(tw*i,24));draw.text((tw*i+4,4),r['label'],fill='white')
   sheet.save(str(Path(review)/(scene['id']+'-'+family.replace(' ','-')+'-'+name+'.png')),icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
print(json.dumps(dict(rows=rows,outputGamutFindings=findings,qualityAcceptance='pending',scope='Actual native TIFF16 and full-resolution SDR float transport, actual embedded-ICC Lab and matched ACR baselines; source ROIs fixed; no fitting; output clipping is diagnostic, not universal failure; not App/HDR or blind-review acceptance; skin is only512x512 originalRGB8')))
`;
// Fixed 0/100 replay for visual inspection; no second float-range probe or
// re-scoring of unchanged contracts. Full mode above retains every exact gate.
const reviewPython=String.raw`
from PIL import Image,ImageDraw,ImageCms
import io
scene=json.loads(sys.argv[1]);renders=json.loads(sys.argv[2]);refs=json.loads(sys.argv[3]);directory=Path(sys.argv[4]);rows=[]
def display(path,box):
 a,icc=read_tiff(path);x,y,w,h=box;image=Image.fromarray(np.rint(a[y:y+h,x:x+w]/257).astype(np.uint8))
 return ImageCms.profileToProfile(image,ImageCms.ImageCmsProfile(io.BytesIO(icc)),ImageCms.createProfile('sRGB'),renderingIntent=1,outputMode='RGB')
def sheet(items,box,path,one_to_one=False):
 x,y,w,h=box
 if one_to_one:
  w=min(w,256);h=min(h,256);x+=(box[2]-w)//2;y+=(box[3]-h)//2;box=(x,y,w,h);tw,th=w,h
 else:tw=max(1,round(w*384/max(w,h)));th=max(1,round(h*384/max(w,h)))
 out=Image.new('RGB',(tw*4,th+40),'#222222');draw=ImageDraw.Draw(out)
 for i,(label,file) in enumerate(items):
  im=display(file,box)
  if not one_to_one:im=im.resize((tw,th),Image.Resampling.NEAREST if max(w,h)<384 else Image.Resampling.LANCZOS)
  out.paste(im,(tw*i,40));draw.text((tw*i+3,2),label,fill='white');draw.text((tw*i+3,17),('1:1' if one_to_one else 'Overview/zoom')+' '+str(tuple(box)),fill='white')
 out.save(path,icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
 return str(path)
def collapse(a,b,c,d,box):
 x,y,w,h=box;a=a[y:y+h,x:x+w];b=b[y:y+h,x:x+w];c=c[y:y+h,x:x+w];d=d[y:y+h,x:x+w];total=dict(commonSafeResolvedEdges=0,nativeNewEndpointPlateauEdges=0,acrNewEndpointPlateauEdges=0,nativeNewRGBFlatEdges=0,acrNewRGBFlatEdges=0)
 for axis in [0,1]:
  low=[slice(None)]*3;high=[slice(None)]*3;low[axis]=slice(None,-1);high[axis]=slice(1,None);low=tuple(low);high=tuple(high)
  a0,a1=a[low],a[high];b0,b1=b[low],b[high];c0,c1=c[low],c[high];d0,d1=d[low],d[high]
  # Both zero baselines must contain a resolved same-channel difference and
  # both endpoints must be unclipped in both baselines. No post-result mask.
  valid=(a0>0)&(a0<65535)&(a1>0)&(a1<65535)&(c0>0)&(c0<65535)&(c1>0)&(c1<65535)&(a0!=a1)&(c0!=c1)
  native=valid&(b0==b1)&((b0==0)|(b0==65535));adobe=valid&(d0==d1)&((d0==0)|(d0==65535))
  total['commonSafeResolvedEdges']+=int(valid.sum());total['nativeNewEndpointPlateauEdges']+=int(native.sum());total['acrNewEndpointPlateauEdges']+=int(adobe.sum())
  commonRGB=valid.any(2)
  total['nativeNewRGBFlatEdges']+=int((commonRGB&(b0==b1).all(2)).sum());total['acrNewRGBFlatEdges']+=int((commonRGB&(d0==d1).all(2)).sum())
 return total
for family in ['Medium Contrast','Strong Contrast']:
 old=next(r for r in renders if r['family']==family and r['amount']=='legacy');active=next(r for r in renders if r['family']==family and r['amount']==100)
 zero=next(r for r in refs if r['curve']==family and r['refine']==0);full=next(r for r in refs if r['curve']==family and r['refine']==100)
 a,ai=read_tiff(old['path']);b,bi=read_tiff(active['path']);c,ci=read_tiff(zero['path']);d,di=read_tiff(full['path']);assert a.shape==b.shape==c.shape==d.shape
 items=[('Native STD',old['path']),('Native100',active['path']),('ACR0',zero['path']),('ACR100',full['path'])];stem=scene['id']+'-'+family.replace(' ','-');views=[]
 views.append(sheet(items,(0,0,scene['width'],scene['height']),directory/(stem+'-full.png')))
 if family=='Strong Contrast':
  for name,box in scene['rois'].items():
   if name in ['face','helmetSpecular']:views.append(sheet(items,box,directory/(stem+'-'+name+'.png')))
   if name in ['face','leaves','woodEdge','fruit']:views.append(sheet(items,box,directory/(stem+'-'+name+'-detail1x.png'),True))
 summaries={name:collapse(a,b,c,d,box) for name,box in {'fullFrame':[0,0,scene['width'],scene['height']],**scene['rois']}.items()}
 rows.append(dict(scene=scene['id'],curve=family,nativeSTDpixelSHA=hashlib.sha256(a.tobytes()).hexdigest(),native100pixelSHA=hashlib.sha256(b.tobytes()).hexdigest(),fixedROIEdgeCollapse=summaries,views=views))
print(json.dumps(dict(rows=rows,outputGamutFindings=[],qualityAcceptance='pending',scope='Fixed 0/100 visual replay plus common-baseline resolved-edge diagnostics; ICC-converted display sRGB; 1:1 crops are deterministic centers of original ROIs; no parameter search; a channel plateau or a code-flat edge alone is not proof of perceptible texture damage')))
`;
let engine,passed=false,engineHash,revision=0;const summaries=[],gamutFindings=[];
try{
 for(const scene of sources){
  assert.equal(await sha(scene.path),scene.sha256,scene.id+' input changed');assert.equal(await sha(scene.rawPath),scene.rawSHA,scene.id+' original changed');
  scene.input=join(work,scene.id+'.tif');Object.assign(scene,py(iccLabPython+prepare,JSON.stringify(scene),scene.input));
 }
 const textureSources=read(join(textureReference,'sources.json'));
 for(const reference of textureSources){
  assert.equal(await sha(resolve(reference.capturedInput)),reference.capturedInputSHA256,'Frozen texture input changed');
  const scene=sources.find(s=>s.id===reference.id);assert(scene);assert.equal(scene.pixelSHA256,reference.pixelSHA256);assert.equal(scene.iccSHA256,reference.iccSHA256);
 }
 const referenceRows=[...read(join(photo,'results.json')).exports.map(r=>({...r,sourceId:'astronaut',path:join(photo,r.output)})),...read(join(textureReference,'results.json')).exports.map(r=>({...r,path:join(textureReference,r.output)}))];
 for(const r of referenceRows){assert.equal(await sha(r.path),r.sha256,'Actual ACR reference changed: '+r.id);assert.deepEqual(r.points,POINT_CURVE_PRESETS[r.curve].map(p=>[Math.round(p.x*255),Math.round(p.y*255)]));}
 console.log(JSON.stringify({scope:'Frozen public inputs verified; pixel crops only; no candidate renders yet',sources:sources.map(({id,url,license,path,sha256,rawPath,rawSHA,crop,precision,rois,width,height,pixelSHA256,iccSHA256})=>({id,url,license,path,sha256,rawPath,rawSHA,crop,precision,rois,width,height,pixelSHA256,iccSHA256}))}));
 if(options.run){
  const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');engineHash=await sha(binary);assert.equal(engineHash,options['engine-sha'],'Frozen native identity mismatch');
  const review=options['review-dir']?resolve(options['review-dir']):'';if(review){assert(!existsSync(review),'Use a new review directory');mkdirSync(review,{recursive:true});}
  engine=new EngineClient({cache:join(work,'cache')});
  for(const scene of sources){
   const im=await engine.call('open',{path:scene.input,sessionId:'refine-photo-'+scene.id,effectsDefaults:'legacy',whiteBalanceDefaults:'current'}),renders=[];
   const base={...im.adjustments,colorProfile:{mode:'embedded'},incrementalTemperature:0,incrementalTint:0,relativeWBModel:'art-ctl-v1',exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,saturation:0,vibrance:0,sharpening:0,colorNoise:0,luminanceNoise:0,grain:0,glow:0,masks:[],spots:[],redCurve:POINT_CURVE_PRESETS.Linear,greenCurve:POINT_CURVE_PRESETS.Linear,blueCurve:POINT_CURVE_PRESETS.Linear};
   delete base.curveRefineModel;delete base.curveRefineSaturation;
   for(const family of options['review-only']?['Medium Contrast','Strong Contrast']:['Linear','Medium Contrast','Strong Contrast'])for(const amount of options['review-only']||family==='Linear'?['legacy',100]:['legacy',0,50,100]){
    const adjustments={...base,curve:POINT_CURVE_PRESETS[family],curveName:family,...(amount==='legacy'?{}:{curveRefineModel:'weighted-std-v1',curveRefineSaturation:amount})},composed=await engine.call('compose',{path:scene.input,width:scene.width,height:scene.height,adjustments,artProfile:im.artProfile});
    if(amount!=='legacy')assert.match(composed.artProfile,/CaptRAWCurveRefineModel=weighted-std-v1/,'Engine lacks refinement patch');
    const stem=scene.id+'-'+family.replaceAll(' ','-')+'-'+amount,output=join(work,stem+'.tif');writeFileSync(join(work,stem+'.arp'),composed.artProfile);
    await engine.call('export',{path:scene.input,artProfile:composed.artProfile,output,format:'tiff',colorSpace:'srgb'});
    // Capture the same recipe at native scale through the existing SDR float
    // transport. No HDR toggle or alternative curve is used to obtain gamut data.
    let linear;
    if(!options['review-only']){
     const fit=engine.preview(++revision,'fit',120000);await engine.call('update',{revision,adjustments,artProfile:composed.artProfile,linearPreview:true});await fit;
     const detail=engine.preview(++revision,'detail',120000);await engine.call('viewport',{revision,x:0,y:0,width:scene.width,height:scene.height});const frame=await detail;
     assert(frame.linear&&frame.linear.width===scene.width&&frame.linear.height===scene.height,'Missing full-resolution linear transport');
     assert.match(composed.artProfile,/^WorkingProfile=Rec2020$/m);
     linear={...frame.linear,file:join(work,stem+'.rgba16f')};copyFileSync(frame.linear.file,linear.file);
    }
    renders.push({family,amount,path:output,linear});
   }
   const result=py(iccLabPython+(options['review-only']?reviewPython:gamutPython+analyze),JSON.stringify(scene),JSON.stringify(renders),JSON.stringify(referenceRows.filter(r=>r.sourceId===scene.id)),review);
   console.log(JSON.stringify(result));summaries.push(result);gamutFindings.push(...result.outputGamutFindings);
   assert.equal(await sha(binary),engineHash,'Engine changed during run');
  }
  console.log(JSON.stringify({scope:options['review-only']?'Fixed 0/100 review replay complete; full pipeline and zero/identity evidence belongs to the separate full diagnostic run':'Diagnostic completion only: exact legacy/zero/identity contracts checked; output clipping is recorded, not treated as a universal ACR failure',engineHash,scenes:sources.length,outputGamutFindings:gamutFindings,qualityAcceptance:'pending',humanQualityReviewRequired:true}));
 }
 for(const scene of sources){assert.equal(await sha(scene.path),scene.sha256);assert.equal(await sha(scene.rawPath),scene.rawSHA);}
 passed=true;
}catch(error){writeFileSync(join(work,'failure.json'),JSON.stringify({error:String(error),engineHash,gamutFindings,summaries},null,2));throw error;}
finally{if(engine)await engine.stop();if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
