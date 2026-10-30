import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EngineClient} from '../../support/engine-client.mjs';
const out=resolve(process.env.CAPTRAW_WIDE_DETAIL_OUT||'artifacts/wide-detail');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:join(out,'core')}),exporter=new EngineClient({cache:join(out,'export')}),cases=[],sources={},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let revision=0;
async function check(name,image,change,requested,luminance=false){
 const a={...image.adjustments,...change},rot=a.rotation%360,W=rot%180?image.height:image.width,H=rot%180?image.width:image.height;
 const x=Math.min(requested.x,W-1),y=Math.min(requested.y,H-1),width=Math.min(requested.width,W-x),height=Math.min(requested.height,H-y);
 const q={x:x/W,y:y/H,width:width/W,height:height/H};
 const fullReference=!!a.masks[0]?.tone;
 a.crop=fullReference?null:rot===90?{x:q.y,y:1-q.x-q.width,width:q.height,height:q.width}:q;
 let pending=engine.preview(++revision);const {artProfile}=await engine.call('update',{revision,adjustments:a,maskId:a.masks[0]?.id,luminance});await pending;
 pending=engine.preview(revision,'detail',120000);await engine.call('viewport',{revision,...requested});const frame=await pending;
 assert.deepEqual([frame.x,frame.y,frame.width,frame.height],[x,y,width,height]);copyFileSync(frame.file,join(out,name+'.png'));
 if(a.masks.length){assert.deepEqual([frame.mask.x,frame.mask.y,frame.mask.width,frame.mask.height],[x,y,width,height]);copyFileSync(frame.mask.file,join(out,name+'-mask.png'));}
 if(luminance){assert.deepEqual([frame.luminance.x,frame.luminance.y,frame.luminance.width,frame.luminance.height],[x,y,width,height]);copyFileSync(frame.luminance.file,join(out,name+'-luminance.png'));}
 await exporter.call('export',{path:image.path,artProfile,output:join(out,name+'.tiff'),format:'tiff'});
 cases.push({name,source:image.path,requested,actual:{x,y,width,height},fullReference,mask:!!frame.mask,luminance:!!frame.luminance,detailMs:frame.elapsedMs});console.log('PASS',name,width,height);
}
try{
 for(const name of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const path=resolve('build/samples',name);sources[path]=hash(path);const image=await engine.call('open',{path,sessionId:name});
  await check(name,image,{}, {x:1500,y:900,width:3001,height:2107});
  if(name==='nikon-d850.NEF'){
   await check('rotated',image,{rotation:90},{x:700,y:1000,width:3001,height:2503});
   const mask={id:'wide',name:'wide',type:'linear',enabled:true,inverted:false,feather:20,points:[],start:{x:.1,y:.15},end:{x:.85,y:.9},brightness:.25,contrast:0,saturation:0,tone:{highlights:25,shadows:0,whites:0,blacks:0}};
   await check('full-context-mask',image,{masks:[mask]},{x:900,y:1100,width:3101,height:2207},true);
   await check('right-bottom',image,{}, {x:image.width-2201,y:image.height-2103,width:3500,height:3000});
  }
 }
 for(const [path,before] of Object.entries(sources))assert.equal(hash(path),before);
 execFileSync('build/qa-venv/bin/python',['-c',`from pathlib import Path
from PIL import Image
import tifffile,numpy as np,json,sys
p=Path(sys.argv[1]);cases=json.loads(sys.argv[2]);results=[]
for c in cases:
 a=np.array(Image.open(p/(c['name']+'.png')));b=tifffile.imread(p/(c['name']+'.tiff'));assert b.dtype==np.uint16
 if c['fullReference']:
  r=c['actual'];b=b[r['y']:r['y']+r['height'],r['x']:r['x']+r['width']]
 assert a.shape==b.shape,c['name']
 delta=np.abs(a.astype(float)-np.rint(b.astype(float)/257));r={'name':c['name'],'shape':list(a.shape),'maximumDifference':float(delta.max()),'differentSamples':int(np.count_nonzero(delta))};results.append(r);assert r['maximumDifference']==0,r
 for kind in ['mask','luminance']:
  if c[kind]:assert Image.open(p/(c['name']+'-'+kind+'.png')).size==(c['actual']['width'],c['actual']['height'])
(p/'pixels.json').write_text(json.dumps(results,indent=2))
`,out,JSON.stringify(cases)]);
}finally{await engine.stop();await exporter.stop();writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development',offline:!!process.env.CAPTRAW_SANDBOX_PROFILE,cases,sources},null,2)+'\n');}
