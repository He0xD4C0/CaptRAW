import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CaptRAWAPI } from '@captraw/contracts';
const invoke=async(channel:string,...args:unknown[])=>{
  try{return await ipcRenderer.invoke(channel,...args);}
  catch(error){const message=error instanceof Error?error.message:String(error);throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error(?: \[[^\]]+\])?: )?/,''));}
};
const api: CaptRAWAPI = {
  importInputProfile:sessionId=>invoke('profiles:import',sessionId),listInputProfiles:()=>invoke('profiles:list'),inspectInputProfile:reference=>invoke('profiles:inspect',reference),
  listPresets:()=>invoke('presets:list'),createPreset:input=>invoke('presets:create',input),
  updatePreset:(id,input)=>invoke('presets:update',{id,input}),renamePreset:(id,name,group)=>invoke('presets:rename',{id,name,group}),
  deletePreset:id=>invoke('presets:delete',id),importPreset:()=>invoke('presets:import'),exportPreset:id=>invoke('presets:export',id),
  applyPreset:(id,target)=>invoke('presets:apply',{id,target}),
  beginObject:(sessionId,adjustments,artProfile)=>invoke('object:begin',{sessionId,adjustments,artProfile}),
  predictObject:(id,prompts,box)=>invoke('object:predict',{id,prompts,box}),
  commitObject:(id,revision,index)=>invoke('object:commit',{id,revision,index}),
  cancelObject:id=>invoke('object:cancel',id),
  exportBatch:request=>invoke('images:export',request),
  synchronize:request=>invoke('images:synchronize',request),
  cancelSynchronize:()=>invoke('images:synchronize-cancel'),
  parametricCurve: settings=>invoke('curve:parametric',settings),
  chooseFiles: () => invoke('files:choose'),
  droppedFiles: files => files.map(file => webUtils.getPathForFile(file)),
  open: path => invoke('image:open', path),
  update: (sessionId, revision, adjustments, artProfile, maskId, luminance, colorSampling) => invoke('image:update', { sessionId, revision, adjustments, artProfile, maskId, luminance, colorSampling }),
  viewport: (sessionId, revision, x, y, width, height) => invoke('image:viewport', { sessionId, revision, x, y, width, height }),
  sampleColor:(sessionId,revision,start,end)=>invoke('image:color-sample',{sessionId,revision,start,end}),
  sampleLuminance:(sessionId,revision,start,end)=>invoke('image:luminance-sample',{sessionId,revision,start,end}),
  whiteBalance:(sessionId,request)=>invoke('image:white-balance',{sessionId,request}),
  before: (sessionId, revision) => invoke('image:before', { sessionId, revision }),
  save: (session, artProfile) => invoke('recipe:save', { session, artProfile }),
  export: (sessionId, artProfile, format, colorSpace, options) => invoke('image:export', { sessionId, artProfile, format, colorSpace, options }),
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
