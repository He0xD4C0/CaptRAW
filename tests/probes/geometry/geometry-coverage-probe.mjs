// Run only after the parent compiles this independent probe. No build commands.
import assert from 'node:assert/strict';
import {access,mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile),argument=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const probe=resolve(argument('probe')||'build/native/captraw-geometry-coverage-probe');
await access(probe); // A missing new probe must fail before allocating scratch.
const retained=argument('output-dir'),root=retained?resolve(retained):await mkdtemp(join(tmpdir(),'captraw-geometry-coverage-'));
if(retained)await mkdir(root); // Never merge into an existing artifact directory.
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const frozen=[probe,'build/native/captraw-engine','build/native/libcaptraw-core.a','build/native/src/engine/libart_engine.a','tests/native/geometry/geometry-coverage-probe.cc'];
let passed=false,cohort,source;
try{
 cohort=Object.fromEntries(await Promise.all(frozen.map(async p=>[p,hash(await readFile(p))])));
 source=argument('metadata')?resolve(argument('metadata')):join(root,'black-with-lens-metadata.png');
 if(!argument('metadata'))await run(resolve('build/qa-venv/bin/python'),['-c',String.raw`
from PIL import Image,TiffImagePlugin
import sys
im=Image.new('RGB',(641,427),(0,0,0))
exif=Image.Exif();exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
im.save(sys.argv[1],exif=exif)
`,source]);
 const sourceSHA=hash(await readFile(source)),planes=join(root,'planes');await mkdir(planes);
 const {stdout,stderr}=await run(probe,[resolve('build/native/resources'),join(root,'cache'),source,planes],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:180000,env:{...process.env,OMP_NUM_THREADS:'2',DISPLAY:'',WAYLAND_DISPLAY:''}});
 await writeFile(join(root,'probe.stderr'),stderr);
 let report;try{report=JSON.parse(stdout);}catch(error){await writeFile(join(root,'probe.stdout'),stdout);throw error;}
 await writeFile(join(root,'report.json'),JSON.stringify({cohort,sourceSHA,...report},null,2)+'\n');
 assert.equal(report.probeVersion,1);assert.equal(report.rows.length,80);assert.equal(report.candidateCount,160);
 assert(report.unsafeCandidates>0,'This characterization must expose incomplete ashift-only candidates, not silently call every rectangle safe');
 const rotate=(p,r)=>r===90?{x:1-p.y,y:p.x}:r===180?{x:1-p.x,y:1-p.y}:r===270?{x:p.y,y:1-p.x}:p;
 for(const row of report.rows){
  assert(row.coveredTrueBlackPixels>1000,'true black is not transparency');assert(row.rampSamples>50);assert(row.maximumRampErrorPixels<.75);assert(row.affineDirectionErrorPixels<.025);
  if(row.lensfunCA)assert(row.lensCoordinateShiftPixels>.001,'real Lensfun fixture required');
  for(const candidate of row.candidates){
   const c=candidate.storedCrop,points=[{x:c.x,y:c.y},{x:c.x+c.width,y:c.y+c.height}].map(p=>{const q=rotate(p,row.rotation);return {x:row.flipHorizontal?1-q.x:q.x,y:row.flipVertical?1-q.y:q.y};});
   const actual={x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),width:Math.abs(points[1].x-points[0].x),height:Math.abs(points[1].y-points[0].y)};
   for(const key of ['x','y','width','height'])assert(Math.abs(actual[key]-candidate.normalizedDisplay[key])<1e-12,'crop edges reverse coarse rotation/reflection only');
   if(candidate.bounded)assert(candidate.renderedCenterSamples>0&&candidate.boundaryPointSamples===1028);
   if(candidate.passesSampledValidation)assert.equal(candidate.incompleteRenderedCenters+candidate.sourceDomainOutsideCenters+candidate.boundaryPointsOutsideSource,0);
  }
 }
 // Independently decode the emitted 16-bit planes; their values are sampler
 // diagnostics, not PNG mask assets or a claim of a fractional-alpha exporter.
 const decoded=JSON.parse((await run(resolve('build/qa-venv/bin/python'),['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
from pathlib import Path
root=Path(sys.argv[1]);report=json.loads(Path(sys.argv[2]).read_text());rows=[]
for row in report['rows']:
 prefix=row['diagnosticPrefix'];w,h=row['width'],row['height']
 planes=[np.array(Image.open(root/(prefix+'-'+suffix+'.pgm'))) for suffix in ('unit-response','source-domain','true-black')]
 assert all(a.shape==(h,w) for a in planes)
 response,domain,black=planes;assert set(np.unique(domain)).issubset({0,65535})
 covered=(response>=round(report['unitResponseThreshold']*65535)) & (black==0)
 assert int(covered.sum())>1000
 rows.append(dict(name=row['name'],coveredBlackPixels=int(covered.sum())))
print(json.dumps(dict(planes=len(rows)*3,rows=rows)))
`,planes,join(root,'report.json')],{encoding:'utf8',maxBuffer:1024*1024})).stdout);
 assert.equal(decoded.planes,240);
 assert.equal(hash(await readFile(source)),sourceSHA);for(const [p,sha] of Object.entries(cohort))assert.equal(hash(await readFile(p)),sha,p+' changed while running');
 passed=true;console.log(JSON.stringify({cohort,cases:report.rows.length,candidates:report.candidateCount,unsafeCandidates:report.unsafeCandidates,decodedPlanes:decoded.planes,maximumRampErrorPixels:Math.max(...report.rows.map(r=>r.maximumRampErrorPixels)),scope:report.limitations,...(retained?{output:root}:{scratchCleaned:true})},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error.stack||error),stdout:error.stdout,stderr:error.stderr,cohort,source},null,2));throw error;}
finally{if(passed&&!retained)await rm(root,{recursive:true,force:true});else console.error(passed?'Retained requested diagnostics:':'Retained coverage failure:',root);}
