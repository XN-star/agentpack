import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from './types';

const MAX_ENTRIES = 200;

/** 历史记录文件：~/.agentpack/history.json（仅记录元信息，不含任何配置内容） */
function historyFile(): string {
  return path.join(os.homedir(), '.agentpack', 'history.json');
}

function isHistoryEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const e = v as Partial<HistoryEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.time === 'string' &&
    (e.action === 'export' || e.action === 'import') &&
    (e.status === 'ok' || e.status === 'failed')
  );
}

/** 读取历史记录（新的在前） */
export function readHistory(limit = 100): HistoryEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(historyFile(), 'utf8')) as unknown;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(isHistoryEntry).slice(0, limit);
  } catch {
    return [];
  }
}

/** 追加一条记录；任何写入失败都不影响主流程（静默忽略） */
export function appendHistory(entry: HistoryEntry): void {
  try {
    if (process.env.AGENTPACK_HISTORY_OFF === '1') {
      return;
    }
    const file = historyFile();
    let list: HistoryEntry[] = [];
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) {
        list = parsed.filter(isHistoryEntry);
      }
    } catch {
      // 首次或损坏时从空开始
    }
    list.unshift(entry);
    list = list.slice(0, MAX_ENTRIES);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // 记录失败不影响迁移主流程
  }
}

/** 清空全部记录 */
export function clearHistory(): void {
  try {
    fs.rmSync(historyFile(), { force: true });
  } catch {
    // 忽略
  }
}

/** 构造一条记录（生成 id 与时间戳） */
export function makeEntry(
  e: Omit<HistoryEntry, 'id' | 'time'>,
): HistoryEntry {
  return { id: randomUUID(), time: new Date().toISOString(), ...e };
}
