import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KDF_DEFAULTS,
  deriveKey,
  encryptFileWithDigest,
  randomNonceHex,
  randomSaltHex,
  validatePassword,
} from './crypto';
import { AppError } from './errors';
import { hashThrough, sha256OfBuffer } from './hash';
import { expandPath } from './paths';
import { collectItemFiles } from './scanner';
import { CORE_VERSION } from './version';
import { ZipWriter } from './zip';
import type {
  EntriesDoc,
  PackManifest,
  PackProgress,
  PackedFileEntry,
  PackedItemEntry,
  PathContext,
  ScannedItem,
} from './types';

export const MANIFEST_NAME = 'manifest.json';
export const PAYLOAD_NAME = 'payload.bin';
export const ENTRIES_NAME = 'entries.json';

export interface ExportOptions {
  items: ScannedItem[];
  ctx: PathContext;
  outPath: string;
  password: string;
  /** 可选：来源机器名（写入 manifest，默认不含以保护隐私） */
  machineName?: string;
  onProgress?: (p: PackProgress) => void;
}

export interface ExportResult {
  manifest: PackManifest;
  entries: EntriesDoc;
  fileCount: number;
  totalBytes: number;
  outSize: number;
}

function joinPlaceholder(base: string, rel: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return rel ? `${b}/${rel}` : b;
}

/** 流式读取文件：计算 sha256 并写入 zip（内容从 transform 流出） */
async function hashIntoArchive(
  abs: string,
  entryName: string,
  zw: ZipWriter,
): Promise<string> {
  const { transform, digestHex } = hashThrough();
  const rs = fs.createReadStream(abs);
  zw.addStream(entryName, rs.pipe(transform));
  await new Promise<void>((resolve, reject) => {
    rs.on('error', reject);
    transform.on('error', reject);
    transform.on('end', () => resolve());
  });
  return digestHex();
}

/**
 * 把选中的条目打包为加密的 .agentpack 文件。
 * 结构：外层 zip{ manifest.json（明文，无条目信息）, payload.bin（AES-256-GCM(inner.zip)）}
 * inner.zip = { entries.json（条目清单）, f000001…（各文件内容）}
 */
export async function exportPack(opts: ExportOptions): Promise<ExportResult> {
  validatePassword(opts.password);
  const migratable = opts.items.filter((i) => i.migratable && i.exists);
  if (migratable.length === 0) {
    throw new AppError('ITEM_NOT_FOUND', '未选择任何可迁移条目');
  }

  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentpack-'));
  try {
    const zw = new ZipWriter(path.join(tmp, 'inner.zip'));
    const itemEntries: PackedItemEntry[] = [];
    const fileEntries: PackedFileEntry[] = [];
    // 内容去重：realpath → 首次出现的 file key + sha256
    const dedup = new Map<string, { key: string; sha256: string }>();
    let seq = 0;
    let totalBytes = 0;

    for (const item of migratable) {
      opts.onProgress?.({ phase: 'collect', itemLabel: item.label });
      const collected = await collectItemFiles(
        item.targetAbs,
        item.type,
        undefined,
        item.fields,
      );
      itemEntries.push({
        key: item.key,
        agentId: item.agentId,
        agentName: item.agentName,
        itemId: item.itemId,
        label: item.label,
        type: item.type,
        category: item.category,
        sensitivity: item.sensitivity,
        placeholderPath: item.placeholderPath,
        fileCount: collected.files.length,
      });
      for (const f of collected.files) {
        seq++;
        totalBytes += f.size;
        const key = `f${String(seq).padStart(6, '0')}`;
        const dest =
          item.type === 'dir'
            ? joinPlaceholder(item.placeholderPath, f.rel)
            : item.placeholderPath;
        // json-fields：打包子集内容并标记 merge，导入时与目标文件深合并
        if (f.content) {
          const sha256 = sha256OfBuffer(f.content);
          zw.addBuffer(key, f.content);
          fileEntries.push({
            key,
            itemKey: item.key,
            dest,
            size: f.size,
            sha256,
            merge: true,
          });
          continue;
        }
        let real: string;
        try {
          real = await fs.promises.realpath(f.abs);
        } catch {
          real = f.abs;
        }
        const dedupKey =
          process.platform === 'win32' ? real.toLowerCase() : real;
        const existing = dedup.get(dedupKey);
        if (existing) {
          fileEntries.push({
            key,
            itemKey: item.key,
            dest,
            size: f.size,
            sha256: existing.sha256,
            sameAs: existing.key,
          });
          continue;
        }
        const sha256 = await hashIntoArchive(f.abs, key, zw);
        dedup.set(dedupKey, { key, sha256 });
        fileEntries.push({ key, itemKey: item.key, dest, size: f.size, sha256 });
      }
      opts.onProgress?.({ phase: 'pack', itemLabel: item.label, bytes: totalBytes, files: seq });
    }

    const doc: EntriesDoc = {
      schema: 'agentpack.entries/1',
      items: itemEntries,
      files: fileEntries,
      sourcePathContext: opts.ctx,
      exportedAt: new Date().toISOString(),
    };
    zw.addBuffer(ENTRIES_NAME, Buffer.from(JSON.stringify(doc), 'utf8'));
    await zw.finalize();

    // 加密
    const salt = randomSaltHex();
    const nonce = randomNonceHex();
    const key = await deriveKey(opts.password, salt, KDF_DEFAULTS);
    const payloadTmp = path.join(tmp, 'payload.bin');
    const digest = await encryptFileWithDigest(
      path.join(tmp, 'inner.zip'),
      payloadTmp,
      key,
      nonce,
    );
    key.fill(0);

    const manifest: PackManifest = {
      format: 'agentpack/1',
      toolVersion: CORE_VERSION,
      createdAt: new Date().toISOString(),
      sourceOs: 'windows',
      ...(opts.machineName ? { sourceMachineName: opts.machineName } : {}),
      kdf: {
        algo: 'scrypt',
        salt,
        N: KDF_DEFAULTS.N,
        r: KDF_DEFAULTS.r,
        p: KDF_DEFAULTS.p,
        keyLen: KDF_DEFAULTS.keyLen,
      },
      payload: {
        algo: 'aes-256-gcm',
        nonce,
        sha256: digest.sha256,
        size: digest.size,
      },
    };

    const outAbs = path.resolve(opts.outPath);
    await fs.promises.mkdir(path.dirname(outAbs), { recursive: true });
    const zwOuter = new ZipWriter(outAbs);
    zwOuter.addBuffer(
      MANIFEST_NAME,
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    );
    zwOuter.addStream(PAYLOAD_NAME, fs.createReadStream(payloadTmp));
    opts.onProgress?.({ phase: 'container', bytes: digest.size });
    await zwOuter.finalize();

    const outSize = (await fs.promises.stat(outAbs)).size;
    opts.onProgress?.({ phase: 'done' });
    return {
      manifest,
      entries: doc,
      fileCount: seq,
      totalBytes,
      outSize,
    };
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** 展开占位符（供 GUI/CLI 展示目标路径） */
export function itemTargetPath(placeholderPath: string, ctx: PathContext): string {
  return expandPath(placeholderPath, ctx);
}
