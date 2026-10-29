import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors';
import type { AgentRegistry } from './types';

/** 仅接受纯文件名（无路径分隔符、不越出根目录），防御路径穿越 */
function safeJoin(rootDir: string, name: string): string | null {
  if (!name || name === '.' || name === '..') {
    return null;
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return null;
  }
  const resolved = path.resolve(rootDir, name);
  const rootResolved = path.resolve(rootDir);
  if (
    resolved !== rootResolved &&
    !resolved.startsWith(rootResolved + path.sep)
  ) {
    return null;
  }
  return resolved;
}

/**
 * 从目录加载全部 registry JSON（每个 agent 一个文件）。
 * 文件缺失字段时抛 REGISTRY_INVALID。
 */
export function loadRegistries(dir: string): AgentRegistry[] {
  const rootResolved = path.resolve(dir);
  let names: string[];
  try {
    names = fs
      .readdirSync(rootResolved)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort();
  } catch (e) {
    throw new AppError(
      'REGISTRY_INVALID',
      `无法读取 agent 清单目录: ${rootResolved}`,
      String(e),
    );
  }
  const regs: AgentRegistry[] = [];
  for (const name of names) {
    const full = safeJoin(rootResolved, name);
    if (!full) {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      throw new AppError(
        'REGISTRY_INVALID',
        `清单文件解析失败: ${name}`,
        String(e),
      );
    }
    regs.push(validateRegistry(raw, name));
  }
  return regs;
}

function validateRegistry(raw: unknown, file: string): AgentRegistry {
  const r = raw as Partial<AgentRegistry>;
  if (!r || typeof r !== 'object') {
    throw new AppError('REGISTRY_INVALID', `清单不是 JSON 对象: ${file}`);
  }
  if (!r.id || !r.name || !Array.isArray(r.roots) || !r.restartHint) {
    throw new AppError(
      'REGISTRY_INVALID',
      `清单缺少 id/name/restartHint/roots: ${file}`,
    );
  }
  return r as AgentRegistry;
}

/**
 * 在候选目录中找到存在的 registry 目录。
 * GUI 打包后用 resources/registry；开发态用仓库根 registry/。
 */
export function findRegistryDir(candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      return c;
    }
  }
  throw new AppError(
    'REGISTRY_INVALID',
    '未找到 agent 清单目录（registry/），可通过 AGENTPACK_REGISTRY 环境变量指定',
  );
}
