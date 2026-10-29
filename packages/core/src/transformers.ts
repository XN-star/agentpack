import fs from 'node:fs';
import path from 'node:path';
import type { PathContext } from './types';

/** 需要做路径改写的文本扩展名 */
const TEXT_EXTS = new Set([
  '.json',
  '.jsonc',
  '.toml',
  '.yaml',
  '.yml',
  '.md',
  '.txt',
  '.ini',
  '.cfg',
  '.conf',
]);
const MAX_TRANSFORM_SIZE = 2 * 1024 * 1024;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function forwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** JSON/字符串字面量里的反斜杠是转义形式（\\），需单独匹配 */
function jsonEscape(p: string): string {
  return p.replace(/\\/g, '\\\\');
}

/**
 * 把内容中来源机器的基准目录（home/appdata/localappdata）替换为目标机器的对应目录。
 * 覆盖三种写法：原始反斜杠、正斜杠、JSON 转义反斜杠。
 */
export function rewriteSourcePaths(
  content: string,
  sourceCtx: PathContext,
  targetCtx: PathContext,
): { text: string; changes: number } {
  let changes = 0;
  let text = content;
  const pairs: Array<[string, string]> = [
    [sourceCtx.home, targetCtx.home],
    [sourceCtx.appdata, targetCtx.appdata],
    [sourceCtx.localappdata, targetCtx.localappdata],
  ];
  for (const [from, to] of pairs) {
    if (!from || !to || from === to) {
      continue;
    }
    const variants: Array<[string, string]> = [
      [from, to],
      [forwardSlashes(from), forwardSlashes(to)],
      [jsonEscape(from), jsonEscape(to)],
    ];
    for (const [f, t] of variants) {
      if (!f) {
        continue;
      }
      const re = new RegExp(escapeRegExp(f), 'gi');
      text = text.replace(re, () => {
        changes++;
        return t;
      });
    }
  }
  return { text, changes };
}

/**
 * 对刚写入的目标文件应用路径改写（仅小体积文本文件）。
 * 返回替换次数。
 */
export async function maybeRewriteFile(
  absPath: string,
  sourceCtx: PathContext,
  targetCtx: PathContext,
): Promise<number> {
  try {
    const st = await fs.promises.stat(absPath);
    if (!st.isFile() || st.size > MAX_TRANSFORM_SIZE) {
      return 0;
    }
    const ext = path.extname(absPath).toLowerCase();
    if (!TEXT_EXTS.has(ext)) {
      return 0;
    }
    const original = await fs.promises.readFile(absPath, 'utf8');
    const { text, changes } = rewriteSourcePaths(original, sourceCtx, targetCtx);
    if (changes > 0 && text !== original) {
      await fs.promises.writeFile(absPath, text, 'utf8');
    }
    return changes;
  } catch {
    return 0;
  }
}
