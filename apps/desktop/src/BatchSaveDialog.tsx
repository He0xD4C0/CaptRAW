import {useEffect,useRef} from 'react';
import type {BatchSaveResult} from '@captraw/contracts';
export function BatchSaveDialog({busy,progress,result,error,cancel,close}:{busy:boolean;progress:string;result:BatchSaveResult|null;error:string;cancel:()=>void;close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="sync-dialog" aria-labelledby="save-selected-title" onCancel={e=>{e.preventDefault();busy?cancel():close();}}>
  <h2 id="save-selected-title">保存所选照片</h2>
  <p className="sync-note">每张照片保存为独立 XMP，蒙版和配置文件资产随附。同名文件保留，新文件自动编号。</p>
  {busy&&<p role="status">{progress}</p>}
  {error&&<p className="sync-error" role="alert">{error}</p>}
  {result&&<><p role="status">{result.cancelled?'已停止后续保存':'保存结束'} · 成功 {result.results.filter(r=>r.output).length} 张{result.results.some(r=>r.error)&&` · 失败 ${result.results.filter(r=>r.error).length} 张`}</p>
   <ul className="save-results">{result.results.map(r=><li key={r.source}><strong>{r.source.split('/').at(-1)}</strong><span className={r.error?'sync-error':''}>{r.output||r.error}</span></li>)}</ul>
   <p className="sync-note">移动编辑文件时请同时保留对应的 .xmp.assets 文件夹。失败或尚未保存的照片仍保留未保存标记。</p></>}
  <footer>{busy?<button onClick={cancel}>完成当前文件后停止</button>:<button className="primary" onClick={close}>完成</button>}</footer>
 </dialog>;
}
