import type {MaskGeometry,Point,RepairSpot,RepairSourceRequest} from '@captraw/contracts';
import {rotatePoint} from './geometry';
import {mappedMaskGuide,MaskGuideCancelled} from './maskGeometry';

function validPoint(point:Point,width:number,height:number,rotation:number){
  if(![width,height].every(v=>Number.isInteger(v)&&v>1)||![0,90,180,270].includes(rotation)||
     ![point.x,point.y].every(Number.isFinite))throw new Error('Invalid repair geometry');
}

// Display-only edge/dark-speck view. Feed the rendered frame, never a recipe or export.
export function repairDustPixels(input:Uint8ClampedArray,width:number,height:number,threshold:number):Uint8ClampedArray {
  if(input.length!==width*height*4||width<1||height<1||!Number.isFinite(threshold)||threshold<0||threshold>100)throw new Error('Invalid dust visualization');
  const gray=new Float32Array(width*height),integral=new Float64Array((width+1)*(height+1)),output=new Uint8ClampedArray(input.length);
  for(let y=0;y<height;++y){let sum=0;for(let x=0;x<width;++x){const i=y*width+x,j=i*4;gray[i]=.2126*input[j]+.7152*input[j+1]+.0722*input[j+2];sum+=gray[i];integral[(y+1)*(width+1)+x+1]=integral[y*(width+1)+x+1]+sum;}}
  for(let y=0;y<height;++y)for(let x=0;x<width;++x){
    const x0=Math.max(0,x-3),x1=Math.min(width,x+4),y0=Math.max(0,y-3),y1=Math.min(height,y+4),stride=width+1;
    const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
    const center=gray[y*width+x],dx=gray[y*width+Math.min(width-1,x+1)]-gray[y*width+Math.max(0,x-1)],dy=gray[Math.min(height-1,y+1)*width+x]-gray[Math.max(0,y-1)*width+x];
    const value=Math.max(Math.abs(center-mean),Math.hypot(dx,dy)/2)>threshold*.75?255:0,i=(y*width+x)*4;
    output[i]=output[i+1]=output[i+2]=value;output[i+3]=255;
  }
  return output;
}

// W/H are the recipe's full dimensions AFTER coarse rotation. Native recipe.cc
// rounds pixel centers, not canvas edges. The native coordinate service retains
// inherited source-canvas reflections; never apply those flips again here.
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

// The renderer freezes geometry and guards the lifetime; all pixel matching is native.
export async function automaticRepairSource(request:RepairSourceRequest,alive:()=>boolean):Promise<Point>{
  if(!alive())throw new MaskGuideCancelled();
  const frozen=structuredClone(request),result=await window.captraw.repairSource(frozen);
  if(!alive()||result.sessionId!==frozen.sessionId||result.revision!==frozen.revision)throw new MaskGuideCancelled();
  return result.source;
}

export interface RepairGuide {
  source:Point|null;
  target:Point|null;
  sourceRadius:Point[][];
  sourceFeather:Point[][];
  targetRadius:Point[][];
  targetFeather:Point[][];
}

async function strokeOutline(path:Point[],radius:number,scale:number,map:(points:Point[])=>Promise<(Point|null)[]>,alive:()=>boolean){
  const left=Math.min(...path.map(p=>p.x))-radius-2,top=Math.min(...path.map(p=>p.y))-radius-2;
  const right=Math.max(...path.map(p=>p.x))+radius+2,bottom=Math.max(...path.map(p=>p.y))+radius+2;
  const step=Math.max(.25,.5/scale,Math.sqrt((right-left)*(bottom-top)/150000));
  const width=Math.ceil((right-left)/step)+1,height=Math.ceil((bottom-top)/step)+1;
  const field=new Float32Array(width*height);field.fill(radius+step*2);
  for(let i=1;i<path.length;++i){
    const a=path[i-1],b=path[i],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const x0=Math.max(0,Math.floor((Math.min(a.x,b.x)-radius-step-left)/step)),x1=Math.min(width-1,Math.ceil((Math.max(a.x,b.x)+radius+step-left)/step));
    const y0=Math.max(0,Math.floor((Math.min(a.y,b.y)-radius-step-top)/step)),y1=Math.min(height-1,Math.ceil((Math.max(a.y,b.y)+radius+step-top)/step));
    for(let y=y0;y<=y1;++y)for(let x=x0;x<=x1;++x){
      const px=left+x*step,py=top+y*step,u=length?Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/length)):0;
      const index=y*width+x;field[index]=Math.min(field[index],Math.hypot(px-a.x-u*dx,py-a.y-u*dy));
    }
  }
  const points:Point[]=[];
  for(let y=0;y<height-1;++y)for(let x=0;x<width-1;++x){
    const q=[{x:left+x*step,y:top+y*step},{x:left+(x+1)*step,y:top+y*step},{x:left+(x+1)*step,y:top+(y+1)*step},{x:left+x*step,y:top+(y+1)*step}];
    const v=[field[y*width+x],field[y*width+x+1],field[(y+1)*width+x+1],field[(y+1)*width+x]],crossings:Point[]=[];
    for(let k=0;k<4;++k){const j=(k+1)%4;if((v[k]<radius)===(v[j]<radius))continue;const u=(radius-v[k])/(v[j]-v[k]);crossings.push({x:q[k].x+(q[j].x-q[k].x)*u,y:q[k].y+(q[j].y-q[k].y)*u});}
    points.push(...crossings);
  }
  const mapped:(Point|null)[]=[];
  for(let i=0;i<points.length;i+=4096){
    if(!alive())throw new MaskGuideCancelled();const batch=points.slice(i,i+4096),result=await map(batch);
    if(result.length!==batch.length||result.some(p=>p!==null&&(!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw new Error('Invalid repair contour mapping');
    mapped.push(...result);
  }
  if(!alive())throw new MaskGuideCancelled();
  const segments:Point[][]=[];for(let i=0;i+1<mapped.length;i+=2)if(mapped[i]&&mapped[i+1])segments.push([mapped[i]!,mapped[i+1]!]);
  return segments;
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
    if(spot.path){
      const dx=center.x-target.x,dy=center.y-target.y;
      const path=spot.path.map(p=>{const q=rotatePoint(p,rotation);return {x:q.x*(width-1)+dx,y:q.y*(height-1)+dy};});
      return strokeOutline(path,r,scale,mapSourceToDisplay,alive);
    }
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
