import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Segmenter} from '@captraw/desktop-core/segmentation';

const out=resolve(process.env.CAPTRAW_SKY_MASK_OUT||'artifacts/sky-mask');
const source=resolve(process.env.CAPTRAW_SKY_MASK_IMAGE||'artifacts/segmentation-input/inputs/nikon-d850.NEF.png');
const manual=resolve(process.env.CAPTRAW_SKY_MASK_REFERENCE||'artifacts/segmentation-input/small-engine-sky.png');
const noSky=resolve(process.env.CAPTRAW_SKY_MASK_NEGATIVE||'artifacts/person-parts-probe/grace-hopper.png');
const binary=resolve(process.env.CAPTRAW_SEGMENT||'build/segmentation/captraw-segment');
const models=resolve(process.env.CAPTRAW_SKY_MASK_MODELS||'build/segmentation/models/small');
const python=resolve(process.env.CAPTRAW_SEGMENTATION_PYTHON||'build/segmentation/venv/bin/python');
const cache=join(out,'cache');
rmSync(cache,{recursive:true,force:true});
mkdirSync(out,{recursive:true});
for(const path of [source,manual,noSky])assert(existsSync(path),'Missing sky-mask fixture: '+path);
assert(existsSync(python),'Build the segmentation Python environment or set CAPTRAW_SEGMENTATION_PYTHON');

const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceSHA256=hash(source),negativeSHA256=hash(noSky),checks=[],rotations=[];
const pass=message=>{checks.push(message);console.log('PASS',message);};
const dimensions=path=>execFileSync(python,['-c',`from PIL import Image\nim=Image.open(${JSON.stringify(path)});print(im.width,im.height)`],{encoding:'utf8'}).trim().split(' ').map(Number);
const archive=(result,rotation)=>{
  const path=join(out,`sky-${rotation}.png`);
  copyFileSync(result.file,path);
  assert.equal(hash(path),result.sha256);
  rotations.push({rotation,result:{...result,file:path}});
  return path;
};
const segmenter=new Segmenter(binary,models,cache,()=>{});
try{
  const [width,height]=dimensions(source);
  const normal=await segmenter.requestSky({sessionId:'landscape',revision:1,path:source,imageSha256:sourceSHA256,width,height,outputRotation:0});
  assert.equal(normal.modelId,'sam2.1-small-fp32-r1');
  assert(normal.seedCount>=3&&normal.seedCount<=4);
  assert(normal.pixels>width*height/100);
  assert.equal(normal.maskWidth,width);
  assert.equal(normal.maskHeight,height);
  const normalPath=archive(normal,0);
  const metrics=JSON.parse(execFileSync(python,['-c',`
import json, numpy as np
from PIL import Image
with Image.open(${JSON.stringify(normalPath)}) as image:
    assert image.mode == 'L'
    actual = np.asarray(image) > 0
with Image.open(${JSON.stringify(manual)}) as image:
    reference = np.asarray(image) > 0
assert actual.shape == reference.shape
iou = float((actual & reference).sum() / (actual | reference).sum())
assert iou > 0.99
top = actual[:max(1, actual.shape[0] // 20)].mean()
assert top > 0.5
print(json.dumps({'iou': iou, 'topCoverage': float(top), 'pixels': int(actual.sum())}))
`],{encoding:'utf8'}));
  assert.equal(metrics.pixels,normal.pixels);
  pass('automatic sky seeds SAM 2.1 locally and matches the independent manual-prompt sky mask at IoU > 0.99');

  for(const rotation of [90,180,270]){
    const result=await segmenter.requestSky({sessionId:'landscape',revision:rotation/90+1,path:source,imageSha256:sourceSHA256,width,height,outputRotation:rotation});
    const swapped=rotation===90||rotation===270;
    assert.equal(result.maskWidth,swapped?height:width);
    assert.equal(result.maskHeight,swapped?width:height);
    archive(result,rotation);
  }
  const rotationPixels=JSON.parse(execFileSync(python,['-c',`
import json, numpy as np
from PIL import Image
data = json.loads(${JSON.stringify(JSON.stringify(rotations))})
with Image.open(data[0]['result']['file']) as image:
    base = np.asarray(image)
rows = []
for row in data:
    with Image.open(row['result']['file']) as image:
        actual = np.asarray(image)
    expected = np.rot90(base, row['rotation'] // 90)
    changed = int(np.count_nonzero(actual != expected))
    assert changed == 0
    rows.append({'rotation': row['rotation'], 'changedPixels': changed})
print(json.dumps(rows))
`],{encoding:'utf8'}));
  assert.equal(rotationPixels.length,4);
  assert(rotationPixels.every(row=>row.changedPixels===0));
  pass('sky masks honor 0 / 90 / 180 / 270 and match np.rot90 exactly');

  await assert.rejects(segmenter.requestSky({sessionId:'landscape',revision:4,path:source,imageSha256:sourceSHA256,width,height}),/版本必须递增/);
  await assert.rejects(segmenter.requestSky({sessionId:'landscape',revision:5,path:source,imageSha256:'0'.repeat(64),width,height}),/checksum mismatch/);
  await assert.rejects(segmenter.requestSky({sessionId:'landscape',revision:6,path:source,imageSha256:sourceSHA256,width,height,outputRotation:45}),/输出旋转角度无效/);
  pass('revision, source checksum and output rotation failures are explicit');

  const [negativeWidth,negativeHeight]=dimensions(noSky);
  await assert.rejects(segmenter.requestSky({sessionId:'portrait',revision:6,path:noSky,imageSha256:negativeSHA256,width:negativeWidth,height:negativeHeight,outputRotation:0}),/未检测到可靠天空/);
  pass('a no-sky portrait is rejected instead of producing an invented sky mask');

  assert.equal(hash(source),sourceSHA256);
  assert.equal(hash(noSky),negativeSHA256);
  pass('sky and no-sky source images remain byte-for-byte unchanged');
  writeFileSync(join(out,'report.json'),JSON.stringify({checks,source,sourceSHA256,negative:noSky,negativeSHA256,modelId:normal.modelId,seedCount:normal.seedCount,metrics,rotations},null,2)+'\n');
}finally{
  await segmenter.dispose();
}
