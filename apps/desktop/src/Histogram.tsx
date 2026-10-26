import type {ImageSession,PreviewFrame} from '../../../packages/contracts';
export function Histogram({frame,image}:{frame?:PreviewFrame;image?:ImageSession}){
  const bins=frame?.histogram||[Array(256).fill(0),Array(256).fill(0),Array(256).fill(0)];
  const peak=Math.max(1,...bins.flat());
  return <div className="histogram-panel"><svg viewBox="0 0 256 90" role="img" aria-label="RGB 直方图">{bins.map((channel,i)=>{
    const path=channel.map((v,x)=>`${x?'L':'M'}${x},${88-Math.pow(v/peak,.5)*83}`).join(' ');
    return <path key={i} d={`${path}L255 90H0Z`} fill={['#db534b33','#5aaf6133','#568ecb33'][i]} stroke={['#db534b','#6aaf6d','#669ac9'][i]} strokeWidth=".7"/>;
  })}</svg><div className="exposure-meta"><span>{image?.iso?`ISO ${image.iso}`:'ISO —'}</span><span>{image?.focalLength?`${Number(image.focalLength.toFixed(1))} 毫米`:'—'}</span><span>{image?.aperture?`f/${Number(image.aperture.toFixed(1))}`:'—'}</span><span>{image?.shutter?(image.shutter<1?`1/${Math.round(1/image.shutter)} 秒`:`${Number(image.shutter.toFixed(2))} 秒`):'—'}</span></div></div>;
}
