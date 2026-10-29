// Default prepares only. --build is for the parent's exclusive compile window.
// ninja -t commands reads the existing graph; it never executes a build edge.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),build=join(root,'build/native');
const source=join(here,'probe.cc'),work=mkdtempSync(join(tmpdir(),'captraw-tat-pipette-'));
const object=join(work,'probe.o'),binary=join(work,'probe'),requests=join(work,'requests.json');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const args=process.argv.slice(2);let complete=false;
try{
 assert(args.every((a,i)=>['--build','--check','--report','--raw'].includes(a)||(i>0&&['--report','--raw'].includes(args[i-1]))),'Unknown argument');
 const chart=join(root,'artifacts/stage-0/acr-reference/tat-interaction-187/inputs/controlled-tat.tif');
 assert.equal(hash(chart),'da7915588f6ac92cf3de084f7ba6aebf396e76017a77ae6a115d25786df7f379');
 const python=process.env.CAPTRAW_PYTHON||join(root,'build/qa-venv/bin/python');
 const fixture=JSON.parse(execFileSync(python,['-c',`import tifffile,hashlib,json,sys
with tifffile.TiffFile(sys.argv[1]) as f:
 p=f.pages[0];a=p.asarray();icc=bytes(p.tags[34675].value)
 assert a.shape==(1024,1536,3) and str(a.dtype)=='uint16'
 print(json.dumps({'shape':list(a.shape),'pixelSha256':hashlib.sha256(a.astype('<u2').tobytes()).hexdigest(),'iccSha256':hashlib.sha256(icc).hexdigest(),'anchors':[{'id':name,'xy':[x,y],'rgb16':a[y,x].tolist()} for name,x,y in [('midgray166',640,550),('orange',128,240),('darkGray',384,550)]]}))`,chart],{encoding:'utf8'}));
 const neutral={crop:null,rotation:0,fineRotation:0,exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,
  texture:0,clarity:0,dehaze:0,saturation:0,vibrance:0,grain:0,vignette:0,glow:0,sharpening:0,luminanceNoise:0,colorNoise:0,
  lensCorrections:false,lensManualDistortion:0,lensVignette:0,masks:[],spots:[],flipHorizontal:false,flipVertical:false,
  perspective:{enabled:false,horizontal:0,vertical:0,angle:0,shear:0,aspect:1,focalLength:28,cropFactor:1},
  curve:[{x:0,y:0},{x:1,y:1}],redCurve:[{x:0,y:0},{x:1,y:1}],greenCurve:[{x:0,y:0},{x:1,y:1}],blueCurve:[{x:0,y:0},{x:1,y:1}],
  hsl:{hue:Array(8).fill(0),saturation:Array(8).fill(0),luminance:Array(8).fill(0)}};
 const points=fixture.anchors.map(p=>({id:p.id,source:[p.xy[0]/1535,p.xy[1]/1023],...(p.id==='midgray166'?{acrInput:166,acrDisplayRGB:156}:{} )}));
 const jobs=[
  {id:'chart-neutral',path:chart,adjustments:neutral,points},
  {id:'chart-main166to201',path:chart,adjustments:{...neutral,curve:[{x:0,y:0},{x:166/255,y:201/255},{x:1,y:1}]},points},
  {id:'chart-crop',path:chart,adjustments:{...neutral,crop:{x:.04,y:.04,width:.92,height:.92}},points},
  {id:'chart-rotate90',path:chart,adjustments:{...neutral,rotation:90},points},
  {id:'chart-perspective',path:chart,adjustments:{...neutral,fineRotation:2,perspective:{...neutral.perspective,enabled:true,horizontal:6,vertical:-4}},points:[points[0]]}
 ];
 const rawFlag=args.indexOf('--raw');
 if(rawFlag>=0){const raw=resolve(args[rawFlag+1]||'');assert(existsSync(raw),'RAW path missing');jobs.push({id:'real-raw',path:raw,raw:true,adjustments:neutral,targets:['tone'],points:[{id:'center',source:[.5,.5]}]});}
 writeFileSync(requests,JSON.stringify(jobs,null,2));
 const commands=execFileSync('ninja',['-C',build,'-t','commands','captraw-wb-probe'],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\n');
 const oldSource=join(root,'tests/white-balance-probe.cc');
 const compile=commands.find(c=>c.includes(oldSource)&&c.includes(' -c ')),link=commands.find(c=>c.includes(' -o captraw-wb-probe '));
 assert(compile&&link,'Existing native probe toolchain missing');
 const oldObject=compile.match(/ -o (\S+) /)?.[1];assert(oldObject&&link.includes(oldObject));
 assert(compile.endsWith(' -c '+oldSource),'Unexpected compile command');
 const compileCommand=compile.replace(' -c '+oldSource,' -c '+quote(source)).replace(' -o '+oldObject+' ',' -o '+quote(object)+' ')
  .replace(' -MT '+oldObject+' ',' -MT '+quote(object)+' ').replace(/ -MF \S+ /,' -MF '+quote(join(work,'probe.d'))+' ');
 const linkCommand=link.replace(oldObject,quote(object)).replace(' -o captraw-wb-probe ',' -o '+quote(binary)+' ');
 assert(!compileCommand.includes(oldSource)&&!compileCommand.includes(oldObject)&&!linkCommand.includes(oldObject),'Shared output survived rewrite');
 assert(compileCommand.includes(" -o '"+object+"'")&&linkCommand.includes(" -o '"+binary+"'"),'Output escaped private scratch');
 const upstream=join(root,'build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src');
 const files=[source,...new Set(jobs.map(j=>j.path)),join(build,'captraw-engine'),join(build,'libcaptraw-core.a'),join(build,'src/engine/libart_engine.a'),join(build,'src/utils/libart_utils.a'),
  ...['engine/procparams.h','engine/dcrop.h','engine/pipettebuffer.h','engine/iptonecurve.cc','engine/iprgbcurves.cc','engine/iphsl.cc','gui/edit.h'].map(p=>join(upstream,p))];
 const identities=Object.fromEntries(files.map(p=>[p,hash(p)]));
 if(process.env.CAPTRAW_PIPETTE_ENGINE_SHA)assert.equal(identities[join(build,'captraw-engine')],process.env.CAPTRAW_PIPETTE_ENGINE_SHA,'Frozen engine changed');
 writeFileSync(join(work,'manifest.json'),JSON.stringify({scope:'prepare only; no compiler invoked',fixture,identities,jobs:jobs.map(j=>j.id),compileCommand,linkCommand},null,2));
 const shell=`#!/bin/sh\nset -eu\ncd ${quote(build)}\n${compileCommand}\n${linkCommand}\n`;
 writeFileSync(join(work,'compile.sh'),shell,{mode:0o700});
 if(args.includes('--build')){
  execFileSync('/bin/sh',[join(work,'compile.sh')],{stdio:'inherit'});
  const output=spawnSync(binary,[join(build,'resources'),join(work,'cache'),requests],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:900000,env:{...process.env,OMP_NUM_THREADS:'2'}});
  writeFileSync(join(work,'stdout.log'),output.stdout||'');writeFileSync(join(work,'stderr.log'),output.stderr||'');
  assert(!output.error,output.error?.message);assert.equal(output.status,0,'Native pipette probe failed; inspect private stderr');
  const result=JSON.parse(output.stdout.trim().split('\n').at(-1));
  result.cohort=identities;result.fixture=fixture;
  const base=result.rows.find(j=>j.id==='chart-neutral'),changed=result.rows.find(j=>j.id==='chart-main166to201');
  for(const before of base.rows.filter(r=>r.target==='tone')){
   const after=changed.rows.find(r=>r.target==='tone'&&r.id===before.id);
   assert(after&&before.full.values.every((v,i)=>Math.abs(v-after.full.values[i])<1e-6),'Main curve changes its own pipette input');
  }
  assert(changed.rows.some(r=>['red','green','blue'].includes(r.target)&&Math.abs(r.full.values[0]-base.rows.find(b=>b.id===r.id&&b.target===r.target).full.values[0])>1e-3),'RGB pipette did not see the preceding main curve');
  assert(result.rows.every(j=>j.rows.some(r=>r.target==='tone')),'Missing actual tone buffer');
  result.acrParity='Measured residuals only; neither domain equality nor display-RGB substitution assumed';
  const report=args.indexOf('--report');if(report>=0){assert(args[report+1],'Report path missing');writeFileSync(resolve(args[report+1]),JSON.stringify(result,null,2));}
  for(const [path,before]of Object.entries(identities))assert.equal(hash(path),before,'Input/shared artifact changed: '+path);
  console.log(JSON.stringify({passed:true,jobs:result.rows.length,measurements:result.rows.reduce((n,j)=>n+j.rows.length,0),acr:base.rows.find(r=>r.target==='tone'&&r.id==='midgray166').acrComparison,report:report>=0?resolve(args[report+1]):null}));
  complete=true;
 }else{
  console.log(JSON.stringify({scope:'prepare only; compiler/runtime not executed',work,manifest:join(work,'manifest.json'),compileScript:join(work,'compile.sh'),run:[binary,join(build,'resources'),join(work,'cache'),requests]}));
  complete=args.includes('--check');
 }
}finally{
 if(complete)rmSync(work,{recursive:true,force:true});else console.error('Prepared/failed probe retained:',work);
}
