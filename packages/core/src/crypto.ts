import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { AppError } from './errors';
import { sha256OfFile } from './hash';

/** scrypt 参数（写入 manifest，前后版本一致才能解密） */
export interface KdfRuntimeParams {
  N: number;
  r: number;
  p: number;
  keyLen: number;
}

export const KDF_DEFAULTS: KdfRuntimeParams = {
  N: 1 << 15, // 32768，约 32MB 内存
  r: 8,
  p: 1,
  keyLen: 32,
};

export const NONCE_LEN = 12;
export const TAG_LEN = 16;

export function randomSaltHex(len = 32): string {
  return crypto.randomBytes(len).toString('hex');
}

export function randomNonceHex(): string {
  return crypto.randomBytes(NONCE_LEN).toString('hex');
}

/** 由密码派生 256 位密钥（不落盘） */
export function deriveKey(
  password: string,
  saltHex: string,
  params: KdfRuntimeParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      Buffer.from(saltHex, 'hex'),
      params.keyLen,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** 密码强度校验：非空且 ≥8 字符 */
export function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8) {
    throw new AppError('PASSWORD_WEAK', '密码至少需要 8 个字符');
  }
}

/**
 * 加密整个文件：dst = [密文][tag(16)]（nonce 由调用方保存到 manifest，不写入文件）。
 * 流式处理，内存占用恒定。
 */
export async function encryptFileTo(
  srcPath: string,
  dstPath: string,
  key: Buffer,
  nonceHex: string,
): Promise<void> {
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(nonceHex, 'hex'),
  );
  await pipeline(
    fs.createReadStream(srcPath),
    cipher,
    fs.createWriteStream(dstPath),
  );
  const tag = cipher.getAuthTag();
  await fs.promises.appendFile(dstPath, tag);
}

/**
 * 解密整个文件（encryptFileTo 的逆过程）。
 * 密码错误时 GCM 校验失败 → PASSWORD_WRONG。
 */
export async function decryptFileTo(
  srcPath: string,
  dstPath: string,
  key: Buffer,
  nonceHex: string,
): Promise<void> {
  const st = await fs.promises.stat(srcPath);
  if (st.size < TAG_LEN + 1) {
    throw new AppError('PACK_CORRUPT', 'payload 数据不完整');
  }
  const fh = await fs.promises.open(srcPath, 'r');
  let tag: Buffer;
  try {
    tag = Buffer.alloc(TAG_LEN);
    await fh.read(tag, 0, TAG_LEN, st.size - TAG_LEN);
  } finally {
    await fh.close();
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(nonceHex, 'hex'),
  );
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(srcPath, { start: 0, end: st.size - TAG_LEN - 1 }),
      decipher,
      fs.createWriteStream(dstPath),
    );
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/auth/i.test(msg)) {
      throw new AppError('PASSWORD_WRONG', '密码错误或文件已损坏');
    }
    throw e;
  }
}

/** 加密文件并返回密文（含 tag）的 sha256 与大小 */
export async function encryptFileWithDigest(
  srcPath: string,
  dstPath: string,
  key: Buffer,
  nonceHex: string,
): Promise<{ sha256: string; size: number }> {
  await encryptFileTo(srcPath, dstPath, key, nonceHex);
  const sha256 = await sha256OfFile(dstPath);
  const st = await fs.promises.stat(dstPath);
  return { sha256, size: st.size };
}
