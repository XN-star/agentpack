import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KDF_DEFAULTS, deriveKey, decryptFileTo } from './crypto';
import { AppError, isAppError } from './errors';
import { expandPath } from './paths';
import { MANIFEST_NAME, PAYLOAD_NAME, ENTRIES_NAME } from './pack';
import { extractEntryToFile, listZipEntries, readEntryBuffer } from './zip';
import type { EntriesDoc, PackManifest } from './types';

/** 读取明文 manifest（无需密码；不含任何条目信息） */
export async function readManifest(packPath: string): Promise<PackManifest> {
  let buf: Buffer;
  try {
    buf = await readEntryBuffer(packPath, MANIFEST_NAME, 1024 * 1024);
  } catch {
    throw new AppError(
      'PACK_CORRUPT',
      '不是有效的 .agentpack 文件（缺少 manifest.json）',
    );
  }
  let m: PackManifest;
  try {
    m = JSON.parse(buf.toString('utf8')) as PackManifest;
  } catch (e) {
    throw new AppError('PACK_CORRUPT', 'manifest.json 解析失败', String(e));
  }
  if (m.format !== 'agentpack/1') {
    throw new AppError(
      'PACK_FORMAT_UNSUPPORTED',
      `不支持的包格式: ${String(m.format ?? '未知')}（请使用匹配版本的 AgentPack）`,
    );
  }
  if (m.kdf?.algo !== 'scrypt' || m.payload?.algo !== 'aes-256-gcm') {
    throw new AppError('PACK_FORMAT_UNSUPPORTED', '不支持的加密方案');
  }
  return m;
}

export interface OpenPackHandle {
  manifest: PackManifest;
  entries: EntriesDoc;
  /** 解密后的内部 zip（临时目录内，close 时删除） */
  innerZipPath: string;
  tempDir: string;
  close(): Promise<void>;
}

/**
 * 验证密码并打开 .agentpack：
 * 提取 payload → sha256 完整性校验 → 解密内部 zip → 读取条目清单。
 * 密码错误抛 PASSWORD_WRONG，损坏抛 PACK_CORRUPT。
 */
export async function openPack(
  packPath: string,
  password: string,
): Promise<OpenPackHandle> {
  const manifest = await readManifest(packPath);
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'agentpack-open-'),
  );
  try {
    const payloadPath = path.join(tempDir, 'payload.bin');
    const names = await listZipEntries(packPath);
    if (!names.has(PAYLOAD_NAME)) {
      throw new AppError('PACK_CORRUPT', '包内缺少 payload');
    }
    const extracted = await extractEntryToFile(packPath, PAYLOAD_NAME, payloadPath);
    if (extracted.sha256 !== manifest.payload.sha256) {
      throw new AppError(
        'PACK_CORRUPT',
        'payload 完整性校验失败（文件损坏或被篡改）',
      );
    }
    const kdf = {
      N: manifest.kdf.N || KDF_DEFAULTS.N,
      r: manifest.kdf.r || KDF_DEFAULTS.r,
      p: manifest.kdf.p || KDF_DEFAULTS.p,
      keyLen: manifest.kdf.keyLen || KDF_DEFAULTS.keyLen,
    };
    const key = await deriveKey(password, manifest.kdf.salt, kdf);
    const innerZipPath = path.join(tempDir, 'inner.zip');
    try {
      await decryptFileTo(payloadPath, innerZipPath, key, manifest.payload.nonce);
    } catch (e) {
      if (isAppError(e) && e.code === 'PASSWORD_WRONG') {
        throw e;
      }
      throw new AppError('PACK_CORRUPT', '解密失败：文件可能已损坏', String(e));
    } finally {
      key.fill(0);
    }
    const entriesBuf = await readEntryBuffer(innerZipPath, ENTRIES_NAME);
    let entries: EntriesDoc;
    try {
      entries = JSON.parse(entriesBuf.toString('utf8')) as EntriesDoc;
    } catch (e) {
      throw new AppError('PACK_CORRUPT', 'entries.json 解析失败', String(e));
    }
    if (entries.schema !== 'agentpack.entries/1') {
      throw new AppError(
        'PACK_FORMAT_UNSUPPORTED',
        `不支持的条目清单版本: ${String(entries.schema)}`,
      );
    }
    return {
      manifest,
      entries,
      innerZipPath,
      tempDir,
      close: async () => {
        await fs.promises
          .rm(tempDir, { recursive: true, force: true })
          .catch(() => {});
      },
    };
  } catch (e) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

export interface VerifyResult {
  manifest: PackManifest;
  /** payload 的 sha256 是否与 manifest 一致 */
  payloadOk: boolean;
  /** 是否已用密码成功解密 */
  decrypted: boolean;
  entries?: EntriesDoc;
}

/**
 * 校验 .agentpack 完整性；提供密码时同时验证可解密性。
 */
export async function verifyPack(
  packPath: string,
  password?: string,
): Promise<VerifyResult> {
  const manifest = await readManifest(packPath);
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'agentpack-verify-'),
  );
  try {
    const payloadPath = path.join(tempDir, 'payload.bin');
    const extracted = await extractEntryToFile(packPath, PAYLOAD_NAME, payloadPath);
    const payloadOk = extracted.sha256 === manifest.payload.sha256;
    if (!password) {
      return { manifest, payloadOk, decrypted: false };
    }
    const handle = await openPack(packPath, password);
    try {
      return {
        manifest,
        payloadOk,
        decrypted: true,
        entries: handle.entries,
      };
    } finally {
      await handle.close();
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 供展示：把包内条目占位符路径展开为本机路径 */
export function expandEntryPath(placeholder: string, ctx: Parameters<typeof expandPath>[1]): string {
  return expandPath(placeholder, ctx);
}
