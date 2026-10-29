// Existing real-camera appearance, including pre-decoderModel active snapshots.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../tests/engine-client.mjs';
const capture=process.argv.includes('--capture'),directory=process.argv.find(a=>a.startsWith('--directory='))?.slice(12);
const root=directory?resolve(directory):capture?await mkdtemp(join(tmpdir(),'captraw-camera-frame-legacy-')):undefined;assert(root);await mkdir(root,{recursive:true});
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),python=resolve('build/qa-venv/bin/python');
const sha=b=>createHash('sha256').update(b).digest('hex'),engineSHA=sha(await readFile(binary));
const pixels=file=>JSON.parse(execFileSync(python,['-c',"import tifffile,hashlib,sys,json;a=tifffile.imread(sys.argv[1]);print(json.dumps({'shape':list(a.shape),'dtype':str(a.dtype),'sha256':hashlib.sha256(a.tobytes()).hexdigest()}))",file],{encoding:'utf8'}));
let core,ok=false;const rows=[];
try{
 const prior=capture?undefined:JSON.parse(await readFile(join(root,'baseline.json'),'utf8'));
 if(capture)assert.equal(engineSHA,'8d030e754508373c4dd7e520e33b249ac32953e1eda536bc2d12de0896a15436');else assert.notEqual(engineSHA,prior.engineSHA);
 core=new EngineClient({cache:join(root,capture?'capture':'verify'),executable:binary});
 for(const row of prior?.rows||['canon-r5.CR3','fuji-xt4.RAF'].flatMap(name=>['legacy','prior-active'].map(mode=>({name,mode})))){
  const path=resolve('build/samples',row.name),sourceSHA=sha(await readFile(path));if(!capture)assert.equal(sourceSHA,row.sourceSHA);
  const image=await core.call('open',{path,sessionId:row.name+row.mode,...(capture?row.mode==='prior-active'?{sourceFramePolicy:'active-area-v1'}:{}:{artProfile:row.artProfile,sourceFrame:row.sourceFrame})});
  if(capture)assert.equal(image.sourceFrame.decoderModel,undefined);else assert.deepEqual(image.sourceFrame,row.sourceFrame);
  const profile=capture?image.artProfile:row.artProfile,settings=capture?image.adjustments:row.adjustments;
  const composed=await core.call('compose',{path,width:image.width,height:image.height,artProfile:profile,adjustments:settings});
  const file=join(root,row.name+'-'+row.mode+'.tiff');
  await core.call('export',{path,artProfile:composed.artProfile,output:file,format:'tiff',colorSpace:'srgb',options:{size:{mode:'long-edge',width:512,height:512,dontEnlarge:true},sharpen:{enabled:false,amount:80,radius:.5}}});
  const output=pixels(file);
  if(capture)rows.push({...row,sourceSHA,sourceFrame:image.sourceFrame,cameraCrop:image.cameraCrop,width:image.width,height:image.height,artProfile:profile,adjustments:settings,output});
  else{assert.deepEqual([image.width,image.height,image.cameraCrop],[row.width,row.height,row.cameraCrop]);assert.deepEqual(output,row.output,row.name+' '+row.mode+' all TIFF16 pixel bytes');await rm(file);}
  assert.equal(sha(await readFile(path)),sourceSHA);await core.call('close');
 }
 if(capture)await writeFile(join(root,'baseline.json'),JSON.stringify({engineSHA,rows},null,2));
 assert.equal(sha(await readFile(binary)),engineSHA);ok=true;console.log(JSON.stringify({directory:root,engineSHA,captured:capture,rows:capture?rows.map(({name,mode,width,height,cameraCrop,output})=>({name,mode,width,height,cameraCrop,output})):prior.rows.length},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({engineSHA,rows,error:String(error.stack||error),diagnostics:core?.diagnostics},null,2));throw error;}
finally{await core?.stop();if(ok)await rm(join(root,capture?'capture':'verify'),{recursive:true,force:true});else console.error('Retained camera legacy failure:',root);}
