import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import * as core from '@agentpack/core';
import type {
  ConflictStrategy,
  ImportProgress,
  ImportReport,
  PackProgress,
  ScanResult,
  ScannedItem,
} from '@agentpack/core';

let win: BrowserWindow | null = null;

function registryDir(): string {
  const candidates = [
    process.env.AGENTPACK_REGISTRY,
    app.isPackaged
      ? path.join(process.resourcesPath, 'registry')
      : path.resolve(app.getAppPath(), '../../registry'),
  ];
  return core.findRegistryDir(candidates);
}

/** 同一个包的解密句柄在预览与执行间复用 */
let cachedHandle: { packPath: string; handle: core.OpenPackHandle } | null = null;

async function getHandle(packPath: string, password: string) {
  if (cachedHandle && cachedHandle.packPath === packPath) {
    return cachedHandle.handle;
  }
  if (cachedHandle) {
    await cachedHandle.handle.close().catch(() => {});
    cachedHandle = null;
  }
  const handle = await core.openPack(packPath, password);
  cachedHandle = { packPath, handle };
  return handle;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'AgentPack 配置转场',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  win.on('closed', () => {
    win = null;
  });
}

function toIpcError(e: unknown): { code: string; message: string } {
  if (core.isAppError(e)) {
    return { code: e.code, message: e.message };
  }
  return { code: 'IO_ERROR', message: (e as Error)?.message ?? String(e) };
}

function sendExportProgress(p: core.PackProgress): void {
  win?.webContents.send('export-progress', p);
}

function sendImportProgress(p: core.ImportProgress): void {
  win?.webContents.send('import-progress', p);
}

function registerIpc(): void {
  ipcMain.handle('scan', async (): Promise<ScanResult> => {
    const regs = core.loadRegistries(registryDir());
    return core.scanRegistries(regs, core.defaultPathContext());
  });

  ipcMain.handle('choose-manual-path', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择要迁移的配置文件或目录',
      properties: ['openFile', 'openDirectory'],
    });
    if (r.canceled || r.filePaths.length === 0) {
      return null;
    }
    return r.filePaths[0];
  });

  ipcMain.handle(
    'add-manual-path',
    async (_e, p: string): Promise<ScannedItem> =>
      core.addManualPath(p, core.defaultPathContext()),
  );

  ipcMain.handle('choose-save-path', async () => {
    const r = await dialog.showSaveDialog(win!, {
      title: '选择导出文件保存位置',
      defaultPath: `配置迁移-${new Date().toISOString().slice(0, 10)}.agentpack`,
      filters: [{ name: 'AgentPack 导出包', extensions: ['agentpack'] }],
    });
    if (r.canceled || !r.filePath) {
      return null;
    }
    return r.filePath;
  });

  ipcMain.handle('choose-pack-file', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择 .agentpack 导入文件',
      properties: ['openFile'],
      filters: [{ name: 'AgentPack 导出包', extensions: ['agentpack'] }],
    });
    if (r.canceled || r.filePaths.length === 0) {
      return null;
    }
    return r.filePaths[0];
  });

  ipcMain.handle('choose-dir', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择本机目标目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || r.filePaths.length === 0) {
      return null;
    }
    return r.filePaths[0];
  });

  ipcMain.handle(
    'export-pack',
    async (
      _e,
      payload: {
        items: ScannedItem[];
        outPath: string;
        password: string;
        machineName?: boolean;
      },
    ) => {
      try {
        const result = await core.exportPack({
          items: payload.items,
          ctx: core.defaultPathContext(),
          outPath: payload.outPath,
          password: payload.password,
          machineName: payload.machineName ? os.hostname() : undefined,
          onProgress: (p: PackProgress) => sendExportProgress(p),
        });
        return {
          ok: true as const,
          fileCount: result.fileCount,
          totalBytes: result.totalBytes,
          outSize: result.outSize,
          payloadSha256: result.manifest.payload.sha256,
        };
      } catch (err) {
        return { ok: false as const, ...toIpcError(err) };
      }
    },
  );

  ipcMain.handle(
    'import-preview',
    async (_e, payload: {
      packPath: string;
      password: string;
      pathMap?: core.PathMapping[];
    }) => {
      try {
        const handle = await getHandle(payload.packPath, payload.password);
        const preview = core.previewImport(
          handle,
          core.defaultPathContext(),
          payload.pathMap,
        );
        const regs = core.loadRegistries(registryDir());
        const agentHints: Record<string, string> = {};
        for (const reg of regs) {
          agentHints[reg.id] = reg.restartHint;
        }
        return {
          ok: true as const,
          manifest: handle.manifest,
          preview,
          agentHints,
        };
      } catch (err) {
        return { ok: false as const, ...toIpcError(err) };
      }
    },
  );

  ipcMain.handle(
    'import-execute',
    async (_e, payload: {
      packPath: string;
      password: string;
      decisions: Record<string, ConflictStrategy>;
      pathMap?: core.PathMapping[];
    }) => {
      try {
        const handle = await getHandle(payload.packPath, payload.password);
        const report: ImportReport = await core.executeImport({
          handle,
          ctx: core.defaultPathContext(),
          decisions: payload.decisions,
          pathMap: payload.pathMap,
          onProgress: (p: ImportProgress) => sendImportProgress(p),
        });
        await handle.close().catch(() => {});
        if (cachedHandle?.packPath === payload.packPath) {
          cachedHandle = null;
        }
        return { ok: true as const, report };
      } catch (err) {
        return { ok: false as const, ...toIpcError(err) };
      }
    },
  );

  ipcMain.handle('get-history', async () => core.readHistory(200));

  ipcMain.handle('clear-history', async () => {
    core.clearHistory();
  });

  ipcMain.handle('get-default-out-dir', () => {
    const docs = app.getPath('documents');
    return fs.existsSync(docs) ? docs : os.homedir();
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (cachedHandle) {
    void cachedHandle.handle.close().catch(() => {});
    cachedHandle = null;
  }
  app.quit();
});
