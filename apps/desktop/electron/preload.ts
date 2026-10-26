import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CaptRAWAPI } from '../../../packages/contracts';
const invoke=async(channel:string,...args:unknown[])=>{
  try{return await ipcRenderer.invoke(channel,...args);}
  catch(error){const message=error instanceof Error?error.message:String(error);throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error(?: \[[^\]]+\])?: )?/,''));}
};
const api: CaptRAWAPI = {
  chooseFiles: () => invoke('files:choose'),
  droppedFiles: files => files.map(file => webUtils.getPathForFile(file)),
  open: (path,baselineVersion) => invoke('image:open', path,baselineVersion),
  update: (sessionId, revision, adjustments, artProfile, maskId) => invoke('image:update', { sessionId, revision, adjustments, artProfile, maskId }),
  viewport: (sessionId, revision, x, y, width, height) => invoke('image:viewport', { sessionId, revision, x, y, width, height }),
  whiteBalance:(sessionId,request)=>invoke('image:white-balance',{sessionId,request}),
  before: (sessionId, revision) => invoke('image:before', { sessionId, revision }),
  save: (session, artProfile) => invoke('recipe:save', { session, artProfile }),
  export: (sessionId, artProfile, format) => invoke('image:export', { sessionId, artProfile, format }),
  cancel: () => invoke('job:cancel'),
  close: () => invoke('image:close'),
  confirmClose:name=>invoke('document:confirm-close',name),
  setDirty:paths=>invoke('documents:dirty',paths),
  onEvent: listener => {
    const handler = (_: unknown, event: Parameters<typeof listener>[0]) => listener(event);
    ipcRenderer.on('engine:event', handler); return () => ipcRenderer.removeListener('engine:event', handler);
  }
};
contextBridge.exposeInMainWorld('captraw', api);
