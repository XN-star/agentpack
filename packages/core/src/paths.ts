import os from 'node:os';
import path from 'node:path';
import type { PathContext } from './types';

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
