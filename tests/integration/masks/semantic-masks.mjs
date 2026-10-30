import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Segmenter} from '@captraw/desktop-core/editing';

const out=resolve(process.env.CAPTRAW_SEMANTIC_MASKS_OUT||'artifacts/semantic-masks');
const source=resolve(process.env.CAPTRAW_SEMANTIC_MASKS_IMAGE||'artifacts/person-parts-probe/grace-hopper.png');
const binary=resolve(process.env.CAPTRAW_SEGMENT||'build/segmentation/captraw-segment');
const models=resolve(process.env.CAPTRAW_SEMANTIC_MASKS_MODELS||'build/segmentation/models/small');
const python=resolve(process.env.CAPTRAW_SEGMENTATION_PYTHON||'build/segmentation/venv/bin/python');
const cache=join(out,'cache');
rmSync(cache,{recursive:true,force:true});
mkdirSync(out,{recursive:true});
assert(existsSync(source),'Provide a public semantic-mask PNG or set CAPTRAW_SEMANTIC_MASKS_IMAGE');
assert(existsSync(python),'Build the segmentation Python environment or set CAPTRAW_SEGMENTATION_PYTHON');

const bytes=readFileSync(source),sourceSHA256=createHash('sha256').update(bytes).digest('hex');
const [width,height]=execFileSync(python,['-c',`from PIL import Image\nim=Image.open(${JSON.stringify(source)});assert im.mode=="RGB";print(im.width,im.height)`],{encoding:'utf8'}).trim().split(' ').map(Number);
const checks=[],archived=[];
const pass=message=>{checks.push(message);console.log('PASS',message);};
const save=(result,rotation)=>{
  const saved=structuredClone(result);
  for(const item of saved.parts){
    const path=join(out,`${item.part}-${rotation}.png`);
    copyFileSync(item.file,path);
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),item.sha256);
    item.file=path;
  }
  archived.push({rotation,result:saved});
  return saved;
};
const segmenter=new Segmenter(binary,models,cache,()=>{});
try{
  const normal=await segmenter.requestSemanticMasks({sessionId:'portrait',revision:1,path:source,imageSha256:sourceSHA256,width,height,outputRotation:0});
  assert.equal(normal.modelId,'u2net-salient-fp32-r1');
  assert.equal(normal.maskWidth,width);
  assert.equal(normal.maskHeight,height);
  assert.deepEqual(normal.parts.map(item=>item.part),['subject','background']);
  assert.deepEqual(normal.parts.map(item=>item.classIndex),[0,1]);
  save(normal,0);
  pass('local Apache-2.0 U2-Net produces subject and background PNGs at the source dimensions');

  for(const rotation of [90,180,270]){
    const result=await segmenter.requestSemanticMasks({sessionId:'portrait',revision:rotation/90+1,path:source,imageSha256:sourceSHA256,width,height,outputRotation:rotation});
    const swapped=rotation===90||rotation===270;
    assert.equal(result.maskWidth,swapped?height:width);
    assert.equal(result.maskHeight,swapped?width:height);
    assert.equal(result.cached,true);
    assert.equal(result.inputMs,0);
    assert.equal(result.decodeMs,0);
    assert.deepEqual(result.parts.map(item=>item.part),['subject','background']);
    save(result,rotation);
  }
  pass('subject probabilities are reused across all coarse rotations without repeat inference');

  const pixels=JSON.parse(execFileSync(python,['-c',`
import json, numpy as np
from PIL import Image
data = json.loads(${JSON.stringify(JSON.stringify(archived))})
base = {p['part']: p for p in data[0]['result']['parts']}
base_pixels = {}
for part, item in base.items():
    with Image.open(item['file']) as image:
        assert image.mode == 'L'
        array = np.asarray(image)
    assert int(np.count_nonzero(array)) == item['pixels']
    base_pixels[part] = array

subject = base_pixels['subject']
background = base_pixels['background']
assert np.array_equal(background, 255 - subject)
assert len(np.unique(subject)) > 2

rows = []
for row in data:
    rotation = row['rotation']
    for item in row['result']['parts']:
        with Image.open(item['file']) as image:
            actual = np.asarray(image)
        expected = np.rot90(base_pixels[item['part']], rotation // 90)
        changed = int(np.count_nonzero(actual != expected))
        assert changed == 0, (rotation, item['part'], changed)
        assert int(np.count_nonzero(actual)) == item['pixels']
        rows.append({'rotation': rotation, 'part': item['part'], 'changedPixels': changed})
print(json.dumps({'uniqueSubjectValues': len(np.unique(subject)), 'rows': rows}))
`],{encoding:'utf8'}));
  assert.equal(pixels.rows.length,8);
  assert(pixels.rows.every(row=>row.changedPixels===0));
  pass('background is the exact grayscale complement of subject; every rotation matches np.rot90 exactly');

  await assert.rejects(segmenter.requestSemanticMasks({sessionId:'portrait',revision:4,path:source,imageSha256:sourceSHA256,width,height}),/版本必须递增/);
  await assert.rejects(segmenter.requestSemanticMasks({sessionId:'portrait',revision:5,path:source,imageSha256:'0'.repeat(64),width,height}),/checksum mismatch/);
  await assert.rejects(segmenter.requestSemanticMasks({sessionId:'portrait',revision:6,path:source,imageSHA256:sourceSHA256,width,height,outputRotation:45}),/输出旋转角度无效/);
  pass('revision, source checksum and rotation failures are explicit');

  assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),sourceSHA256);
  pass('the source image remains byte-for-byte unchanged');
  writeFileSync(join(out,'report.json'),JSON.stringify({checks,source,sourceSHA256,modelId:normal.modelId,dimensions:{width,height},archived,pixels},null,2)+'\n');
}finally{
  await segmenter.dispose();
}
