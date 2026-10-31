import os from 'node:os';
import path from 'node:path';
import { AppError } from './errors';
import type { PathContext, PathMapping } from './types';

export const TOKEN_HOME = '{{home}}';
export const TOKEN_APPDATA = '{{appdata}}';
export const TOKEN_LOCALAPPDATA = '{{localappdata}}';

const TOKENS = [TOKEN_HOME, TOKEN_APPDATA, TOKEN_LOCALAPPDATA] as const;

/** 本机默认路径上下文（Windows） */
export function defaultPathContext(): PathContext {
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localappdata =
    process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return {
    home: path.normalize(home),
    appdata: path.normalize(appdata),
    localappdata: path.normalize(localappdata),
  };
}

function tokenBase(token: string, ctx: PathContext): string {
  switch (token) {
    case TOKEN_HOME:
      return ctx.home;
    case TOKEN_APPDATA:
      return ctx.appdata;
    case TOKEN_LOCALAPPDATA:
      return ctx.localappdata;
    default:
      throw new Error(`未知路径占位符: ${token}`);
  }
}

/** 展开 {{home}} 等占位符为本机绝对路径 */
export function expandPath(placeholder: string, ctx: PathContext): string {
  let p = placeholder;
  for (const token of TOKENS) {
    p = p.split(token).join(tokenBase(token, ctx));
  }
  return path.normalize(p);
}

/** 占位符 → 本机绝对路径（等价 expandPath，语义命名） */
export function placeholderToAbs(p: string, ctx: PathContext): string {
  return expandPath(p, ctx);
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function sameDir(a: string, b: string): boolean {
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/**
 * 本机绝对路径 → 占位符路径（正斜杠）。
 * 不在任何基准目录下时返回 null（调用方可作为手动条目降级处理）。
 */
export function absToPlaceholder(abs: string, ctx: PathContext): string | null {
  const norm = path.normalize(abs);
  const normFwd = toForwardSlashes(norm);
  // 优先匹配更长的基准目录（localappdata 在 home 之下时避免误匹配 home）
  const raw: Array<[string, string]> = [
    [TOKEN_LOCALAPPDATA, toForwardSlashes(ctx.localappdata)],
    [TOKEN_APPDATA, toForwardSlashes(ctx.appdata)],
    [TOKEN_HOME, toForwardSlashes(ctx.home)],
  ];
  const ordered = raw.sort((a, b) => b[1].length - a[1].length);

  for (const [token, baseFwd] of ordered) {
    const baseN = toForwardSlashes(path.normalize(baseFwd));
    if (sameDir(normFwd, baseN)) {
      return token;
    }
    if (normFwd.toLowerCase().startsWith(baseN.toLowerCase() + '/')) {
      return token + normFwd.slice(baseN.length);
    }
  }
  return null;
}

/** 映射端点规范化：正斜杠、去尾斜杠 */
function normFwd(p: string): string {
  return toForwardSlashes(p).replace(/\/+$/, '');
}

/**
 * 落位前缀映射：把包内记录的来源机器绝对路径（非占位符条目）映射到目标机器路径。
 * - 占位符路径（{{home}}/...）不参与映射，原样返回
 * - 大小写不敏感（Windows），前缀边界完整匹配（防 E:/A 误吞 E:/AB）
 * - 多条映射时最长前缀优先
 */
export function applyPathMapping(dest: string, pathMap: PathMapping[]): string {
  if (!pathMap.length || dest.startsWith('{{')) {
    return dest;
  }
  const normDest = normFwd(dest);
  const ordered = pathMap
    .map((m) => ({ from: normFwd(m.from), to: normFwd(m.to) }))
    .filter((m) => m.from && m.to)
    .sort((a, b) => b.from.length - a.from.length);
  for (const m of ordered) {
    if (normDest.toLowerCase() === m.from.toLowerCase()) {
      return m.to;
    }
    const lower = normDest.toLowerCase();
    const lowerFrom = m.from.toLowerCase();
    if (lower.startsWith(lowerFrom + '/')) {
      return m.to + normDest.slice(m.from.length);
    }
  }
  return dest;
}

/**
 * 解析 CLI/GUI 传入的映射参数（"来源=目标"），两端规范化为正斜杠。
 * 格式非法（缺 =、端点为空）时抛 AppError。
 */
export function parsePathMappingSpecs(specs: string[]): PathMapping[] {
  return specs.map((spec, i) => {
    const eq = spec.indexOf('=');
    const from = eq === -1 ? '' : normFwd(spec.slice(0, eq));
    const to = eq === -1 ? '' : normFwd(spec.slice(eq + 1));
    if (!from || !to) {
      throw new AppError(
        'IO_ERROR',
        `无效的路径映射参数（第 ${i + 1} 项）: "${spec}"，格式应为 来源=目标，如 --map "E:/MyTools=D:/TeamTools"`,
      );
    }
    return { from, to };
  });
}
