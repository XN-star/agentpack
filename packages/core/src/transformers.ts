import fs from 'node:fs';
import path from 'node:path';
import type { PathContext, PathMapping } from './types';

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

function toBackslashes(p: string): string {
  return p.replace(/\//g, '\\');
}

/** 规范化映射端点：正斜杠、去尾斜杠 */
function normMapPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 把内容中来源机器的基准目录（home/appdata/localappdata）替换为目标机器的对应目录；
 * 再应用导入方提供的自定义路径映射（pathMap，覆盖三基准之外的路径前缀）。
 * 覆盖三种写法：原始反斜杠、正斜杠、JSON 转义反斜杠。
 */
export function rewriteSourcePaths(
  content: string,
  sourceCtx: PathContext,
  targetCtx: PathContext,
  pathMap?: PathMapping[],
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
  // 自定义映射：最长前缀优先；与三基准（或其祖先）重叠的映射跳过，避免双重改写
  const bases = [sourceCtx.home, sourceCtx.appdata, sourceCtx.localappdata]
    .filter(Boolean)
    .map(normMapPath)
    .map((b) => b.toLowerCase());
  const ordered = [...(pathMap ?? [])]
    .map((m) => ({ from: normMapPath(m.from), to: normMapPath(m.to) })
    )
    .filter((m) => m.from && m.to)
    .filter(
      (m) =>
        !bases.some(
          (b) =>
            m.from.toLowerCase() === b ||
            b.toLowerCase().startsWith(m.from.toLowerCase() + '/'),
        ),
    )
    .sort((a, b) => b.from.length - a.from.length);
  for (const m of ordered) {
    // 三种写法变体统一边界：前缀后必须是结尾/空白/引号/斜杠，防止 E:/A 误吞 E:/AB
    const edge = '(?=$|[\\s"/\\\\])';
    const variants: Array<[string, string]> = [
      [m.from, m.to],
      [toBackslashes(m.from), toBackslashes(m.to)],
      [jsonEscape(toBackslashes(m.from)), jsonEscape(toBackslashes(m.to))],
    ];
    for (const [f, t] of variants) {
      const re = new RegExp(escapeRegExp(f) + edge, 'gi');
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
  pathMap?: PathMapping[],
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
    const { text, changes } = rewriteSourcePaths(
      original,
      sourceCtx,
      targetCtx,
      pathMap,
    );
    if (changes > 0 && text !== original) {
      await fs.promises.writeFile(absPath, text, 'utf8');
    }
    return changes;
  } catch {
    return 0;
  }
}
