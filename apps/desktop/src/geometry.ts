import type { Adjustments, Point } from '@captraw/contracts';
export interface CanvasEditTransaction {
  sessionId:string;revision:number;valid:()=>boolean;release:()=>void;
  apply:(change:(a:Adjustments)=>Adjustments)=>boolean;
}
export type Transform = { x: number; y: number; scale: number; width: number; height: number };
export function imageTransform(width: number, height: number, canvasWidth: number, canvasHeight: number, crop: Adjustments['crop'], zoom: number, pan: Point, actualSize: boolean, dpr = 1): Transform {
  const c = crop || { x: 0, y: 0, width: 1, height: 1 };
  const scale = actualSize ? 1 / dpr : Math.min((canvasWidth - 64) / (width * c.width), (canvasHeight - 64) / (height * c.height)) * zoom;
  return { x: canvasWidth / 2 - (c.x + c.width / 2) * width * scale + pan.x, y: canvasHeight / 2 - (c.y + c.height / 2) * height * scale + pan.y, scale, width, height };
}
export function imagePoint(x: number, y: number, t: Transform): Point {
  return { x: Math.max(0, Math.min(1, (x - t.x) / (t.width * t.scale))), y: Math.max(0, Math.min(1, (y - t.y) / (t.height * t.scale))) };
}
export function visibleImageRegion(t:Transform,canvasWidth:number,canvasHeight:number){
  const left=Math.max(0,-t.x/t.scale),top=Math.max(0,-t.y/t.scale);
  const right=Math.min(t.width,(canvasWidth-t.x)/t.scale),bottom=Math.min(t.height,(canvasHeight-t.y)/t.scale);
  if(right<=left||bottom<=top)return null;
  const x=Math.floor(left),y=Math.floor(top);
  return {x,y,width:Math.ceil(right)-x,height:Math.ceil(bottom)-y};
}
export function canvasPoint(p: Point, t: Transform): Point { return { x: t.x + p.x * t.width * t.scale, y: t.y + p.y * t.height * t.scale }; }
export function rotatePoint(p: Point, rotation: number): Point {
  switch((rotation%360+360)%360){case 90:return {...p,x:1-p.y,y:p.x};case 180:return {...p,x:1-p.x,y:1-p.y};case 270:return {...p,x:p.y,y:1-p.x};default:return p;}
}
export function rotateCrop(crop: Adjustments['crop'], rotation: number): Adjustments['crop'] {
  if(!crop)return null;
  const corners=[rotatePoint(crop,rotation),rotatePoint({x:crop.x+crop.width,y:crop.y+crop.height},rotation)];
  const x=Math.min(corners[0].x,corners[1].x),y=Math.min(corners[0].y,corners[1].y);
  return {x,y,width:Math.abs(corners[1].x-corners[0].x),height:Math.abs(corners[1].y-corners[0].y)};
}
export type CropRect = NonNullable<Adjustments['crop']>;
export type CropHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
export const cropHandles:CropHandle[]=['nw','n','ne','e','se','s','sw','w'];
export function cropHandlePoint(c:CropRect,h:CropHandle):Point {
  return {x:c.x+c.width*(h.includes('w')?0:h.includes('e')?1:.5),y:c.y+c.height*(h.includes('n')?0:h.includes('s')?1:.5)};
}
// Aspect here is normalized width/height, not the ratio of output pixels.
export function drawCrop(start:Point,end:Point,aspect?:number|null):CropRect|null {
  const sx=end.x<start.x?-1:1,sy=end.y<start.y?-1:1;
  let width=Math.abs(end.x-start.x),height=Math.abs(end.y-start.y);
  if(aspect){width=Math.max(width,height*aspect);height=width/aspect;const scale=Math.min(1,(sx>0?1-start.x:start.x)/width,(sy>0?1-start.y:start.y)/height);width*=scale;height*=scale;}
  if(!(width>=.001&&height>=.001))return null;
  return {x:start.x+(sx<0?-width:0),y:start.y+(sy<0?-height:0),width,height};
}
export function resizeCrop(c:CropRect,handle:CropHandle,point:Point,aspect?:number|null):CropRect|null {
  if(handle.length===2){const opposite={x:c.x+(handle.includes('w')?c.width:0),y:c.y+(handle.includes('n')?c.height:0)};return drawCrop(opposite,point,aspect);}
  const horizontal=handle==='w'||handle==='e',center={x:c.x+c.width/2,y:c.y+c.height/2};
  const anchor=horizontal?(handle==='w'?c.x+c.width:c.x):(handle==='n'?c.y+c.height:c.y);
  const value=horizontal?point.x:point.y,sign=value<anchor?-1:1;
  let width=horizontal?Math.abs(value-anchor):c.width,height=horizontal?c.height:Math.abs(value-anchor);
  if(aspect){if(horizontal){width=Math.min(width,2*Math.min(center.y,1-center.y)*aspect);height=width/aspect;}else{height=Math.min(height,2*Math.min(center.x,1-center.x)/aspect);width=height*aspect;}}
  if(!(width>=.001&&height>=.001))return null;
  return {x:horizontal?anchor+(sign<0?-width:0):center.x-width/2,y:horizontal?center.y-height/2:anchor+(sign<0?-height:0),width,height};
}
export function moveCrop(c:CropRect,dx:number,dy:number):CropRect {
  return {...c,x:Math.max(0,Math.min(1-c.width,c.x+dx)),y:Math.max(0,Math.min(1-c.height,c.y+dy))};
}
export function fitCropAspect(c:CropRect,aspect:number):CropRect {
  let width=Math.sqrt(c.width*c.height*aspect),height=width/aspect;
  const scale=Math.min(1,1/width,1/height);width*=scale;height*=scale;
  return {x:Math.max(0,Math.min(1-width,c.x+c.width/2-width/2)),y:Math.max(0,Math.min(1-height,c.y+c.height/2-height/2)),width,height};
}
