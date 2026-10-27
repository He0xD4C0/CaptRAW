import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {NativeEngine} from './engine.js';
export interface SegmentationRequest {
  sessionId:string;revision:number;path:string;imageSha256:string;width:number;height:number;
  points:[number,number][];labels:number[];
}
export interface SegmentationResult {
  sessionId:string;revision:number;imageSha256:string;modelId:string;width:number;height:number;
  selected:number;candidates:{index:number;score:number;pixels:number;file:string;sha256:string}[];
  cached:boolean;inputMs:number;encodeMs:number;decodeMs:number;writeMs:number;elapsedMs:number;
}
type Stage={event:'segment-stage';stage:'prepare'|'encode'|'decode'|'write';sessionId:string;revision:number};
type Worker={rpc:NativeEngine;cache:string;closed:Promise<void>;files:string[];failure?:string};
const cancelled=()=>Object.assign(new Error('对象选择已取消或已被新的操作替代。'),{name:'AbortError'});
export class Segmenter {
  private worker?:Worker;
  private generation=0;
  private lastRevision=0;
  private tail:Promise<unknown>=Promise.resolve();
  private disposed=false;
  constructor(private binary:string,private models:string,private cacheRoot:string,private onStage:(stage:Stage)=>void=()=>{}){}
  get processId(){return this.worker?.rpc.child.pid;}
  private async release(worker:Worker){
    worker.rpc.terminate();await worker.closed;
    await rm(worker.cache,{recursive:true,force:true});
  }
  private async ensure():Promise<Worker>{
    if(this.worker?.rpc.alive)return this.worker;
    if(this.worker){const old=this.worker;this.worker=undefined;await this.release(old);}
    await mkdir(this.cacheRoot,{recursive:true});const cache=await mkdtemp(join(this.cacheRoot,'worker-'));
    try{
      const rpc=new NativeEngine(this.binary,this.models,cache);
      const worker:Worker={rpc,cache,closed:new Promise(done=>rpc.child.once('close',()=>done())),files:[]};
      worker.rpc.on('engine-event',message=>{if(message.event==='error')worker.failure??=String(message.message);});
      this.worker=worker;return worker;
    }catch(error){await rm(cache,{recursive:true,force:true});throw error;}
  }
  request(supplied:SegmentationRequest):Promise<SegmentationResult>{
    if(this.disposed)return Promise.reject(new Error('对象选择服务已关闭。'));
    if(!Number.isSafeInteger(supplied.revision)||supplied.revision<=this.lastRevision)return Promise.reject(new Error('对象选择版本必须递增。'));
    const request=structuredClone(supplied),generation=++this.generation;this.lastRevision=request.revision;
    const task=this.tail.catch(()=>{}).then(async()=>{
      if(generation!==this.generation||this.disposed)throw cancelled();
      const worker=await this.ensure();
      if(generation!==this.generation||this.disposed){if(this.worker===worker){this.worker=undefined;await this.release(worker);}throw cancelled();}
      const stage=(message:Stage)=>{if(message.event==='segment-stage'&&message.revision===request.revision&&message.sessionId===request.sessionId&&generation===this.generation)this.onStage(message);};
      worker.rpc.on('engine-event',stage);
      try{
        const result:SegmentationResult=await worker.rpc.call('predict',request);
        if(result.sessionId!==request.sessionId||result.revision!==request.revision||result.imageSha256!==request.imageSha256||result.width!==request.width||result.height!==request.height||result.candidates?.length!==3)throw new Error('对象选择返回了不匹配的结果。');
        for(const item of result.candidates){const path=relative(worker.cache,resolve(item.file));if(!path||path.startsWith('..')||isAbsolute(path)||!/^mask-\d+-[012]\.png$/.test(path))throw new Error('对象选择返回了无效的缓存文件。');}
        if(generation!==this.generation||this.disposed){await Promise.all(result.candidates.map(c=>rm(c.file,{force:true})));throw cancelled();}
        // Candidate files are borrowed until the next successful result or cancel.
        // A committed selection must copy its asset before requesting another result.
        await Promise.all(worker.files.map(file=>rm(file,{force:true})));
        if(generation!==this.generation||this.disposed){await Promise.all(result.candidates.map(c=>rm(c.file,{force:true})));throw cancelled();}
        worker.files=result.candidates.map(c=>c.file);
        return result;
      }catch(error){
        if(generation!==this.generation||this.disposed)throw cancelled();
        if(worker.failure)throw new Error(worker.failure);
        throw error;
      }finally{worker.rpc.off('engine-event',stage);}
    });
    // Attach a rejection handler immediately; callers still receive their own rejection.
    this.tail=task.catch(()=>{});return task;
  }
  async cancel(){
    ++this.generation;const worker=this.worker,tail=this.tail;this.worker=undefined;
    if(worker)await this.release(worker);
    await tail;
  }
  async dispose(){this.disposed=true;await this.cancel();}
}
