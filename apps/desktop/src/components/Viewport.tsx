import { useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, FolderOpen, Maximize, Scan } from 'lucide-react';
import type { Adjustments, BrushSettings, LocalMask, Point, PreviewFrame, ObjectPrompt, ObjectBox, ComparisonLayout,ImageSession } from '@captraw/contracts';
import { canvasPoint, imagePoint, imageTransform, visibleImageRegion, rotatePoint, rotateCrop, cropHandles, cropHandlePoint, drawCrop,resizeCrop,moveCrop,type CropHandle,type CropRect,type CanvasEditTransaction } from '../lib/geometry';
import {useMaskGesture,type MaskEditTransaction,type MaskHandle} from '../hooks/useMaskGesture';
import {mappedMaskGuide} from '../lib/maskGeometry';
import {useRepairGesture,type RepairInteraction} from '../hooks/useRepairGesture';
import {mappedRepairGuide,repairSourcePoint,repairDustPixels,type RepairGuide} from '../lib/repairGeometry';
import type {useGuidedPerspective} from '../hooks/useGuidedPerspective';
import {useStraightenGesture} from '../hooks/useStraightenGesture';
import {LinearCanvas,type LinearPane,type ImageRect} from '../lib/LinearCanvas';
import {useRangeGesture} from '../hooks/useRangeGesture';
import {GuidedLoupe,loupeRegion} from './GuidedLoupe';
export type Tool = 'object' | 'hand' | 'brush' | 'eraser' | 'linear' | 'radial' | 'crop' | 'straighten' | 'perspective' | 'white-balance' | 'repair' | 'luminance' | 'color' | 'curve';
interface Props {
  sessionId?:string;beforeLabel?:string;
  clipping?:'shadows'|'highlights'|null;
  dustView?:{enabled:boolean;threshold:number};
  viewCommand?:{action:'fit'|'actual'|'zoom-in'|'zoom-out';sequence:number};
  guided:ReturnType<typeof useGuidedPerspective>;
  comparison?:{label:string;layout:ComparisonLayout;frame?:PreviewFrame;detail?:PreviewFrame;viewport:(x:number,y:number,w:number,h:number)=>void};
  comparisonControl?:React.ReactNode;
  object?:{mode:'point'|'box';ready:boolean;box?:ObjectBox;pickBox:(start:Point,end:Point)=>void;url?:string;prompts:ObjectPrompt[];pick:(point:Point,exclude:boolean)=>void};
  frame?: PreviewFrame; detailFrame?: PreviewFrame; adjustments?: Adjustments; tool: Tool;
  selectedMask?: LocalMask; brushSize: number;brush:BrushSettings; overlay: boolean; busy: boolean;
  luminanceMap?:boolean;sampleRange:(start:Point,end:Point|undefined,append:boolean,transaction:CanvasEditTransaction)=>Promise<void>;cancelSample:()=>void;removeColor:(index:number)=>void;
  sample:(point:Point)=>void;componentId?:string;maskId?:string;
  sampleCurve:(point:Point)=>void;
  repair?:RepairInteraction;imageSize?:Pick<ImageSession,'width'|'height'|'effectiveGeometry'>;
  edit: (fn: (a: Adjustments) => Adjustments, transient?: boolean) => void; commit: () => void;
  beginMaskEdit:(sessionId:string,revision:number,maskId:string,componentId?:string)=>MaskEditTransaction|null;
  beginCanvasEdit:(sessionId:string,revision:number,label:string)=>CanvasEditTransaction|null;
  error:(message:string)=>void;
  straightenDone:()=>void;
  open: () => void; drop: (paths: string[]) => void;
  viewport: (x: number,y: number,w: number,h: number) => void;
}
export function Viewport(p: Props) {
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const linearCanvas=useRef<HTMLCanvasElement>(null),[linearRenderer,setLinearRenderer]=useState<LinearCanvas>(),[linearReady,setLinearReady]=useState(''),[linearMessage,setLinearMessage]=useState(''),[linearRetry,setLinearRetry]=useState(0);
  const [size,setSize] = useState({ width: 900,height: 700 });
  const [pixelRatio,setPixelRatio]=useState(devicePixelRatio);
  useEffect(()=>{const query=matchMedia(`(resolution: ${pixelRatio}dppx)`),changed=()=>setPixelRatio(devicePixelRatio);query.addEventListener('change',changed);window.addEventListener('resize',changed);return()=>{query.removeEventListener('change',changed);window.removeEventListener('resize',changed);};},[pixelRatio]);
  const [image,setImage] = useState<HTMLImageElement>(), [detail,setDetail] = useState<HTMLImageElement>();
  const [luminanceImage,setLuminanceImage]=useState<HTMLImageElement>(),[luminanceDetail,setLuminanceDetail]=useState<HTMLImageElement>();
  const [beforeImage,setBeforeImage]=useState<HTMLImageElement>(),[beforeDetail,setBeforeDetail]=useState<HTMLImageElement>();
  useEffect(()=>{setBeforeImage(undefined);const frame=p.comparison?.frame;if(!frame)return;let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setBeforeImage(img);};img.src=frame.url;return()=>{valid=false;};},[p.comparison?.frame?.url]);
  useEffect(()=>{setBeforeDetail(undefined);const frame=p.comparison?.detail;if(!frame)return;let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setBeforeDetail(img);};img.src=frame.url;return()=>{valid=false;};},[p.comparison?.detail?.url]);
  const [sampleBox,setSampleBox]=useState<{start:Point;end:Point}>();
  const [zoom,setZoom] = useState(1), [actual,setActual] = useState(false), [pan,setPan] = useState<Point>({x:0,y:0});
  const drag = useRef<{ start: Point; previous: Point; pan: Point; hand:boolean; rangePick?:boolean;objectBox?:boolean;crop?:{rect:CropRect;handle:CropHandle|'move'} } | undefined>(undefined);
  const spaceHeld=useRef(false),[altHeld,setAltHeld]=useState(false);
  useEffect(()=>{if(container.current)container.current.style.cursor='';if(drag.current?.rangePick){drag.current=undefined;setSampleBox(undefined);}},[p.tool,p.componentId,p.selectedMask?.id,p.object?.mode]);
  useEffect(()=>{const down=(e:KeyboardEvent)=>{if(e.key==='Alt')setAltHeld(true);if(e.code==='Space'&&!e.defaultPrevented&&!(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')){spaceHeld.current=true;if(!(e.target as HTMLElement)?.closest('button,a[href],summary,[role=button],[role=slider],[role=tab]'))e.preventDefault();}};const up=(e:KeyboardEvent)=>{if(e.key==='Alt')setAltHeld(false);if(e.code==='Space')spaceHeld.current=false;};const blur=()=>{spaceHeld.current=false;setAltHeld(false);setHover(undefined);};window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};},[]);
  const [dragOver,setDragOver] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width,height: entry.contentRect.height }));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!p.frame) { setImage(undefined);return; }
    let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setImage(img);};img.src=p.frame.url;
    return()=>{valid=false;};
  }, [p.frame?.url]);
  useEffect(() => {
    if(!p.detailFrame){setDetail(undefined);return;}
    let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setDetail(img);};img.src=p.detailFrame.url;
    return()=>{valid=false;};
  },[p.detailFrame?.url]);
  useEffect(()=>{
    setLuminanceImage(undefined);if(!p.luminanceMap||!p.frame?.luminance)return;
    let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setLuminanceImage(img);};img.src=p.frame.luminance.url;return()=>{valid=false;};
  },[p.luminanceMap,p.frame?.luminance?.url]);
  useEffect(()=>{
    setLuminanceDetail(undefined);if(!p.luminanceMap||!p.detailFrame?.luminance)return;
    let valid=true;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{if(valid)setLuminanceDetail(img);};img.src=p.detailFrame.luminance.url;return()=>{valid=false;};
  },[p.luminanceMap,p.detailFrame?.luminance?.url]);
  const clippingCanvas=useMemo(()=>{
    if(!p.clipping)return undefined;
    const source=actual&&detail?.src===p.detailFrame?.url?detail:image;if(!source?.naturalWidth)return undefined;
    const overlay=document.createElement('canvas');overlay.width=source.naturalWidth;overlay.height=source.naturalHeight;
    const context=overlay.getContext('2d',{willReadFrequently:true});if(!context)return undefined;
    context.drawImage(source,0,0);let pixels;try{pixels=context.getImageData(0,0,overlay.width,overlay.height);}catch{return undefined;}
    const marked=context.createImageData(overlay.width,overlay.height);
    for(let i=0;i<pixels.data.length;i+=4){
      const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
      if(p.clipping==='shadows'&&r<=3&&g<=3&&b<=3){marked.data[i]=30;marked.data[i+1]=100;marked.data[i+2]=255;marked.data[i+3]=210;}
      else if(p.clipping==='highlights'&&(r>=252||g>=252||b>=252)){
        marked.data[i]=255;marked.data[i+1]=45;marked.data[i+2]=35;marked.data[i+3]=210;
      }
    }
    context.putImageData(marked,0,0);return overlay;
  },[p.clipping,actual,image,detail,p.detailFrame?.url]);
  useEffect(()=>{setZoom(1);setActual(false);setPan({x:0,y:0});},[p.sessionId]);
  const fw=p.frame?.fullWidth||1,fh=p.frame?.fullHeight||1;
  const rotation=p.adjustments?.rotation||0;
  const cropping=p.tool==='crop'||p.tool==='straighten';
  const effective=p.imageSize?.effectiveGeometry;
  const mirrorHorizontal=(p.adjustments?.flipHorizontal??effective?.flipHorizontal??false)!==(effective?.sourceFlipHorizontal??false);
  const mirrorVertical=(p.adjustments?.flipVertical??effective?.flipVertical??false)!==(effective?.sourceFlipVertical??false);
  const mirrorPoint=(q:Point)=>({...q,x:mirrorHorizontal?1-q.x:q.x,y:mirrorVertical?1-q.y:q.y});
  const mirrorCrop=(c:CropRect|null)=>c?{...c,x:mirrorHorizontal?1-c.x-c.width:c.x,y:mirrorVertical?1-c.y-c.height:c.y}:null;
  const displayCrop=(c:CropRect|null)=>mirrorCrop(rotateCrop(c,rotation));
  const cropPoint=(q:Point)=>mirrorPoint(rotatePoint(q,rotation));
  const crop=cropping?null:displayCrop(p.adjustments?.crop||null);
  const displayPoint=(point:Point)=>canvasPoint(rotatePoint(point,rotation),t);
  const mode=p.comparison?.layout||'off',dual=mode!=='off',horizontal=mode==='top-bottom'||mode==='split-horizontal';
  const paneWidth=mode==='left-right'?size.width/2:size.width,paneHeight=mode==='top-bottom'?size.height/2:size.height;
  const t=imageTransform(fw,fh,paneWidth,paneHeight,crop,zoom,pan,actual,devicePixelRatio);
  const wantsLinear=!!p.frame?.linear&&!p.luminanceMap&&!p.dustView?.enabled&&(!dual||!!p.comparison?.frame?.linear);
  const dust=useMemo(()=>{
    if(!p.dustView?.enabled)return undefined;
    const convert=(source:HTMLImageElement|undefined)=>{
      if(!source)return undefined;
      const result=document.createElement('canvas');result.width=source.naturalWidth;result.height=source.naturalHeight;
      const context=result.getContext('2d',{willReadFrequently:true})!;context.drawImage(source,0,0);
      const data=context.getImageData(0,0,result.width,result.height);data.data.set(repairDustPixels(data.data,result.width,result.height,p.dustView!.threshold));context.putImageData(data,0,0);return result;
    };
    return {fit:convert(image),detail:convert(detail)};
  },[image,detail,p.dustView?.enabled,p.dustView?.threshold]);
  const linearKey=JSON.stringify([p.frame?.linear?.url,p.detailFrame?.linear?.url,p.comparison?.frame?.linear?.url,p.comparison?.detail?.linear?.url,size.width,size.height,t.x,t.y,t.scale,crop,actual,mode,pixelRatio]);
  const linearActive=wantsLinear&&linearReady===linearKey&&!linearMessage;
  useEffect(()=>{
    setLinearReady('');setLinearRenderer(undefined);setLinearMessage('');if(!wantsLinear||!linearCanvas.current)return;
    let alive=true,renderer:LinearCanvas|undefined;
    const failed=(message:string)=>{if(alive){setLinearMessage(message);setLinearReady('');}};
    void LinearCanvas.create(linearCanvas.current,failed).then(result=>{if(!alive)result.destroy();else{renderer=result;setLinearRenderer(result);}}).catch(error=>failed(String(error)));
    return()=>{alive=false;renderer?.destroy();};
  },[wantsLinear,linearRetry]);
  useEffect(()=>{
    if(!wantsLinear||!linearRenderer||!p.frame||linearMessage)return;let alive=true;
    const area=crop||{x:0,y:0,width:1,height:1};
    const pane=(frame:PreviewFrame,detail:PreviewFrame|undefined,second:boolean):LinearPane=>{
      const ox=second&&mode==='left-right'?size.width/2:0,oy=second&&mode==='top-bottom'?size.height/2:0;
      const destination={x:t.x+ox,y:t.y+oy,width:fw*t.scale,height:fh*t.scale};
      let clip:ImageRect={x:0,y:0,width:size.width,height:size.height};
      if(dual)clip=horizontal?{x:0,y:second?size.height/2:0,width:size.width,height:size.height/2}:{x:second?size.width/2:0,y:0,width:size.width/2,height:size.height};
      const cropRect={x:destination.x+area.x*destination.width,y:destination.y+area.y*destination.height,width:area.width*destination.width,height:area.height*destination.height},x=Math.max(clip.x,cropRect.x),y=Math.max(clip.y,cropRect.y);
      clip={x,y,width:Math.max(0,Math.min(clip.x+clip.width,cropRect.x+cropRect.width)-x),height:Math.max(0,Math.min(clip.y+clip.height,cropRect.y+cropRect.height)-y)};
      return {frame,detail:detail?.sessionId===frame.sessionId&&detail.revision===frame.revision?detail:undefined,destination,clip,actual};
    };
    const panes=dual&&p.comparison?.frame?[pane(p.comparison.frame,p.comparison.detail,false),pane(p.frame,p.detailFrame,true)]:[pane(p.frame,p.detailFrame,false)];
    void linearRenderer.draw(panes,size.width,size.height,devicePixelRatio).then(drawn=>{if(alive&&drawn)setLinearReady(linearKey);}).catch(error=>{if(alive){setLinearMessage(String(error));setLinearReady('');}});
    return()=>{alive=false;};
  },[linearRenderer,linearKey,wantsLinear,linearMessage]);
  const viewKey=JSON.stringify([p.frame?.sessionId,p.frame?.revision,p.tool,size.width,size.height,t.x,t.y,t.scale,mode]);
  const [hover,setHover]=useState<{point:Point;key:string}>();
  const pointer=hover?.key===viewKey?hover:undefined;
  const loupePoint=p.guided.enabled&&!dual&&!p.busy&&image?.src===p.frame?.url&&(p.guided.loupe||altHeld)&&pointer
    ?p.guided.draft?.line[p.guided.draft.end]||pointer.point:undefined;
  const loupeArea=loupePoint?loupeRegion(loupePoint,fw,fh,devicePixelRatio):undefined;
  const straighten=useStraightenGesture({sessionId:p.sessionId,revision:p.frame?.revision,adjustments:p.adjustments,enabled:p.tool==='straighten',
    width:fw,height:fh,scale:t.scale,viewKey:JSON.stringify([size.width,size.height,t.x,t.y,t.scale,mode,fw,fh]),begin:p.beginCanvasEdit,error:p.error,done:p.straightenDone});
  const rangeGesture=useRangeGesture({sessionId:p.sessionId,revision:p.frame?.revision,adjustments:p.adjustments,tool:p.tool,maskId:p.selectedMask?.id,componentId:p.componentId,
    width:fw,height:fh,rotation,scale:t.scale,viewKey:JSON.stringify([size.width,size.height,t.x,t.y,t.scale,mode,fw,fh]),begin:p.beginCanvasEdit,sample:p.sampleRange,cancelSample:p.cancelSample,error:p.error});
  const colorSamples=p.selectedMask?.colorSamples;
  const colorKey=JSON.stringify([p.frame?.sessionId,p.frame?.revision,fw,fh,rotation,p.selectedMask?.id,p.componentId,colorSamples,p.tool]);
  const [colorMapping,setColorMapping]=useState<{key:string;points:(Point|null)[]}>(),[colorFailure,setColorFailure]=useState<{key:string;message:string}>(),[colorAttempt,setColorAttempt]=useState(0);
  const colorPins=colorMapping?.key===colorKey?colorMapping.points:undefined;
  useEffect(()=>{
    if(p.tool!=='color'||!p.frame||!colorSamples?.length)return;
    let alive=true;const frame=p.frame;
    void (async()=>{
      const anchors=colorSamples.flatMap(s=>s.sourcePoint?[s.sourcePoint]:[]).map(point=>{const q=rotatePoint(point,rotation);return {x:q.x*(fw-1),y:q.y*(fh-1)};});
      const result=anchors.length?await window.captraw.coordinates(frame.sessionId,frame.revision,'source','display',anchors):undefined;
      if(!alive)return;
      if(result&&(result.width!==fw||result.height!==fh||result.points.length!==anchors.length))throw new Error('照片尺寸已变化，请重试颜色标记。');
      let i=0;const points=colorSamples.map(s=>{
        if(s.sourcePoint)return result!.points[i++];
        // Existing documents have no source anchor; preserve their stored display position.
        const center=s.end?{x:(s.point.x+s.end.x)/2,y:(s.point.y+s.end.y)/2}:s.point,q=rotatePoint(center,rotation);
        return {x:q.x*fw-.5,y:q.y*fh-.5};
      });
      setColorMapping({key:colorKey,points});setColorFailure(points.some(q=>!q)?{key:colorKey,message:'部分颜色标记无法定位，可在右侧样本列表管理。'}:undefined);
    })().catch(error=>{if(alive)setColorFailure({key:colorKey,message:String(error)});});
    return()=>{alive=false;};
  },[colorKey,colorAttempt]);
  const maskGesture=useMaskGesture({sessionId:p.sessionId,revision:p.frame?.revision,mask:p.selectedMask,componentId:p.componentId,tool:p.tool,
    adjustments:p.adjustments,width:fw,height:fh,rotation,radius:p.brushSize,brush:p.brush,begin:p.beginMaskEdit,error:p.error});
  const rw=(rotation%180?p.imageSize?.height:p.imageSize?.width)||fw,rh=(rotation%180?p.imageSize?.width:p.imageSize?.height)||fh;
  const repairGesture=useRepairGesture({sessionId:p.sessionId,revision:p.frame?.revision,adjustments:p.adjustments,tool:p.tool,repair:p.repair,
    width:fw,height:fh,recipeWidth:rw,recipeHeight:rh,rotation,begin:p.beginCanvasEdit,error:p.error});
  useEffect(()=>{
    const command=p.viewCommand;if(!command||!p.frame||p.guided.active()||maskGesture.pending||repairGesture.pending||straighten.pending||rangeGesture.box)return;
    if(command.action==='fit'){setActual(false);setZoom(1);setPan({x:0,y:0});}
    else if(command.action==='actual'){setActual(true);setPan({x:0,y:0});}
    else{setActual(false);setZoom(z=>Math.max(.2,Math.min(12,z*(command.action==='zoom-in'?1.25:.8))));}
  },[p.viewCommand?.sequence]);
  const spots=(p.adjustments?.spots||[]).map(s=>s.id===repairGesture.draft?.id?repairGesture.draft:s);
  const repairKey=JSON.stringify([p.frame?.sessionId,p.frame?.revision,fw,fh,rw,rh,rotation,t.scale,spots,p.repair?.selectedId,p.repair?.source,p.repair?.guides,p.tool]);
  const [repairMapping,setRepairMapping]=useState<{key:string;targets:(Point|null)[];active?:RepairGuide;source?:Point|null}>();
  const [repairFailure,setRepairFailure]=useState(''),[repairAttempt,setRepairAttempt]=useState(0);
  const repairGuide=repairMapping?.key===repairKey?repairMapping:undefined;
  useEffect(()=>{
    if(p.tool!=='repair'||!p.repair?.guides||!p.frame)return;
    let alive=true;const frame=p.frame;
    const map=async(points:Point[])=>{
      const mapped:(Point|null)[]=[];
      for(let i=0;i<points.length;i+=4096){
        if(!alive)throw new Error('Repair guide cancelled');
        const result=await window.captraw.coordinates(frame.sessionId,frame.revision,'source','display',points.slice(i,i+4096));
        if(result.width!==fw||result.height!==fh)throw new Error('Repair guide dimensions changed');mapped.push(...result.points);
      }return mapped;
    };
    void (async()=>{
      const points=spots.map(s=>repairSourcePoint(s.target,rw,rh,rotation));
      if(p.repair?.source)points.push(repairSourcePoint(p.repair.source,rw,rh,rotation));
      const targets=await map(points),selected=spots.find(s=>s.id===p.repair?.selectedId);
      const active=selected?await mappedRepairGuide(selected,rw,rh,rotation,t.scale,map,()=>alive):undefined;
      if(alive){setRepairFailure('');setRepairMapping({key:repairKey,targets:targets.slice(0,spots.length),source:targets[spots.length],active});}
    })().catch(error=>{if(alive){setRepairMapping(undefined);setRepairFailure(repairKey);p.error(`无法准备修复控制点：${String(error)}。单击画布重试。`);}});
    return()=>{alive=false;};
  },[repairKey,repairAttempt]);
  const repairGuidePoint=(q:Point)=>({x:t.x+(q.x+.5)*t.scale,y:t.y+(q.y+.5)*t.scale});
  const repairPath=(segments:Point[][])=>segments.map(segment=>segment.map((q,i)=>{const v=repairGuidePoint(q);return `${i?'L':'M'}${v.x},${v.y}`;}).join(' ')).join(' ');
  const mask=maskGesture.draft||p.selectedMask;
  const guideKey=JSON.stringify([p.frame?.sessionId,p.frame?.revision,fw,fh,rotation,t.scale,mask?.id,p.componentId,mask?.type,mask?.initialized,mask?.start,mask?.end,mask?.referenceAngle,mask?.geometryReference]);
  const [mappedGuide,setMappedGuide]=useState<{key:string;handles:(Point|null)[];segments:Point[][]}>();
  const [guideFailure,setGuideFailure]=useState(''),[guideAttempt,setGuideAttempt]=useState(0);
  const guide=mappedGuide?.key===guideKey?mappedGuide:undefined;
  useEffect(()=>{
    if(!mask||mask.initialized===false||!p.frame||!['linear','radial'].includes(mask.type))return;
    let alive=true;const frame=p.frame;
    void mappedMaskGuide(mask,fw,fh,rotation,t.scale,async points=>{
      const result=await window.captraw.coordinates(frame.sessionId,frame.revision,'reference','display',points,mask.referenceAngle,mask.geometryReference);
      if(result.width!==fw||result.height!==fh)throw new Error('Mask guide dimensions changed');return result.points;
    },()=>alive).then(result=>{if(alive){setGuideFailure('');setMappedGuide({key:guideKey,...result});}}).catch(error=>{
      if(alive){setMappedGuide(undefined);setGuideFailure(guideKey);p.error(`无法准备蒙版控制点：${String(error)}。单击画布重试。`);}
    });
    return()=>{alive=false;};
  },[guideKey,guideAttempt]);
  const guidePoint=(q:Point)=>({x:t.x+q.x*t.scale,y:t.y+q.y*t.scale});
  useEffect(()=>{
    const c=canvas.current;if(!c)return;
    const dpr=devicePixelRatio;c.width=Math.round(size.width*dpr);c.height=Math.round(size.height*dpr);
    const ctx=c.getContext('2d',{colorSpace:'srgb'})!;ctx.scale(dpr,dpr);ctx.clearRect(0,0,size.width,size.height);
    if(!image)return;
    const gray=!dual&&p.luminanceMap&&luminanceImage?.src===p.frame?.luminance?.url?luminanceImage:undefined;
    const currentDetail=detail?.src===p.detailFrame?.url?detail:undefined;
    const currentBeforeDetail=beforeDetail?.src===p.comparison?.detail?.url?beforeDetail:undefined;
    const currentLuminanceDetail=luminanceDetail?.src===p.detailFrame?.luminance?.url?luminanceDetail:undefined;
    function draw(img:CanvasImageSource|undefined,region:CanvasImageSource|undefined,f:PreviewFrame|undefined,second:boolean){
      if(!img&&!region)return;ctx.save();
      if(dual){ctx.beginPath();if(horizontal)ctx.rect(0,second?size.height/2:0,size.width,size.height/2);else ctx.rect(second?size.width/2:0,0,size.width/2,size.height);ctx.clip();}
      if(second){if(mode==='left-right')ctx.translate(size.width/2,0);if(mode==='top-bottom')ctx.translate(0,size.height/2);}
      if(crop){ctx.beginPath();ctx.rect(t.x+crop.x*fw*t.scale,t.y+crop.y*fh*t.scale,crop.width*fw*t.scale,crop.height*fh*t.scale);ctx.clip();}
      ctx.imageSmoothingEnabled=!actual;if(img&&!linearActive)ctx.drawImage(img,t.x,t.y,fw*t.scale,fh*t.scale);
      if(actual&&region&&f&&!linearActive)ctx.drawImage(region,t.x+(f.x||0)*t.scale,t.y+(f.y||0)*t.scale,f.width*t.scale,f.height*t.scale);
      ctx.restore();
    }
    if(dual&&p.comparison?.frame?.fullWidth===fw&&p.comparison.frame.fullHeight===fh)draw(beforeImage,currentBeforeDetail,p.comparison.detail,false);
    draw(dust?.fit||gray||image,dust?.detail&&currentDetail?dust.detail:gray?currentLuminanceDetail:currentDetail,gray&&p.detailFrame?.luminance?{...p.detailFrame,...p.detailFrame.luminance}:p.detailFrame,dual);
    if(clippingCanvas){
      const region=actual&&detail?.src===p.detailFrame?.url?p.detailFrame:undefined;
      ctx.save();if(crop){ctx.beginPath();ctx.rect(t.x+crop.x*fw*t.scale,t.y+crop.y*fh*t.scale,crop.width*fw*t.scale,crop.height*fh*t.scale);ctx.clip();}
      if(region)ctx.drawImage(clippingCanvas,t.x+(region.x||0)*t.scale,t.y+(region.y||0)*t.scale,region.width*t.scale,region.height*t.scale);
      else ctx.drawImage(clippingCanvas,t.x,t.y,fw*t.scale,fh*t.scale);ctx.restore();
    }
    c.dataset.luminance=gray?.src||'';c.dataset.frame=image.src;c.dataset.detail=actual?currentDetail?.src||'':'';
    c.dataset.before=dual?beforeImage?.src||'':'';c.dataset.beforeDetail=dual&&actual?currentBeforeDetail?.src||'':'';c.dataset.layout=mode;c.dataset.clipping=p.clipping||'';c.dataset.dust=dust?'true':'false';
  },[image,detail,p.detailFrame,p.frame,luminanceImage,luminanceDetail,p.luminanceMap,size,zoom,pan,actual,p.adjustments?.crop,p.tool,mode,beforeImage,beforeDetail,p.comparison?.frame,p.comparison?.detail,clippingCanvas,p.clipping,linearActive,pixelRatio,dust]);
  useEffect(()=>{
    if((!actual&&!loupeArea)||!p.frame||p.busy)return;
    const timer=setTimeout(()=>{
      let region=actual?visibleImageRegion(t,paneWidth,paneHeight):null;
      if(loupeArea){
        const x=Math.min(region?.x??loupeArea.x,loupeArea.x),y=Math.min(region?.y??loupeArea.y,loupeArea.y);
        region={x,y,width:Math.max(region?region.x+region.width:0,loupeArea.x+loupeArea.width)-x,height:Math.max(region?region.y+region.height:0,loupeArea.y+loupeArea.height)-y};
      }
      if(!region)return;
      const {x,y,width,height}=region,d=p.detailFrame;
      if(!(d?.sessionId===p.frame!.sessionId&&d.revision===p.frame!.revision&&(d.x||0)<=x&&(d.y||0)<=y&&(d.x||0)+d.width>=x+width&&(d.y||0)+d.height>=y+height))p.viewport(x,y,width,height);
      if(actual&&p.comparison?.frame)p.comparison.viewport(x,y,width,height);
    },loupeArea?90:160);return()=>clearTimeout(timer);
  },[actual,pan,p.frame?.url,size,mode,p.comparison?.frame?.url,p.busy,loupeArea?.x,loupeArea?.y,loupeArea?.width,loupeArea?.height]);
  function point(event: React.PointerEvent): Point {
    const bounds=container.current!.getBoundingClientRect();const q=imagePoint(event.clientX-bounds.left,event.clientY-bounds.top,t);return rotatePoint(p.tool==='crop'?mirrorPoint(q):q,-rotation);
  }
  function repairPoint(event:React.PointerEvent):Point {
    const bounds=container.current!.getBoundingClientRect();return {x:(event.clientX-bounds.left-t.x)/t.scale-.5,y:(event.clientY-bounds.top-t.y)/t.scale-.5};
  }
  useEffect(()=>{repairGesture.cancel();if(p.guided.active())p.guided.cancel();},[size.width,size.height,mode,rotation,p.adjustments?.flipHorizontal,p.adjustments?.flipVertical]);
  function hoverAt(event:React.PointerEvent<HTMLDivElement>){
    setAltHeld(event.altKey);
    if(!p.guided.enabled||spaceHeld.current||event.buttons===4){setHover(undefined);return;}
    const q=repairPoint(event),area=crop||{x:0,y:0,width:1,height:1};
    if(q.x+.5<area.x*fw||q.y+.5<area.y*fh||q.x+.5>(area.x+area.width)*fw||q.y+.5>(area.y+area.height)*fh){setHover(undefined);return;}
    setHover({point:{x:Math.max(0,Math.min(fw-1,q.x)),y:Math.max(0,Math.min(fh-1,q.y))},key:viewKey});
  }
  function down(event:React.PointerEvent<HTMLDivElement>) {
    if(!image||event.button>1)return;
    hoverAt(event);
    const bounds=container.current!.getBoundingClientRect();
    const x=(event.clientX-bounds.left-t.x)/(fw*t.scale),y=(event.clientY-bounds.top-t.y)/(fh*t.scale);
    const area=crop||{x:0,y:0,width:1,height:1};
    if(p.tool!=='hand'&&!spaceHeld.current&&event.button!==1&&(x<area.x||y<area.y||x>area.x+area.width||y>area.y+area.height))return;
    if(p.tool==='perspective'&&!spaceHeld.current&&event.button===0){
      if(image.src===p.frame?.url&&p.guided.begin(repairPoint(event),t.scale))event.currentTarget.setPointerCapture(event.pointerId);return;
    }
    if(p.tool==='straighten'&&!spaceHeld.current&&event.button===0){
      if(image.src===p.frame?.url&&straighten.begin(repairPoint(event)))event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if(['brush','eraser','linear','radial'].includes(p.tool)&&!spaceHeld.current&&event.button===0){
      if(image.src!==p.frame?.url)return;
      let handle:MaskHandle|undefined;
      if(mask&&mask.initialized!==false&&(p.tool==='linear'||p.tool==='radial')){
        if(!guide){if(guideFailure===guideKey){setGuideFailure('');setGuideAttempt(n=>n+1);p.error('正在重试蒙版控制点映射。');}else p.error('正在准备蒙版控制点，请稍后重试。');return;}
        handle=(['start','end','move'] as const).find((_,i)=>{const q=guide.handles[i];if(!q)return false;const v=guidePoint(q);return Math.hypot(v.x+bounds.left-event.clientX,v.y+bounds.top-event.clientY)<=12;});
      }
      if(maskGesture.begin({x,y},handle,p.tool==='eraser'||event.altKey))event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if(p.tool==='object'&&!spaceHeld.current&&event.button===0){if(!p.object?.ready)return;const at=point(event);if(p.object.mode==='box'){event.currentTarget.setPointerCapture(event.pointerId);drag.current={start:at,previous:at,pan:{x:0,y:0},hand:false,rangePick:true,objectBox:true};setSampleBox({start:at,end:at});}else p.object.pick(at,event.altKey);return;}
    if((p.tool==='luminance'||p.tool==='color')&&!spaceHeld.current&&event.button===0){
      if(p.tool==='color'&&event.altKey){if(!colorPins){p.error('正在准备颜色样本标记，请稍后重试。');return;}const i=colorPins.findIndex(point=>{if(!point)return false;const q=repairGuidePoint(point);return Math.hypot(q.x+bounds.left-event.clientX,q.y+bounds.top-event.clientY)<=12;});if(i>=0)p.removeColor(i);return;}
      if(p.busy||image.src!==p.frame?.url)return;if(rangeGesture.begin(point(event),event.shiftKey))event.currentTarget.setPointerCapture(event.pointerId);return;}
    if(p.tool==='white-balance'&&!spaceHeld.current&&event.button===0){if(!p.busy)p.sample(point(event));return;}
    if(p.tool==='curve'&&!spaceHeld.current&&event.button===0){if(!p.busy&&image.src===p.frame?.url)p.sampleCurve(repairPoint(event));return;}
    if(p.tool==='repair'&&!spaceHeld.current&&event.button===0&&p.repair){
      if(image.src!==p.frame?.url)return;
      if(p.repair.guides&&!repairGuide){if(repairFailure===repairKey){setRepairFailure('');setRepairAttempt(n=>n+1);p.error('正在重试修复控制点映射。');}else p.error('正在准备修复控制点，请稍后重试。');return;}
      const at=repairPoint(event),hit=(q:Point|null|undefined)=>{if(!q)return false;const v=repairGuidePoint(q);return Math.hypot(v.x-(event.clientX-bounds.left),v.y-(event.clientY-bounds.top))<=12;};
      if(!event.altKey&&!p.repair.selectingSource&&p.repair.guides){
        const selected=spots.find(s=>s.id===p.repair?.selectedId);
        const source=selected&&hit(repairGuide?.active?.source),target=[...spots].reverse().find((_,i)=>hit(repairGuide?.targets[spots.length-1-i]));
        if(source||target){if(repairGesture.begin(at,false,{spot:source?selected!:target!,part:source?'source':'target'}))event.currentTarget.setPointerCapture(event.pointerId);return;}
      }
      if(repairGesture.begin(at,event.altKey))event.currentTarget.setPointerCapture(event.pointerId);return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const at=point(event);drag.current={start:at,previous:at,pan:{x:event.clientX-pan.x,y:event.clientY-pan.y},hand:spaceHeld.current||event.button===1};
    if(drag.current.hand)return;
    if(p.tool==='crop'&&p.adjustments?.crop){
      const rect=displayCrop(p.adjustments.crop)!,display=cropPoint(at);
      const handle=cropHandles.find(h=>{const q=canvasPoint(cropHandlePoint(rect,h),t);return Math.hypot(q.x-(event.clientX-bounds.left),q.y-(event.clientY-bounds.top))<=10;});
      if(handle)drag.current.crop={rect,handle};
      else if(display.x>=rect.x&&display.x<=rect.x+rect.width&&display.y>=rect.y&&display.y<=rect.y+rect.height)drag.current.crop={rect,handle:'move'};
    }
  }
  function move(event:React.PointerEvent<HTMLDivElement>) {
    hoverAt(event);
    if(p.guided.active()){p.guided.move(repairPoint(event),event.altKey);return;}
    if(straighten.active()){straighten.move(repairPoint(event));return;}
    if(maskGesture.active()){
      const b=event.currentTarget.getBoundingClientRect();maskGesture.move(imagePoint(event.clientX-b.left,event.clientY-b.top,t),p.tool==='eraser'||event.altKey);return;
    }
    if(repairGesture.active()){repairGesture.move(repairPoint(event));return;}
    if(rangeGesture.active()){rangeGesture.move(point(event));return;}
    const d=drag.current;const at=point(event);
    if(!d){
      if(p.tool==='crop'){
        const c=displayCrop(p.adjustments?.crop||null),v=cropPoint(at),b=event.currentTarget.getBoundingClientRect();
        const h=c&&cropHandles.find(h=>{const q=canvasPoint(cropHandlePoint(c,h),t);return Math.hypot(q.x-event.clientX+b.left,q.y-event.clientY+b.top)<=10;});
        const cursors={nw:'nwse-resize',n:'ns-resize',ne:'nesw-resize',e:'ew-resize',se:'nwse-resize',s:'ns-resize',sw:'nesw-resize',w:'ew-resize'};
        event.currentTarget.style.cursor=h?cursors[h]:c&&v.x>=c.x&&v.x<=c.x+c.width&&v.y>=c.y&&v.y<=c.y+c.height?'move':'crosshair';
      }return;
    }
    if(d.rangePick){d.previous=at;setSampleBox({start:d.start,end:at});return;}
    if(p.tool==='hand'||d.hand)setPan({x:event.clientX-d.pan.x,y:event.clientY-d.pan.y});
    else if(p.tool==='crop'){
      const start=cropPoint(d.start),end=cropPoint(at),locked=p.adjustments?.cropAspect;
      const aspect=locked?(rotation%180?1/locked:locked)*fh/fw:null;
      const next=d.crop?(d.crop.handle==='move'?moveCrop(d.crop.rect,end.x-start.x,end.y-start.y):resizeCrop(d.crop.rect,d.crop.handle,end,aspect)):drawCrop(start,end,aspect);
      if(next)p.edit(a=>({...a,crop:rotateCrop(mirrorCrop(next),-rotation)}),true);
    }
    d.previous=at;
  }
  function up(event:React.PointerEvent<HTMLDivElement>){if(p.guided.active()){setHover(undefined);void p.guided.end(repairPoint(event),event.altKey);return;}if(rangeGesture.active()){void rangeGesture.end(point(event));return;}if(straighten.active()){void straighten.end(repairPoint(event));return;}if(maskGesture.active()){const b=event.currentTarget.getBoundingClientRect();maskGesture.end(imagePoint(event.clientX-b.left,event.clientY-b.top,t),p.tool==='eraser'||event.altKey);return;}if(repairGesture.active()){repairGesture.end(repairPoint(event));return;}const d=drag.current;if(d){drag.current=undefined;if(d.rangePick){setSampleBox(undefined);const first=displayPoint(d.start),last=displayPoint(d.previous);if(d.objectBox){if(Math.hypot(first.x-last.x,first.y-last.y)>3)p.object?.pickBox(d.start,d.previous);}}else p.commit();}}
  function cancel(){if(p.guided.active())p.guided.cancel();rangeGesture.cancel();straighten.cancel();maskGesture.cancel();repairGesture.cancel();const d=drag.current;drag.current=undefined;setSampleBox(undefined);if(d&&!d.rangePick)p.commit();}
  return <section className="viewport-shell">
    <div ref={container} className={`viewport tool-${p.tool} ${dragOver?'drop-active':''}`} style={p.tool==='curve'?{cursor:'crosshair'}:undefined} data-testid="viewport"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={()=>setHover(undefined)}
      onWheel={e=>{if(!image||p.guided.active()||maskGesture.active()||repairGesture.active()||straighten.active()||rangeGesture.active())return;setActual(false);setZoom(z=>Math.max(.2,Math.min(12,z*Math.exp(-e.deltaY*.002))));}}
      onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
      onDrop={e=>{e.preventDefault();setDragOver(false);p.drop(window.captraw.droppedFiles(Array.from(e.dataTransfer.files)));}}>
      {wantsLinear&&<canvas key={linearRetry} ref={linearCanvas} className="linear-preview" aria-label="浮点显影预览" aria-hidden="true" style={{visibility:linearActive?'visible':'hidden'}} data-frame={linearActive?p.frame?.linear?.url:''} data-detail={linearActive&&actual?p.detailFrame?.linear?.url:''}/>}
      <canvas ref={canvas} aria-label="显影预览" />
      {!!p.frame?.linear&&!p.luminanceMap&&<div className="linear-display-status" role="status" onPointerDown={event=>event.stopPropagation()} title={linearMessage||'浮点数据和画布配置不代表屏幕物理亮度已验收。'}>{linearMessage?'已回退 SDR · 高光可能截断':!wantsLinear?'对比暂用 SDR · 高光可能截断':linearActive?'扩展范围画布 · 实际 HDR 亮度未验证':'正在准备浮点画布'}{linearMessage&&<button onClick={()=>{setLinearMessage('');setLinearRetry(n=>n+1);}}>重试浮点显示</button>}</div>}
      {p.beforeLabel&&image&&<div className="before-state-label" role="status">{p.beforeLabel} · 同步构图</div>}
      {dual&&image&&<div className={`comparison-labels ${horizontal?'horizontal':''}`} aria-label="前后对比"><span title="前状态沿用当前裁切、旋转、透视和镜头校正">{p.comparison?.label} · 同步构图</span><span>当前编辑</span></div>}
      {!image&&!p.busy&&<div className="welcome"><div className="welcome-mark"><Aperture size={48} strokeWidth={1}/></div><span className="eyebrow">A BETTER START FOR EVERY RAW</span><h1>从光线，开始。</h1><p>让原片的每一份细节，都有表达的空间。</p><button className="primary" onClick={p.open}><FolderOpen size={16}/>打开照片<span>⌘ O</span></button><small>或将 RAW 文件拖到这里<br/>所有显影均在本机完成，原片保持不变。</small></div>}
      {p.busy&&<div className="rendering"><i/>正在显影</div>}
      <svg className="mask-overlay" width={size.width} height={size.height} aria-hidden="true">
        <defs><clipPath id="mask-image-bounds"><rect x={t.x+(crop?.x||0)*fw*t.scale} y={t.y+(crop?.y||0)*fh*t.scale} width={(crop?.width||1)*fw*t.scale} height={(crop?.height||1)*fh*t.scale}/></clipPath>
          <mask id="mask-fit-region" maskUnits="userSpaceOnUse" x="0" y="0" width={size.width} height={size.height}><rect width={size.width} height={size.height} fill="white"/>{actual&&p.detailFrame?.mask&&p.detailFrame.mask.id===p.maskId&&<rect x={t.x+p.detailFrame.mask.x*t.scale} y={t.y+p.detailFrame.mask.y*t.scale} width={p.detailFrame.mask.width*t.scale} height={p.detailFrame.mask.height*t.scale} fill="black"/>}</mask>
        </defs>
        {p.object&&<g clipPath="url(#mask-image-bounds)"><defs><filter id="object-red" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 .2  0 0 0 0 .1  1 0 0 0 0"/></filter></defs>
          {p.object.url&&(()=>{const o=displayPoint({x:0,y:0}),x=displayPoint({x:1,y:0}),y=displayPoint({x:0,y:1});return <image data-testid="object-candidate-overlay" href={p.object!.url} x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform={`matrix(${x.x-o.x} ${x.y-o.y} ${y.x-o.x} ${y.y-o.y} ${o.x} ${o.y})`} filter="url(#object-red)" opacity=".45"/>;})()}
          {p.object.box&&(()=>{const start=displayPoint(p.object!.box!.start),end=displayPoint(p.object!.box!.end);return <rect data-testid="object-box" x={Math.min(start.x,end.x)} y={Math.min(start.y,end.y)} width={Math.abs(end.x-start.x)} height={Math.abs(end.y-start.y)} fill="none" stroke="white" strokeDasharray="4 3"/>;})()}
          {p.object.prompts.map((v,i)=>{const q=displayPoint(v.point);return <g key={i} data-testid="object-prompt"><circle cx={q.x} cy={q.y} r="8" fill={v.exclude?'#b33':'#176d40'} stroke="white"/><text x={q.x} y={q.y+4} textAnchor="middle" fill="white" fontSize="12">{v.exclude?'−':'+'}</text></g>;})}
        </g>}
        {(sampleBox||rangeGesture.box)&&(()=>{const box=(sampleBox||rangeGesture.box)!;const a=displayPoint(box.start),b=displayPoint(box.end);return <rect data-testid="luminance-sample-box" x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.abs(a.x-b.x)} height={Math.abs(a.y-b.y)} fill="#ffffff12" stroke="white" strokeDasharray="4 3" clipPath="url(#mask-image-bounds)"/>;})()}
        {p.tool==='color'&&colorPins?.map((point,i)=>{if(!point)return null;const q=repairGuidePoint(point);return <g data-testid="color-sample-pin" key={i} clipPath="url(#mask-image-bounds)"><circle cx={q.x} cy={q.y} r="10" fill="#333" stroke="white"/><text x={q.x} y={q.y+4} textAnchor="middle" fill="white" fontSize="11">{i+1}</text></g>;})}
        {p.tool==='repair'&&p.repair?.guides&&repairGuide&&<g data-testid="repair-guides" clipPath="url(#mask-image-bounds)">
          {spots.map((s,i)=>{const q=repairGuide.targets[i],target=q?repairGuidePoint(q):undefined,active=s.id===p.repair?.selectedId,g=active?repairGuide.active:undefined,source=g?.source?repairGuidePoint(g.source):undefined;return <g key={s.id} opacity={s.enabled?1:.45}>
            {target&&<circle data-testid={active?'repair-target-handle':undefined} cx={target.x} cy={target.y} r="3" fill={active?'#fff':'#333'} stroke="#fff"/>}
            {g&&<>{source&&target&&<line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#ddd" strokeDasharray="4 3"/>}
              <path className="repair-area" d={repairPath(g.targetRadius)} fill="none" stroke="#fff"/><path className="repair-area" d={repairPath(g.targetFeather)} fill="none" stroke="#aaa" strokeDasharray="3 3"/>
              <path className="repair-area" d={repairPath(g.sourceRadius)} fill="none" stroke="#abd2ff" strokeDasharray="4 3"/><path className="repair-area" d={repairPath(g.sourceFeather)} fill="none" stroke="#abd2ff" strokeDasharray="3 3"/>
              {source&&<circle data-testid="repair-source-handle" cx={source.x} cy={source.y} r="3" fill="#abd2ff"/>}</>}
          </g>;})}
          {repairGuide.source&&(p.repair.selectingSource||!p.repair.selectedId)&&(()=>{const v=repairGuidePoint(repairGuide.source!);return <g data-testid="repair-pending-source"><circle cx={v.x} cy={v.y} r="6" fill="none" stroke="#abd2ff"/><path d={`M${v.x-9},${v.y}h18 M${v.x},${v.y-9}v18`} stroke="#abd2ff"/></g>;})()}
        </g>}
        {p.overlay&&p.maskId&&p.frame?.mask?.id===p.maskId&&<g clipPath="url(#mask-image-bounds)" opacity=".45">
          <image data-testid="mask-coverage" href={p.frame.mask.url} x={t.x} y={t.y} width={fw*t.scale} height={fh*t.scale} preserveAspectRatio="none" mask="url(#mask-fit-region)"/>
          {actual&&p.detailFrame?.mask&&p.detailFrame.mask.id===p.maskId&&<image data-testid="mask-detail-coverage" href={p.detailFrame.mask.url} x={t.x+p.detailFrame.mask.x*t.scale} y={t.y+p.detailFrame.mask.y*t.scale} width={p.detailFrame.mask.width*t.scale} height={p.detailFrame.mask.height*t.scale} preserveAspectRatio="none"/>}
        </g>}
        {mask&&guide&&<g data-testid="mask-mapped-guide">
          <path data-testid="mask-guide-path" d={guide.segments.map(segment=>segment.map((q,i)=>{const v=guidePoint(q);return `${i?'L':'M'}${v.x},${v.y}`;}).join(' ')).join(' ')} fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray={mask.type==='radial'?'5 4':undefined}/>
          {guide.handles.map((q,i)=>{if(!q)return null;const v=guidePoint(q);return <circle key={i} data-testid={`mask-${['start','end','move'][i]}-handle`} cx={v.x} cy={v.y} r="5" fill={i?'#292b2e':'#f7f7f7'} stroke={i?'#fff':'#292b2e'}/>;})}
        </g>}
        {maskGesture.screen.length>0&&<g data-testid="mask-stroke-draft" clipPath="url(#mask-image-bounds)" opacity=".6">
          <polyline points={maskGesture.screen.map(q=>{const v=canvasPoint(q,t);return `${v.x},${v.y}`;}).join(' ')} fill="none" stroke="#ff745b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </g>}
        {cropping&&p.adjustments?.crop&&(()=>{const c=displayCrop(p.adjustments.crop)!,q=canvasPoint(c,t),width=c.width*fw*t.scale,height=c.height*fh*t.scale;return <g>
          <path fill="#0008" fillRule="evenodd" d={`M${t.x},${t.y}h${fw*t.scale}v${fh*t.scale}h${-fw*t.scale}Z M${q.x},${q.y}h${width}v${height}h${-width}Z`}/>
          <rect data-testid="crop-frame" x={q.x} y={q.y} width={width} height={height} fill="none" stroke="#fff"/>
          {[1/3,2/3].map(f=><g key={f}><line x1={q.x+width*f} y1={q.y} x2={q.x+width*f} y2={q.y+height} stroke="#ffffff60"/><line x1={q.x} y1={q.y+height*f} x2={q.x+width} y2={q.y+height*f} stroke="#ffffff60"/></g>)}
          {p.tool==='crop'&&cropHandles.map(h=>{const v=canvasPoint(cropHandlePoint(c,h),t);return <rect key={h} data-testid={`crop-handle-${h}`} x={v.x-4} y={v.y-4} width="8" height="8" fill="#fff" stroke="#222"/>;})}
        </g>;})()}
        {p.guided.enabled&&[...p.guided.lines.map((g,i)=>p.guided.draft?.index===i?p.guided.draft.line:g),...(p.guided.draft?.index===-1?[p.guided.draft.line]:[])].map((g,i)=>{const a=repairGuidePoint(g.start),b=repairGuidePoint(g.end);return <g key={i} data-testid="perspective-guide" data-axis={g.axis}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#111" strokeWidth="4"/><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={i===p.guided.selected?'#ffd987':'white'} strokeWidth="1.5"/>
          {[a,b].map((q,j)=><circle data-testid={`perspective-guide-${i}-${j}`} key={j} cx={q.x} cy={q.y} r="5" fill="white" stroke="#222"/>)}<text x={a.x+9} y={a.y-9} fill="white" stroke="#222" paintOrder="stroke" strokeWidth="2" fontSize="12">{i+1}</text>
        </g>;})}
        {straighten.line&&(()=>{const a=repairGuidePoint(straighten.line.start),b=repairGuidePoint(straighten.line.end);return <g data-testid="straighten-line">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#111" strokeWidth="4"/><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeWidth="1.5"/>
          {[a,b].map((q,i)=><circle key={i} cx={q.x} cy={q.y} r="4" fill="white" stroke="#111"/>)}
        </g>;})()}
      </svg>
      {loupePoint&&p.frame&&<GuidedLoupe point={loupePoint} screen={repairGuidePoint(loupePoint)} size={size} frame={p.frame} detail={p.detailFrame} image={detail}/>}
      {maskGesture.pending&&<span className="mask-gesture-status" role="status">{maskGesture.preparing?'正在准备自动蒙版 · Esc 取消':'正在绘制蒙版 · 松开后应用'}</span>}
      {repairGesture.pending&&<span className="mask-gesture-status" data-testid="repair-gesture-pending" role="status">正在定位修复区域 · 松开后应用</span>}
      {p.tool==='color'&&(colorFailure?.key===colorKey?<span className="mask-gesture-status" role="status">{colorFailure.message}<button onClick={()=>{setColorFailure(undefined);setColorAttempt(n=>n+1);}}>重试颜色标记</button></span>:colorSamples?.some(s=>!s.sourcePoint)&&<span className="mask-gesture-status" role="status">旧样本未记录原图位置；重新取样后标记可跟随几何变化。</span>)}
      {straighten.pending&&<span className="mask-gesture-status" data-testid="straighten-pending" role="status">正在拉直 · Esc 取消</span>}
    </div>
    <div className="view-controls"><button disabled={!p.frame||maskGesture.pending||repairGesture.pending||!!straighten.line||!!rangeGesture.box||p.guided.active()} onClick={()=>{setActual(false);setZoom(1);setPan({x:0,y:0});}} className={!actual&&zoom===1?'active':''} title="适应窗口 ⌘0"><Maximize size={14}/>适屏</button><button disabled={!p.frame||maskGesture.pending||repairGesture.pending||!!straighten.line||!!rangeGesture.box||p.guided.active()} onClick={()=>{setActual(true);setPan({x:0,y:0});}} className={actual?'active':''} title="原始像素预览 ⌘⌥0"><Scan size={14}/>1:1</button><span aria-label="缩放比例">{!p.frame?'—':actual?'100%':`${Math.round(t.scale*devicePixelRatio*100)}%`}</span>{p.comparisonControl}<span className="view-hint">{p.tool==='object'?(p.object?.mode==='box'?'拖动框住对象 · 空格平移':'单击添加 · Option 单击排除 · 空格平移'):p.tool==='white-balance'?'单击照片中的中性灰色 · I 选择吸管 · Esc 退出':p.tool==='repair'?(p.repair?.selectingSource?'单击选择取样来源':'单击目标修复 · ⌥ 单击重新取样 · 空格平移'):p.tool==='perspective'?'松手自动校正 · ⌥ 精细拖动 · 空格平移':p.tool==='straighten'?'沿水平或竖直参照线拖动 · Esc 取消':p.tool==='crop'?'拖动设置裁切范围':p.tool==='hand'?'⌘0 适屏 · ⌘⌥0 1:1 · ⌘+/- 缩放 · 拖动平移':p.tool==='eraser'?'在选中画笔蒙版中擦除':'拖动绘制 · 拖动中心移动 · 拖动端点调整范围'}</span></div>
  </section>;
}
