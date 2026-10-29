import fs from 'node:fs';
import path from 'node:path';
import { buildExcludeMatcher } from './glob';
import { absToPlaceholder, expandPath } from './paths';
import type {
  AgentRegistry,
  PathContext,
  RegistryItem,
  ScanResult,
  ScannedAgent,
  ScannedItem,
} from './types';

const MAX_DEPTH = 24;
/** 版本号前缀提取（字面量规则）：匹配 2.0.32-x64 → 2.0.32 */
const VERSION_PREFIX = /^[vV]?(\d+(?:\.\d+){1,3})/;

export interface CollectedFile {
  /** 实际读取路径（符号链接已解引用） */
  abs: string;
  /** 相对条目根的路径，正斜杠 */
  rel: string;
  size: number;
  isLink: boolean;
}

interface WalkStats {
  linkCount: number;
  warnings: Set<string>;
}

async function walkDir(
  dir: string,
  rel: string,
  excluded: (relPath: string) => boolean,
  out: CollectedFile[],
  stats: WalkStats,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) {
    stats.warnings.add(`目录层级过深，已跳过: ${rel}`);
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    stats.warnings.add(`无法读取目录 ${rel}: ${(e as Error).message}`);
    return;
  }
  for (const ent of entries) {
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (excluded(childRel)) {
      continue;
    }
    const childAbs = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      stats.linkCount++;
      let real: string;
      try {
        real = await fs.promises.realpath(childAbs);
      } catch {
        stats.warnings.add(`符号链接目标不存在，已跳过: ${childRel}`);
        continue;
      }
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(real);
      } catch (e) {
        stats.warnings.add(`无法读取链接目标 ${childRel}: ${(e as Error).message}`);
        continue;
      }
      if (st.isDirectory()) {
        await walkDir(real, childRel, excluded, out, stats, depth + 1);
      } else if (st.isFile()) {
        out.push({ abs: real, rel: childRel, size: st.size, isLink: true });
      }
      continue;
    }
    if (ent.isDirectory()) {
      await walkDir(childAbs, childRel, excluded, out, stats, depth + 1);
    } else if (ent.isFile()) {
      try {
        const st = await fs.promises.stat(childAbs);
        out.push({ abs: childAbs, rel: childRel, size: st.size, isLink: false });
      } catch (e) {
        stats.warnings.add(`无法读取文件 ${childRel}: ${(e as Error).message}`);
      }
    }
  }
}

/**
 * 枚举一个条目下的全部文件（扫描与打包共用同一实现，保证清单一致）。
 * 目录条目会递归（解引用符号链接），文件条目返回单文件。
 */
export async function collectItemFiles(
  targetAbs: string,
  type: 'file' | 'dir',
  exclude?: string[],
): Promise<{ files: CollectedFile[]; linkCount: number; warnings: string[] }> {
  const excluded = buildExcludeMatcher(type === 'dir' ? exclude : undefined);
  const out: CollectedFile[] = [];
  const stats: WalkStats = { linkCount: 0, warnings: new Set<string>() };
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(targetAbs);
  } catch {
    throw new Error(`条目不存在或无法访问: ${targetAbs}`);
  }
  if (type === 'file') {
    if (!st.isFile()) {
      throw new Error(`期望文件但得到目录: ${targetAbs}`);
    }
    out.push({ abs: targetAbs, rel: '', size: st.size, isLink: false });
  } else if (st.isDirectory()) {
    await walkDir(targetAbs, '', excluded, out, stats, 0);
  } else {
    throw new Error(`期望目录但得到文件: ${targetAbs}`);
  }
  return {
    files: out,
    linkCount: stats.linkCount,
    warnings: [...stats.warnings],
  };
}

function forwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function joinPlaceholder(base: string, rel: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return rel ? `${b}/${rel}` : b;
}

async function probeVersion(
  reg: AgentRegistry,
  ctx: PathContext,
): Promise<string | null> {
  for (const probe of reg.versionProbes ?? []) {
    try {
      if (probe.kind === 'json' && probe.field) {
        const p = expandPath(probe.path, ctx);
        const obj = JSON.parse(await fs.promises.readFile(p, 'utf8')) as unknown;
        let cur: unknown = obj;
        for (const seg of probe.field.split('.')) {
          if (
            cur &&
            typeof cur === 'object' &&
            seg in (cur as Record<string, unknown>)
          ) {
            cur = (cur as Record<string, unknown>)[seg];
          } else {
            cur = undefined;
            break;
          }
        }
        if (typeof cur === 'string' && cur) {
          return cur;
        }
      } else if (probe.kind === 'dirname-version' && probe.dir) {
        const dirAbs = expandPath(probe.dir, ctx);
        const names = await fs.promises.readdir(dirAbs);
        for (const n of names) {
          const m = n.match(VERSION_PREFIX);
          if (m && m[1]) {
            return m[1];
          }
        }
      }
    } catch {
      // 探测失败不影响扫描
    }
  }
  return null;
}

async function scanItemAt(
  reg: AgentRegistry,
  rootBase: string,
  item: RegistryItem,
  placeholderPath: string,
  targetAbs: string,
): Promise<ScannedItem | null> {
  const warnings: string[] = [];
  let st: fs.Stats | null = null;
  try {
    st = await fs.promises.stat(targetAbs);
  } catch {
    return null; // 不存在则不展示
  }
  const typeOk = item.type === 'dir' ? st.isDirectory() : st.isFile();
  if (!typeOk) {
    warnings.push(`实际类型与清单不符（期望${item.type === 'dir' ? '目录' : '文件'}），已跳过`);
    return null;
  }

  let size = 0;
  let fileCount = 0;
  let linkCount = 0;
  try {
    if (item.type === 'file') {
      size = st.size;
      fileCount = 1;
    } else {
      const r = await collectItemFiles(targetAbs, 'dir', item.exclude);
      size = r.files.reduce((acc, f) => acc + f.size, 0);
      fileCount = r.files.length;
      linkCount = r.linkCount;
      warnings.push(...r.warnings);
    }
  } catch (e) {
    warnings.push((e as Error).message);
  }

  return {
    key: `${reg.id}:${rootBase}:${item.id}`,
    agentId: reg.id,
    agentName: reg.name,
    itemId: item.id,
    label: item.label,
    type: item.type,
    category: item.category,
    sensitivity: item.sensitivity,
    defaultSelected: item.defaultSelected,
    migratable: item.migratable !== false,
    reason: item.reason,
    note: item.note,
    placeholderPath,
    targetAbs,
    exists: true,
    size,
    fileCount,
    linkCount,
    warnings,
  };
}

/** 扫描一个 agent 的全部配置根 */
export async function scanAgent(
  reg: AgentRegistry,
  ctx: PathContext,
): Promise<ScannedAgent> {
  const agent: ScannedAgent = {
    id: reg.id,
    name: reg.name,
    description: reg.description,
    restartHint: reg.restartHint,
    version: await probeVersion(reg, ctx),
    found: false,
    items: [],
    nonMigratable: reg.nonMigratable,
  };
  for (const root of reg.roots) {
    const baseAbs = expandPath(root.base, ctx);
    if (!fs.existsSync(baseAbs)) {
      continue;
    }
    agent.found = true;
    for (const item of root.items) {
      const placeholderPath = joinPlaceholder(root.base, item.path);
      const targetAbs = expandPath(placeholderPath, ctx);
      const scanned = await scanItemAt(
        reg,
        root.base,
        item,
        placeholderPath,
        targetAbs,
      );
      if (scanned) {
        agent.items.push(scanned);
      }
    }
  }
  return agent;
}

/** 扫描全部 registry */
export async function scanRegistries(
  regs: AgentRegistry[],
  ctx: PathContext,
): Promise<ScanResult> {
  const agents: ScannedAgent[] = [];
  for (const reg of regs) {
    agents.push(await scanAgent(reg, ctx));
  }
  return {
    ctx,
    scannedAt: new Date().toISOString(),
    agents,
    manualItems: [],
  };
}

/** 把一个非默认路径加入扫描结果（手动添加条目） */
export async function addManualPath(
  absPath: string,
  ctx: PathContext,
): Promise<ScannedItem> {
  const abs = path.normalize(absPath);
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(abs);
  } catch {
    throw new Error(`路径不存在或无法访问: ${abs}`);
  }
  if (!st.isFile() && !st.isDirectory()) {
    throw new Error(`仅支持文件或目录: ${abs}`);
  }
  const isDir = st.isDirectory();
  const fwd = forwardSlashes(abs);
  const placeholderPath = absToPlaceholder(abs, ctx) ?? fwd;
  const label = path.basename(abs) || abs;

  let size = 0;
  let fileCount = 0;
  let linkCount = 0;
  const warnings: string[] = [];
  if (isDir) {
    const r = await collectItemFiles(abs, 'dir');
    size = r.files.reduce((acc, f) => acc + f.size, 0);
    fileCount = r.files.length;
    linkCount = r.linkCount;
    warnings.push(...r.warnings);
  } else {
    size = st.size;
    fileCount = 1;
  }

  return {
    key: `manual:${fwd}`,
    agentId: 'manual',
    agentName: '手动添加',
    itemId: fwd,
    label: isDir ? `${label}（目录）` : label,
    type: isDir ? 'dir' : 'file',
    category: 'other',
    sensitivity: 'normal',
    defaultSelected: true,
    migratable: true,
    placeholderPath,
    targetAbs: abs,
    exists: true,
    size,
    fileCount,
    linkCount,
    warnings,
  };
}
