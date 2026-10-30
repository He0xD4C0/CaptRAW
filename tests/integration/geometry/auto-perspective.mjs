import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
const root=resolve(process.env.CAPTRAW_AUTO_PERSPECTIVE_OUT||'artifacts/auto-perspective');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const executable=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const core=new EngineClient({executable,resources,cache:join(out,'cache')}),old=resolve('/Users/he0xd4c0/Applications/CaptRAW-0.52.app/Contents/Resources/native'),reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference-cache')});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),checks=[],rows=[],errors=[];let failure,revision=0;
core.on('error',e=>errors.push(e));reference.on('error',e=>errors.push(e));
const pass=s=>{checks.push(s);console.log('PASS',s);};
const python=resolve('build/qa-venv/bin/python');
execFileSync(python,['-c',String.raw`
from PIL import Image,ImageDraw
import sys,numpy as np
from pathlib import Path
p=Path(sys.argv[1]);a=Image.new('RGB',(1000,800),(100,100,100));d=ImageDraw.Draw(a)
for x in range(50,1000,100):
 for y in range(50,800,100):d.rectangle((x,y,x+60,y+65),fill=(220,220,220),outline=(30,30,30),width=5)
for y in (235,565):d.line((100,y,900,y),fill=(240,20,20),width=6)
for x in (265,735):d.line((x,80,x,720),fill=(20,210,240),width=6)
for angle in (-6,6):a.rotate(angle,resample=Image.Resampling.BICUBIC,fillcolor=(100,100,100)).save(p/('tilt'+str(angle)+'.png'))
dst=[(80,40),(920,90),(980,750),(20,790)];src=[(0,0),(1000,0),(1000,800),(0,800)];m=[];b=[]
for (x,y),(u,v) in zip(dst,src):m.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
a.transform(a.size,Image.Transform.PERSPECTIVE,np.linalg.solve(m,b),resample=Image.Resampling.BICUBIC,fillcolor=(100,100,100)).save(p/'keystone.png')
Image.new('RGB',a.size,(100,100,100)).save(p/'blank.png')
`,out]);
function slopes(path){return JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,sys,json,math
a=np.array(Image.open(sys.argv[1])).astype(float);h,w=a.shape[:2];ys,xs=np.mgrid[:h,:w];result=[]
for mode in range(2):
 weight=(a[:,:,0]-np.maximum(a[:,:,1],a[:,:,2])) if mode==0 else (np.minimum(a[:,:,1],a[:,:,2])-a[:,:,0]);angles=[]
 for side in range(2):
  split=ys<h/2 if mode==0 else xs<w/2;mask=(weight>80)&(split if side==0 else ~split);y,x=np.where(mask);assert len(x)>100
  xy=np.stack([x,y]);v=np.linalg.eigh(np.cov(xy))[1][:,-1];angle=math.degrees(math.atan2(v[1],v[0]));angle=(angle+90)%180-90
  angles.append(abs(angle) if mode==0 else 90-abs(angle))
 result.append(max(angles))
print(json.dumps(result))
`,path],{encoding:'utf8'}));}
async function render(adjustments,artProfile){const pending=core.preview(++revision);const result=await core.call('update',{revision,adjustments,artProfile});return {...result,frame:await pending};}
try{
 for(const name of ['tilt-6','tilt6','keystone']){
  const path=join(out,name+'.png'),sourceHash=hash(path),sessionId=name,im=await core.call('open',{path,sessionId});
  for(const direction of ['horizontal','vertical','both']){
   const before=await render(im.adjustments,im.artProfile),oldProfile=await core.call('save');
   const started=Date.now(),result=await core.call('autoPerspective',{sessionId,revision,direction}),elapsedMs=Date.now()-started;
   assert.deepEqual(await core.call('save'),oldProfile,'Analysis must never edit the active document');
   assert.deepEqual(await core.call('autoPerspective',{sessionId,revision,direction}),result,'Repeated detection must be deterministic');
   const corrected=await render({...im.adjustments,perspective:result},im.artProfile),beforeAngles=slopes(before.frame.file),afterAngles=slopes(corrected.frame.file);
   for(const axis of direction==='both'?[0,1]:[direction==='horizontal'?0:1])assert(afterAngles[axis]<.25,JSON.stringify({name,direction,beforeAngles,afterAngles,result}));
   rows.push({name,direction,elapsedMs,beforeAngles,afterAngles,result});
   if(direction==='both'){
    for(const [e,file] of [[core,'current'],[reference,'reference']])await e.call('export',{path,artProfile:corrected.artProfile,format:'tiff',output:join(out,file+'.tiff')});
    execFileSync(python,['-c',`import numpy as np,tifffile,sys\na,b=[tifffile.imread(p) for p in sys.argv[1:]]\nassert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)\nwith tifffile.TiffFile(sys.argv[1]) as x,tifffile.TiffFile(sys.argv[2]) as y:assert x.pages[0].tags[34675].value==y.pages[0].tags[34675].value`,join(out,'current.tiff'),join(out,'reference.tiff')]);
   }
  }
  assert.equal(hash(path),sourceHash);
 }
 pass('9 signed tilt/keystone and directional cases straighten independently measured pixel lines within 0.25 degrees; analysis is deterministic and read-only');
 pass('three solved transforms export TIFF16 and ICC identical to independent installed 0.52 rendering');
 const blank=await core.call('open',{path:join(out,'blank.png'),sessionId:'blank'}),a={...blank.adjustments,perspective:{...blank.adjustments.perspective,enabled:true,angle:3,horizontal:12}};await render(a,blank.artProfile);const saved=await core.call('save');
 for(const direction of ['horizontal','vertical','both'])await assert.rejects(core.call('autoPerspective',{sessionId:'blank',revision,direction}),/未找到足够可靠/);
 for(const request of [{sessionId:'wrong',revision,direction:'both'},{sessionId:'blank',revision:revision-1,direction:'both'},{sessionId:'blank',revision,direction:'invalid'}])await assert.rejects(core.call('autoPerspective',request));
 assert.deepEqual(await core.call('save'),saved);pass('no-lines and invalid/stale requests reject without changing existing nonzero perspective');
 assert.deepEqual(errors,[]);
}catch(e){failure=e.stack;throw e;}finally{await core.stop();await reference.stop();for(const name of ['cache','reference-cache'])rmSync(join(out,name),{recursive:true,force:true});writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,executable,resources,binarySHA256:hash(executable),checks,rows,errors,failure},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
