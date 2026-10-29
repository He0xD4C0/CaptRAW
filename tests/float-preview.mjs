import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,symlinkSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join,basename,dirname} from 'node:path';
import {homedir} from 'node:os';
import {EngineClient} from './engine-client.mjs';
const out=resolve(process.env.CAPTRAW_FLOAT_PREVIEW_OUT||'artifacts/float-preview');mkdirSync(out,{recursive:true});const work=mkdtempSync(join(out,'run-'));
const checks=[],frames=[],comparisons=[],sources=[],pass=message=>{checks.push(message);console.log('PASS',message);},hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const python=resolve('build/qa-venv/bin/python'),sandbox=resolve('tests/offline-native.sb'),reference=join(work,'reference'),mac=join(reference,'Contents/MacOS');let engine,old,complete=false,revision=0;
const run=(command,args,extra={})=>execFileSync(command,args,{encoding:'utf8',maxBuffer:4*1024*1024,...extra});
const change=(profile,group,key,value)=>{const start=profile.indexOf('['+group+']'),end=profile.indexOf('\n[',start);assert(start>=0);const section=profile.slice(start,end<0?undefined:end),pattern=new RegExp('(^|\\n)'+key+'=[^\\n]*');assert(pattern.test(section),key);return profile.slice(0,start)+section.replace(pattern,(_match,prefix)=>prefix+key+'='+value)+(end<0?'':profile.slice(end));};
function binary(name){
 const path=join(mac,name);copyFileSync('build/native/'+name,path);
 for(const dependency of run('otool',['-L',path]).split('\n').slice(1).map(line=>line.trim().split(' (')[0]).filter(Boolean)){
  if(dependency.startsWith('/System/Library/')||dependency.startsWith('/usr/lib/'))continue;assert(existsSync(join(mac,'lib',basename(dependency))),dependency);run('install_name_tool',['-change',dependency,'@loader_path/lib/'+basename(dependency),path]);
 }
 for(const match of run('otool',['-l',path]).matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g))if(match[1].startsWith('/opt/')||match[1].startsWith('/Users/'))run('install_name_tool',['-delete_rpath',match[1],path]);run('codesign',['--force','--sign','-',path]);return path;
}
async function update(adjustments,profile='',linearPreview=true){const next=++revision,pending=engine.preview(next,'fit',120000);const result=await engine.call('update',{revision:next,adjustments,artProfile:profile,linearPreview});const frame=await pending;inspect(frame,linearPreview);return {...result,frame};}
async function detail(x,y,width=192,height=128){const pending=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,x,y,width,height});const frame=await pending;inspect(frame,true);return frame;}
function inspect(frame,linear){
 if(!linear){assert.equal(frame.linear,null);return;}
 const p=frame.linear;assert(p);assert.equal(p.width,frame.width);assert.equal(p.height,frame.height);assert.equal(p.rowBytes,frame.width*8);assert.equal(p.encoding,'rgba16float-le');assert.equal(p.colorSpace,'rec709-linear');assert.equal(readFileSync(p.file).length,frame.width*frame.height*8);
 frames.push({kind:frame.kind,revision:frame.revision,width:frame.width,height:frame.height,x:frame.x,y:frame.y,elapsedMs:frame.elapsedMs,sha256:hash(p.file)});
}
async function compare(frame,profile,source,name){
 let linear=change(profile,'Color Management','OutputProfile','RTv4_Linear_Rec709');linear=change(linear,'Color Management','OutputBPC','false');linear=change(linear,'Resize','Enabled','false');const arp=join(work,name+'.arp'),tiff=join(work,name+'.tif');writeFileSync(arp,linear);
 const crop=linear.slice(linear.indexOf('[Crop]'),linear.indexOf('\n[',linear.indexOf('[Crop]'))),offset=crop.includes('Enabled=true')?{x:Number(crop.match(/\nX=(\d+)/)[1]),y:Number(crop.match(/\nY=(\d+)/)[1])}:{x:0,y:0};
 try{run('/usr/bin/sandbox-exec',['-f',sandbox,join(mac,'captraw-art-reference'),'-a','-o',tiff,'-p',arp,'-t','-b32','-Y','-c',source],{env:{...process.env,OMP_NUM_THREADS:'8',ART_SETTINGS:join(reference,'settings'),ART_CACHE:join(reference,'cache')}});}
 catch(error){writeFileSync(join(work,name+'.log'),String(error.stdout||'')+String(error.stderr||''));throw error;}
 const stats=JSON.parse(run(python,['-c',`import tifffile,numpy as np,json,sys
path,raw=sys.argv[1:3];w,h,x,y=map(int,sys.argv[3:]);a=tifffile.imread(path);assert a.dtype==np.float32
reference=a[y:y+h,x:x+w];assert reference.shape==(h,w,3)
b=np.fromfile(raw,dtype='<f2').reshape(h,w,4);assert np.isfinite(b).all() and np.all(b[:,:,3]==1)
nearest=reference.astype(np.float16);expected=nearest.copy()
for direction,sign in [(np.inf,1),(-np.inf,-1)]:
 neighbor=np.nextafter(nearest,np.float16(direction));midpoint=(nearest.astype(np.float64)+neighbor.astype(np.float64))/2
 mask=(reference*sign>0)&(reference.astype(np.float64)==midpoint);expected[mask]=neighbor[mask]
assert np.array_equal(expected,b[:,:,:3]),int(np.count_nonzero(expected!=b[:,:,:3]))
delta=np.abs(reference.astype(np.float64)-b[:,:,:3].astype(np.float64));ulp=np.spacing(np.maximum(np.abs(reference),2**-14).astype(np.float16)).astype(np.float64)
print(json.dumps(dict(width=w,height=h,maximumDifference=float(delta.max()),maximumHalfULPs=float(np.max(delta/ulp)),overWhiteChannels=int(np.count_nonzero(b[:,:,:3]>1.001)),minimum=float(b[:,:,:3].min()),maximum=float(b[:,:,:3].max()),exactNearestHalfChannels=int(np.count_nonzero(nearest==b[:,:,:3])),matchesARTQuantization=True)))`,tiff,frame.linear.file,frame.width,frame.height,(frame.x||0)-offset.x,(frame.y||0)-offset.y]));
 comparisons.push({name,...stats});rmSync(tiff);rmSync(arp);console.log(name,JSON.stringify(stats));return stats;
}
try{
 mkdirSync(mac,{recursive:true});mkdirSync(join(reference,'settings'));symlinkSync(resolve('build/bundle/native/lib'),join(mac,'lib'));symlinkSync(resolve('build/bundle/native/resources'),join(reference,'Contents/Resources'));copyFileSync('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/data/options/options.osx',join(reference,'settings/options'));
 const executable=binary('captraw-engine');binary('captraw-art-reference');process.env.CAPTRAW_SANDBOX_PROFILE=sandbox;
 engine=new EngineClient({executable,resources:join(reference,'Contents/Resources'),cache:join(work,'core')});const previous=join(homedir(),'Applications/CaptRAW-0.63.app/Contents/Resources/native');old=new EngineClient({executable:join(previous,'captraw-engine'),resources:join(previous,'resources'),cache:join(work,'old')});
 for(const sample of (process.env.CAPTRAW_FLOAT_SAMPLES||'synthetic.dng,nikon-d850.NEF,canon-r5.CR3,fuji-xt4.RAF').split(',')){
  const source=resolve('build/samples',sample),before=hash(source),image=await engine.call('open',{path:source,sessionId:basename(sample)}),prior=await old.call('open',{path:source,sessionId:basename(sample)});
  const pending=old.preview(1,'fit',120000),oldResult=await old.call('update',{revision:1,adjustments:prior.adjustments});const oldFrame=await pending,baseline=await update(image.adjustments,'',false);assert.equal(baseline.artProfile,oldResult.artProfile);assert.equal(hash(baseline.frame.file),hash(oldFrame.file));
  const withFloat=await update(image.adjustments);assert.equal(withFloat.artProfile,baseline.artProfile);assert.equal(hash(withFloat.frame.file),hash(baseline.frame.file));assert.equal(hash(source),before);sources.push({sample,sha256:before,sourceUnchanged:true,sdrExact:true});
  pass(sample+': default and opt-in SDR pixels equal the installed 0.63 baseline');
  if(sample!=='synthetic.dng'&&!sample.endsWith('.NEF'))continue;
  const adjustments={...image.adjustments,exposure:3},composed=await engine.call('compose',{path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments}),profile=change(composed.artProfile,'ToneCurve','WhitePoint',8),hdr=await update(adjustments,profile);
  const x=sample==='synthetic.dng'?120:Math.floor(hdr.frame.fullWidth*.55),y=sample==='synthetic.dng'?100:Math.floor(hdr.frame.fullHeight*.2),roi=await detail(x,y);
  await compare(roi,hdr.artProfile,source,basename(sample)+'-detail');pass(sample+': cached HDR 1:1 float pixels exactly match independent ART Float32 rendering with its half quantization');
  if(sample==='synthetic.dng'){
   const local={...adjustments,rotation:90,crop:{x:.1,y:.1,width:.8,height:.8},masks:[{id:'local',name:'local',type:'radial',enabled:true,inverted:false,initialized:true,referenceAngle:0,feather:30,brightness:0,contrast:0,saturation:0,tone:{highlights:25,shadows:15,whites:10,blacks:0},points:[],start:{x:.2,y:.2},end:{x:.8,y:.8}}]};
   const changed=await update(local,profile),first=await detail(180,220);await compare(first,changed.artProfile,source,'cropped-local');const second=await detail(320,400);await compare(second,changed.artProfile,source,'cached-pan');pass('rotated crop, local-tone full context and cached pan publish matching float windows');
   await assert.rejects(engine.call('update',{revision:999,adjustments:local,linearPreview:'yes'}),/Invalid float preview request/);const unaffected=await detail(320,400);assert.equal(hash(unaffected.linear.file),hash(second.linear.file));assert.equal(unaffected.revision,revision);pass('invalid float-preview requests preserve the active revision and cached pixels');
   const count=readdirSync(join(work,'core')).filter(n=>n.endsWith('.rgba16f')).length;const disabled=await update(local,'',false);assert.equal(disabled.frame.linear,null);assert.equal(readdirSync(join(work,'core')).filter(n=>n.endsWith('.rgba16f')).length,count);pass('disabling float transport stops allocations and publishing without changing the recipe');
  }
  if(sample==='synthetic.dng'){
   const grading=structuredClone(image.adjustments.colorGrading);grading.global={hue:40,saturation:30,luminance:20};
   const managed=await update({...adjustments,hdrEnabled:true,hdrHeadroom:3,colorGrading:grading},baseline.artProfile),roi=await detail(120,100);await compare(roi,managed.artProfile,source,'managed-hdr-grading');pass('explicit HDR state and peak-relative grading persist through the complete ART profile into an independent Float32 render');
  }
  assert.equal(hash(source),before);
 }
 await engine.call('close');const reopened=await engine.call('open',{path:resolve('build/samples/synthetic.dng'),sessionId:'reopened'}),fresh=await update(reopened.adjustments,'',false);assert.equal(fresh.frame.linear,null);pass('close and reopen clear float mode and cached HDR state');
 const opaqueId='../相机 / RAW # % ?',opaque=await engine.call('open',{path:resolve('build/samples/synthetic.dng'),sessionId:opaqueId}),opaqueFrame=(await update(opaque.adjustments)).frame;assert.equal(opaqueFrame.sessionId,opaqueId);assert.equal(dirname(opaqueFrame.file),join(work,'core'));assert.equal(dirname(opaqueFrame.linear.file),join(work,'core'));pass('opaque session IDs preserve RPC identity while PNG and float files stay inside the private cache');complete=true;
}finally{
 if(engine)await engine.stop();if(old)await old.stop();writeFileSync(join(out,'report.json'),JSON.stringify({complete,checks,sources,frames,comparisons,engineSHA256:hash('build/native/captraw-engine'),nativeSandboxed:true,homebrewDenied:true,installedReference:'0.63',hdrFeatureAccepted:false,scope:'Development native cached float callbacks and desktop contract forwarding only; not integrated HDR controls or physical HDR display acceptance.',...(!complete?{work}:{})},null,2)+'\n');if(complete)rmSync(work,{recursive:true,force:true});else console.error('Failure workspace:',work);
}
