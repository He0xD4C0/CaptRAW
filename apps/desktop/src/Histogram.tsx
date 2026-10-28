import {useSyncExternalStore} from 'react';
import type {ImageSession,PreviewFrame} from '@captraw/contracts';
export type ClippingMode='shadows'|'highlights';
let clipping:ClippingMode|null=null;const clippingListeners=new Set<()=>void>();
export function useClipping(){return useSyncExternalStore(listener=>{clippingListeners.add(listener);return()=>clippingListeners.delete(listener);},()=>clipping,()=>null);}
export function setClipping(value:ClippingMode|null){if(value===clipping)return;clipping=value;for(const listener of clippingListeners)listener();}
export function Histogram({frame,image,disabled=false}:{frame?:PreviewFrame;image?:ImageSession;disabled?:boolean}){
  const clipping=useClipping();
  const bins=frame?.histogram||[Array(256).fill(0),Array(256).fill(0),Array(256).fill(0)];
  const peak=Math.max(1,...bins.flat());
  const toggle=(value:ClippingMode)=>setClipping(clipping===value?null:value);
  return <div className="histogram-panel"><div className="clipping-controls"><button type="button" aria-label="显示阴影裁剪" title="阴影裁剪：当前 sRGB 预览三通道均不高于 3" aria-pressed={clipping==='shadows'} disabled={disabled||!frame} onClick={()=>toggle('shadows')}><i className="shadow-marker"/></button><button type="button" aria-label="显示高光裁剪" title="高光裁剪：当前 sRGB 预览任一分量不低于 252" aria-pressed={clipping==='highlights'} disabled={disabled||!frame} onClick={()=>toggle('highlights')}><i className="highlight-marker"/></button></div><svg viewBox="0 0 256 90" role="img" aria-label="RGB 直方图">{bins.map((channel,i)=>{
    const path=channel.map((v,x)=>`${x?'L':'M'}${x},${88-Math.pow(v/peak,.5)*83}`).join(' ');
    return <path key={i} d={`${path}L255 90H0Z`} fill={['#db534b33','#5aaf6133','#568ecb33'][i]} stroke={['#db534b','#6aaf6d','#669ac9'][i]} strokeWidth=".7"/>;
  })}</svg><div className="exposure-meta"><span>{image?.iso?`ISO ${image.iso}`:'ISO —'}</span><span>{image?.focalLength?`${Number(image.focalLength.toFixed(1))} 毫米`:'—'}</span><span>{image?.aperture?`f/${Number(image.aperture.toFixed(1))}`:'—'}</span><span>{image?.shutter?(image.shutter<1?`1/${Math.round(1/image.shutter)} 秒`:`${Number(image.shutter.toFixed(2))} 秒`):'—'}</span></div></div>;
}

// Native ART curve-input luminance, already logarithmically scaled by the engine.
export function CurveHistogram({bins}:{bins?:number[]|null}){
  if(!bins?.length)return null;
  const peak=Math.max(1,...bins),path=bins.map((v,i)=>`${i?'L':'M'}${i/(bins.length-1)*256},${256-v/peak*240}`).join(' ');
  return <path aria-label="曲线输入明度直方图" role="img" data-testid="curve-histogram" d={`${path}L256 256H0Z`} fill="#252525" pointerEvents="none"><title>曲线处理前的明度分布</title></path>;
}
