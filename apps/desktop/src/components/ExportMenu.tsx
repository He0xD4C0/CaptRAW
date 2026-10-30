import {useEffect,useRef} from 'react';
import {OUTPUT_COLOR_SPACES,type OutputColorSpace,type ImageSession,type Adjustments} from '@captraw/contracts';
import {outputDimensions,validateExportOptions,type ExportOptions,type ExportFormat} from '@captraw/contracts/export-options';

export function ExportMenu({colorSpace,change,close,run,count=1,options,setOptions,image,adjustments,disabled=false}:{colorSpace:OutputColorSpace;change:(v:OutputColorSpace)=>void;close:()=>void;run:(format:ExportFormat)=>void;count?:number;options:ExportOptions;setOptions:(v:ExportOptions)=>void;image?:ImageSession;adjustments?:Adjustments;disabled?:boolean}){
 const menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!disabled)menu.current?.querySelector('select')?.focus();},[disabled]);
 useEffect(()=>{
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
 return <div ref={menu} className="export-menu" role="dialog" aria-label="导出设置" aria-busy={disabled} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss();}}}>
  {disabled&&<p className="export-note" role="status">正在应用当前编辑，请稍候…</p>}
  <fieldset className="export-controls" disabled={disabled}>
  <p className="export-note">{count>1?`导出所选 ${count} 张照片 · 选择目标文件夹`:`导出所选照片 · ${image?.name||''}`}{count>1&&<><br/>同名文件自动编号，保留已有文件</>}</p>
  <label className="export-space">SDR 色彩空间<select aria-label="输出色彩空间" value={colorSpace} onChange={e=>change(e.target.value as OutputColorSpace)}>{Object.entries(OUTPUT_COLOR_SPACES).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
  <p className="export-note">JPEG / TIFF 使用所选 ICC · SDR</p>
  <label className="export-space">图像大小<select aria-label="输出尺寸方式" value={size.mode} onChange={e=>changeSize({mode:e.target.value as ExportOptions['size']['mode']})}><option value="original">原尺寸（保留裁切）</option><option value="long-edge">长边</option><option value="short-edge">短边</option><option value="bounds">边界框（宽 × 高）</option></select></label>
  {size.mode!=='original'&&<div className="export-fields"><label>{size.mode==='bounds'?'宽度':size.mode==='long-edge'?'长边':'短边'}<input aria-label="输出像素" type="number" min="1" max="65000" step="1" value={Number.isNaN(size.width)?'':size.width} onChange={e=>changeSize({width:e.target.valueAsNumber})}/>px</label>{size.mode==='bounds'&&<label>高度<input aria-label="输出高度" type="number" min="1" max="65000" step="1" value={Number.isNaN(size.height)?'':size.height} onChange={e=>changeSize({height:e.target.valueAsNumber})}/>px</label>}<label><input type="checkbox" checked={size.dontEnlarge} onChange={e=>changeSize({dontEnlarge:e.target.checked})}/>不放大</label></div>}
  <p className="export-note export-dimensions" aria-live="polite">{dimensions}{count>1?'（所选首张；每张按自身裁切比例计算）':' · 保持比例'}</p>
  <div className="export-fields"><label><input type="checkbox" checked={sharpen.enabled} onChange={e=>changeSharpen({enabled:e.target.checked})}/>输出锐化</label>{sharpen.enabled&&<><label>数量<input aria-label="输出锐化数量" type="number" min="0" max="300" step="1" value={Number.isNaN(sharpen.amount)?'':sharpen.amount} onChange={e=>changeSharpen({amount:e.target.valueAsNumber})}/></label><label>半径<input aria-label="输出锐化半径" type="number" min="0.1" max="3" step="0.1" value={Number.isNaN(sharpen.radius)?'':sharpen.radius} onChange={e=>changeSharpen({radius:e.target.valueAsNumber})}/>px</label></>}</div>
  <p className="export-note">仅作用于导出 · 锐化在缩放后应用</p>
  <div className="export-fields"><label>分辨率<input aria-label="输出分辨率" type="number" min="1" max="999" step="1" value={Number.isNaN(options.resolution)?'':options.resolution??300} onChange={e=>setOptions({...options,resolution:e.target.valueAsNumber})}/>PPI</label></div>
  <p className="export-note">PPI 决定打印尺寸，不改变像素数量。</p>
  <label className="export-space">元数据<select aria-label="输出元数据" value={options.metadata?.include==='all'?'all-except-develop':options.metadata?.include??'all-except-develop'} onChange={e=>setOptions({...options,metadata:{include:e.target.value as NonNullable<ExportOptions['metadata']>['include'],removeLocation:options.metadata?.removeLocation??false}})}><option value="all-except-develop">全部照片元数据</option><option value="copyright">仅版权与作者</option><option value="none">不保留</option></select></label>
  <div className="export-fields"><label><input type="checkbox" aria-label="移除输出位置信息" checked={options.metadata?.removeLocation??false} disabled={options.metadata?.include==='none'||options.metadata?.include==='copyright'} onChange={e=>setOptions({...options,metadata:{include:options.metadata?.include??'all-except-develop',removeLocation:e.target.checked}})}/>移除位置及相机私有数据</label></div>
  <p className="export-note">ICC 与打印参数始终保留；这些元数据选项作用于 JPEG／TIFF。</p>
  <div className="export-fields"><label>JPEG 质量<input aria-label="JPEG 质量" type="number" min="0" max="12" step="1" value={Number.isNaN(options.jpegQuality)?'':options.jpegQuality??12} onChange={e=>setOptions({...options,jpegQuality:e.target.valueAsNumber})}/></label><label>TIFF 压缩<select aria-label="TIFF 压缩" value={options.tiffCompression??'zip'} onChange={e=>setOptions({...options,tiffCompression:e.target.value as 'zip'|'none'})}><option value="zip">ZIP（无损）</option><option value="none">无压缩</option></select></label></div>
  {error&&<p className="export-error" role="alert">{error}</p>}
  <button disabled={!!error} onClick={()=>run('jpeg')}><strong>JPEG</strong><span>{OUTPUT_COLOR_SPACES[colorSpace]} · 8 位</span></button>
  <button disabled={!!error} onClick={()=>run('tiff')}><strong>TIFF · 16 位</strong><span>{OUTPUT_COLOR_SPACES[colorSpace]} · 适合后续编辑</span></button>
  <button disabled={!!error} onClick={()=>run('avif')}><strong>AVIF · HDR · 12 位</strong><span>Rec.2020 / PQ · 无损编码</span></button>
  <p className="export-note">HDR AVIF 固定 Rec.2020 / PQ，参考白 203 cd/m²；没有增益图，SDR 外观由查看器映射。12 位量化后的编码无损，超出色域的通道会裁剪。</p>
  </fieldset>
 </div>;
}
