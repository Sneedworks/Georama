import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GeoramaApi } from '../src/shared/ipc';

contextBridge.exposeInMainWorld('georama', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC.getInfo),\n  selectUserAssets: () => ipcRenderer.invoke(IPC.selectUserAssets),\n  readUserImage: (kind, reference) => ipcRenderer.invoke(IPC.readUserImage, kind, reference),
} satisfies GeoramaApi));
