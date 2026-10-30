import {relative,isAbsolute,sep} from 'node:path';
import type {ChildProcess} from 'node:child_process';

export function executableName(name:string,platform:NodeJS.Platform=process.platform){
 return platform==='win32'?name+'.exe':name;
}
export function isContainedFile(directory:string,file:string){
 const path=relative(directory,file);
 return !!path&&!isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep);
}
export function documentRelativePath(directory:string,file:string){
 return relative(directory,file).split(sep).join('/');
}
export function terminateProcess(child:ChildProcess){
 if(child.exitCode===null&&child.signalCode===null&&!child.killed)child.kill('SIGTERM');
}
