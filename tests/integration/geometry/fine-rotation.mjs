import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';

const root=resolve('artifacts/fine-rotation');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),source=join(out,'source.png');
const python=resolve('build/qa-venv/bin/python');
const executable=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine');
const resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const installed=join(homedir(),'Applications/CaptRAW-0.47.app/Contents/Resources/native');
const referenceExecutable=join(installed,'captraw-engine'),referenceResources=join(installed,'resources');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const report={passed:false,checks:[],pairs:[],bindings:[],rejections:[],errors:[],
 scope:'Native controlled PNG, installed 0.47 core oracle, exact TIFF16 pixels; no GUI or model acceptance',
 executable,resources,referenceExecutable,referenceResources};
const clients=[];let revision=0;
const pass=name=>{report.checks.push(name);console.log('PASS',name);};

function section(profile,name){
 const start=profile.indexOf(`[${name}]\n`);assert(start>=0,`Missing ART section ${name}`);
 const end=profile.indexOf('\n[',start);
 return {start,end:end<0?profile.length:end,text:profile.slice(start,end<0?profile.length:end)};
}
function fields(profile,name,values){
 const part=section(profile,name);let text=part.text;
 for(const [key,value] of Object.entries(values)){
  const pattern=new RegExp(`^${key}=.*$`,'m');
  text=pattern.test(text)?text.replace(pattern,`${key}=${value}`):text.trimEnd()+`\n${key}=${value}\n`;
 }
 return profile.slice(0,part.start)+text+profile.slice(part.end);
}
function value(profile,name,key){
 const match=section(profile,name).text.match(new RegExp(`^${key}=(.*)$`,'m'));
 assert(match,`Missing ART ${name}/${key}`);return match[1];
}
function client(binary,assets,cache){
 const engine=new EngineClient({executable:binary,resources:assets,cache:join(out,cache)});
 engine.on('error',error=>report.errors.push({client:cache,...error}));clients.push(engine);return engine;
}
async function render(engine,artProfile,adjustments){
 const next=++revision;let listener,timer;
 const waiting=new Promise((resolve,reject)=>{
  listener=({frame})=>{if(frame.revision===next&&frame.kind==='fit')resolve(frame);};
  engine.on('preview',listener);
  timer=setTimeout(()=>reject(new Error(`Preview ${next} timed out`)),120000);
 });
 waiting.catch(()=>{});
 try{
  const result=await engine.call('update',{revision:next,artProfile,adjustments});
  return {...result,frame:await waiting};
 }finally{clearTimeout(timer);engine.off('preview',listener);}
}
async function compare(engine,reference,name,actualProfile,expectedProfile,metadata={}){
 const actual=join(out,name+'.tiff'),expected=join(out,name+'-reference.tiff');
 writeFileSync(join(out,name+'.arp'),actualProfile);writeFileSync(join(out,name+'-reference.arp'),expectedProfile);
 await engine.call('export',{path:source,artProfile:actualProfile,output:actual,format:'tiff'});
 await reference.call('export',{path:source,artProfile:expectedProfile,output:expected,format:'tiff'});
 const pixels=JSON.parse(execFileSync(python,['-c',String.raw`
import json,sys,numpy as np,tifffile
a,b=[tifffile.imread(path) for path in sys.argv[1:]]
assert a.dtype==b.dtype==np.uint16,(a.dtype,b.dtype)
assert a.shape==b.shape,(a.shape,b.shape)
d=np.abs(a.astype(np.int32)-b.astype(np.int32))
print(json.dumps(dict(shape=list(a.shape),bits=16,maximumDifference=int(d.max()),differentSamples=int(np.count_nonzero(d)))))
`,actual,expected],{encoding:'utf8'}));
 report.pairs.push({name,...metadata,...pixels,actual,expected});
 assert.equal(pixels.differentSamples,0,`${name}: ${JSON.stringify(pixels)}`);
}
const leaf=(id,type='radial')=>({id,name:id,type,enabled:true,initialized:true,inverted:false,feather:12,
 brightness:.4,contrast:0,saturation:0,start:{x:.2,y:.27},end:{x:.68,y:.74},
 points:[{x:.34,y:.41,radius:.2}],operation:'add'});

try{
 for(const path of [python,executable,resources,referenceExecutable,referenceResources])assert(existsSync(path),`Missing ${path}`);
 report.binaryHashes={current:hash(executable),reference:hash(referenceExecutable)};
 execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw
import numpy as np,sys
y,x=np.mgrid[:480,:640];a=np.empty((480,640,3),dtype=np.uint8)
a[:,:,0]=45+(x*3+y)%151;a[:,:,1]=50+(y*2+x//3)%143;a[:,:,2]=55+(x+y*3)%137
im=Image.fromarray(a);d=ImageDraw.Draw(im)
d.rectangle((41,57,139,121),fill=(235,45,35));d.ellipse((403,291,573,439),fill=(25,190,230))
d.line((12,420,589,33),fill=(230,220,35),width=7);im.save(sys.argv[1])
`,source]);
 report.sourceHash=hash(source);
 const engine=client(executable,resources,'current-cache');
 const reference=client(referenceExecutable,referenceResources,'reference-cache');
 const currentReady=await engine.ready,referenceReady=await reference.ready;
 report.engineVersions={current:currentReady.engineVersion,reference:referenceReady.engineVersion};
 assert.equal(currentReady.engineVersion,referenceReady.engineVersion,'Processing version must remain unchanged');
 const image=await engine.call('open',{path:source,sessionId:'fine-rotation'});
 const oldImage=await reference.call('open',{path:source,sessionId:'fine-rotation-reference'});
 assert.equal(image.adjustments.fineRotation,0);
 assert.equal(image.baselineVersion,oldImage.baselineVersion);report.baselineVersion=image.baselineVersion;
 const base={...image.adjustments};delete base.fineRotation;
 assert(!Object.hasOwn(base,'fineRotation'));
 const compose=(core,artProfile,adjustments)=>core.call('compose',{path:source,width:image.width,height:image.height,artProfile,adjustments});
 const profile=(enabled,fill,global=false)=>fields(fields(oldImage.artProfile,'Rotation',{
  Enabled:enabled,Degree:23,CaptRAWMaskCoordinates:global,CaptRAWMaskReferenceDegree:7,
 }),'Common Properties for Transformations',{AutoFill:fill});
 pass('native open reports zero fine rotation with unchanged processing and baseline versions');

 for(const fill of [false,true])for(const [rotation,angle] of [[0,0],[90,23],[180,-17],[270,23]]){
  const name=`fine-${rotation}-${angle}-fill-${fill}`,input=profile(true,fill);
  const adjustments={...base,rotation,fineRotation:angle};
  const validated=await engine.call('validate',{artProfile:input,adjustments});
  assert.equal(validated.fineRotation,angle);assert.deepEqual(validated.masks,[]);
  // The oracle never receives the new field: change only ART Enabled/Degree.
  const old=(await compose(reference,input,{...base,rotation})).artProfile;
  const expected=fields(old,'Rotation',{Enabled:angle!==0,Degree:angle});
  const composed=(await compose(engine,input,adjustments)).artProfile;
  const actual=await render(engine,input,adjustments);
  assert.equal(actual.artProfile,composed,'compose and update must apply the same rotation');
  assert.deepEqual(actual.geometry,{rotation,angle});
  assert.equal(value(actual.artProfile,'Rotation','Enabled'),String(angle!==0));
  assert.equal(Number(value(actual.artProfile,'Rotation','Degree')),angle);
  assert.equal(value(actual.artProfile,'Common Properties for Transformations','AutoFill'),String(fill));
  copyFileSync(actual.frame.file,join(out,name+'-preview.png'));
  await compare(engine,reference,name,actual.artProfile,expected,{rotation,angle,fill});
 }
 pass('four coarse directions at 0/+23/-17 match direct old-core ART edits pixel for pixel, with AutoFill off and on');

 for(const enabled of [true,false])for(const fill of [false,true]){
  const input=profile(enabled,fill,true),name=`legacy-${enabled}-fill-${fill}`;
  const reopened=await engine.call('open',{path:source,sessionId:name});
  assert.equal(reopened.adjustments.fineRotation,0,'Fresh open must not leak the previous edit angle');
  const old=(await compose(reference,input,base)).artProfile;
  const actual=await render(engine,input,base);
  assert.equal(actual.artProfile,old,'Omitted fineRotation must preserve the complete old-core profile');
  assert.equal(section(actual.artProfile,'Rotation').text,section(input,'Rotation').text);
  const validated=await engine.call('validate',{artProfile:input,adjustments:base});
  assert.equal(validated.fineRotation,enabled?23:0);
  await compare(engine,reference,name,actual.artProfile,old,{enabled,storedDegree:23,fill,fieldOmitted:true});
  const unchanged=(await compose(engine,input,{...base,fineRotation:enabled?23:0})).artProfile;
  assert.equal(unchanged,old,'Same effective angle must retain dormant Degree and all ART settings');
 }
 pass('omitted field preserves enabled 23 and disabled stored 23 profiles and pixels; equal effective values retain dormant settings');

 // The source canvas determines missing references before the new angle is applied.
 for(const enabled of [true,false])for(const global of [true,false]){
  const input=profile(enabled,true,global),inherited=global?7:enabled?23:0;
  const masks=[leaf('top'),{...leaf('group'),components:[leaf('missing','linear'),
   {...leaf('explicit-zero','brush'),referenceAngle:0},
   {...leaf('nested'),components:[{...leaf('explicit-minus'),referenceAngle:-17},{...leaf('explicit-plus'),referenceAngle:7}]}]}];
  const adjustments={...base,fineRotation:-11,masks},snapshot=structuredClone(adjustments);
  const validated=await engine.call('validate',{artProfile:input,adjustments});
  const expected=structuredClone(masks);expected[0].referenceAngle=inherited;expected[1].components[0].referenceAngle=inherited;
  assert.equal(validated.fineRotation,-11);assert.deepEqual(validated.masks,expected);
  assert.deepEqual(adjustments,snapshot);
  // Once bound, new-field output must also match the old core with a direct ART edit.
  const bound={...base,masks:validated.masks};
  const old=(await compose(reference,input,bound)).artProfile;
  const expectedProfile=fields(old,'Rotation',{Enabled:true,Degree:-11});
  const actual=(await compose(engine,input,{...bound,fineRotation:-11})).artProfile;
  await compare(engine,reference,`masks-${enabled}-global-${global}`,actual,expectedProfile,{inherited,explicit:[0,-17,7],global});
  report.bindings.push({enabled,global,inherited,fineRotation:validated.fineRotation,masks:validated.masks});
 }
 pass('validate binds missing leaf references before rotation, preserves nested explicit references with either global flag, and matches old-core mask pixels');

 for(const angle of [-45,45]){
  const input=profile(false,false),adjustments={...base,fineRotation:angle};
  assert.equal((await engine.call('validate',{artProfile:input,adjustments})).fineRotation,angle);
  const composed=await compose(engine,input,adjustments);
  assert.equal(Number(value(composed.artProfile,'Rotation','Degree')),angle);
  assert.equal(value(composed.artProfile,'Rotation','Enabled'),'true');
  assert.equal(value(composed.artProfile,'Common Properties for Transformations','AutoFill'),'false');
 }
 pass('inclusive -45/+45 boundaries are accepted and preserve AutoFill');

 const stable=await render(engine,profile(true,false),{...base,fineRotation:23});
 const rejectedRevisions=new Set(),unexpectedFrames=[];
 engine.on('preview',({frame})=>{if(rejectedRevisions.has(frame.revision))unexpectedFrames.push(frame);});
 const invalid=[46,-46,45.0001,-45.0001,'23','',null,true,false,[],{}];
 for(const [index,angle] of invalid.entries()){
  const adjustments={...base,fineRotation:angle},output=join(out,`invalid-${index}.tiff`),rejections=[];
  await assert.rejects(engine.call('validate',{artProfile:stable.artProfile,adjustments}),error=>{rejections.push({method:'validate',error:error.message});return true;});
  const next=++revision;rejectedRevisions.add(next);
  await assert.rejects(engine.call('update',{revision:next,artProfile:stable.artProfile,adjustments}),error=>{rejections.push({method:'update',error:error.message});return true;});
  assert.equal((await engine.call('save')).artProfile,stable.artProfile,'Rejected angle changed active profile');
  let reachedExport=false;
  await assert.rejects((async()=>{
   const result=await compose(engine,stable.artProfile,adjustments);
   reachedExport=true;
   await engine.call('export',{path:source,artProfile:result.artProfile,output,format:'tiff'});
  })(),error=>{rejections.push({method:'compose/export',error:error.message});return true;});
  assert.equal(reachedExport,false,'compose must reject the invalid angle before export');
  assert(!existsSync(output),'Invalid angle produced successful output');
  assert.equal((await engine.call('save')).artProfile,stable.artProfile);
  report.rejections.push({angle,rejections,outputAbsent:true});
 }
 // JSON has no NaN/Infinity literals; test their actual EngineClient wire value, null.
 assert.equal(JSON.stringify({fineRotation:NaN}),'{"fineRotation":null}');
 assert.equal(JSON.stringify({fineRotation:Infinity}),'{"fineRotation":null}');
 report.nonFiniteWireValue=null;
 const recovered=await render(engine,stable.artProfile,{...base,fineRotation:23});
 assert.equal(hash(recovered.frame.file),hash(stable.frame.file));assert.deepEqual(unexpectedFrames,[]);
 pass('bad angles and non-numeric values reject validate/update/compose-export without output or profile mutation; valid rendering recovers');

 report.rawBaseline=[];
 const options={size:{mode:'long-edge',width:512,height:512,dontEnlarge:true},sharpen:{enabled:false,amount:0,radius:1}};
 for(const name of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const path=resolve('build/samples',name),sourceHash=hash(path);
  const current=await engine.call('open',{path,sessionId:`baseline-${name}`});
  assert.equal(current.adjustments.fineRotation,0);
  const composed=await engine.call('compose',{path,width:current.width,height:current.height,
   artProfile:current.artProfile,adjustments:{...current.adjustments,fineRotation:0}});
  await engine.call('close');
  const old=await reference.call('open',{path,sessionId:`baseline-reference-${name}`});
  assert.equal(current.baselineVersion,old.baselineVersion);
  assert.equal(current.artProfile,old.artProfile,'Both cores must start from the same RAW baseline profile');
  assert.equal(composed.artProfile,old.artProfile,'Explicit zero must preserve the exact reference profile');
  assert.equal(value(old.artProfile,'Rotation','Enabled'),'false');
  await reference.call('close');
  const actual=join(out,name+'-zero.tiff'),expected=join(out,name+'-baseline-reference.tiff');
  writeFileSync(join(out,name+'-zero.arp'),composed.artProfile);
  writeFileSync(join(out,name+'-baseline-reference.arp'),old.artProfile);
  await engine.call('export',{path,artProfile:composed.artProfile,output:actual,format:'tiff',options});
  await reference.call('export',{path,artProfile:old.artProfile,output:expected,format:'tiff',options});
  const pixels=JSON.parse(execFileSync(python,['-c',String.raw`
import json,sys,hashlib,numpy as np,tifffile
images=[];profiles=[]
for path in sys.argv[1:]:
 with tifffile.TiffFile(path) as f:
  page=f.pages[0];assert page.bitspersample==16,page.bitspersample
  assert 34675 in page.tags,'Missing embedded ICC profile'
  icc=bytes(page.tags[34675].value);assert len(icc)>=128 and icc[36:40]==b'acsp','Invalid ICC header'
  profiles.append(icc);images.append(page.asarray())
a,b=images;assert a.dtype==b.dtype==np.uint16,(a.dtype,b.dtype)
assert a.shape==b.shape and max(a.shape[:2])==512,(a.shape,b.shape)
assert profiles[0]==profiles[1],'Embedded ICC profiles differ'
d=np.abs(a.astype(np.int32)-b.astype(np.int32))
print(json.dumps(dict(shape=list(a.shape),dtype=str(a.dtype),bits=16,iccBytes=len(profiles[0]),iccSHA256=hashlib.sha256(profiles[0]).hexdigest(),iccEqual=True,maximumDifference=int(d.max()),differentSamples=int(np.count_nonzero(d)))))
`,actual,expected],{encoding:'utf8'}));
  report.rawBaseline.push({name,path,sourceHash,sourceUnchanged:hash(path)===sourceHash,
   fineRotation:0,sameProfile:true,baselineVersion:current.baselineVersion,actual,expected,...pixels});
  assert.equal(pixels.differentSamples,0,`${name}: explicit zero changed baseline pixels`);
  assert.equal(hash(path),sourceHash,`${name}: source changed`);
  pass(`${name}: explicit zero equals old-core baseline TIFF16 pixels and embedded ICC at 512px`);
 }

 assert.equal(hash(source),report.sourceHash);report.sourceUnchanged=true;
 assert.equal(hash(referenceExecutable),report.binaryHashes.reference);
 assert.equal(hash(executable),report.binaryHashes.current,'Core changed during the run');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{
 for(const engine of clients){
  await engine.stop();
  writeFileSync(join(out,engine===clients[0]?'current.stderr.log':'reference.stderr.log'),engine.diagnostics);
 }
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('REPORT',join(out,'report.json'));
}
