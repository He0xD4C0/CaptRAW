import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
const source=await transform(readFileSync('apps/desktop/src/geometry.ts','utf8'),{loader:'ts',format:'esm'});
const {rotatePoint,rotateCrop,imageTransform,canvasPoint,imagePoint}=await import(`data:text/javascript;base64,${Buffer.from(source.code).toString('base64')}`);
test('image coordinates survive rotation and HiDPI canvas transforms',()=>{
 for(const rotation of [0,90,180,270]){
  const point={x:.234,y:.678};const rotated=rotatePoint(point,rotation),restored=rotatePoint(rotated,-rotation);
  assert(Math.abs(restored.x-point.x)<1e-12&&Math.abs(restored.y-point.y)<1e-12);
  const t=imageTransform(8280,5512,1000,650,null,1,{x:40,y:-12},false,2);
  const screen=canvasPoint(rotated,t),result=imagePoint(screen.x,screen.y,t);
  assert(Math.abs(result.x-rotated.x)<1e-12&&Math.abs(result.y-rotated.y)<1e-12);
 }
});
test('100 percent uses one source pixel per physical display pixel',()=>{
 const t=imageTransform(8280,5512,1000,650,null,1,{x:0,y:0},true,2);
 assert.equal(t.scale*2,1);
 const crop=rotateCrop({x:.1,y:.2,width:.3,height:.4},90);
 for(const [key,expected] of Object.entries({x:.4,y:.1,width:.4,height:.3}))assert(Math.abs(crop[key]-expected)<1e-12);
});
