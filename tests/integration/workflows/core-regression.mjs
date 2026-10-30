import { EngineClient } from '../../support/engine-client.mjs';
import { resolve } from 'node:path';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
mkdirSync('artifacts/regression',{recursive:true});
const engine=new EngineClient({cache:'build/regression-cache'});
engine.on('error',x=>console.error('native',x));
const source=resolve('build/samples/synthetic.dng');
const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
const original=digest();await engine.ready;
const sidecars=[source+'.xmp',source+'.arp'];
for(const path of sidecars)writeFileSync(path,'CaptRAW preservation regression sentinel\n');
const image=await engine.call('open',{path:source,sessionId:'regression'});
const base=image.adjustments;let revision=0;const results=[];
async function render(name,adjustments){
 const pending=engine.preview(++revision);const result=await engine.call('update',{revision,adjustments});
 const frame=await pending;const output=resolve(`artifacts/regression/${name}.tiff`);
 await engine.call('export',{path:source,artProfile:result.artProfile,output,format:'tiff'});
 results.push({name,frame,output});return result;
}
try{
 await render('baseline',base);
 await render('exposure',{...base,exposure:1});
 const mask={id:'a',name:'Test',type:'radial',enabled:true,inverted:false,feather:0,brightness:1,contrast:0,saturation:0,points:[],start:{x:.2,y:.2},end:{x:.5,y:.7}};
 await render('radial',{...base,masks:[mask]});
 await render('disabled',{...base,masks:[{...mask,enabled:false}]});
 await render('inverted',{...base,masks:[{...mask,inverted:true}]});
 await render('rotated',{...base,rotation:90,masks:[mask]});
 await render('linear',{...base,masks:[{...mask,type:'linear',start:{x:.2,y:.5},end:{x:.8,y:.5}}]});
 await render('brush',{...base,masks:[{...mask,type:'brush',points:[{x:.35,y:.4,radius:.5,erase:false}]}]});
 await render('erased',{...base,masks:[{...mask,type:'brush',points:[{x:.35,y:.4,radius:.5,erase:false},{x:.35,y:.4,radius:.5,erase:true}]}]});
 await render('crop',{...base,rotation:90,crop:{x:.2,y:.2,width:.5,height:.4}});
 await render('restored',base);
 await assert.rejects(engine.call('update',{revision:++revision,adjustments:{...base,exposure:Infinity}}));
 assert.equal(digest(),original);
 for(const path of sidecars)assert.equal(readFileSync(path,'utf8'),'CaptRAW preservation regression sentinel\n');
 await assert.rejects(engine.call('open',{path:resolve('build/samples/unsupported-compression.dng'),sessionId:'unsupported'}));
 writeFileSync('artifacts/regression/results.json',JSON.stringify(results,null,2));
 console.log('Native regression exports complete',results.length);
}finally{await engine.stop();}
