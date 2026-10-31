/** 条目业务分类 */
export type Category =
  | 'settings'
  | 'prompt'
  | 'rules'
  | 'skills'
  | 'mcp'
  | 'memory'
  | 'credentials'
  | 'other';

/**
 * 敏感级：
 * - normal  普通配置
 * - secret  凭据类（导出默认排除，内容在预览中打码）
 * - bound   设备绑定/登录态（不可迁移）
 */
export type Sensitivity = 'normal' | 'secret' | 'bound';

/** 路径上下文：占位符展开的目标机器基准目录 */
export interface PathContext {
  home: string;
  appdata: string;
  localappdata: string;
}

/**
 * 自定义路径映射（导入方提供）：把来源机器的路径前缀映射到目标机器。
 * 两端均为正斜杠形式；不写入 agentpack 包文件。
 */
export interface PathMapping {
  /** 来源机器路径前缀（正斜杠） */
  from: string;
  /** 目标机器路径前缀（正斜杠） */
  to: string;
}

/** registry 中一个条目（registry JSON 里的 items 元素） */
export interface RegistryItem {
  id: string;
  label: string;
  /** 相对 root.base 的路径，正斜杠 */
  path: string;
  /**
   * - file/dir：整文件/整目录
   * - json-fields：只提取 JSON 顶层的指定字段（fields），导入时与目标文件深合并，
   *   用于「配置与账号态混在同一文件」的场景（如 Claude Code 的 .claude.json）
   */
  type: 'file' | 'dir' | 'json-fields';
  category: Category;
  sensitivity: Sensitivity;
  defaultSelected: boolean;
  migratable?: boolean;
  /** 不可迁移原因或补充说明 */
  reason?: string;
  note?: string;
  /** 目录内排除的 glob（相对条目根） */
  exclude?: string[];
  /** type=json-fields：要提取的顶层字段名 */
  fields?: string[];
  /** 符号链接处理：dereference（默认）| skip */
  linkPolicy?: 'dereference' | 'skip';
}

/** registry 中一个配置根（一个 agent 可有多个安装位置） */
export interface RegistryRoot {
  id: string;
  /** 含 {{home}} 等占位符的基准目录 */
  base: string;
  items: RegistryItem[];
}

export interface RegistryVersionProbe {
  path: string;
  /**
   * - json：从 path 指向的 JSON 文件按 field（点分路径）取版本
   * - dirname-version：列出 dir 下的目录名，用内置的字面量规则
   *   提取开头版本号（如 2.0.32-x64 → 2.0.32）
   */
  kind: 'json' | 'dirname-version';
  /** kind=json：点分字段路径，如 "version" */
  field?: string;
  /** kind=dirname-version：父目录（token 路径） */
  dir?: string;
}

/** 一个 agent 的完整描述（registry/*.json） */
export interface AgentRegistry {
  id: string;
  name: string;
  description?: string;
  /** 导入完成后提示用户如何让配置生效 */
  restartHint: string;
  roots: RegistryRoot[];
  versionProbes?: RegistryVersionProbe[];
  /** 界面中展示的「不可迁移项」说明 */
  nonMigratable?: Array<{ path: string; reason: string }>;
}

/** 扫描出的一个条目 */
export interface ScannedItem {
  key: string;
  agentId: string;
  agentName: string;
  itemId: string;
  label: string;
  type: 'file' | 'dir' | 'json-fields';
  category: Category;
  sensitivity: Sensitivity;
  defaultSelected: boolean;
  migratable: boolean;
  reason?: string;
  note?: string;
  /** 条目自身的占位符路径（正斜杠） */
  placeholderPath: string;
  /** 本机绝对路径（已解引用） */
  targetAbs: string;
  /** type=json-fields：要提取的顶层字段 */
  fields?: string[];
  exists: boolean;
  size: number;
  fileCount: number;
  linkCount: number;
  warnings: string[];
}

export interface ScannedAgent {
  id: string;
  name: string;
  description?: string;
  restartHint: string;
  version: string | null;
  found: boolean;
  items: ScannedItem[];
  nonMigratable?: Array<{ path: string; reason: string }>;
}

export interface ScanResult {
  ctx: PathContext;
  scannedAt: string;
  agents: ScannedAgent[];
  /** 「手动添加」条目（不属于任何内置 agent） */
  manualItems: ScannedItem[];
}

/** 打包清单（.agentpack 明文部分，不含任何条目信息） */
export interface PackManifest {
  format: 'agentpack/1';
  toolVersion: string;
  createdAt: string;
  sourceOs: 'windows';
  sourceMachineName?: string;
  kdf: {
    algo: 'scrypt';
    salt: string;
    N: number;
    r: number;
    p: number;
    keyLen: number;
  };
  payload: {
    algo: 'aes-256-gcm';
    nonce: string;
    /** payload.bin（含 nonce 前缀与 tag 尾缀）的 sha256，hex */
    sha256: string;
    size: number;
  };
}

/** 打包文件条目（在加密的 entries.json 内） */
export interface PackedFileEntry {
  /** 包内唯一键，如 f0001 */
  key: string;
  itemKey: string;
  /** 目标机器占位符路径（正斜杠） */
  dest: string;
  size: number;
  sha256: string;
  /** 内容与另一条目相同（按内容去重），值为源条目的 key */
  sameAs?: string;
  /** json-fields 条目：导入时与目标已有 JSON 深合并（不整文件覆盖） */
  merge?: boolean;
}

export interface PackedItemEntry {
  key: string;
  agentId: string;
  agentName: string;
  itemId: string;
  label: string;
  type: 'file' | 'dir' | 'json-fields';
  category: Category;
  sensitivity: Sensitivity;
  /** 展示用：条目占位符路径 */
  placeholderPath: string;
  fileCount: number;
}

export interface EntriesDoc {
  schema: 'agentpack.entries/1';
  items: PackedItemEntry[];
  files: PackedFileEntry[];
  /** 来源机器的路径基准，用于导入时的路径改写 transformer */
  sourcePathContext: PathContext;
  exportedAt: string;
}

export type ConflictStrategy = 'overwrite' | 'skip' | 'backup';

/** 导入/导出历史记录（仅元信息，不含配置内容） */
export interface HistoryEntry {
  id: string;
  /** ISO 时间 */
  time: string;
  action: 'export' | 'import';
  status: 'ok' | 'failed';
  /** agent 名称列表 */
  agents: string[];
  /** 条目标签（最多 50 条） */
  items: string[];
  itemCount: number;
  fileCount: number;
  /** 导出=原始总字节；导入=写入字节 */
  bytes: number;
  /** 导出文件路径 / 包文件路径 */
  path: string;
  /** 补充信息（失败原因、备份目录等） */
  message?: string;
}

export interface ImportPreviewItem {
  item: PackedItemEntry;
  /** 目标机器绝对路径（应用 pathMap 后） */
  targetAbs: string;
  /** 冲突状态 */
  conflict: 'none' | 'exists';
  existingSize: number;
  /** 条目来自三基准之外（占位符路径非 {{ 开头），导入时需要路径映射确认 */
  nonStandardPath: boolean;
}

export interface ImportReport {
  written: number;
  skipped: number;
  backedUp: number;
  warnings: string[];
  backupPath?: string;
  bytesWritten: number;
}

export interface PackProgress {
  phase: 'collect' | 'pack' | 'encrypt' | 'container' | 'done';
  itemLabel?: string;
  bytes?: number;
  totalBytes?: number;
  files?: number;
}

export interface ImportProgress {
  phase: 'backup' | 'write' | 'done';
  current?: string;
  files?: number;
  totalFiles?: number;
}
