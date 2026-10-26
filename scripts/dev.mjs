import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname,'..');
if(!existsSync(resolve(root,'build/native/captraw-engine')))throw new Error('请先运行 npm run build:native');
const build=spawn('npm',['run','build:ui'],{cwd:root,stdio:'inherit'});
await new Promise((resolve,reject)=>build.on('exit',code=>code===0?resolve():reject(new Error('UI build failed'))));
const vite=spawn(resolve(root,'node_modules/.bin/vite'),[],{cwd:root,stdio:'inherit'});
for(let i=0;i<50;i++){
  try{await fetch('http://127.0.0.1:5173');break;}catch{await new Promise(r=>setTimeout(r,100));}
}
const electron=spawn(resolve(root,'node_modules/.bin/electron'),['.'],{cwd:root,stdio:'inherit',env:{...process.env,CAPTRAW_DEV_URL:'http://127.0.0.1:5173'}});
electron.on('exit',code=>{vite.kill();process.exit(code||0);});
process.on('SIGINT',()=>{electron.kill();vite.kill();});
