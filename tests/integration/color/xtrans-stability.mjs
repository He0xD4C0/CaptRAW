import {EngineClient} from '../../support/engine-client.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('artifacts/xtrans-stability');mkdirSync(out,{recursive:true});const source=resolve('build/samples/fuji-xt4.RAF'),profile=readFileSync('artifacts/native-acceptance/X-T4.arp','utf8');const runs=[];
for(const threads of [1,2,8]){
 const engine=new EngineClient({cache:`build/xtrans-stable-${threads}`,env:{OMP_NUM_THREADS:String(threads),MallocPreScribble:'1',MallocScribble:'1'}});engine.on('error',()=>{});
 try{await engine.call('export',{path:source,artProfile:profile,output:join(out,`threads-${threads}.tiff`),format:'tiff'});runs.push({threads,heapScribble:true});}finally{await engine.stop();}
}
for(let i=0;i<2;i++)execFileSync(resolve('build/reference/Contents/MacOS/captraw-art-reference'),['-o',join(out,`cli-${i}.tif`),'-p',resolve('artifacts/native-acceptance/X-T4.arp'),'-t','-b16','-Y','-c',source],{env:{...process.env,ART_SETTINGS:resolve('build/reference/settings'),ART_CACHE:resolve('build/reference/cache')},stdio:['ignore','pipe','pipe']});
writeFileSync(join(out,'runs.json'),JSON.stringify({runs,independentCLIRuns:2,source:'fuji-xt4.RAF',sourceSHA256:JSON.parse(readFileSync('tests/fixtures/fixtures.json','utf8')).find(x=>x.name==='fuji-xt4.RAF').sha256},null,2)+'\n');console.log('X-Trans repeated worker, thread-count and CLI exports completed');
