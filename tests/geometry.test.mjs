import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
const source=await transform(readFileSync('apps/desktop/src/geometry.ts','utf8'),{loader:'ts',format:'esm'});
const {rotatePoint,rotateCrop,imageTransform,canvasPoint,imagePoint,drawCrop,resizeCrop,moveCrop,fitCropAspect,cropHandles}=await import(`data:text/javascript;base64,${Buffer.from(source.code).toString('base64')}`);
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

test('locked crop gestures preserve ratio, bounds and opposite anchor through rotation',()=>{
 const within=c=>{assert(c&&c.width>=.001&&c.height>=.001);assert(c.x>=-1e-12&&c.y>=-1e-12&&c.x+c.width<=1+1e-12&&c.y+c.height<=1+1e-12);};
 for(const rotation of [0,90,180,270])for(const pixelRatio of [1,4/3,3/2,16/9,9/16]){
  const [width,height]=rotation%180?[4032,6048]:[6048,4032],aspect=pixelRatio*height/width;
  const c=fitCropAspect({x:.2,y:.2,width:.5,height:.5},aspect);within(c);
  for(const h of cropHandles)for(const point of [{x:.01,y:.01},{x:.99,y:.99},{x:.3,y:.7}]){
   const r=resizeCrop(c,h,point,aspect);if(!r)continue;within(r);assert(Math.abs(r.width*width/(r.height*height)-pixelRatio)<1e-10);
   const restored=rotateCrop(rotateCrop(r,-rotation),rotation);for(const k of ['x','y','width','height'])assert(Math.abs(r[k]-restored[k])<1e-12);
  }
  for(const end of [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}]){const r=drawCrop({x:.45,y:.55},end,aspect);within(r);assert(Math.abs(r.width/r.height-aspect)<1e-10);}
 }
 assert.equal(drawCrop({x:0,y:0},{x:0,y:0},1),null);
 const original={x:.2,y:.3,width:.4,height:.2},moved=moveCrop(original,10,-10);assert.deepEqual(moved,{x:.6,y:0,width:.4,height:.2});
 const resized=resizeCrop(original,'nw',{x:.1,y:.2});assert(Math.abs(resized.x+resized.width-.6)<1e-12);assert(Math.abs(resized.y+resized.height-.5)<1e-12);
 const a=fitCropAspect(original,2),b=fitCropAspect(a,.5),back=fitCropAspect(b,2);for(const k of ['x','y','width','height'])assert(Math.abs(back[k]-a[k])<1e-12);
});
