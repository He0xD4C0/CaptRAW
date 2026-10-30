// Measure default composition against fixed, independently supplied ACR sizes.
// A matching processing canvas alone is not a passing composition result.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
const root=await mkdtemp(join(tmpdir(),'captraw-source-frame-framing-'));
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),python=resolve('build/qa-venv/bin/python');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),engineSHA=sha(await readFile(binary));
const cases=[['nikon-d850.NEF',8256,5504],['canon-r5.CR3',8192,5464],['fuji-xt4.RAF',6240,4160]],rows=[];
let core,completed=false;
try{
 core=new EngineClient({cache:join(root,'core'),executable:binary});
 for(const [name,gw,gh] of cases){
  const path=resolve('build/samples',name),sourceSHA=sha(await readFile(path));
  const image=await core.call('open',{path,sessionId:name,sourceFramePolicy:'active-area-v1'});
  const {artProfile}=await core.call('compose',{path,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:image.adjustments});
  const file=join(root,name+'.tiff');
  await core.call('export',{path,artProfile,output:file,format:'tiff',colorSpace:'srgb',options:{size:{mode:'original',width:gw,height:gh,dontEnlarge:true},sharpen:{enabled:false,amount:80,radius:.5}}});
  const dimensions=JSON.parse(execFileSync(python,['-c',"import tifffile,sys,json;f=tifffile.TiffFile(sys.argv[1]);p=f.pages[0];print(json.dumps([p.imagewidth,p.imagelength]));f.close()",file],{encoding:'utf8'}));
  assert.equal(sha(await readFile(path)),sourceSHA,'source bytes preserved');
  rows.push({name,image:{width:image.width,height:image.height},sourceFrame:image.sourceFrame,cameraCrop:image.cameraCrop,
   output:{width:dimensions[0],height:dimensions[1]},acrGolden:{width:gw,height:gh},
   delta:{width:dimensions[0]-gw,height:dimensions[1]-gh},matchesGolden:dimensions[0]===gw&&dimensions[1]===gh});
  assert.deepEqual(dimensions,[gw,gh],name+' actual default TIFF must match the fixed ACR dimensions');
  await rm(file);await core.call('close');
 }
 assert.equal(sha(await readFile(binary)),engineSHA,'frozen executable');
 completed=true;console.log(JSON.stringify({engineSHA,rows,scope:'Dimensions measured from actual original-size TIFF outputs; this does not assert ACR pixel or color equivalence.'},null,2));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({engineSHA,rows,error:String(error.stack||error),diagnostics:core?.diagnostics},null,2));throw error;}
finally{await core?.stop();if(completed)await rm(root,{recursive:true,force:true});else console.error('Retained framing failure:',root);}
