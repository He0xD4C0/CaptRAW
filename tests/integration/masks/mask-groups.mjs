import {EngineClient} from '../../support/engine-client.mjs';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=resolve('artifacts/mask-groups');mkdirSync(out,{recursive:true});const path=resolve('build/samples/synthetic.dng');
const engine=new EngineClient({cache:'build/mask-group-cache'});engine.on('error',()=>{});const results=[];
try{
 const image=await engine.call('open',{path,sessionId:'groups'});let revision=0;
 const shape=(id,start,end,operation='add')=>({id,name:id,type:'radial',enabled:true,inverted:false,feather:0,points:[],start,end,operation});
 const first=shape('A',{x:.15,y:.2},{x:.55,y:.7}),second=shape('B',{x:.4,y:.2},{x:.8,y:.7});
 const group={...first,id:'group',name:'Group',brightness:1,contrast:0,saturation:0,components:[first,second]};
 const render=async(name,masks)=>{const pending=engine.preview(++revision);const {artProfile}=await engine.call('update',{revision,adjustments:{...image.adjustments,masks}});await pending;await engine.call('export',{path,artProfile,output:resolve(out,name+'.tiff'),format:'tiff'});writeFileSync(resolve(out,name+'.arp'),artProfile);results.push(name);return artProfile;};
 await render('baseline',[]);
 for(const operation of ['add','subtract','intersect']){
  const profile=await render(operation,[{...group,components:[first,{...second,operation}]}]);assert(profile.includes('CaptRAWComponentCount'));
  if(operation==='intersect'){
   const exporter=new EngineClient({cache:'build/mask-group-export-cache'});
   try{await exporter.call('export',{path,artProfile:profile,output:resolve(out,'reloaded.tiff'),format:'tiff'});}finally{await exporter.stop();}
  }
 }
 await render('hidden-child',[{...group,components:[first,{...second,enabled:false}]}]);
 await render('inverted',[{...group,inverted:true,components:[first,{...second,operation:'intersect'}]}]);
 writeFileSync(resolve(out,'report.json'),JSON.stringify({results},null,2)+'\n');console.log('Group native exports passed',results);
}finally{await engine.stop();}
