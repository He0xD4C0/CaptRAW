import {useEffect,useRef} from 'react';
import {OUTPUT_COLOR_SPACES,type OutputColorSpace,type ImageSession,type Adjustments} from '@captraw/contracts';
import {outputDimensions,validateExportOptions,type ExportOptions} from '@captraw/contracts/export-options';

export function ExportMenu({colorSpace,change,close,run,count=1,options,setOptions,image,adjustments}:{colorSpace:OutputColorSpace;change:(v:OutputColorSpace)=>void;close:()=>void;run:(format:'jpeg'|'tiff')=>void;count?:number;options:ExportOptions;setOptions:(v:ExportOptions)=>void;image?:ImageSession;adjustments?:Adjustments}){
 const menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  menu.current?.querySelector('select')?.focus();
  const dismiss=(e:PointerEvent)=>{if(!(e.target as HTMLElement).closest('.export-container'))close();};
  document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);
 },[]);
 const dismiss=()=>{close();document.querySelector<HTMLButtonElement>('.export-button')?.focus();};
 const size=options.size,sharpen=options.sharpen;
 const changeSize=(patch:Partial<ExportOptions['size']>)=>setOptions({...options,size:{...size,...patch}});
 const changeSharpen=(patch:Partial<ExportOptions['sharpen']>)=>setOptions({...options,sharpen:{...sharpen,...patch}});
 let dimensions='',error='';
 try{
  validateExportOptions(options);
  if(image){
   let width=Math.max(1,Math.round(image.width*(adjustments?.crop?.width??1))),height=Math.max(1,Math.round(image.height*(adjustments?.crop?.height??1)));
   if((adjustments?.rotation??0)%180)[width,height]=[height,width];
   const result=outputDimensions(width,height,options);dimensions=`${result.width} × ${result.height} 像素`;
  }
 }catch(e){error=(e as Error).message;}
 return <div ref={menu} className="export-menu" role="dialog" aria-label="导出设置" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss();}}}>
  <p className="export-note">{count>1?`导出所选 ${count} 张照片 · 选择目标文件夹`:'导出当前照片'}{count>1&&<><br/>同名文件自动编号，保留已有文件</>}</p>
  <label className="export-space">色彩空间<select aria-label="输出色彩空间" value={colorSpace} onChange={e=>change(e.target.value as OutputColorSpace)}>{Object.entries(OUTPUT_COLOR_SPACES).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
  <p className="export-note">预览 sRGB · 输出嵌入所选 ICC · SDR</p>
  <label className="export-space">图像大小<select aria-label="输出尺寸方式" value={size.mode} onChange={e=>changeSize({mode:e.target.value as ExportOptions['size']['mode']})}><option value="original">原尺寸（保留裁切）</option><option value="long-edge">长边</option><option value="short-edge">短边</option><option value="bounds">边界框（宽 × 高）</option></select></label>
  {size.mode!=='original'&&<div className="export-fields"><label>{size.mode==='bounds'?'宽度':size.mode==='long-edge'?'长边':'短边'}<input aria-label="输出像素" type="number" min="1" max="65000" step="1" value={Number.isNaN(size.width)?'':size.width} onChange={e=>changeSize({width:e.target.valueAsNumber})}/>px</label>{size.mode==='bounds'&&<label>高度<input aria-label="输出高度" type="number" min="1" max="65000" step="1" value={Number.isNaN(size.height)?'':size.height} onChange={e=>changeSize({height:e.target.valueAsNumber})}/>px</label>}<label><input type="checkbox" checked={size.dontEnlarge} onChange={e=>changeSize({dontEnlarge:e.target.checked})}/>不放大</label></div>}
  <p className="export-note export-dimensions" aria-live="polite">{dimensions}{count>1?'（当前照片；每张按自身裁切比例计算）':' · 保持比例'}</p>
  <div className="export-fields"><label><input type="checkbox" checked={sharpen.enabled} onChange={e=>changeSharpen({enabled:e.target.checked})}/>输出锐化</label>{sharpen.enabled&&<><label>数量<input aria-label="输出锐化数量" type="number" min="0" max="300" step="1" value={Number.isNaN(sharpen.amount)?'':sharpen.amount} onChange={e=>changeSharpen({amount:e.target.valueAsNumber})}/></label><label>半径<input aria-label="输出锐化半径" type="number" min="0.1" max="3" step="0.1" value={Number.isNaN(sharpen.radius)?'':sharpen.radius} onChange={e=>changeSharpen({radius:e.target.valueAsNumber})}/>px</label></>}</div>
  <p className="export-note">仅作用于导出 · 锐化在缩放后应用</p>
  {error&&<p className="export-error" role="alert">{error}</p>}
  <button disabled={!!error} onClick={()=>run('jpeg')}><strong>JPEG</strong><span>{OUTPUT_COLOR_SPACES[colorSpace]} · 8 位</span></button>
  <button disabled={!!error} onClick={()=>run('tiff')}><strong>TIFF · 16 位</strong><span>{OUTPUT_COLOR_SPACES[colorSpace]} · 适合后续编辑</span></button>
 </div>;
}
