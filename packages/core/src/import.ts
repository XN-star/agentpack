import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors';
import { expandPath } from './paths';
import { maybeRewriteFile } from './transformers';
import type { OpenPackHandle } from './unpack';
import { extractEntryToFileFast, readEntryBuffer } from './zip';
import type {
  ConflictStrategy,
  ImportPreviewItem,
  ImportProgress,
  ImportReport,
  PathContext,
  PackedFileEntry,
} from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 深合并：对象递归合并，数组与标量以 patch 为准 */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) {
      out[k] = deepMerge(cur, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isUnsafeDest(dest: string): boolean {
  return dest.split('/').includes('..');
}

function stripToken(dest: string): string {
  return dest.replace(/^\{\{[^}]+\}\}\//, '');
}

/** 导入前预览：逐条目给出目标路径与冲突状态（凭据内容不在此展示） */
export function previewImport(
  handle: OpenPackHandle,
  ctx: PathContext,
): ImportPreviewItem[] {
  const out: ImportPreviewItem[] = [];
  for (const item of handle.entries.items) {
    const targetAbs = expandPath(item.placeholderPath, ctx);
    let conflict: 'none' | 'exists' = 'none';
    let existingSize = 0;
    try {
      const st = fs.statSync(targetAbs);
      conflict = 'exists';
      existingSize = st.isFile() ? st.size : 0;
    } catch {
      // 目标不存在 → 新增
    }
    out.push({ item, targetAbs, conflict, existingSize });
  }
  return out;
}

export interface ImportOptions {
  handle: OpenPackHandle;
  ctx: PathContext;
  /** 选中条目 key → 冲突策略（未列出的条目不导入） */
  decisions: Record<string, ConflictStrategy>;
  /** 备份根目录；默认 ~/agentpack-backups/<时间戳>/ */
  backupRoot?: string;
  /** 为 true 时只演练不写盘 */
  dryRun?: boolean;
  onProgress?: (p: ImportProgress) => void;
}

function timestampForDir(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * 执行导入：
 * 1) 备份阶段 —— 对策略为 backup 且目标已存在的文件复制到备份目录
 * 2) 写入阶段 —— 从内部 zip 解出各文件（sameAs 条目从已写入的主文件复制），
 *    文本文件应用路径改写 transformer
 * 锁定/无权限的文件跳过并记入警告，不中断整体导入。
 */
export async function executeImport(
  opts: ImportOptions,
): Promise<ImportReport> {
  const { handle, ctx } = opts;
  const report: ImportReport = {
    written: 0,
    skipped: 0,
    backedUp: 0,
    warnings: [],
    bytesWritten: 0,
  };
  const selected = handle.entries.items.filter((i) => opts.decisions[i.key]);
  if (selected.length === 0) {
    throw new AppError('ITEM_NOT_FOUND', '未选择任何要导入的条目');
  }

  const filesByItem = new Map<string, PackedFileEntry[]>();
  for (const f of handle.entries.files) {
    const arr = filesByItem.get(f.itemKey);
    if (arr) {
      arr.push(f);
    } else {
      filesByItem.set(f.itemKey, [f]);
    }
  }

  // ---------- 备份阶段 ----------
  const needBackup = selected.filter((i) => opts.decisions[i.key] === 'backup');
  let backupDir: string | undefined;
  const backupList: Array<{ original: string; backup: string }> = [];
  if (needBackup.length > 0 && !opts.dryRun) {
    backupDir = opts.backupRoot ?? path.join(ctx.home, 'agentpack-backups', timestampForDir());
    await fs.promises.mkdir(backupDir, { recursive: true });
  }
  for (const item of needBackup) {
    const files = filesByItem.get(item.key) ?? [];
    for (const f of files) {
      if (isUnsafeDest(f.dest)) {
        report.warnings.push(`不安全的目标路径，已跳过: ${f.dest}`);
        continue;
      }
      const abs = expandPath(f.dest, ctx);
      try {
        await fs.promises.access(abs);
      } catch {
        continue; // 目标不存在，无需备份
      }
      const rel = path.join(item.agentId, stripToken(f.dest));
      const backupAbs = path.join(backupDir!, rel);
      try {
        await fs.promises.mkdir(path.dirname(backupAbs), { recursive: true });
        await fs.promises.copyFile(abs, backupAbs);
        backupList.push({ original: abs, backup: backupAbs });
        report.backedUp++;
      } catch (e) {
        report.warnings.push(`备份失败（继续原样导入）: ${abs} — ${(e as Error).message}`);
      }
    }
  }
  if (backupDir && backupList.length > 0) {
    try {
      await fs.promises.writeFile(
        path.join(backupDir, 'BACKUP-MANIFEST.json'),
        JSON.stringify({ createdAt: new Date().toISOString(), files: backupList }, null, 2),
        'utf8',
      );
      report.backupPath = backupDir;
    } catch {
      report.warnings.push('备份清单写入失败');
    }
  } else if (needBackup.length > 0) {
    report.backupPath = backupDir;
  }

  if (opts.dryRun) {
    for (const item of selected) {
      if (opts.decisions[item.key] === 'skip') {
        report.skipped += filesByItem.get(item.key)?.length ?? 0;
      }
    }
    report.written = handle.entries.files
      .filter((f) => wantedSelected(f, selected) && opts.decisions[f.itemKey] !== 'skip')
      .length;
    return report;
  }

  // ---------- 写入阶段 ----------
  const selectedKeys = new Set(selected.map((i) => i.key));
  const ordered = [...handle.entries.files].sort(
    (a, b) => Number(Boolean(a.sameAs)) - Number(Boolean(b.sameAs)),
  );
  const relevant = ordered.filter((f) => selectedKeys.has(f.itemKey));
  const totalFiles = relevant.length;
  let done = 0;
  const writtenByKey = new Map<string, string>();

  for (const f of relevant) {
    done++;
    opts.onProgress?.({
      phase: 'write',
      current: f.dest,
      files: done,
      totalFiles,
    });
    const strategy = opts.decisions[f.itemKey]!;
    if (strategy === 'skip') {
      report.skipped++;
      continue;
    }
    if (isUnsafeDest(f.dest)) {
      report.warnings.push(`不安全的目标路径，已跳过: ${f.dest}`);
      report.skipped++;
      continue;
    }
    const destAbs = expandPath(f.dest, ctx);
    try {
      await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
      if (f.merge) {
        // json-fields 条目：读取包子集，与目标已有 JSON 深合并（保留目标账号态等其余字段）
        const srcBuf = await readEntryBuffer(handle.innerZipPath, f.key);
        let subset: unknown;
        try {
          subset = JSON.parse(srcBuf.toString('utf8'));
        } catch {
          report.warnings.push(`包内 JSON 解析失败，已跳过: ${f.dest}`);
          report.skipped++;
          continue;
        }
        if (!isPlainObject(subset)) {
          report.warnings.push(`包内子集不是 JSON 对象，已跳过: ${f.dest}`);
          report.skipped++;
          continue;
        }
        let targetObj: Record<string, unknown> = {};
        let targetInvalid = false;
        try {
          const parsed = JSON.parse(await fs.promises.readFile(destAbs, 'utf8'));
          if (!isPlainObject(parsed)) {
            targetInvalid = true;
          } else {
            targetObj = parsed;
          }
        } catch {
          // 目标不存在或暂不可解析：按全新写入处理
          targetObj = {};
        }
        if (targetInvalid) {
          report.warnings.push(`目标文件不是 JSON 对象，已跳过合并: ${f.dest}`);
          report.skipped++;
          continue;
        }
        const merged = deepMerge(targetObj, subset);
        await fs.promises.writeFile(
          destAbs,
          JSON.stringify(merged, null, 2),
          'utf8',
        );
      } else if (f.sameAs) {
        let src = writtenByKey.get(f.sameAs);
        if (!src || !fs.existsSync(src)) {
          // 主条目未导入时，尝试从本机已写入位置复制；否则告警跳过
          src = expandPath(
            handle.entries.files.find((x) => x.key === f.sameAs)?.dest ?? '',
            ctx,
          );
        }
        if (src && fs.existsSync(src)) {
          await fs.promises.copyFile(src, destAbs);
        } else {
          report.warnings.push(`重复内容源不可用，已跳过: ${f.dest}`);
          report.skipped++;
          continue;
        }
      } else {
        await extractEntryToFileFast(handle.innerZipPath, f.key, destAbs);
      }
      writtenByKey.set(f.key, destAbs);
      report.written++;
      report.bytesWritten += f.size;
      const changes = await maybeRewriteFile(
        destAbs,
        handle.entries.sourcePathContext,
        ctx,
      );
      if (changes > 0) {
        report.warnings.push(`已按目标机器改写路径（${changes} 处）: ${f.dest}`);
      }
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/EBUSY|EPERM|EACCES/.test(msg)) {
        report.warnings.push(`文件被占用或无权限，已跳过: ${destAbs} — ${msg}`);
        report.skipped++;
      } else {
        report.warnings.push(`写入失败: ${destAbs} — ${msg}`);
        report.skipped++;
      }
    }
  }

  // ---------- 空目录补建 ----------
  for (const item of selected) {
    if (item.type !== 'dir') {
      continue;
    }
    const files = filesByItem.get(item.key) ?? [];
    if (files.length === 0 && opts.decisions[item.key] !== 'skip') {
      if (isUnsafeDest(item.placeholderPath)) {
        continue;
      }
      try {
        await fs.promises.mkdir(expandPath(item.placeholderPath, ctx), {
          recursive: true,
        });
      } catch {
        report.warnings.push(`目录创建失败: ${item.placeholderPath}`);
      }
    }
  }

  opts.onProgress?.({ phase: 'done' });
  return report;
}

function wantedSelected(
  f: PackedFileEntry,
  selected: Array<{ key: string }>,
): boolean {
  return selected.some((i) => i.key === f.itemKey);
}

/** 供 GUI/CLI 读取包内条目名（如需诊断） */
export async function listPackEntries(packPath: string): Promise<string[]> {
  const { listZipEntries } = await import('./zip');
  const m = await listZipEntries(packPath);
  return [...m.keys()];
}
