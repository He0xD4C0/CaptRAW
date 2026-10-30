import type {Dialog,IpcMain} from 'electron';
import {basename,dirname,extname,join,resolve} from 'node:path';
import {realpath,stat,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativeEngine,captureSourceIdentity,verifySourceIdentity} from '@captraw/desktop-core/engine';
import {BatchExporter,finishOutputMetadata,validateBatch} from '@captraw/desktop-core/export';
import {OUTPUT_COLOR_SPACES,type ExportRequest} from '@captraw/contracts';
import type {MainRuntime} from './context.js';

export function registerExportIpc(ipc:IpcMain,dialog:Dialog,runtime:MainRuntime){
  ipc.handle('images:export',async(_,request)=>{
    if(runtime.exportPending)throw new Error('已有导出任务正在运行。');
    validateBatch(request);runtime.exportPending=true;
    try{
      const result=await dialog.showOpenDialog(runtime.win,{title:`导出 ${request.documents.length} 张照片：选择文件夹`,properties:['openDirectory','createDirectory']});
      if(result.canceled||!result.filePaths.length)return null;
      return await runtime.batchExporter.run(request,result.filePaths[0]);
    }finally{runtime.exportPending=false;}
  });
  ipc.handle('image:export', async (_, input:ExportRequest) => {
    if (runtime.exportPending) throw new Error('已有导出任务正在运行。');
    const {document:current,format,colorSpace,options}=structuredClone(input);
    validateBatch({documents:[current],format,colorSpace,options});
    runtime.exportPending=true;
    try{
    const sourceIdentity=current.sourceIdentity??await captureSourceIdentity(current.path);
    await verifySourceIdentity(current.path,sourceIdentity);
    const colorName=format==='avif'?'Rec.2020 / PQ HDR':OUTPUT_COLOR_SPACES[colorSpace];
    const extension = format === 'jpeg' ? 'jpg' : format==='avif'?'avif':'tiff';
    const result = await dialog.showSaveDialog(runtime.win, { title: '导出照片', defaultPath: join(dirname(current.path), `${basename(current.path, extname(current.path))}_CaptRAW.${extension}`), filters: [{ name: `${format === 'jpeg' ? 'JPEG' : format==='avif'?'AVIF · 12 位':'TIFF · 16 位'} · ${colorName}`, extensions: [extension] }] });
    if (result.canceled || !result.filePath) return null;
    if(!(format==='jpeg'?/\.(jpg|jpeg)$/i:format==='avif'?/\.avif$/i:/\.(tif|tiff)$/i).test(result.filePath))throw new Error('请选择与导出格式对应的 JPEG、TIFF 或 AVIF 文件名。');
    if (resolve(result.filePath) === current.path || /\.(nef|cr3|cr2|arw|raf|dng|xmp|arp)$/i.test(result.filePath)) throw new Error('不能覆盖原始照片或编辑资产。');
    const outputPath=result.filePath;
    const assertOutputNotSource=async()=>{
      const [sourcePath,targetDirectory,source,target]=await Promise.all([
        realpath(current.path),realpath(dirname(outputPath)),stat(current.path,{bigint:true}),
        stat(outputPath,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;})
      ]);
      if(join(targetDirectory,basename(outputPath))===sourcePath||(target&&target.dev===source.dev&&target.ino===source.ino))throw new Error('不能覆盖原始照片或其文件系统别名。');
    };
    await assertOutputNotSource();
    const job = randomUUID(), temp = `${result.filePath}.${job}.tmp`;
    runtime.exportTemp=temp;
    runtime.exportCancelled = false;
    const worker = new NativeEngine(runtime.binary, runtime.resources, join(runtime.cache, `export-${job}`)); runtime.exporter = worker;
    worker.on('engine-event', message => { if (message.event === 'progress') runtime.send({ event: 'job', job: { id: job, state: 'running', progress: message.progress, message: '正在处理并导出照片…' } }); });
    runtime.send({ event: 'job', job: { id: job, state: 'running', progress: 0, message: '正在处理并导出照片…' } });
    try {
      const {artProfile}=await worker.call('compose',current);
      if (runtime.exportCancelled) throw new Error('已取消导出');
      const output=await worker.call('export', { path: current.path, artProfile, output: temp, format, colorSpace, options, rating:current.rating });
      if(!runtime.exportCancelled)await finishOutputMetadata(worker,runtime.documents.xmp,current,format,options,output);
      if (runtime.exportCancelled) throw new Error('已取消导出');
      await verifySourceIdentity(current.path,sourceIdentity);
      await assertOutputNotSource();
      if (runtime.exportCancelled) throw new Error('已取消导出');
      await rename(temp, result.filePath);
      runtime.send({ event: 'job', job: { id: job, state: 'done', progress: 1, message: `已导出 ${basename(result.filePath)}` } });
      return result.filePath;
    } catch (error) {
      runtime.send({ event: 'job', job: { id: job, state: runtime.exportCancelled ? 'cancelled' : 'error', progress: 0, message: runtime.exportCancelled ? '已取消导出' : String(error) } });
      if (!runtime.exportCancelled) throw error; return null;
    } finally {
      const stopped=worker.child.exitCode!==null||worker.child.signalCode!==null?Promise.resolve():new Promise<void>(done=>worker.child.once('exit',()=>done()));
      worker.terminate();await stopped;runtime.exporter = undefined;runtime.exportTemp=undefined; await rm(temp, { force: true }); await rm(join(runtime.cache, `export-${job}`), { recursive: true, force: true });
    }
    }finally{runtime.exportPending=false;}
  });
  ipc.handle('job:cancel', async () => { if(runtime.batchExporter.active)runtime.batchExporter.cancel();else if (runtime.exporter) { runtime.exportCancelled = true; runtime.exporter.terminate(); } else await runtime.engine?.call('cancel'); });
}
