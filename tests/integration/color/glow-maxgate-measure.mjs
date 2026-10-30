// Fixed private max-RGB gate vs shared Y gate. No build or parameter search.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,decodeAdjustments} from '@captraw/desktop-core/documents';

const candidate=resolve(process.argv[2]||'/var/folders/61/zp95tf4d2td4q8j8th6jn__c0000gn/T/captraw-glow-maxgate-dT2Ck3/captraw-engine');
const shared=resolve('build/native/captraw-engine'),reference=resolve('artifacts/stage-0/acr-reference/glow-tiff-187');
const uniform=resolve('artifacts/stage-0/acr-reference/glow-uniform-187/input.tif');
const work=mkdtempSync(join(tmpdir(),'captraw-glow-maxgate-measure-')),checks=[],engines=[];
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const prep=JSON.parse(readFileSync(join(candidate,'../manifest.json'),'utf8'));
const xmp=new XMP(resolve('build/xmp/captraw-xmp'));
const referenceManifest=JSON.parse(readFileSync(join(reference,'pixels.json'),'utf8'));
let complete=false;
const py=String.raw`
import sys,json,hashlib,importlib.util
from pathlib import Path
import numpy as np,tifffile
spec=importlib.util.spec_from_file_location('glow_math','tests/probes/color/glow-composite-probe.py')
math=importlib.util.module_from_spec(spec);spec.loader.exec_module(math)
work=Path(sys.argv[1]);run=json.loads((work/'run.json').read_text());ref=Path(run['reference'])
def read(path):
 with tifffile.TiffFile(path) as f:
  p=f.pages[0];a=p.asarray(maxworkers=1);icc=bytes(p.tags[34675].value)
  assert a.dtype==np.uint16 and a.ndim==3 and a.shape[2]==3
  return a,icc
regions={
 'redInterior':(slice(48,112),slice(96,160)),
 'redInsideRightEdge':(slice(48,112),slice(232,242)),
 'redOutsideRightEdge':(slice(48,112),slice(246,256)),
 'greenInterior':(slice(48,112),slice(352,416)),
 'blueInterior':(slice(48,112),slice(608,672)),
 'blueInsideRightEdge':(slice(48,112),slice(744,754)),
 'blueOutsideRightEdge':(slice(48,112),slice(758,768)),
 'grayInterior':(slice(528,592),slice(608,672)),
 'brightCore':(slice(520,600),slice(1080,1210)),
 'outerHalo':(slice(520,600),slice(960,1030)),
 'selectedMagenta':(slice(350,430),slice(1080,1200)),
 'selectedBlue':(slice(350,430),slice(600,690)),
 'selectedOrange':(slice(278,302),slice(64,192)),
}
paths={r['case']:r for r in run['exports']};zero=paths['zero'];base={}
for kind in ['Y','max','ACR']:
 a,icc=read(zero[kind]);base[kind]={'pixels':a,'icc':icc,'xyz':math.common(a,icc,False)}
assert np.array_equal(base['Y']['pixels'],base['max']['pixels']),'Zero differs across gate binaries'
assert base['Y']['icc']==base['max']['icc'],'Zero output ICC differs across gate binaries'
rows=[]
for name,row in paths.items():
 data={}
 for kind in ['Y','max','ACR']:
  a,icc=read(row[kind]);assert a.shape==base[kind]['pixels'].shape
  xyz=math.common(a,icc,False);delta=xyz-base[kind]['xyz']
  codes=a.astype(np.int32)-base[kind]['pixels'].astype(np.int32)
  data[kind]={'pixels':a,'icc':icc,'delta':delta,'codes':codes}
 out={'case':name,'regions':{}}
 for label,roi in regions.items():
  r={}
  for kind in data:
   d=data[kind]['delta'][roi];codes=data[kind]['codes'][roi]
   r[kind]={'meanDeltaY':float(d[:,:,1].mean()),'meanDeltaRGB16':codes.mean((0,1)).tolist(),
            'minDeltaRGB16':codes.min((0,1)).tolist(),'maxDeltaRGB16':codes.max((0,1)).tolist()}
  for kind in ['Y','max']:
   error=data[kind]['delta'][roi]-data['ACR']['delta'][roi]
   r[kind]['XYZEffectResidualX65535']=float(np.abs(error).mean()*65535)
  out['regions'][label]=r
 out['grayProfile']=[{'x':x,**{kind:float(v['delta'][556:565,x-4:x+5,1].mean()) for kind,v in data.items()}} for x in range(540,741,20)]
 # Whole-image scores are diagnostic only; never a candidate selection oracle.
 out['globalXYZEffectResidualX65535']={kind:float(np.abs(data[kind]['delta']-data['ACR']['delta']).mean()*65535) for kind in ['Y','max']}
 rows.append(out)
 if name in ['zero','diffusion40']:
  for kind,v in data.items():
   if name=='zero' and kind=='max':continue
   for label,roi in {'colors':(slice(48,112),slice(0,780)), 'gray-halo':(slice(520,600),slice(500,1240))}.items():
    tifffile.imwrite(work/'evidence'/f'{kind}-{name}-{label}.tif',v['pixels'][roi],photometric='rgb',metadata=None,compression='deflate',iccprofile=v['icc'])
uniforms=[]
for kind in ['Y','max']:
 a,ai=read(work/'renders'/f'uniform-{kind}-zero.tif');b,bi=read(work/'renders'/f'uniform-{kind}-diffusion40.tif')
 assert a.shape==(2000,3000,3) and ai==bi
 roi=(slice(750,1250),slice(1250,1750));d=b[roi].astype(np.int32)-a[roi].astype(np.int32)
 ay=math.common(a[roi].copy(),ai,False);by=math.common(b[roi].copy(),bi,False)
 uniforms.append({'gate':kind,'centerROI':{'x':1250,'y':750,'width':500,'height':500},
  'baselineMinMaxRGB16':[a[roi].min((0,1)).tolist(),a[roi].max((0,1)).tolist()],
  'minDeltaRGB16':d.min((0,1)).tolist(),'meanDeltaRGB16':d.mean((0,1)).tolist(),'maxDeltaRGB16':d.max((0,1)).tolist(),
  'maxAbsDeltaY':float(abs(by[:,:,1]-ay[:,:,1]).max()),'meanDeltaY':float((by[:,:,1]-ay[:,:,1]).mean())})
result={'identity':run['identity'],'allPairedARPExact':True,'zeroPixelsAndICCExactAcrossBinaries':True,
 'rows':rows,'uniform':uniforms,'checks':run['checks'],
 'scope':'Actual fixed native full TIFF outputs; deltas use each engine/Adobe own zero and actual embedded ICC. No fitting or Adobe algorithm claim.',
 'qualityAcceptance':'diagnostic-only; examine interiors/edges and every state; no whole-image-MAE acceptance',
 'evidenceCrops':{'colors':[0,48,780,64],'gray-halo':[500,520,740,80]},
 'exports':[{**r,'sha256':{k:hashlib.sha256(Path(r[k]).read_bytes()).hexdigest() for k in ['Y','max','ACR']}} for r in run['exports']]}
(work/'results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
`;
try{
 assert.equal(sha(shared),prep.sharedEngineSHA256);
 assert.equal(sha('native/src/effects.cc'),prep.originalEffectsSHA256);
 assert.equal(sha(join(candidate,'../effects.cc')),prep.candidateEffectsSHA256);
 assert.equal(sha('build/native/src/engine/libart_engine.a'),prep.sharedArtArchiveSHA256);
 assert.equal(sha(uniform),'fa78bd78ddf224bc7f16751d0e193f0b2c818809d58d8567586ff4c6724a6180');
 assert.equal(sha(join(reference,'input.tif')),referenceManifest.inputSHA256);
 for(const row of referenceManifest.rows)assert.equal(sha(join(reference,row.tiff)),row.sha256);
 const identity={sharedEngineSHA256:sha(shared),candidateEngineSHA256:sha(candidate),effectsSHA256:sha('native/src/effects.cc'),
  candidateEffectsSHA256:sha(join(candidate,'../effects.cc')),sharedArtArchiveSHA256:sha('build/native/src/engine/libart_engine.a'),
  chartSHA256:sha(join(reference,'input.tif')),uniformSHA256:sha(uniform)};
 mkdirSync(join(work,'renders'));mkdirSync(join(work,'evidence'));
 const pair={};
 for(const [kind,executable]of [['Y',shared],['max',candidate]]){
  pair[kind]=new EngineClient({executable,cache:join(work,'cache-'+kind),env:{OMP_NUM_THREADS:'2'}});engines.push(pair[kind]);
 }
 const exports=[];
 for(const [input,path]of [['chart',join(reference,'input.tif')],['uniform',uniform]]){
  const images={};for(const kind of ['Y','max'])images[kind]=await pair[kind].call('open',{path,sessionId:'maxgate-'+input,effectsDefaults:'legacy',whiteBalanceDefaults:'legacy'});
  assert.deepEqual(images.Y.adjustments,images.max.adjustments);assert.equal(images.Y.artProfile,images.max.artProfile);
  const rows=input==='chart'?referenceManifest.rows:[{name:'zero',settings:{Glow:'0'}},{name:'diffusion40',settings:{Glow:'40'}}];
  for(const row of rows){
   let controls={glow:Number(row.settings.Glow||0),glowStyle:'diffusion',glowRange:50,glowSpread:50,glowWarmth:0};
   if(input==='chart'){
    const actual=decodeAdjustments((await xmp.read(join(reference,row.xmp))).properties).adjustments;
    controls={...controls,...Object.fromEntries(Object.entries(actual).filter(([k])=>k.startsWith('glow')||k==='masks'))};
   }
   const profiles={};
   for(const kind of ['Y','max'])profiles[kind]=(await pair[kind].call('compose',{path,width:images[kind].width,height:images[kind].height,artProfile:images[kind].artProfile,adjustments:{...images[kind].adjustments,...controls}})).artProfile;
   assert.equal(profiles.Y,profiles.max,'Paired ARP differs: '+row.name);
   const paths={};
   for(const kind of ['Y','max']){
    paths[kind]=join(work,'renders',`${input}-${kind}-${row.name}.tif`);
    await pair[kind].call('export',{path,artProfile:profiles[kind],output:paths[kind],format:'tiff',colorSpace:'srgb'});
   }
   if(input==='chart')exports.push({case:row.name,...paths,ACR:join(reference,row.tiff)});
   checks.push(`${input}/${row.name}: paired full ARP exact, both real TIFF16 exports complete`);console.log('MEASURED',input,row.name);
  }
 }
 assert.equal(sha(shared),identity.sharedEngineSHA256);assert.equal(sha(candidate),identity.candidateEngineSHA256);
 assert.equal(sha(uniform),identity.uniformSHA256);assert.equal(sha(join(reference,'input.tif')),identity.chartSHA256);
 writeFileSync(join(work,'run.json'),JSON.stringify({identity,exports,reference,checks},null,2));
 execFileSync(resolve('build/qa-venv/bin/python'),['-B','-c',py,work],{stdio:'inherit',maxBuffer:8*1024*1024});
 complete=true;console.log('Measurements retained:',work);
}catch(error){writeFileSync(join(work,'failure.json'),JSON.stringify({error:String(error),checks,engineDiagnostics:engines.map(e=>e.diagnostics.slice(-5000))},null,2));throw error;
}finally{
 for(const engine of engines)await engine.stop();
 if(complete){rmSync(join(work,'renders'),{recursive:true,force:true});for(const k of ['Y','max'])rmSync(join(work,'cache-'+k),{recursive:true,force:true});}
 else console.error('Failure retained:',work);
}
