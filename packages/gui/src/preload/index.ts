import { contextBridge, ipcRenderer } from 'electron';

const api = {
  scan: () => ipcRenderer.invoke('scan'),
  chooseManualPath: () => ipcRenderer.invoke('choose-manual-path'),
  addManualPath: (p: string) => ipcRenderer.invoke('add-manual-path', p),
  chooseSavePath: () => ipcRenderer.invoke('choose-save-path'),
  choosePackFile: () => ipcRenderer.invoke('choose-pack-file'),
  getDefaultOutDir: () => ipcRenderer.invoke('get-default-out-dir'),
  exportPack: (payload: unknown) => ipcRenderer.invoke('export-pack', payload),
  importPreview: (payload: unknown) =>
    ipcRenderer.invoke('import-preview', payload),
  importExecute: (payload: unknown) =>
    ipcRenderer.invoke('import-execute', payload),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  onExportProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
  onImportProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('import-progress', listener);
    return () => ipcRenderer.removeListener('import-progress', listener);
  },
};

contextBridge.exposeInMainWorld('agentpack', api);

export type Api = typeof api;
