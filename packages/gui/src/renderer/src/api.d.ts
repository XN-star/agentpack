import type {
  ConflictStrategy,
  ImportPreviewItem,
  ImportReport,
  ImportProgress,
  PackManifest,
  PackProgress,
  ScanResult,
  ScannedItem,
} from '@agentpack/core';

export interface ExportResultLite {
  ok: true;
  fileCount: number;
  totalBytes: number;
  outSize: number;
  payloadSha256: string;
}

export interface IpcError {
  ok: false;
  code: string;
  message: string;
}

export interface ImportPreviewResult {
  ok: true;
  manifest: PackManifest;
  preview: ImportPreviewItem[];
  agentHints: Record<string, string>;
}

export interface ImportExecuteResult {
  ok: true;
  report: ImportReport;
}

export interface AgentPackApi {
  scan(): Promise<ScanResult>;
  chooseManualPath(): Promise<string | null>;
  addManualPath(p: string): Promise<ScannedItem>;
  chooseSavePath(): Promise<string | null>;
  choosePackFile(): Promise<string | null>;
  getDefaultOutDir(): Promise<string>;
  exportPack(payload: {
    items: ScannedItem[];
    outPath: string;
    password: string;
    machineName?: boolean;
  }): Promise<ExportResultLite | IpcError>;
  importPreview(payload: {
    packPath: string;
    password: string;
  }): Promise<ImportPreviewResult | IpcError>;
  importExecute(payload: {
    packPath: string;
    password: string;
    decisions: Record<string, ConflictStrategy>;
  }): Promise<ImportExecuteResult | IpcError>;
  onExportProgress(cb: (p: PackProgress) => void): () => void;
  onImportProgress(cb: (p: ImportProgress) => void): () => void;
}

declare global {
  interface Window {
    agentpack: AgentPackApi;
  }
}
