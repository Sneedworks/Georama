import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GeoramaApi } from '../src/shared/ipc';

contextBridge.exposeInMainWorld('georama', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC.getInfo),
} satisfies GeoramaApi));
