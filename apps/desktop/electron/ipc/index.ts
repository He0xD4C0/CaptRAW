import type {App,Dialog,IpcMain} from 'electron';
import type {MainRuntime} from './context.js';
import {registerComparisonIpc} from './comparison.js';
import {registerDocumentIpc} from './documents.js';
import {registerExportIpc} from './export.js';
import {registerImagesIpc} from './images.js';
import {registerMasksIpc} from './masks.js';
import {registerPresetIpc} from './presets.js';

export function registerIpc(ipc:IpcMain,dialog:Dialog,app:App,runtime:MainRuntime){
  registerComparisonIpc(ipc,runtime);
  registerPresetIpc(ipc,dialog,runtime);
  registerImagesIpc(ipc,app,runtime);
  registerMasksIpc(ipc,runtime);
  registerDocumentIpc(ipc,dialog,runtime);
  registerExportIpc(ipc,dialog,runtime);
}
