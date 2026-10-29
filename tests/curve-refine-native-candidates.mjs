// Isolated ARP candidates only. No renderer, production parameter or source patch is used.
import assert from 'node:assert/strict';
import {EngineClient} from './engine-client.mjs';
import {XMP,decodeAdjustments} from '@captraw/desktop-core/xmp';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {sampleCurve} from '../apps/desktop/src/curve.ts';
const work=mkdtempSync(join(tmpdir(),'captraw-refine-candidates-')),reference=resolve('artifacts/stage-0/acr-reference/curves-refine-tiff-187');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),source=join(reference,'input.tif'),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=sha(source),engineHash=sha('build/native/captraw-engine');
const referenceInfo=JSON.parse(readFileSync(join(reference,'pixels.json'))),cases=referenceInfo.rows;let passed=false;
const engine=new EngineClient({cache:join(work,'cache')});
const grayStages=process.argv.includes('--gray-stages'),curveModes=process.argv.includes('--curve-modes'),previews=[];let revision=0;
assert(!(grayStages&&curveModes));
// procparams.cc tc_mapping, both save and load; not UI labels or guessed names.
const modes=['Standard','Luminance','WeightedStd','SatAndValueBlending','FilmLike','Perceptual','Neutral'];
const candidates=grayStages?[['Standard',100]]:curveModes?modes.map(mode=>[mode,100]):[['Standard',100],['Perceptual',0],['Perceptual',50],['Perceptual',100]];
function toneSetting(profile,key,value){const at=profile.indexOf('[ToneCurve]\n');assert(at>=0);const end=profile.indexOf('\n[',at+1),section=profile.slice(at,end<0?undefined:end),pattern=new RegExp('^'+key+'=.*$','m');return profile.slice(0,at)+(pattern.test(section)?section.replace(pattern,key+'='+value):section+'\n'+key+'='+value+'\n')+(end<0?'':profile.slice(end));}
try{
 assert.equal(sourceHash,referenceInfo.inputSHA256);const image=await engine.call('open',{path:source,sessionId:'candidate',sourceFramePolicy:'active-area-v1',whiteBalanceDefaults:'current',effectsDefaults:'current'}),renders=[],grids=[];
 for(const [family,stem] of [['neutral','neutral'],['medium','medium-refine0'],['strong','strong-refine0']]){
  const parsed=decodeAdjustments((await xmp.call('read',readFileSync(join(reference,stem+'.xmp'),'utf8'))).properties);
  const points=parsed.adjustments.curve,grid=Float64Array.from(sampleCurve(points,65536)),gridPath=join(work,family+'-natural.f64'),raw=await engine.call('curve',{points}),small=sampleCurve(points);
  writeFileSync(gridPath,Buffer.from(grid.buffer));grids.push({family,points,path:gridPath,rawSplineRPCMax16:Math.max(...small.map((v,i)=>Math.abs(v-raw.samples[i])*65535))});
  const adjustments={...image.adjustments,curve:parsed.adjustments.curve,exposure:0,contrast:0,sharpening:0,colorNoise:0,luminanceNoise:0,grain:0,glow:0,masks:[],spots:[]};
  const composed=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments,artProfile:image.artProfile});
  grids.at(-1).workingProfile=composed.artProfile.match(/^WorkingProfile=(.*)$/m)?.[1];
  for(const [mode,strength] of candidates){
   const profile=toneSetting(toneSetting(composed.artProfile,'CurveMode',mode),'PerceptualStrength',strength),output=join(work,`${family}-${mode}-${strength}.tif`);
   assert.equal(toneSetting(toneSetting(profile,'CurveMode','Standard'),'PerceptualStrength',100),toneSetting(toneSetting(composed.artProfile,'CurveMode','Standard'),'PerceptualStrength',100),'Only mode and its supported strength may differ; all stored curves and other settings stay fixed');
   await engine.call('export',{path:source,artProfile:profile,output,format:'tiff',colorSpace:'srgb'});renders.push({family,mode,strength,path:output});
   if(grayStages){
    const pending=engine.preview(++revision,'fit',120000);await engine.call('update',{revision,adjustments,artProfile:profile});const fit=await pending;
    const crop=engine.preview(++revision,'detail',120000);await engine.call('viewport',{revision,x:0,y:640,width:image.width,height:image.height-640});const detail=await crop;
    previews.push({family,fit,detail});
   }
  }
 }
 const result=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import json,sys,numpy as np,tifffile,hashlib
from pathlib import Path
root=Path(sys.argv[1]);cases=json.loads(sys.argv[2]);renders=json.loads(sys.argv[3]);grids=json.loads(sys.argv[4]);gray_stages=json.loads(sys.argv[5]);previews=json.loads(sys.argv[6]);curve_modes=json.loads(sys.argv[7]);rows=[];arrays={}
for r in renders:
 with tifffile.TiffFile(r['path']) as f:
  a=f.asarray();assert a.dtype==np.uint16 and a.shape==(1024,1536,3) and 34675 in f.pages[0].tags
 arrays[(r['family'],r['mode'],r['strength'])]=a.astype(np.int32)
for c in cases:
 p=root/c['tiff'];assert hashlib.sha256(p.read_bytes()).hexdigest()==c['sha256'];ref=tifffile.imread(p).astype(np.int32);family='neutral' if c['name']=='neutral' else c['name'].split('-')[0]
 for r in renders:
  if r['family']!=family:continue
  d=arrays[(family,r['mode'],r['strength'])]-ref
  rows.append(dict(reference=c['name'],mode=r['mode'],strength=r['strength'],mae16=float(np.abs(d).mean()),max16=int(np.abs(d).max()),changedPixels=int(np.count_nonzero(np.any(d!=0,axis=2)))))
deltas=[]
for family,high in [('medium','medium-default'),('strong','strong-refine100')]:
 if gray_stages or curve_modes:continue
 lo=next(c for c in cases if c['name']==family+'-refine0');hi=next(c for c in cases if c['name']==high);expected=tifffile.imread(root/hi['tiff']).astype(np.int32)-tifffile.imread(root/lo['tiff']).astype(np.int32)
 actual=arrays[(family,'Perceptual',100)]-arrays[(family,'Perceptual',0)];d=actual-expected
 baseline=arrays[(family,'Standard',100)]-arrays[(family,'Perceptual',0)]
 deltas.append(dict(family=family,refinementDeltaMAE16=float(np.abs(d).mean()),refinementDeltaMax16=int(np.abs(d).max()),standardVsPerceptual0Max16=int(np.abs(baseline).max())))
source=tifffile.imread(root/'input.tif').astype(np.int32);spread=np.ptp(source,axis=2);level=source.mean(axis=2);yy,xx=np.indices(spread.shape)
# Source-defined groups are frozen for all references/candidates; thresholds are
# encoded RGB code differences, not a perceptual chroma or an Adobe model.
groups={'exact-neutral':spread==0,'exact-neutral-unclipped':(spread==0)&(level>1024)&(level<64511),'near-neutral-1-128':(spread>0)&(spread<=128),'low-chroma-129-2048':(spread>128)&(spread<=2048),'mid-chroma-2049-8192':(spread>2048)&(spread<=8192),'high-chroma-8193+':spread>8192}
# Interior ROIs inspected in the actual reference source. The authored gray
# ramps have small nonzero RGB differences, so audit them separately.
ramps={'gray-steps':(yy>=656)&(yy<816)&(xx>=16)&(xx<1520),'gray-smooth':(yy>=848)&(yy<912)&(xx>=16)&(xx<1520),'gray-dark':(yy>=944)&(yy<1008)&(xx>=16)&(xx<1520)}
def metrics(d,mask):
 q=d[mask].astype(np.float64)
 if not q.size:return dict(pixels=0)
 axis=q.mean(axis=1);chroma=q-axis[:,None]
 return dict(pixels=int(len(q)),mae16=float(np.abs(q).mean()),max16=float(np.abs(q).max()),changedPixels=int(np.count_nonzero(np.any(q!=0,axis=1))),grayAxisMAE16=float(np.abs(axis).mean()),grayAxisBias16=float(axis.mean()),chromaResidualMAE16=float(np.abs(chroma).mean()))
refs={c['name']:tifffile.imread(root/c['tiff']).astype(np.int32) for c in cases};diagnostics=dict(groupDefinition='source max(R,G,B)-min(R,G,B), uint16 code units; grayAxis=(R+G+B)/3 in encoded RGB, not physical luminance',sourceGroups={k:int(m.sum()) for k,m in groups.items()},rampSourceAudit={k:dict(pixels=int(m.sum()),sourceMaxSpread16=int(spread[m].max()),sourceExactNeutralPixels=int(np.count_nonzero(m&(spread==0)))) for k,m in ramps.items()},referenceRefineDeltas=[],standardGroups=[],grayCurveEffects=[],grayRampBins=[])
for family,high in [('medium','medium-default'),('strong','strong-refine100')]:
 names=[family+'-refine0',family+'-refine50',high]
 for lo,hi in [(0,1),(0,2),(1,2)]:
  d=refs[names[hi]]-refs[names[lo]]
  for label,mask in {**groups,**ramps}.items():diagnostics['referenceRefineDeltas'].append(dict(family=family,low=[0,50,100][lo],high=[0,50,100][hi],group=label,**metrics(d,mask)))
 for name in names:
  d=arrays[(family,'Standard',100)]-refs[name]
  for label,mask in {**groups,**ramps}.items():diagnostics['standardGroups'].append(dict(reference=name,group=label,**metrics(d,mask)))
  curve_delta=(arrays[(family,'Standard',100)]-arrays[('neutral','Standard',100)])-(refs[name]-refs['neutral'])
  for label,mask in ramps.items():diagnostics['grayCurveEffects'].append(dict(reference=name,group=label,**metrics(curve_delta,mask)))
 # Binned gray-axis mappings are measurements only; never fit or apply a curve.
 mask=(ramps['gray-smooth']|ramps['gray-dark'])&(spread<=64)&(level>1024)&(level<64511)
 for i in range(16):
  selected=mask&(level>=i*4096)&(level<(i+1)*4096)
  if not selected.any():continue
  def avg(a):return float(a[selected].mean(axis=1).mean())
  diagnostics['grayRampBins'].append(dict(family=family,bin=i,pixels=int(selected.sum()),inputGrayAxis16=float(level[selected].mean()),standardGrayAxis16=avg(arrays[(family,'Standard',100)]),acr0GrayAxis16=avg(refs[names[0]]),acr50GrayAxis16=avg(refs[names[1]]),acr100GrayAxis16=avg(refs[names[2]])))
for label,mask in {**groups,**ramps}.items():diagnostics['standardGroups'].append(dict(reference='neutral',group=label,**metrics(arrays[('neutral','Standard',100)]-refs['neutral'],mask)))
# Evaluate the existing unmodified natural spline on each pipeline's measured
# neutral TIFF, independently by encoded channel. Every uint16 input has an
# exact grid entry; do not fit Adobe points, gamma or a refine strength.
# This is a final-output composition hypothesis, not a model of internal stages.
diagnostics['neutralCompositionDefinition']='actual family output minus naturalSpline(actual neutral output), encoded sRGB channels; unrounded prediction in uint16 units; excludes no upstream/post-curve stages'
diagnostics['rawSplineRPCMax16']={g['family']:g['rawSplineRPCMax16'] for g in grids}
diagnostics['neutralComposition']=[];diagnostics['neutralTransportResidual']=[]
for g in grids:
 family=g['family']
 if family=='neutral':continue
 lut=np.fromfile(g['path'],dtype='<f8');assert len(lut)==65536
 predicted_acr=np.clip(lut[refs['neutral']],0,1)*65535
 predicted_std=np.clip(lut[arrays[('neutral','Standard',100)]],0,1)*65535
 names=[family+'-refine0',family+'-refine50','medium-default' if family=='medium' else 'strong-refine100']
 for name,actual,predicted in [(name,refs[name],predicted_acr) for name in names]+[(family+'-Standard',arrays[(family,'Standard',100)],predicted_std)]:
  for label,mask in {'exact-neutral-unclipped':groups['exact-neutral-unclipped'],**ramps}.items():
   diagnostics['neutralComposition'].append(dict(reference=name,group=label,**metrics(actual-predicted,mask)))
 # Remove the effect predicted solely from the two measured neutral outputs.
 residual=(arrays[(family,'Standard',100)]-refs[names[0]])-(predicted_std-predicted_acr)
 for label,mask in {'exact-neutral-unclipped':groups['exact-neutral-unclipped'],**ramps}.items():
  diagnostics['neutralTransportResidual'].append(dict(family=family,group=label,**metrics(residual,mask)))
if curve_modes:
 # ART iccmatrices.h::xyz_sRGBd65 plus standard CIELAB equations. This is an
 # output-space diagnostic, not Adobe's internal refine model or a new renderer.
 def lab(rgb):
  e=rgb.astype(np.float64)/65535;l=np.where(e<=.04045,e/12.92,((e+.055)/1.055)**2.4)
  xyz=l@np.array([[.4124564,.3575761,.1804375],[.2126729,.7151522,.0721750],[.0193339,.1191920,.9503041]]).T
  xyz/=np.array([.95047,1,1.08883]);f=np.where(xyz>216/24389,np.cbrt(xyz),(24389/27*xyz+16)/116)
  return np.stack([116*f[:,:,1]-16,500*(f[:,:,0]-f[:,:,1]),200*(f[:,:,1]-f[:,:,2])],axis=2)
 def C(a):return np.linalg.norm(a[:,:,1:],axis=2)
 def H(a):return np.degrees(np.arctan2(a[:,:,2],a[:,:,1]))
 def wrap(a):return (a+180)%360-180
 def mean_abs(a,mask):return float(np.abs(a[mask]).mean()) if mask.any() else None
 def p95_abs(a,mask):return float(np.percentile(np.abs(a[mask]),95)) if mask.any() else None
 def differences(a,b,mask):
  ca,cb=C(a),C(b);valid=mask&(ca>=5)&(cb>=5);dh=wrap(H(a)-H(b))
  return dict(pixels=int(mask.sum()),lightnessMAE=mean_abs(a[:,:,0]-b[:,:,0],mask),chromaMAE=mean_abs(ca-cb,mask),hueValidPixels=int(valid.sum()),hueMAEdeg=mean_abs(dh,valid),hueP95deg=p95_abs(dh,valid))
 mode_names=list(dict.fromkeys(r['mode'] for r in renders));selected_groups={k:groups[k] for k in ['exact-neutral-unclipped','near-neutral-1-128','low-chroma-129-2048','mid-chroma-2049-8192','high-chroma-8193+']}
 # Interior warm/dark and pale authored skin-colour swatches, not portraits.
 # Their small source code variation cannot establish real photographic detail.
 quality_groups={'skin-medium':(yy>=336)&(yy<464)&(xx>=16)&(xx<240),'skin-light':(yy>=336)&(yy<464)&(xx>=272)&(xx<496),'highlight-gray-ramp':(ramps['gray-smooth']|ramps['gray-dark'])&(level>=.9*65535)&(level<.995*65535),'bright-color':(source.max(axis=2)>=60000)&(spread>8193)}
 diagnostics['modeDefinition']='All native endpoints use identical stored natural-spline points, gamma/Catmull path and non-curve settings. Zero endpoint is the actual same-family Standard render, never a different curve or Perceptual0. 50/100 relative tests scale endpoint Lab deltas for diagnostics only; no native amount or pixel interpolation is implemented.'
 diagnostics['modeEndpoints']=[];diagnostics['modeRelativeDeltas']=[];diagnostics['identityModeDifferences']=[];diagnostics['referenceHalfDeltas']=[];diagnostics['modeHueSectors']=[]
 diagnostics['qualityGroups']={k:dict(pixels=int(m.sum()),sourceUniqueRGB=int(len(np.unique(source[m],axis=0)))) for k,m in quality_groups.items()};diagnostics['qualityScope']='One authored chart: skin-colour swatches and highlight ramps, no photographic skin texture or specular highlights. No production strength or roundtrip contract exists yet.'
 diagnostics['modeQuality']=[];diagnostics['workingProfiles']={g['family']:g['workingProfile'] for g in grids}
 for mode in mode_names:
  for group,mask in selected_groups.items():
   diagnostics['identityModeDifferences'].append(dict(mode=mode,group=group,**metrics(arrays[('neutral',mode,100)]-arrays[('neutral','Standard',100)],mask)))
 for family,high in [('medium','medium-default'),('strong','strong-refine100')]:
  names=[family+'-refine0',family+'-refine50',high];gold=[lab(refs[name]) for name in names];base=lab(arrays[(family,'Standard',100)])
  gold_chroma=[C(a) for a in gold];gold_hue=[H(a) for a in gold];base_chroma=C(base);base_hue=H(base)
  half_error=(gold[1]-gold[0])-.5*(gold[2]-gold[0])
  for group,mask in selected_groups.items():
   diagnostics['referenceHalfDeltas'].append(dict(family=family,group=group,lightnessMAE=mean_abs(half_error[:,:,0],mask),abVectorMAE=float(np.linalg.norm(half_error[:,:,1:][mask],axis=1).mean())))
  for mode in mode_names:
   native_rgb=arrays[(family,mode,100)];native=lab(native_rgb);native_chroma=C(native);native_hue=H(native);delta=native-base
   baseline_rgb=arrays[(family,'Standard',100)];clipped=np.any((native_rgb==0)|(native_rgb==65535),axis=2);base_clipped=np.any((baseline_rgb==0)|(baseline_rgb==65535),axis=2)
   for group,mask in {**selected_groups,**quality_groups}.items():
    source_gray=source[mask].mean(axis=1);out_gray=native_rgb[mask].mean(axis=1);base_gray=baseline_rgb[mask].mean(axis=1)
    a=native_rgb[mask];b=baseline_rgb[mask];new_high=(a==65535)&(b<65535);new_low=(a==0)&(b>0)
    clip_audit=dict(newHighByRGB=new_high.sum(axis=0).tolist(),newLowByRGB=new_low.sum(axis=0).tolist(),maxSTDHeadroomAtNewHigh16=int((65535-b)[new_high].max()) if new_high.any() else 0,maxSTDValueAtNewLow16=int(b[new_low].max()) if new_low.any() else 0)
    diagnostics['modeQuality'].append(dict(family=family,mode=mode,group=group,**clip_audit,clippedFraction=float(clipped[mask].mean()),newClippedVsSTDFraction=float((clipped&~base_clipped)[mask].mean()),recoveredClippingVsSTDFraction=float((~clipped&base_clipped)[mask].mean()),grayAxisMAE16=float(np.abs(out_gray-base_gray).mean()),sourceGrayStd16=float(source_gray.std()),outputGrayStd16=float(out_gray.std()),stdOutputGrayStd16=float(base_gray.std()),vsSTD=differences(native,base,mask),vsACR0=differences(native,gold[0],mask),vsACR50=differences(native,gold[1],mask),vsACR100=differences(native,gold[2],mask)))
   for i,name in enumerate(names):
    for group,mask in selected_groups.items():
     diagnostics['modeEndpoints'].append(dict(family=family,mode=mode,reference=name,group=group,**differences(native,gold[i],mask)))
   def relative(mask,i,scale):
    expected=gold[i]-gold[0];actual=scale*delta;error=actual-expected
    dc=scale*(native_chroma-base_chroma);target_dc=gold_chroma[i]-gold_chroma[0]
    expected_h=wrap(gold_hue[i]-gold_hue[0]);actual_h=scale*wrap(native_hue-base_hue)
    hue_valid=mask&(gold_chroma[0]>=5)&(gold_chroma[i]>=5)&(base_chroma>=5)&(native_chroma>=5)
    direction=mask&(np.linalg.norm(expected[:,:,1:],axis=2)>.05)
    a=actual[:,:,1:][direction];b=expected[:,:,1:][direction];den=float(np.linalg.norm(a)*np.linalg.norm(b));dot=np.sum(a*b,axis=1)
    return dict(pixels=int(mask.sum()),lightnessDeltaMAE=mean_abs(actual[:,:,0],mask),referenceLightnessDeltaMAE=mean_abs(expected[:,:,0],mask),lightnessDeltaErrorMAE=mean_abs(error[:,:,0],mask),chromaDeltaMAE=mean_abs(dc,mask),referenceChromaDeltaMAE=mean_abs(target_dc,mask),chromaDeltaErrorMAE=mean_abs(dc-target_dc,mask),abDeltaErrorMAE=float(np.linalg.norm(error[:,:,1:][mask],axis=1).mean()),abDeltaCosine=float(dot.sum()/den) if den else None,abSameDirectionFraction=float(np.mean(dot>0)) if len(dot) else None,hueValidPixels=int(hue_valid.sum()),hueDeltaMAEdeg=mean_abs(actual_h,hue_valid),referenceHueDeltaMAEdeg=mean_abs(expected_h,hue_valid),hueDeltaErrorMAEdeg=mean_abs(wrap(actual_h-expected_h),hue_valid),hueDeltaErrorP95deg=p95_abs(wrap(actual_h-expected_h),hue_valid))
   for i,scale in [(1,.5),(2,1)]:
    for group,mask in selected_groups.items():
     diagnostics['modeRelativeDeltas'].append(dict(family=family,mode=mode,referenceLevel=[0,50,100][i],endpointDeltaScale=scale,group=group,**relative(mask,i,scale)))
   for sector in range(6):
    mask=groups['high-chroma-8193+']&((gold_hue[0]+360)%360>=sector*60)&((gold_hue[0]+360)%360<(sector+1)*60)
    if mask.any():diagnostics['modeHueSectors'].append(dict(family=family,mode=mode,hueSectorStartDeg=sector*60,**relative(mask,2,1)))
if gray_stages:
 from PIL import Image
 # Read-only numerical ports of ART color.h, lut.h, diagonalcurves.cc,
 # iptonecurve.cc::adjust and curves.cc::ToneCurve::Set. No parameter search.
 # The neutral-axis transport below assumes whitept=1 and encoded sRGB output.
 def srgb_encode(x):return np.where(x<=.0031308,x*12.92,1.055*np.maximum(x,0)**(1/2.4)-.055)
 def srgb_decode(x):return np.where(x<=.04045,x/12.92,((np.maximum(x,0)+.055)/1.055)**2.4)
 def gamma(x):return np.where(x<=.003040,x*12.92310,1.055*np.maximum(x,0)**(1/2.4)-.055)
 def igamma(x):return np.where(x<=.039286,x/12.92310,((np.maximum(x,0)+.055)/1.055)**2.4)
 def lookup(table,index):
  index=np.asarray(index);j=np.clip(index.astype(np.int64),0,65534);f=(index-j).astype(np.float32)
  value=table[j]+(table[j+1]-table[j])*f
  return np.where(index<0,table[0],np.where(index>65534,table[-1],value))
 grid=np.arange(65536,dtype=np.float64)/65535
 gamma_lut=(gamma(grid).astype(np.float32)*np.float32(65535)).astype(np.float32)
 igamma_lut=(igamma(grid).astype(np.float32)*np.float32(65535)).astype(np.float32)
 def G(x):return lookup(gamma_lut,np.asarray(x)*65535).astype(np.float64)/65535
 def IG(x):return lookup(igamma_lut,np.asarray(x)*65535).astype(np.float64)/65535
 def natural(points,t):
  x=np.array([p['x'] for p in points]);y=np.array([p['y'] for p in points]);n=len(x);second=np.zeros(n);u=np.zeros(n)
  for i in range(1,n-1):
   sig=(x[i]-x[i-1])/(x[i+1]-x[i-1]);p=sig*second[i-1]+2;second[i]=(sig-1)/p
   u[i]=(6*((y[i+1]-y[i])/(x[i+1]-x[i])-(y[i]-y[i-1])/(x[i]-x[i-1]))/(x[i+1]-x[i-1])-sig*u[i-1])/p
  for k in range(n-2,-1,-1):second[k]=second[k]*second[k+1]+u[k]
  t=np.asarray(t);hi=np.clip(np.searchsorted(x,t,side='right'),1,n-1);lo=hi-1;h=x[hi]-x[lo];a=(x[hi]-t)/h;b=(t-x[lo])/h
  return np.maximum(0,a*y[lo]+b*y[hi]+((a*a*a-a)*second[lo]+(b*b*b-b)*second[hi])*h*h/6)
 def catmull(points,forward,inverse,linear_readout=False,raw_curve=False):
  # Original adjust sample locations, including raw (not decoded) curve x's.
  nodes=list(np.arange(25)/100);i=25;j=2
  while i<100:nodes.append(i/100);i+=j;j*=2
  nodes+=list(p['x'] for p in points)
  pairs={float(np.float32(x)):float(np.float32(inverse(natural(points,forward(x))))) for x in nodes}
  xy=np.array(sorted(pairs.items()));x=xy[:,0];y=xy[:,1]
  def reflect(px,py,cx,cy):
   dx=px-cx;rx=cx-dx*.01;return np.array([rx,(py-cy)/dx*(rx-cx)+cy if dx>1e-5 else cy])
  controls=np.vstack([reflect(x[1],y[1],x[0],y[0]),xy,reflect(x[-2],y[-2],x[-1],y[-1])]);poly=[]
  for i in range(len(x)-1):
   p=controls[i:i+4];n=max(int(65000*(x[i+1]-x[i])+.5),2)
   tt=np.concatenate([[0],np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1)**.375)])
   t=tt[1]+(tt[2]-tt[1])/n*np.arange(1,n-1);t=t[:,None]
   if p[1,1]==p[2,1] and p[1,1] in (0,1):
    v=p[1,0]+(tt[2]-tt[1])/n*np.arange(1,n-1);v=v[v<p[2,0]];c=np.column_stack([v,np.full(len(v),p[1,1])])
   else:
    a1=(tt[1]-t)/(tt[1]-tt[0])*p[0]+(t-tt[0])/(tt[1]-tt[0])*p[1]
    a2=(tt[2]-t)/(tt[2]-tt[1])*p[1]+(t-tt[1])/(tt[2]-tt[1])*p[2]
    a3=(tt[3]-t)/(tt[3]-tt[2])*p[2]+(t-tt[2])/(tt[3]-tt[2])*p[3]
    b1=(tt[2]-t)/(tt[2]-tt[0])*a1+(t-tt[0])/(tt[2]-tt[0])*a2
    b2=(tt[3]-t)/(tt[3]-tt[1])*a2+(t-tt[1])/(tt[3]-tt[1])*a3
    c=(tt[2]-t)/(tt[2]-tt[1])*b1+(t-tt[1])/(tt[2]-tt[1])*b2
   poly.extend([p[1:2],c,p[2:3]])
  poly=np.vstack(poly);assert np.all(np.diff(poly[:,0])>=0)
  def evaluate(t):
   if linear_readout:return np.maximum(0,np.interp(t,poly[:,0],poly[:,1]))
   k=np.searchsorted(poly[:,0],t);return np.maximum(0,poly[np.minimum(k,len(poly)-1),1])
  if raw_curve:return evaluate
  # ToneCurve::Set queries at float(i)/65535.f and stores float LUT values.
  tone_lut=evaluate(np.arange(65536,dtype=np.float32)/np.float32(65535)).astype(np.float32)*np.float32(65535)
  return lambda t:lookup(tone_lut,np.asarray(t,dtype=np.float32)*np.float32(65535)).astype(np.float64)/65535
 def scalar_metrics(d,bits=16):
  d=np.asarray(d);return {f'mae{bits}':float(np.abs(d).mean()),f'max{bits}':float(np.abs(d).max()),f'p99Abs{bits}':float(np.percentile(np.abs(d),99)),f'bias{bits}':float(d.mean())}
 def visibility(observed,ideal):
  def lightness(e):
   y=srgb_decode(e);return np.where(y>216/24389,116*np.cbrt(y)-16,(24389/27)*y)
  q=np.rint(observed*255)-np.rint(ideal*255);dl=np.abs(lightness(observed)-lightness(ideal))
  return dict(display8MAE=float(np.abs(q).mean()),display8Max=float(np.abs(q).max()),display8ChangedFraction=float(np.mean(q!=0)),grayDeltaLMean=float(dl.mean()),grayDeltaLP99=float(np.percentile(dl,99)),grayDeltaLMax=float(dl.max()))
 diagnostics['grayStages']=[];diagnostics['grayStageAttribution']=[];diagnostics['visibility']=[];diagnostics['previewComparison']=[]
 gray=arrays[('neutral','Standard',100)].mean(axis=2)/65535;linear=srgb_decode(gray)
 for g in grids:
  family=g['family']
  if family=='neutral':continue
  points=g['points'];curve=lambda t:natural(points,t);direct=curve(gray)
  analytic=srgb_encode(igamma(curve(gamma(linear))))
  tables=srgb_encode(IG(curve(G(linear))))
  sampled=srgb_encode(catmull(points,gamma,igamma)(linear))
  current=srgb_encode(catmull(points,G,IG)(linear))
  # Fixed readout substitution isolates the 65k polyline's ceil lookup error;
  # it leaves all coarse adjust nodes and Catmull equations untouched.
  readout=srgb_encode(catmull(points,G,IG,True)(linear))
  actual=arrays[(family,'Standard',100)].mean(axis=2)/65535
  predicted={'direct-natural':direct,'gamma-analytic':analytic,'gamma-LUT':tables,'Catmull-analytic-gamma':sampled,'Catmull-current-gamma-LUT':current,'Catmull-linear-polyline-readout':readout}
  for group,mask in {'exact-neutral-unclipped':groups['exact-neutral-unclipped'],**ramps}.items():
   for name,p in predicted.items():diagnostics['grayStages'].append(dict(family=family,group=group,stage=name,**scalar_metrics((actual-p)[mask]*65535)))
   for name,delta in [('analytic-gamma-vs-direct',analytic-direct),('gamma-LUT-vs-analytic',tables-analytic),('Catmull-resampling-vs-gamma-LUT',current-tables),('gamma-LUT-effect-with-Catmull',current-sampled),('polyline-ceil-vs-linear-readout',current-readout),('Catmull-shape-vs-gamma-LUT',readout-tables)]:
    diagnostics['grayStageAttribution'].append(dict(family=family,group=group,stage=name,**scalar_metrics(delta[mask]*65535)))
   # Actual output difference from fixed encoded-domain natural composition.
   diagnostics['visibility'].append(dict(family=family,reference='own-neutral-natural',group=group,**visibility(actual[mask],direct[mask])))
   for name in [family+'-refine0',family+'-refine50','medium-default' if family=='medium' else 'strong-refine100']:
    diagnostics['visibility'].append(dict(family=family,reference=name,group=group,**visibility(actual[mask],refs[name][mask].mean(axis=1)/65535)))
 for record in previews:
  family=record['family'];fit=np.asarray(Image.open(record['fit']['file']).convert('RGB')).astype(np.int32);detail=np.asarray(Image.open(record['detail']['file']).convert('RGB')).astype(np.int32)
  assert fit.shape==(1024,1536,3) and detail.shape==(384,1536,3)
  exported=np.rint(arrays[(family,'Standard',100)]/257).astype(np.int32)
  for group,mask in ramps.items():
   a=fit[mask];b=exported[mask];d=detail[mask[640:]]-a
   diagnostics['previewComparison'].append(dict(family=family,group=group,fitVsTIFF8=scalar_metrics(a-b,8),detailVsFit8=scalar_metrics(d,8),fitVsTIFFChangedFraction=float(np.mean(np.any(a!=b,axis=1))),detailVsFitChangedFraction=float(np.mean(np.any(d!=0,axis=1)))))
print(json.dumps(dict(rows=rows,deltas=deltas,diagnostics=diagnostics)))`,reference,JSON.stringify(cases),JSON.stringify(renders),JSON.stringify(grids),JSON.stringify(grayStages),JSON.stringify(previews),JSON.stringify(curveModes)],{encoding:'utf8',maxBuffer:4*1024*1024}));
 assert.equal(sha(source),sourceHash);assert.equal(sha('build/native/captraw-engine'),engineHash);
 console.log(JSON.stringify({scope:`7 actual ACR references vs ${renders.length} isolated native ARP renders; one authored scene; no fitting or production mapping`,engineHash,sourceHash,...result}));passed=true;
}finally{await engine.stop();if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
