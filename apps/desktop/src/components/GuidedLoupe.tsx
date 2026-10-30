import type {Point,PreviewFrame} from '@captraw/contracts';

export const loupeSize=144;
export function loupeRegion(point:Point,width:number,height:number,dpr:number){
 const radius=loupeSize*dpr/4;
 const x=Math.max(0,Math.floor(point.x+.5-radius)),y=Math.max(0,Math.floor(point.y+.5-radius));
 return {x,y,width:Math.min(width,Math.ceil(point.x+.5+radius))-x,height:Math.min(height,Math.ceil(point.y+.5+radius))-y};
}
export function GuidedLoupe({point,screen,size,frame,detail,image}:{point:Point;screen:Point;size:{width:number;height:number};frame:PreviewFrame;detail?:PreviewFrame;image?:HTMLImageElement}){
 const scale=2/devicePixelRatio,r=loupeRegion(point,frame.fullWidth,frame.fullHeight,devicePixelRatio);
 const ready=detail?.sessionId===frame.sessionId&&detail.revision===frame.revision&&detail.fullWidth===frame.fullWidth&&detail.fullHeight===frame.fullHeight&&image?.src===detail.url&&image.naturalWidth===detail.width&&image.naturalHeight===detail.height&&
  (detail.x||0)<=r.x&&(detail.y||0)<=r.y&&(detail.x||0)+detail.width>=r.x+r.width&&(detail.y||0)+detail.height>=r.y+r.height;
 const width=loupeSize+2,height=loupeSize+26;
 const left=Math.max(4,Math.min(size.width-width-4,screen.x+24+width<size.width?screen.x+24:screen.x-width-24));
 const top=Math.max(4,Math.min(size.height-height-4,screen.y+24+height<size.height?screen.y+24:screen.y-height-24));
 return <div className="guided-loupe" role="img" aria-label="引导透视放大镜" data-ready={!!ready} data-x={point.x} data-y={point.y} data-scale={scale} style={{left,top}}>
  <svg width={loupeSize} height={loupeSize} viewBox={`0 0 ${loupeSize} ${loupeSize}`} aria-hidden="true">
   {ready&&<image href={detail.url} x={loupeSize/2+((detail.x||0)-point.x-.5)*scale} y={loupeSize/2+((detail.y||0)-point.y-.5)*scale} width={detail.width*scale} height={detail.height*scale} style={{imageRendering:'pixelated'}}/>}
   {ready?<path d={`M72 0v65 M72 79v65 M0 72h65 M79 72h65`} fill="none" stroke="#fff" strokeWidth="1" style={{filter:'drop-shadow(1px 1px 0 #111)'}}/>:<text x="72" y="76" textAnchor="middle" fill="#ddd" fontSize="11">正在载入细节…</text>}
  </svg>
  <span>200% · 显影细节</span>
 </div>;
}
