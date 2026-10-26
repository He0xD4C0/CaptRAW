import { useEffect, useRef, useState } from 'react';
import { Aperture, FolderOpen, Maximize, Scan } from 'lucide-react';
import type { Adjustments, LocalMask, Point, PreviewFrame } from '../../../packages/contracts';
import { canvasPoint, imagePoint, imageTransform, rotatePoint, rotateCrop } from './geometry';
export type Tool = 'hand' | 'brush' | 'eraser' | 'linear' | 'radial' | 'crop' | 'white-balance';
interface Props {
  frame?: PreviewFrame; detailFrame?: PreviewFrame; adjustments?: Adjustments; tool: Tool;
  selectedMask?: LocalMask; brushSize: number; overlay: boolean; busy: boolean;
  sample:(point:Point)=>void;componentId?:string;maskId?:string;
  edit: (fn: (a: Adjustments) => Adjustments, transient?: boolean) => void; commit: () => void;
  open: () => void; drop: (paths: string[]) => void;
  viewport: (x: number,y: number,w: number,h: number) => void;
}
export function Viewport(p: Props) {
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size,setSize] = useState({ width: 900,height: 700 });
  const [image,setImage] = useState<HTMLImageElement>(), [detail,setDetail] = useState<HTMLImageElement>();
  const [zoom,setZoom] = useState(1), [actual,setActual] = useState(false), [pan,setPan] = useState<Point>({x:0,y:0});
  const drag = useRef<{ start: Point; previous: Point; pan: Point; hand:boolean; shape?:{start:Point;end:Point}; handle?:'start'|'end'|'move' } | undefined>(undefined);
  const spaceHeld=useRef(false);
  useEffect(()=>{const down=(e:KeyboardEvent)=>{if(e.code==='Space'&&!(e.target as HTMLElement)?.matches('input,textarea,select')){e.preventDefault();spaceHeld.current=true;}};const up=(e:KeyboardEvent)=>{if(e.code==='Space')spaceHeld.current=false;};window.addEventListener('keydown',down);window.addEventListener('keyup',up);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};},[]);
  const [dragOver,setDragOver] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width,height: entry.contentRect.height }));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!p.frame) { setImage(undefined);return; }
    let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setImage(img);};img.src=p.frame.url;
    setDetail(undefined);return()=>{valid=false;};
  }, [p.frame?.url]);
  useEffect(() => {
    if(!p.detailFrame){setDetail(undefined);return;}
    let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setDetail(img);};img.src=p.detailFrame.url;
    return()=>{valid=false;};
  },[p.detailFrame?.url]);
  useEffect(()=>{setZoom(1);setActual(false);setPan({x:0,y:0});},[p.frame?.sessionId]);
  const fw=p.frame?.fullWidth||1,fh=p.frame?.fullHeight||1;
  const rotation=p.adjustments?.rotation||0;
  const crop=p.tool==='crop'?null:rotateCrop(p.adjustments?.crop||null,rotation);
  const displayPoint=(point:Point)=>canvasPoint(rotatePoint(point,rotation),t);
  const t=imageTransform(fw,fh,size.width,size.height,crop,zoom,pan,actual,devicePixelRatio);
  useEffect(()=>{
    const c=canvas.current;if(!c)return;
    const dpr=devicePixelRatio;c.width=Math.round(size.width*dpr);c.height=Math.round(size.height*dpr);
    const ctx=c.getContext('2d',{colorSpace:'srgb'})!;ctx.scale(dpr,dpr);ctx.clearRect(0,0,size.width,size.height);
    if(!image)return;
    ctx.save();
    if(crop){ctx.beginPath();ctx.rect(t.x+crop.x*fw*t.scale,t.y+crop.y*fh*t.scale,crop.width*fw*t.scale,crop.height*fh*t.scale);ctx.clip();}
    ctx.imageSmoothingEnabled=!actual;
    ctx.drawImage(image,t.x,t.y,fw*t.scale,fh*t.scale);
    if(detail && p.detailFrame){const f=p.detailFrame;ctx.drawImage(detail,t.x+(f.x||0)*t.scale,t.y+(f.y||0)*t.scale,f.width*t.scale,f.height*t.scale);}
    ctx.restore();
    c.dataset.frame=image.src;c.dataset.detail=detail?.src||'';
  },[image,detail,p.detailFrame,size,zoom,pan,actual,p.adjustments?.crop,p.tool]);
  useEffect(()=>{
    if(!actual||!p.frame)return;
    const timer=setTimeout(()=>{
      const x=Math.max(0,Math.floor(-t.x/t.scale)),y=Math.max(0,Math.floor(-t.y/t.scale));
      p.viewport(x,y,Math.min(2048,fw-x,Math.ceil(size.width/t.scale)),Math.min(2048,fh-y,Math.ceil(size.height/t.scale)));
    },160);return()=>clearTimeout(timer);
  },[actual,pan,p.frame?.revision,size]);
  function point(event: React.PointerEvent): Point {
    const bounds=container.current!.getBoundingClientRect();return rotatePoint(imagePoint(event.clientX-bounds.left,event.clientY-bounds.top,t),-rotation);
  }
  function changeMask(fn:(mask: LocalMask)=>LocalMask) {
    const id=p.selectedMask?.id;if(!id)return;
    p.edit(a=>({...a,masks:a.masks.map(m=>{
      if(m.id!==id)return m;
      if(p.componentId&&m.components)return {...m,components:m.components.map(c=>{if(c.id!==p.componentId)return c;const next=fn({...m,...c,components:undefined});return {...c,points:next.points,start:next.start,end:next.end,initialized:true};})};
      return fn(m);
    })}),true);
  }
  function paint(at:Point,previous?:Point,erase=false) {
    const radius=p.brushSize;
    const points:Point[]=[];
    const distance=previous?Math.hypot((at.x-previous.x)*fw,(at.y-previous.y)*fh):0;
    const spacing=Math.max(1,radius*.1*Math.min(fw,fh)*.25);
    const count=Math.min(1000,Math.max(1,Math.ceil(distance/spacing)));
    for(let i=1;i<=count;i++){const amount=i/count;points.push({x:previous?previous.x+(at.x-previous.x)*amount:at.x,y:previous?previous.y+(at.y-previous.y)*amount:at.y,radius,erase:p.tool==='eraser'||erase});}
    changeMask(m=>({...m,points:[...m.points,...points]}));
  }
  function down(event:React.PointerEvent<HTMLDivElement>) {
    if(!image||event.button>1)return;
    const bounds=container.current!.getBoundingClientRect();
    const x=(event.clientX-bounds.left-t.x)/(fw*t.scale),y=(event.clientY-bounds.top-t.y)/(fh*t.scale);
    const area=crop||{x:0,y:0,width:1,height:1};
    if(p.tool!=='hand'&&!spaceHeld.current&&event.button!==1&&(x<area.x||y<area.y||x>area.x+area.width||y>area.y+area.height))return;
    if(p.tool==='white-balance'&&!spaceHeld.current&&event.button===0){if(!p.busy)p.sample(point(event));return;}
    event.currentTarget.setPointerCapture(event.pointerId);
    const at=point(event);drag.current={start:at,previous:at,pan:{x:event.clientX-pan.x,y:event.clientY-pan.y},hand:spaceHeld.current||event.button===1};
    if(drag.current.hand)return;
    if(p.tool==='brush'||p.tool==='eraser')paint(at,undefined,event.altKey);
    else if(p.tool==='linear'||p.tool==='radial'){
      const m=p.selectedMask;
      if(m&&m.initialized!==false){
        const center={x:(m.start.x+m.end.x)/2,y:(m.start.y+m.end.y)/2};
        const hit=(q:Point)=>{const screen=displayPoint(q);return Math.hypot(screen.x-(event.clientX-bounds.left),screen.y-(event.clientY-bounds.top))<=12;};
        const handle=hit(m.start)?'start':hit(m.end)?'end':hit(center)?'move':undefined;
        if(handle){drag.current.handle=handle;drag.current.shape={start:{...m.start},end:{...m.end}};return;}
      }
      changeMask(m=>({...m,start:at,end:at}));
    }
  }
  function move(event:React.PointerEvent<HTMLDivElement>) {
    const d=drag.current;if(!d)return;const at=point(event);
    if(p.tool==='hand'||d.hand)setPan({x:event.clientX-d.pan.x,y:event.clientY-d.pan.y});
    else if(p.tool==='brush'||p.tool==='eraser')paint(at,d.previous,event.altKey);
    else if(p.tool==='linear'||p.tool==='radial'){
      if(d.handle==='move'&&d.shape){
        const {start,end}=d.shape;
        const dx=Math.max(-Math.min(start.x,end.x),Math.min(1-Math.max(start.x,end.x),at.x-d.start.x));
        const dy=Math.max(-Math.min(start.y,end.y),Math.min(1-Math.max(start.y,end.y),at.y-d.start.y));
        changeMask(m=>({...m,start:{x:start.x+dx,y:start.y+dy},end:{x:end.x+dx,y:end.y+dy}}));
      }else if(d.handle==='start')changeMask(m=>({...m,start:at}));
      else changeMask(m=>({...m,end:at}));
    }
    else if(p.tool==='crop'){
      const x=Math.min(d.start.x,at.x),y=Math.min(d.start.y,at.y);
      const width=Math.max(.01,Math.abs(d.start.x-at.x)),height=Math.max(.01,Math.abs(d.start.y-at.y));
      p.edit(a=>({...a,crop:{x,y,width:Math.min(1-x,width),height:Math.min(1-y,height)}}),true);
    }
    d.previous=at;
  }
  function up(){if(drag.current){drag.current=undefined;p.commit();}}
  const mask=p.selectedMask,start=mask?displayPoint(mask.start):{x:0,y:0},end=mask?displayPoint(mask.end):{x:0,y:0};
  return <section className="viewport-shell">
    <div ref={container} className={`viewport tool-${p.tool} ${dragOver?'drop-active':''}`} data-testid="viewport"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={e=>{if(!image)return;setActual(false);setZoom(z=>Math.max(.2,Math.min(12,z*Math.exp(-e.deltaY*.002))));}}
      onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
      onDrop={e=>{e.preventDefault();setDragOver(false);p.drop(window.captraw.droppedFiles(Array.from(e.dataTransfer.files)));}}>
      <canvas ref={canvas} aria-label="显影预览" />
      {!image&&!p.busy&&<div className="welcome"><div className="welcome-mark"><Aperture size={48} strokeWidth={1}/></div><span className="eyebrow">A BETTER START FOR EVERY RAW</span><h1>从光线，开始。</h1><p>让原片的每一份细节，都有表达的空间。</p><button className="primary" onClick={p.open}><FolderOpen size={16}/>打开照片<span>⌘ O</span></button><small>或将 RAW 文件拖到这里<br/>所有显影均在本机完成，原片保持不变。</small></div>}
      {p.busy&&<div className="rendering"><i/>正在显影</div>}
      <svg className="mask-overlay" width={size.width} height={size.height} aria-hidden="true">
        <defs><clipPath id="mask-image-bounds"><rect x={t.x+(crop?.x||0)*fw*t.scale} y={t.y+(crop?.y||0)*fh*t.scale} width={(crop?.width||1)*fw*t.scale} height={(crop?.height||1)*fh*t.scale}/></clipPath>
          <mask id="mask-fit-region" maskUnits="userSpaceOnUse" x="0" y="0" width={size.width} height={size.height}><rect width={size.width} height={size.height} fill="white"/>{actual&&p.detailFrame?.mask&&p.detailFrame.mask.id===p.maskId&&<rect x={t.x+p.detailFrame.mask.x*t.scale} y={t.y+p.detailFrame.mask.y*t.scale} width={p.detailFrame.mask.width*t.scale} height={p.detailFrame.mask.height*t.scale} fill="black"/>}</mask>
        </defs>
        {p.overlay&&p.maskId&&p.frame?.mask?.id===p.maskId&&<g clipPath="url(#mask-image-bounds)" opacity=".45">
          <image data-testid="mask-coverage" href={p.frame.mask.url} x={t.x} y={t.y} width={fw*t.scale} height={fh*t.scale} preserveAspectRatio="none" mask="url(#mask-fit-region)"/>
          {actual&&p.detailFrame?.mask&&p.detailFrame.mask.id===p.maskId&&<image data-testid="mask-detail-coverage" href={p.detailFrame.mask.url} x={t.x+p.detailFrame.mask.x*t.scale} y={t.y+p.detailFrame.mask.y*t.scale} width={p.detailFrame.mask.width*t.scale} height={p.detailFrame.mask.height*t.scale} preserveAspectRatio="none"/>}
        </g>}
        {mask&&mask.initialized!==false&&mask.type==='linear'&&<g><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#fff" strokeWidth="1.5"/></g>}
        {mask&&mask.initialized!==false&&mask.type==='radial'&&<ellipse cx={(start.x+end.x)/2} cy={(start.y+end.y)/2} rx={Math.abs(start.x-end.x)/2} ry={Math.abs(start.y-end.y)/2} fill="none" stroke="#fff" strokeDasharray="5 4"/>}
        {mask&&mask.initialized!==false&&(mask.type==='linear'||mask.type==='radial')&&<g>
          <circle data-testid="mask-start-handle" cx={start.x} cy={start.y} r="5" fill="#f7f7f7" stroke="#292b2e"/>
          <circle data-testid="mask-end-handle" cx={end.x} cy={end.y} r="5" fill="#292b2e" stroke="#fff"/>
          <circle data-testid="mask-move-handle" cx={(start.x+end.x)/2} cy={(start.y+end.y)/2} r="5" fill="#292b2e" stroke="#fff"/>
        </g>}
        {p.tool==='crop'&&p.adjustments?.crop&&(()=>{const c=rotateCrop(p.adjustments.crop,rotation)!,q=canvasPoint(c,t);return <g><rect x={q.x} y={q.y} width={c.width*fw*t.scale} height={c.height*fh*t.scale} fill="none" stroke="#fff"/><line x1={q.x+c.width*fw*t.scale/3} y1={q.y} x2={q.x+c.width*fw*t.scale/3} y2={q.y+c.height*fh*t.scale} stroke="#ffffff60"/><line x1={q.x} y1={q.y+c.height*fh*t.scale/3} x2={q.x+c.width*fw*t.scale} y2={q.y+c.height*fh*t.scale/3} stroke="#ffffff60"/></g>;})()}
      </svg>
    </div>
    <div className="view-controls"><button onClick={()=>{setActual(false);setZoom(1);setPan({x:0,y:0});}} className={!actual&&zoom===1?'active':''} title="适应窗口"><Maximize size={14}/>适屏</button><button onClick={()=>{setActual(true);setPan({x:0,y:0});}} className={actual?'active':''} title="原始像素预览"><Scan size={14}/>1:1</button><span>{actual?'100%':`${Math.round(t.scale*100)}%`}</span><span className="view-hint">{p.tool==='white-balance'?'单击照片中的中性灰色 · I 选择吸管 · Esc 退出':p.tool==='crop'?'拖动设置裁切范围':p.tool==='hand'?'滚轮缩放 · 拖动平移':p.tool==='eraser'?'在选中画笔蒙版中擦除':'拖动绘制 · 拖动中心移动 · 拖动端点调整范围'}</span></div>
  </section>;
}
