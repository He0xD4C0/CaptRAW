import {EngineClient} from '../../support/engine-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const out=resolve('artifacts/white-balance-reference'),reference=JSON.parse(readFileSync(join(out,'reference.json'))),e=new EngineClient({cache:join(out,'cache')});e.on('error',()=>{});
const coefficients=profile=>profile.match(/\[White Balance\][\s\S]*?Multipliers=([^\n]+)/)[1].split(';').filter(Boolean).map(Number);
const rows=[];let revision=0;
try{
 for(const fixture of reference.fixtures){
  const image=await e.call('open',{path:fixture.path,sessionId:'reference'});
  const adjustments={...image.adjustments,colorProfile:{...image.adjustments.colorProfile,mode:'embedded'},temperature:fixture.temperature,tint:fixture.tint,wbMode:'custom',wbMultipliers:null};
  const preview=e.preview(++revision);const result=await e.call('update',{revision,adjustments});await preview;
  const actual=coefficients(result.artProfile),error=Math.max(...actual.map((v,i)=>Math.abs(v-fixture.multipliers[i])));
  assert(error<1e-10,JSON.stringify({fixture,actual,error}));
  const composed=await e.call('compose',{path:fixture.path,width:image.width,height:image.height,adjustments,artProfile:result.artProfile});assert.deepEqual(coefficients(composed.artProfile),actual);
  await e.call('export',{path:fixture.path,artProfile:result.artProfile,output:join(out,`manual-${fixture.temperature}.tiff`),format:'tiff'});
  // A second process with saved exact coefficients must render exactly the same pixels.
  const worker=new EngineClient({cache:join(out,'independent')});try{await worker.call('export',{path:fixture.path,artProfile:composed.artProfile,output:join(out,`independent-${fixture.temperature}.tiff`),format:'tiff'});}finally{await worker.stop();}
  const camera=await e.call('whiteBalance',{mode:'camera'});rows.push({...fixture,actual,maximumCoefficientError:error,camera});
 }
 const iccImage=await e.call('open',{path:reference.embeddedICC,sessionId:'icc'});assert.equal(iccImage.inputProfiles.find(p=>p.id==='embedded').kind,'icc');
 const iccResults={};for(const mode of ['matrix','embedded']){
  const a={...iccImage.adjustments,temperature:4500,tint:25,wbMultipliers:null,colorProfile:{...iccImage.adjustments.colorProfile,mode}};
  const preview=e.preview(++revision),result=await e.call('update',{revision,adjustments:a});await preview;iccResults[mode]=coefficients(result.artProfile);
 }
 assert.deepEqual(iccResults.embedded,iccResults.matrix);console.log('PASS embedded ICC takes precedence over DCP for white balance');
 writeFileSync(join(out,'native.json'),JSON.stringify({rows,iccResults},null,2)+'\n');console.log('PASS three dual-illuminant camera matrices, preview/compose coefficients and independent exports');
 execFileSync('build/qa-venv/bin/python',['-c',`import numpy as np,tifffile,json\nfrom pathlib import Path\np=Path(${JSON.stringify(out)});report=[]\nfor t in [2850,4000,6500]:\n a=tifffile.imread(p/f'manual-{t}.tiff');b=tifffile.imread(p/f'independent-{t}.tiff')\n assert a.dtype==np.uint16 and np.array_equal(a,b)\n center=np.median(a[32:-32,32:-32],axis=(0,1));spread=float((center.max()-center.min())/center.mean());assert spread<.0015\n report.append(dict(temperature=t,median=center.tolist(),grayChannelSpread=spread,independentPixelsEqual=True))\n(p/'pixels.json').write_text(json.dumps(report,indent=2)+'\\n')\nprint('PASS neutral RAW gray patches and identical independent TIFF16 pixels')`],{stdio:'inherit'});
}finally{await e.stop();}
