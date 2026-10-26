import {EngineClient} from './engine-client.mjs';
import {resolve,join} from 'node:path';
import {mkdirSync,cpSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=resolve('artifacts/mask-preview');mkdirSync(out,{recursive:true});
const engine=new EngineClient({cache:'build/mask-preview-cache'});engine.on('error',()=>{});const frames={};
try{
 const path=resolve('build/samples/synthetic.dng'),image=await engine.call('open',{path,sessionId:'mask-preview'});let revision=0;
 const shape=(id,start,end)=>({id,name:id,type:'radial',enabled:true,inverted:false,feather:35,points:[],start,end,operation:'add'});
 const a=shape('a',{x:.15,y:.2},{x:.6,y:.75}),b=shape('b',{x:.4,y:.3},{x:.85,y:.7});
 const group={...a,id:'group',brightness:1,contrast:0,saturation:0,components:[a]};
 async function render(name,masks,extra={},maskId='group'){
  const pending=engine.preview(++revision);const result=await engine.call('update',{revision,adjustments:{...image.adjustments,masks,...extra},maskId});const frame=await pending;
  cpSync(frame.file,join(out,name+'.png'));if(frame.mask)cpSync(frame.mask.file,join(out,name+'-coverage.png'));frames[name]=frame;return result.artProfile;
 }
 await render('baseline',[]);assert(!frames.baseline.mask);
 await render('a',[group]);await render('b',[{...group,components:[b]}]);
 for(const operation of ['add','subtract','intersect'])await render(operation,[{...group,components:[a,{...b,operation}]}]);
 const profile=await render('inverted',[{...group,inverted:true,components:[a,{...b,operation:'subtract'}]}]);
 writeFileSync(join(out,'overlay-on.arp'),profile);
 await engine.call('export',{path,artProfile:profile,output:join(out,'overlay-on.tiff'),format:'tiff'});
 const offProfile=await render('off',[{...group,inverted:true,components:[a,{...b,operation:'subtract'}]}],{},'');assert(!frames.off.mask);
 await engine.call('export',{path,artProfile:offProfile,output:join(out,'overlay-off.tiff'),format:'tiff'});
 assert.equal(profile,offProfile,'View-only overlay must not modify the processing profile');
 await render('rotated',[group],{rotation:90});
 await render('crop',[group],{crop:{x:.1,y:.1,width:.75,height:.75}});
 const detail=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:200,y:180,width:256,height:256});frames.detail=await detail;assert(frames.detail.mask);cpSync(frames.detail.mask.file,join(out,'detail-coverage.png'));
 await render('hard',[{...group,components:[{...a,feather:0}]}]);
 const hardDetail=engine.preview(revision,'detail');await engine.call('viewport',{revision,x:200,y:180,width:256,height:256});frames.hardDetail=await hardDetail;cpSync(frames.hardDetail.mask.file,join(out,'hardDetail-coverage.png'));
 await render('hidden',[{...group,enabled:false}]);assert(!frames.hidden.mask);
 await render('empty',[{...group,components:[]}]);assert(!frames.empty.mask);
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:process.env.CAPTRAW_ENGINE||'development native',offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,exportUnchanged:true,frames},null,2)+'\n');console.log('Exact engine mask coverage captured, selection clear and export isolation passed');
}finally{await engine.stop();}
