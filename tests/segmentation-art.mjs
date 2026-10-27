import {EngineClient} from './engine-client.mjs';
import {resolve,join} from 'node:path';import {homedir} from 'node:os';import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
// Probe only: exercise ART's existing external-mask fields, without advertising a desktop feature.
const out=resolve('artifacts/segmentation/art');mkdirSync(out,{recursive:true});const native=join(homedir(),'Applications/CaptRAW-0.25.app/Contents/Resources/native');
const engine=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(out,'cache')});let revision=0;const results=[],hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function external(arp,path,inverted=false){return arp.replace(/(\[ColorCorrection\]\n)([^\[]*)/,(_,head,body)=>{assert(body.includes('ExternalMaskEnabled_1=false'));return head+body.replace('ExternalMaskEnabled_1=false','ExternalMaskEnabled_1=true').replace('ExternalMaskFilename_1=','ExternalMaskFilename_1='+pathToFileURL(path).href).replace('ExternalMaskInverted_1=false','ExternalMaskInverted_1='+inverted);});}
const prepare=process.argv.includes('--prepare-inputs');
try{
 if(prepare){
  mkdirSync(resolve('artifacts/segmentation/inputs'),{recursive:true});
  for(const name of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
   const path=resolve('build/samples',name),before=hash(path),image=await engine.call('open',{path,sessionId:name});
   const wait=engine.preview(++revision);const p=await engine.call('update',{revision,adjustments:image.adjustments});await wait;
   const output=resolve('artifacts/segmentation/inputs',name+'.jpg');await engine.call('export',{path,artProfile:p.artProfile,output,format:'jpeg',colorSpace:'srgb',options:{size:{mode:'long-edge',width:1536,height:1536,dontEnlarge:true},sharpen:{enabled:false,amount:80,radius:.5}}});
   assert.equal(hash(path),before);writeFileSync(output+'.json',JSON.stringify({source:path,artProfile:p.artProfile,width:image.width,height:image.height},null,2));results.push({source:path,sourceSHA256:before,output,outputSHA256:hash(output)});
  }
 }else for(const [source,maskName] of [['canon-r5.CR3','apple'],['fuji-xt4.RAF','chart-box'],['nikon-d850.NEF','sky']]){
  const path=resolve('artifacts/segmentation/inputs',source+'.jpg'),image=await engine.call('open',{path,sessionId:source}),checksum=hash(path),mask=resolve('artifacts/segmentation/tiny',maskName+'-mask.png');
  const baseWait=engine.preview(++revision),baseline=await engine.call('update',{revision,adjustments:image.adjustments});await baseWait;
  const a={...image.adjustments,masks:[{id:'object',name:'分割探针',type:'luminance',luminanceRange:[0,0,100,100],enabled:true,inverted:false,feather:0,brightness:.75,contrast:0,saturation:0,start:{x:0,y:0},end:{x:1,y:1},points:[]}]};
  const wait=engine.preview(++revision),full=await engine.call('update',{revision,adjustments:a});await wait;
  const profiles={base:baseline.artProfile,full:full.artProfile,selected:external(full.artProfile,mask),inverted:external(full.artProfile,mask,true),missing:external(full.artProfile,join(out,'missing.png'))};
  for(const [name,artProfile] of Object.entries(profiles)){
   const output=join(out,maskName+'-'+name+'.tiff');await engine.call('export',{path,artProfile,format:'tiff',output,colorSpace:'srgb'});writeFileSync(join(out,maskName+'-'+name+'.arp'),artProfile);
  }
  // A separately started installed core must reopen and render the same ARP + mask file.
  const fresh=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(out,'fresh')});try{await fresh.call('export',{path,artProfile:profiles.selected,format:'tiff',output:join(out,maskName+'-reopened.tiff'),colorSpace:'srgb'});}finally{await fresh.stop();}
  assert.equal(hash(path),checksum);results.push({source,path,inputSHA256:checksum,mask,maskSHA256:hash(mask),name:maskName,width:image.width,height:image.height});console.log('PROBED',source,maskName);
 }
}finally{writeFileSync(join(out,prepare?'input-preparation.json':'report.json'),JSON.stringify({runtime:native,offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,results,limitations:['Diagnostic only; external assets are not yet a portable CaptRAW recipe feature','Missing external masks currently fail open upstream; this probe records the defect, not a product pass']},null,2)+'\n');await engine.stop();}
