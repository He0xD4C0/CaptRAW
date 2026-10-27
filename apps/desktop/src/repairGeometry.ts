import type {MaskGeometry,Point,RepairSpot} from '@captraw/contracts';
import {rotatePoint} from './geometry';
import {mappedMaskGuide,MaskGuideCancelled} from './maskGeometry';

function validPoint(point:Point,width:number,height:number,rotation:number){
  if(![width,height].every(v=>Number.isInteger(v)&&v>1)||![0,90,180,270].includes(rotation)||
     ![point.x,point.y].every(Number.isFinite))throw new Error('Invalid repair geometry');
}

// W/H are the recipe's full dimensions AFTER coarse rotation. Native recipe.cc
// rounds pixel centers, not canvas edges. Neither helper applies EXIF or flips.
export function repairSourcePoint(point:Point,width:number,height:number,rotation:number):Point {
  validPoint(point,width,height,rotation);
  const q=rotatePoint(point,rotation),lround=(v:number)=>v<0?-Math.round(-v):Math.round(v);
  return {x:lround(q.x*(width-1)),y:lround(q.y*(height-1))};
}

// Preserve subpixels and off-image values; the gesture decides whether a point
// may be committed. Rounding/clamping here would alter unchanged recipe values.
export function repairNormalizedPoint(sourcePixel:Point,width:number,height:number,rotation:number):Point {
  validPoint(sourcePixel,width,height,rotation);
  return rotatePoint({x:sourcePixel.x/(width-1),y:sourcePixel.y/(height-1)},-rotation);
}

export interface RepairGuide {
  source:Point|null;
  target:Point|null;
  sourceRadius:Point[][];
  sourceFeather:Point[][];
  targetRadius:Point[][];
  targetFeather:Point[][];
}

// Outputs stay in display pixel-center coordinates. The canvas projection adds
// +0.5 before multiplying by CSS scale; it must not coarse-rotate them again.
export async function mappedRepairGuide(
  spot:RepairSpot,width:number,height:number,rotation:number,scale:number,
  mapSourceToDisplay:(points:Point[])=>Promise<(Point|null)[]>,alive:()=>boolean=()=>true,
):Promise<RepairGuide> {
  const check=()=>{if(!alive())throw new MaskGuideCancelled();};check();
  const source=repairSourcePoint(spot.source,width,height,rotation),target=repairSourcePoint(spot.target,width,height,rotation);
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(spot.radius)||spot.radius<2||spot.radius>200||
     !Number.isFinite(spot.feather)||spot.feather<0||spot.feather>100)throw new Error('Invalid repair geometry');
  const radius=Math.trunc(spot.radius);
  // SpotEntry stores float feather; ipspot.cc:344 rounds its float outer radius
  // to an integer BEFORE preview downsampling (not simply radius*(1+percent)).
  const feather=Math.fround(spot.feather/100);
  const outer=Math.trunc(Math.fround(Math.fround(radius*Math.fround(1+feather))+.5));
  const centers=await mapSourceToDisplay([source,target]);check();
  if(centers.length!==2||centers.some(p=>p!==null&&(!Number.isFinite(p.x)||!Number.isFinite(p.y))))
    throw new Error('Invalid repair guide mapping result');
  const circle=async(center:Point,r:number)=>{
    // The existing radial sampler multiplies by W/H. Synthetic normalization
    // cancels that convention; these are already coarse-rotated source pixels.
    const radial:MaskGeometry={id:spot.id,name:spot.name,type:'radial',enabled:true,inverted:false,feather:0,points:[],
      start:{x:(center.x-r)/width,y:(center.y-r)/height},end:{x:(center.x+r)/width,y:(center.y+r)/height}};
    return (await mappedMaskGuide(radial,width,height,0,scale,mapSourceToDisplay,alive)).segments;
  };
  const sourceRadius=await circle(source,radius),sourceFeather=outer===radius?sourceRadius:await circle(source,outer);
  const targetRadius=await circle(target,radius),targetFeather=outer===radius?targetRadius:await circle(target,outer);
  check();return {source:centers[0],target:centers[1],sourceRadius,sourceFeather,targetRadius,targetFeather};
}
