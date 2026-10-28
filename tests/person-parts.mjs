import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Segmenter} from '@captraw/desktop-core/segmentation';

const out=resolve(process.env.CAPTRAW_PERSON_PARTS_OUT||'artifacts/person-parts');
const source=resolve(process.env.CAPTRAW_PERSON_PARTS_IMAGE||'artifacts/person-parts-probe/grace-hopper.png');
const binary=resolve(process.env.CAPTRAW_SEGMENT||'build/segmentation/captraw-segment');
const models=resolve(process.env.CAPTRAW_PERSON_PARTS_MODELS||'build/segmentation/models/small');
const cache=join(out,'cache');
rmSync(cache,{recursive:true,force:true});mkdirSync(out,{recursive:true});
assert(existsSync(source),'Provide a public portrait PNG or set CAPTRAW_PERSON_PARTS_IMAGE');
const bytes=readFileSync(source),sha256=createHash('sha256').update(bytes).digest('hex');
const [width,height]=execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image\nim=Image.open(${JSON.stringify(source)});assert im.mode=="RGB";print(im.width,im.height)`],{encoding:'utf8'}).trim().split(' ').map(Number);
const checks=[],pass=message=>{checks.push(message);console.log('PASS',message);};
const segmenter=new Segmenter(binary,models,cache,()=>{});
try{
 const normal=await segmenter.requestParts({sessionId:'portrait',revision:1,path:source,imageSha256:sha256,width,height,outputRotation:0});
 assert.equal(normal.modelId,'mediapipe-selfie-multiclass-fp32-r1');
 assert.equal(normal.maskWidth,width);assert.equal(normal.maskHeight,height);assert.equal(normal.parts.length,5);
 assert.deepEqual(normal.parts.map(item=>item.part),['hair','bodySkin','faceSkin','clothes','accessories']);
 assert(normal.parts.filter(item=>item.pixels>0).length>=4);
 execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image\nimport json\nr=json.loads(${JSON.stringify(JSON.stringify(normal))})\nfor p in r['parts']:\n im=Image.open(p['file']);assert im.mode=='L';assert im.size==(${width},${height});assert im.getextrema()[0]>=0`]);
 pass('real portrait produces five correctly sized person-part masks from the local Apache-2.0 model');
 const rotated=await segmenter.requestParts({sessionId:'portrait',revision:2,path:source,imageSha256:sha256,width,height,outputRotation:90});
 assert.equal(rotated.maskWidth,height);assert.equal(rotated.maskHeight,width);
 execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image\nimport json\nr=json.loads(${JSON.stringify(JSON.stringify(rotated))})\nfor p in r['parts']:\n im=Image.open(p['file']);assert im.mode=='L';assert im.size==(${height},${width})`]);
 pass('person parts honor the existing coarse-rotation mask convention');
 await assert.rejects(segmenter.requestParts({sessionId:'portrait',revision:2,path:source,imageSha256:sha256,width,height}),/版本必须递增/);
 await assert.rejects(segmenter.requestParts({sessionId:'portrait',revision:3,path:source,imageSha256:'0'.repeat(64),width,height}),/checksum mismatch/);
 assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),sha256);
 pass('revision and source hash failures are explicit and the source remains unchanged');
 writeFileSync(join(out,'report.json'),JSON.stringify({checks,source,sourceSHA256:sha256,modelId:normal.modelId,dimensions:{width,height},parts:normal.parts},null,2)+'\n');
}finally{await segmenter.dispose();}
