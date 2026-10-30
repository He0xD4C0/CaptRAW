import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {NativeEngine} from '../engine/engine.js';
import type {PersonPart} from '@captraw/contracts';
export interface SegmentationRequest {
  sessionId:string;revision:number;path:string;imageSha256:string;width:number;height:number;
  points:[number,number][];labels:number[];outputRotation?:number;
}
export interface SegmentationResult {
  sessionId:string;revision:number;imageSha256:string;modelId:string;width:number;height:number;
  maskWidth:number;maskHeight:number;
  selected:number;candidates:{index:number;score:number;pixels:number;file:string;sha256:string}[];
  cached:boolean;inputMs:number;encodeMs:number;decodeMs:number;writeMs:number;elapsedMs:number;
}
export interface PersonPartsRequest {sessionId:string;revision:number;path:string;imageSha256:string;width:number;height:number;outputRotation?:number}
export interface PersonPartsSegmentationResult {
  sessionId:string;revision:number;imageSha256:string;modelId:string;width:number;height:number;maskWidth:number;maskHeight:number;
  parts:{part:PersonPart;classIndex:number;pixels:number;file:string;sha256:string}[];
  inputMs:number;decodeMs:number;writeMs:number;elapsedMs:number;
}
export interface SemanticMasksRequest {sessionId:string;revision:number;path:string;imageSha256:string;width:number;height:number;outputRotation?:number}
export interface SemanticMasksSegmentationResult {
  sessionId:string;revision:number;imageSha256:string;modelId:string;width:number;height:number;maskWidth:number;maskHeight:number;
  parts:{part:'subject'|'background';classIndex:number;pixels:number;file:string;sha256:string}[];
  cached:boolean;inputMs:number;decodeMs:number;writeMs:number;elapsedMs:number;
}
export interface SkyMaskRequest {sessionId:string;revision:number;path:string;imageSha256:string;width:number;height:number;outputRotation?:number}
export interface SkyMaskSegmentationResult {
  sessionId:string;revision:number;imageSha256:string;modelId:string;width:number;height:number;maskWidth:number;maskHeight:number;
  selected:number;score:number;pixels:number;file:string;sha256:string;seedCount:number;cached:boolean;
  seedMs:number;inputMs:number;encodeMs:number;decodeMs:number;writeMs:number;elapsedMs:number;
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
    if(supplied.outputRotation!==undefined&&(!Number.isInteger(supplied.outputRotation)||![0,90,180,270].includes(supplied.outputRotation)))return Promise.reject(new Error('对象选择输出旋转角度无效。'));
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
        const swapped=request.outputRotation===90||request.outputRotation===270;
        if(result.maskWidth!==(swapped?request.height:request.width)||result.maskHeight!==(swapped?request.width:request.height))throw new Error('对象选择返回了不匹配的蒙版尺寸。');
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
  requestParts(supplied:PersonPartsRequest):Promise<PersonPartsSegmentationResult>{
    if(this.disposed)return Promise.reject(new Error('人物部位选择服务已关闭。'));
    if(supplied.outputRotation!==undefined&&(!Number.isInteger(supplied.outputRotation)||![0,90,180,270].includes(supplied.outputRotation)))return Promise.reject(new Error('人物部位输出旋转角度无效。'));
    if(!Number.isSafeInteger(supplied.revision)||supplied.revision<=this.lastRevision)return Promise.reject(new Error('人物部位选择版本必须递增。'));
    const request=structuredClone(supplied),generation=++this.generation;this.lastRevision=request.revision;
    const task=this.tail.catch(()=>{}).then(async()=>{
      if(generation!==this.generation||this.disposed)throw cancelled();
      const worker=await this.ensure();
      if(generation!==this.generation||this.disposed){if(this.worker===worker){this.worker=undefined;await this.release(worker);}throw cancelled();}
      const stage=(message:Stage)=>{if(message.event==='segment-stage'&&message.revision===request.revision&&message.sessionId===request.sessionId&&generation===this.generation)this.onStage(message);};
      worker.rpc.on('engine-event',stage);
      try{
        const result:PersonPartsSegmentationResult=await worker.rpc.call('parts',request);
        if(result.sessionId!==request.sessionId||result.revision!==request.revision||result.imageSha256!==request.imageSha256||result.width!==request.width||result.height!==request.height||result.parts?.length!==5)throw new Error('人物部位选择返回了不匹配的结果。');
        const swapped=request.outputRotation===90||request.outputRotation===270;
        if(result.maskWidth!==(swapped?request.height:request.width)||result.maskHeight!==(swapped?request.width:request.height))throw new Error('人物部位选择返回了不匹配的蒙版尺寸。');
        const expected:PersonPart[]=['hair','bodySkin','faceSkin','clothes','accessories'];
        for(const [index,item] of result.parts.entries()){
          if(item.part!==expected[index]||item.classIndex!==index+1||!Number.isInteger(item.pixels)||item.pixels<0)throw new Error('人物部位类别无效。');
          const path=relative(worker.cache,resolve(item.file));if(!path||path.startsWith('..')||isAbsolute(path)||!/^part-\d+-[1-5]\.png$/.test(path))throw new Error('人物部位选择返回了无效的缓存文件。');
        }
        if(generation!==this.generation||this.disposed){await Promise.all(result.parts.map(c=>rm(c.file,{force:true})));throw cancelled();}
        await Promise.all(worker.files.map(file=>rm(file,{force:true})));worker.files=result.parts.map(c=>c.file);
        return result;
      }catch(error){
        if(generation!==this.generation||this.disposed)throw cancelled();
        if(worker.failure)throw new Error(worker.failure);
        throw error;
      }finally{worker.rpc.off('engine-event',stage);}
    });
    this.tail=task.catch(()=>{});return task;
  }
  requestSemanticMasks(supplied:SemanticMasksRequest):Promise<SemanticMasksSegmentationResult>{
    if(this.disposed)return Promise.reject(new Error('自动主体蒙版服务已关闭。'));
    if(supplied.outputRotation!==undefined&&(!Number.isInteger(supplied.outputRotation)||![0,90,180,270].includes(supplied.outputRotation)))return Promise.reject(new Error('自动主体输出旋转角度无效。'));
    if(!Number.isSafeInteger(supplied.revision)||supplied.revision<=this.lastRevision)return Promise.reject(new Error('自动主体蒙版版本必须递增。'));
    const request=structuredClone(supplied),generation=++this.generation;this.lastRevision=request.revision;
    const task=this.tail.catch(()=>{}).then(async()=>{
      if(generation!==this.generation||this.disposed)throw cancelled();
      const worker=await this.ensure();
      if(generation!==this.generation||this.disposed){if(this.worker===worker){this.worker=undefined;await this.release(worker);}throw cancelled();}
      const stage=(message:Stage)=>{if(message.event==='segment-stage'&&message.revision===request.revision&&message.sessionId===request.sessionId&&generation===this.generation)this.onStage(message);};
      worker.rpc.on('engine-event',stage);
      try{
        const result:SemanticMasksSegmentationResult=await worker.rpc.call('semantic-masks',request);
        if(result.sessionId!==request.sessionId||result.revision!==request.revision||result.imageSha256!==request.imageSha256||result.width!==request.width||result.height!==request.height||result.parts?.length!==2)throw new Error('自动主体蒙版返回了不匹配的结果。');
        const swapped=request.outputRotation===90||request.outputRotation===270;
        if(result.maskWidth!==(swapped?request.height:request.width)||result.maskHeight!==(swapped?request.width:request.height))throw new Error('自动主体蒙版返回了不匹配的尺寸。');
        for(const [index,item] of result.parts.entries()){
          if(item.part!==(index===0?'subject':'background')||item.classIndex!==index||!Number.isInteger(item.pixels)||item.pixels<0)throw new Error('自动主体蒙版类别无效。');
          const path=relative(worker.cache,resolve(item.file));if(!path||path.startsWith('..')||isAbsolute(path)||!/^semantic-\d+-[01]\.png$/.test(path))throw new Error('自动主体蒙版返回了无效的缓存文件。');
        }
        if(generation!==this.generation||this.disposed){await Promise.all(result.parts.map(c=>rm(c.file,{force:true})));throw cancelled();}
        await Promise.all(worker.files.map(file=>rm(file,{force:true})));worker.files=result.parts.map(c=>c.file);
        return result;
      }catch(error){
        if(generation!==this.generation||this.disposed)throw cancelled();
        if(worker.failure)throw new Error(worker.failure);
        throw error;
      }finally{worker.rpc.off('engine-event',stage);}
    });
    this.tail=task.catch(()=>{});return task;
  }
  requestSky(supplied:SkyMaskRequest):Promise<SkyMaskSegmentationResult>{
    if(this.disposed)return Promise.reject(new Error('自动天空蒙版服务已关闭。'));
    if(supplied.outputRotation!==undefined&&(!Number.isInteger(supplied.outputRotation)||![0,90,180,270].includes(supplied.outputRotation)))return Promise.reject(new Error('自动天空输出旋转角度无效。'));
    if(!Number.isSafeInteger(supplied.revision)||supplied.revision<=this.lastRevision)return Promise.reject(new Error('自动天空蒙版版本必须递增。'));
    const request=structuredClone(supplied),generation=++this.generation;this.lastRevision=request.revision;
    const task=this.tail.catch(()=>{}).then(async()=>{
      if(generation!==this.generation||this.disposed)throw cancelled();
      const worker=await this.ensure();
      if(generation!==this.generation||this.disposed){if(this.worker===worker){this.worker=undefined;await this.release(worker);}throw cancelled();}
      const stage=(message:Stage)=>{if(message.event==='segment-stage'&&message.revision===request.revision&&message.sessionId===request.sessionId&&generation===this.generation)this.onStage(message);};
      worker.rpc.on('engine-event',stage);
      try{
        const result:SkyMaskSegmentationResult=await worker.rpc.call('sky',request);
        if(result.sessionId!==request.sessionId||result.revision!==request.revision||result.imageSha256!==request.imageSha256||result.width!==request.width||result.height!==request.height||!Number.isInteger(result.seedCount)||result.seedCount<3||result.seedCount>4)throw new Error('自动天空蒙版返回了不匹配的结果。');
        const swapped=request.outputRotation===90||request.outputRotation===270;
        if(result.maskWidth!==(swapped?request.height:request.width)||result.maskHeight!==(swapped?request.width:request.height))throw new Error('自动天空蒙版返回了不匹配的尺寸。');
        if(!Number.isInteger(result.pixels)||result.pixels<=0)throw new Error('自动天空蒙版为空。');
        const path=relative(worker.cache,resolve(result.file));if(!path||path.startsWith('..')||isAbsolute(path)||!/^sky-\d+\.png$/.test(path))throw new Error('自动天空蒙版返回了无效的缓存文件。');
        if(generation!==this.generation||this.disposed){await rm(result.file,{force:true});throw cancelled();}
        await Promise.all(worker.files.map(file=>rm(file,{force:true})));worker.files=[result.file];
        return result;
      }catch(error){
        if(generation!==this.generation||this.disposed)throw cancelled();
        if(worker.failure)throw new Error(worker.failure);
        throw error;
      }finally{worker.rpc.off('engine-event',stage);}
    });
    this.tail=task.catch(()=>{});return task;
  }
  async cancel(){
    ++this.generation;const worker=this.worker,tail=this.tail;this.worker=undefined;
    if(worker)await this.release(worker);
    await tail;
  }
  async dispose(){this.disposed=true;await this.cancel();}
}
