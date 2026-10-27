import { spawn,spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname,'..');
for(const [file,command] of [['build/native/captraw-engine','build:native'],['build/xmp/captraw-xmp','build:xmp']]){
  if(!existsSync(resolve(root,file)))throw new Error(`请先运行 pnpm ${command}`);
}
for(const command of ['prepare:electron','build:ui']){
  const result=spawnSync('pnpm',[command],{cwd:root,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
const children=new Set();let stopping=false;
function stop(code=0){
  if(stopping)return;stopping=true;
  for(const child of children){
    try{if(process.platform==='win32')child.kill();else process.kill(-child.pid,'SIGTERM');}
    catch(error){if(error.code!=='ESRCH')console.error(error);}
  }
  process.exitCode=code;
}
function run(args,env={}){
  const child=spawn('pnpm',args,{cwd:root,stdio:'inherit',detached:process.platform!=='win32',env:{...process.env,...env}});
  children.add(child);child.on('error',error=>{console.error(error);stop(1);});
  child.on('exit',code=>{children.delete(child);if(!stopping)stop(code||0);});return child;
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
run(['--filter','@captraw/contracts','dev']);
run(['--filter','@captraw/desktop-core','dev']);
run(['--filter','@captraw/desktop','dev:electron']);
run(['--filter','@captraw/desktop','dev:renderer']);
let ready=false;
for(let i=0;i<100&&!stopping;i++){
  try{const response=await fetch('http://127.0.0.1:5173');if(response.ok){ready=true;break;}}catch{}
  await new Promise(done=>setTimeout(done,100));
}
if(!ready){console.error('Vite 未能启动。');stop(1);}
else if(!stopping)run(['exec','electron','.',...process.argv.slice(2)],{CAPTRAW_DEV_URL:'http://127.0.0.1:5173'});
