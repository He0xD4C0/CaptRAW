import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
export class EngineClient extends EventEmitter {
  seq = 0; pending = new Map(); diagnostics = '';
  constructor({ root = process.cwd(), cache = 'build/test-cache', executable=process.env.CAPTRAW_ENGINE, resources=process.env.CAPTRAW_RESOURCES,env={} } = {}) {
    super();
    const binary=executable || resolve(root, 'build/native/captraw-engine');
    const args=[resources || resolve(root, 'build/native/resources'), resolve(root, cache)];
    this.child = spawn(process.env.CAPTRAW_SANDBOX_PROFILE?'/usr/bin/sandbox-exec':binary, process.env.CAPTRAW_SANDBOX_PROFILE?['-f',process.env.CAPTRAW_SANDBOX_PROFILE,binary,...args]:args, { env: { ...process.env, ...env, DISPLAY: '', WAYLAND_DISPLAY: '' } });
    this.child.stderr.on('data', x => { this.diagnostics += x; });
    this.ready = new Promise((resolve, reject) => {
      this.once('ready', resolve); this.child.once('error', reject);
      this.child.once('exit', (code, signal) => { reject(new Error(`Engine exit ${code}/${signal}: ${this.diagnostics.slice(-2000)}`)); for (const p of this.pending.values()) p.reject(new Error('Engine exited')); this.pending.clear(); });
    });
    createInterface({ input: this.child.stdout }).on('line', line => {
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        const p = this.pending.get(message.id); this.pending.delete(message.id);
        if (p) message.error ? p.reject(new Error(message.error)) : p.resolve(message.result);
      } else this.emit(message.event, message);
    });
  }
  async call(method, params = {}) {
    await this.ready; const id = ++this.seq;
    if(this.child.exitCode!==null||this.child.signalCode!==null||this.child.killed)throw new Error(`Engine exited: ${this.diagnostics.slice(-2500)}`);
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n',error=>{if(error){this.pending.delete(id);reject(error);}}); });
  }
  preview(revision, kind = 'fit', timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off('preview', listener); reject(new Error(`Preview ${revision}/${kind} timed out: ${this.diagnostics.slice(-1000)}`)); }, timeout);
      const listener = ({ frame }) => { if (frame.revision === revision && frame.kind === kind) { clearTimeout(timer); this.off('preview', listener); resolve(frame); } };
      this.on('preview', listener);
    });
  }
  async stop() { await this.call('close').catch(() => {}); this.child.stdin.end(); }
}
