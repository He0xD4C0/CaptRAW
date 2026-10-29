import {useEffect,useRef} from 'react';
import type {BatchSaveResult} from '@captraw/contracts';
export function BatchSaveDialog({busy,progress,result,error,cancel,close,retry}:{busy:boolean;progress:string;result:BatchSaveResult|null;error:string;cancel:()=>void;close:()=>void;retry:(path?:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="sync-dialog" aria-labelledby="save-selected-title" onCancel={e=>{e.preventDefault();busy?cancel():close();}}>
  <h2 id="save-selected-title">保存照片编辑</h2>
  <p className="sync-note">默认更新原片旁的同名 XMP，首次写入或外部修改后确认目标。原片保持不变。</p>
  {busy&&<p role="status">{progress}</p>}
  {error&&<p className="sync-error" role="alert">{error}</p>}
  {result&&<><p role="status">{result.cancelled?'已停止后续保存':'保存结束'} · 成功 {result.results.filter(r=>r.output).length} 张{result.results.some(r=>r.error)&&` · 失败 ${result.results.filter(r=>r.error).length} 张`}</p>
   <ul className="save-results">{result.results.map(r=><li key={r.source}><strong>{r.source.split(/[/\\]/).at(-1)}</strong><span className={r.error?'sync-error':''}>{r.output||r.error}</span>{r.error&&!busy&&<button onClick={()=>retry(r.source)}>另存此项…</button>}</li>)}</ul>
   <p className="sync-note">移动编辑文件时请同时保留对应的 .xmp.assets 文件夹。失败或尚未保存的照片仍保留未保存标记。</p></>}
  <footer>{busy?<button onClick={cancel}>完成当前文件后停止</button>:<>{(error||result?.cancelled||result?.results.some(r=>r.error))&&<button onClick={()=>retry()}>重试未保存项</button>}<button className="primary" onClick={close}>返回编辑</button></>}</footer>
 </dialog>;
}
