import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import {join} from 'node:path';
import {ENGINE_VERSION} from '@captraw/contracts';
import {terminateProcess} from './runtime.js';
export class NativeEngine extends EventEmitter {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  private exited=false;
  get alive(){return !this.exited&&!this.child.killed;}
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>();
  constructor(binary: string, resources: string, cache: string) {
    super(); mkdirSync(cache, { recursive: true });
    const log = createWriteStream(join(cache,'engine.log'), { flags: 'a' });
    this.child = spawn(binary, [resources, cache], { stdio: 'pipe',windowsHide:true });
    this.child.stderr.pipe(log);
    this.ready = new Promise((resolve, reject) => {
      this.once('ready', resolve);this.once('startup-error',reject); this.child.once('error', error=>{this.exited=true;log.end();reject(error);});
      this.child.once('exit', (code, signal) => {
        this.exited=true;
        const error = new Error(`显影核心已退出（${code ?? signal}），请重新打开图片重试。`);
        reject(error); for (const task of this.pending.values()) task.reject(error); this.pending.clear();
        this.emit('engine-event', { event: 'error', message: error.message }); log.end();
      });
    });
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line);
        if (typeof message.id === 'number') {
          const task = this.pending.get(message.id); this.pending.delete(message.id);
          if (task) message.error ? task.reject(new Error(message.error)) : task.resolve(message.result);
        } else if (message.event === 'ready') {
          if(message.engineVersion!==ENGINE_VERSION){
            this.emit('startup-error',new Error(`显影核心与应用处理版本不一致（应用 ${ENGINE_VERSION}；核心 ${message.engineVersion??'未报告'}），请使用同一构建的完整应用。`));
            this.terminate();return;
          }
          this.emit('ready');
        }
        else this.emit('engine-event', message);
      } catch { log.write(`Invalid protocol line: ${line}\n`); }
    });
  }
  async call(method: string, params: unknown = {}): Promise<any> {
    await this.ready;
    if (!this.alive) throw new Error('显影核心未运行，请重新打开图片。');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { this.pending.delete(id); reject(error); }
      });
    });
  }
  terminate() { terminateProcess(this.child); }
}
