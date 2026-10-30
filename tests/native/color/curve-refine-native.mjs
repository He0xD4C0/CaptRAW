// Run after the parent builds native and contracts/dist. No compiler is invoked.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
import {POINT_CURVE_PRESETS} from '@captraw/contracts';
import {grayICC} from '../../support/curve-refine-quality-math.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-curve-refine-native-')),source=join(work,'chart.tif'),python=resolve('build/qa-venv/bin/python'),engine=new EngineClient({cache:join(work,'cache')}),checks=[];
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),engineHash=sha('build/native/captraw-engine');let passed=false,revision=0,sequence=0,nonEqualStageSamples=0,stageWitness;
const py=(code,...args)=>execFileSync(python,['-c',code,...args],{encoding:'utf8',maxBuffer:1024*1024});
function tone(profile,key,value){const at=profile.indexOf('[ToneCurve]\n');assert(at>=0);const end=profile.indexOf('\n[',at+1),part=profile.slice(at,end<0?undefined:end),re=new RegExp('^'+key+'=.*$','m');return profile.slice(0,at)+(re.test(part)?part.replace(re,key+'='+value):part+'\n'+key+'='+value+'\n')+(end<0?'':profile.slice(end));}
const withAmount=(a,amount)=>({...a,curveRefineModel:'weighted-std-v1',curveRefineSaturation:amount}),pass=s=>{checks.push(s);console.log('PASS',s);};
async function render(adjustments,artProfile,linearPreview=false){const r=++revision,pending=engine.preview(r,'fit',120000),result=await engine.call('update',{revision:r,adjustments,artProfile,linearPreview});const frame=await pending;return {...result,frame,hash:sha(frame.file)};}
async function output(profile){const path=join(work,`${++sequence}.tif`);await engine.call('export',{path:source,artProfile:profile,output:path,format:'tiff',colorSpace:'srgb'});return path;}
function exact(a,b){py('import numpy as np,tifffile,sys\na=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert np.array_equal(a,b)',a,b);}
try{
 py(`import numpy as np,tifffile,sys
from PIL import ImageCms
y,x=np.mgrid[:256,:512];a=np.stack([5000+50000*x/511,3000+52000*y/255,2000+55000*((x+2*y)%512)/511],axis=2).astype(np.uint16)
gray=np.rint(np.arange(512)/511*65535).astype(np.uint16);a[128:]=gray[None,:,None]
icc=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes();tifffile.imwrite(sys.argv[1],a,photometric='rgb',extratags=[(34675,'B',len(icc),icc,False)])`,source);
 const original=sha(source);
 // Only the existing explicit current policy creates the new owned default.
 // Omitting the policy and explicit legacy remain unmarked, independent of WB.
 for(const policy of [undefined,'legacy']){
  const opened=await engine.call('open',{path:source,sessionId:'refine-policy-legacy',...(policy?{effectsDefaults:policy}:{}),whiteBalanceDefaults:'current'});
  assert.equal(opened.adjustments.curveRefineModel,undefined);assert.equal(opened.adjustments.curveRefineSaturation,undefined);
  assert.deepEqual(await engine.call('adjustmentBase',{artProfile:opened.artProfile,groups:['curveRefine']}),{});
 }
 const fresh=await engine.call('open',{path:source,sessionId:'refine-policy-current',effectsDefaults:'current',whiteBalanceDefaults:'current'});
 assert.equal(fresh.adjustments.curveRefineModel,'weighted-std-v1');assert.equal(fresh.adjustments.curveRefineSaturation,100);assert.deepEqual(fresh.adjustments.curve,POINT_CURVE_PRESETS.Linear);
 assert.deepEqual(await engine.call('adjustmentBase',{artProfile:fresh.artProfile,groups:['curveRefine']}),{curveRefineModel:'weighted-std-v1',curveRefineSaturation:100});
 const noRefine={...fresh.adjustments};delete noRefine.curveRefineModel;delete noRefine.curveRefineSaturation;
 const freshIdentity=await render(fresh.adjustments,fresh.artProfile),oldIdentity=await render(noRefine,fresh.artProfile);
 assert.equal(freshIdentity.hash,oldIdentity.hash);exact(await output(freshIdentity.artProfile),await output(oldIdentity.artProfile));
 pass('only explicit current initializes owned100; omitted/legacy stay unmarked; identity preview and TIFF remain exact');
 for(const name of ['Medium Contrast','Strong Contrast']){
  const current={...fresh.adjustments,curve:POINT_CURVE_PRESETS[name],curveName:name},plain={...noRefine,curve:POINT_CURVE_PRESETS[name],curveName:name};
  const active=await render(current,fresh.artProfile),old=await render(plain,fresh.artProfile);
  assert.notEqual(active.hash,old.hash,name+' must actually use inherited default100');
  assert.deepEqual(await engine.call('adjustmentBase',{artProfile:active.artProfile,groups:['curveRefine']}),{curveRefineModel:'weighted-std-v1',curveRefineSaturation:100});
  const activeFile=await output(active.artProfile),oldFile=await output(old.artProfile);
  py('import tifffile,numpy as np,sys\na=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert not np.array_equal(a,b)',activeFile,oldFile);
  assert.equal((await render(fresh.adjustments,active.artProfile)).hash,freshIdentity.hash,'Undo preset to identity must keep exact original pixels');
 }
 pass('new current Medium/Strong retain default100 and affect actual preview/TIFF; restoring identity is exact');
 const image=await engine.call('open',{path:source,sessionId:'curve-refine',effectsDefaults:'legacy',whiteBalanceDefaults:'current'});
 const base={...image.adjustments,curve:structuredClone(POINT_CURVE_PRESETS['Medium Contrast']),contrast:25,sharpening:0,colorNoise:0,luminanceNoise:0,grain:0,glow:0};
 const first=await render(withAmount(base,0),image.artProfile);assert.match(first.artProfile,/CaptRAWCurveRefineModel=weighted-std-v1/,'Reject an engine without the new patch');
 const strong=await engine.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...base,curve:POINT_CURVE_PRESETS['Strong Contrast']},artProfile:image.artProfile});
 const second=strong.artProfile.slice(strong.artProfile.indexOf('[ToneCurve]\n')).match(/^Curve=(.*)$/m)[1];
 for(const mode of ['Standard','Neutral','FilmLike','Luminance','Perceptual','WeightedStd','SatAndValueBlending']){
  const inherited=tone(tone(image.artProfile,'CurveMode2',mode),'Curve2',second),old=await render(base,inherited),zero=await render(withAmount(base,0),inherited);
  assert.equal(zero.hash,old.hash,'0 endpoint with inherited '+mode);const oldFile=await output(old.artProfile);exact(oldFile,await output(zero.artProfile));
  const full=await render(withAmount(base,100),inherited),fullFile=await output(full.artProfile);assert.notEqual(full.hash,old.hash,'Fixture must exercise refine');
  // An sRGB-tagged equal-code ramp is near-gray, not exact gray in ART's
  // working ICC. Compare its actual output ICC in Lab; never expand a code gate.
  // Budget: 0.1 CIELAB unit in Euclidean DeltaE76, including lightness/chroma.
  // This is a conservative perceptual regression budget, not an Adobe kernel
  // match or a universal visibility threshold, and is independent of bit depth.
  const gray=grayICC(oldFile,fullFile);assert(gray.maxDeltaE76<=.1,JSON.stringify({mode,...gray}));
  console.log(JSON.stringify({mode,taggedSRGBNearGray:gray,maxDeltaE76Budget:.1}));
  // (none) bypasses input ICC only; preceding processing and float conversion
  // can still produce near-gray at the primary curve. Read the real stage via
  // the public sampler instead of assuming exact per-pixel working RGB.
  // The sampler is an 8px gamma-LUT average: inequality disproves exact gray,
  // equality cannot establish raw equality. Strict zero-ULP gray belongs to the
  // compiled kernel probe (including Contrast/curve2), not this full pipeline.
  const working={...base,colorProfile:{mode:'inherited',reference:'(none)'}},wold=await render(working,inherited);
  assert.match(wold.artProfile,/^InputProfile=\(none\)$/m);
  const stage=[];for(const x of [14,35,41,75,128,256,448,498]){
   const sample=await engine.call('sampleCurve',{sessionId:image.id,revision,channel:'curve',point:{x,y:200}});
   assert.equal(sample.domain,'art-tone-input-v1');const spread=Math.max(...sample.values)-Math.min(...sample.values);stage.push({x,values:sample.values,spread});
   if(spread!==0){++nonEqualStageSamples;stageWitness??={mode,x,values:sample.values,spread,sampleSize:sample.sampleSize,domain:sample.domain};}
  }
  const wfull=await render(withAmount(working,100),inherited);assert.match(wfull.artProfile,/^InputProfile=\(none\)$/m);
  const woldFile=await output(wold.artProfile),wfullFile=await output(wfull.artProfile),noneGray=grayICC(woldFile,wfullFile);
  assert(noneGray.maxDeltaE76<=.1,JSON.stringify({mode,inputICC:'none',...noneGray}));
  console.log(JSON.stringify({mode,inputICCNoneNearGray:noneGray,primaryStageSamples:stage,maxDeltaE76Budget:.1}));
  assert.equal((await render(base,full.artProfile)).hash,old.hash,'Removing marker must not inherit it from the profile');
 }
 assert(nonEqualStageSamples>0,'Fixture must expose at least one non-equal real sampleCurve readback; equal averages cannot prove exact per-pixel gray');
 console.log(JSON.stringify({inputICCNoneStageCounterexample:{nonEqualSampleCount:nonEqualStageSamples,witness:stageWitness},scope:'8px gamma-LUT stage samples; not a raw per-pixel dump or a proof that equal samples mean equal pixels'}));
 pass('zero/removal exact; all curve2 modes retain near-gray within 0.1 Lab unit for tagged-sRGB and input-ICC bypass; real non-equal primary sample recorded; strict exact-gray proof belongs to the separate compiled kernel probe');
 for(const curve of [POINT_CURVE_PRESETS.Linear,[{x:0,y:0},{x:.375,y:.375},{x:1,y:1}]]){
  const a={...base,curve,redCurve:POINT_CURVE_PRESETS['Strong Contrast'],parametricCurve:{shadows:10,darks:-15,lights:5,highlights:20,splits:[25,50,75]}},old=await render(a,image.artProfile),full=await render(withAmount(a,100),image.artProfile);
  assert.equal(full.hash,old.hash);exact(await output(old.artProfile),await output(full.artProfile));
 }
 pass('identity master bypass stays exact with non-neutral RGB channel and independent parametric curves');
 const active=await render(withAmount(base,50),image.artProfile),projected=await engine.call('adjustmentBase',{artProfile:active.artProfile,groups:['curveRefine']});
 assert.deepEqual(projected,{curveRefineModel:'weighted-std-v1',curveRefineSaturation:50});assert.deepEqual(await engine.call('adjustmentBase',{artProfile:image.artProfile,groups:['curveRefine']}),{});
 const restored=await render({...base,...projected},active.artProfile);assert.equal(restored.hash,active.hash);exact(await output(active.artProfile),await output(restored.artProfile));
 pass('explicit ARP projection restores both fields and preserves real preview/output');
 for(const patch of [{curveRefineModel:'future-v2',curveRefineSaturation:50},{curveRefineModel:'weighted-std-v1'},{curveRefineSaturation:50},{curveRefineModel:'weighted-std-v1',curveRefineSaturation:-1}])await assert.rejects(engine.call('compose',{path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:{...base,...patch}}));
 const invalid=[tone(active.artProfile,'CaptRAWCurveRefineModel','future-v2'),tone(active.artProfile,'CaptRAWCurveRefineAmount','101'),tone(active.artProfile,'CaptRAWCurveRefineAmount','1.5'),active.artProfile.replace(/^Version=\d+$/m,'Version=100'),active.artProfile.replace(/^Version=\d+\n/m,''),tone(active.artProfile,'CurveMode','UntrustedMode')];
 for(const profile of invalid){await assert.rejects(engine.call('adjustmentBase',{artProfile:profile,groups:['curveRefine']}));await assert.rejects(engine.call('export',{path:source,artProfile:profile,output:join(work,'rejected.tif'),format:'tiff',colorSpace:'srgb'}));}
 pass('owned model/amount/header validation also rejects direct full-ARP exports');
 for(const headroom of [1,3,4]){
  const a={...base,exposure:4,hdrEnabled:true,hdrHeadroom:headroom},old=await render(a,image.artProfile,true),zero=await render(withAmount(a,0),image.artProfile,true),full=await render(withAmount(a,100),image.artProfile,true);
  assert(old.frame.linear&&zero.frame.linear&&full.frame.linear);assert.equal(sha(zero.frame.linear.file),sha(old.frame.linear.file));
  console.log(py(`import numpy as np,json,sys
def read(p):return np.fromfile(p,dtype='<f2').reshape(256,512,4)[:,:,:3].astype(float)
a=read(sys.argv[1]);b=read(sys.argv[2]);assert np.isfinite(a).all() and np.isfinite(b).all();assert a.max()>1 and b.max()>1,(a.max(),b.max());print(json.dumps(dict(headroom=int(sys.argv[3]),legacyMax=float(a.max()),refinedMax=float(b.max()))))`,old.frame.linear.file,full.frame.linear.file,String(headroom)).trim());
 }
 pass('compiled HDR pipeline keeps exact zero and values above SDR white for multiple white points');
 assert.equal(sha(source),original);assert.equal(sha('build/native/captraw-engine'),engineHash);passed=true;console.log(JSON.stringify({engineHash,checks}));
}finally{await engine.stop();if(passed)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
