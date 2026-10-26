import type { Adjustments, Point } from '../../../packages/contracts';
export type Transform = { x: number; y: number; scale: number; width: number; height: number };
export function imageTransform(width: number, height: number, canvasWidth: number, canvasHeight: number, crop: Adjustments['crop'], zoom: number, pan: Point, actualSize: boolean, dpr = 1): Transform {
  const c = crop || { x: 0, y: 0, width: 1, height: 1 };
  const scale = actualSize ? 1 / dpr : Math.min((canvasWidth - 64) / (width * c.width), (canvasHeight - 64) / (height * c.height)) * zoom;
  return { x: canvasWidth / 2 - (c.x + c.width / 2) * width * scale + pan.x, y: canvasHeight / 2 - (c.y + c.height / 2) * height * scale + pan.y, scale, width, height };
}
export function imagePoint(x: number, y: number, t: Transform): Point {
  return { x: Math.max(0, Math.min(1, (x - t.x) / (t.width * t.scale))), y: Math.max(0, Math.min(1, (y - t.y) / (t.height * t.scale))) };
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
