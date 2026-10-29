import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decryptFileTo,
  deriveKey,
  encryptFileTo,
  KDF_DEFAULTS,
  randomNonceHex,
  randomSaltHex,
  validatePassword,
} from '../src/crypto';
import { AppError } from '../src/errors';

describe('加密', () => {
  it('密码强度校验', () => {
    expect(() => validatePassword('short')).toThrow(AppError);
    expect(() => validatePassword('12345678')).not.toThrow();
  });

  it('加解密 round-trip（流式、含随机数据）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpack-crypto-'));
    try {
      const src = path.join(dir, 'plain.bin');
      const enc = path.join(dir, 'enc.bin');
      const dec = path.join(dir, 'dec.bin');
      const data = crypto.randomBytes(1024 * 64 + 7);
      fs.writeFileSync(src, data);
      const salt = randomSaltHex();
      const nonce = randomNonceHex();
      const key = await deriveKey('Str0ngPass!', salt, KDF_DEFAULTS);
      await encryptFileTo(src, enc, key, nonce);
      expect(fs.statSync(enc).size).toBe(data.length + 16);
      await decryptFileTo(enc, dec, key, nonce);
      expect(fs.readFileSync(dec)).toEqual(data);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('错误密码 → PASSWORD_WRONG', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpack-crypto-'));
    try {
      const src = path.join(dir, 'plain.txt');
      const enc = path.join(dir, 'enc.bin');
      const dec = path.join(dir, 'dec.bin');
      fs.writeFileSync(src, 'hello agentpack 中文内容');
      const salt = randomSaltHex();
      const nonce = randomNonceHex();
      const key = await deriveKey('correct-horse', salt, KDF_DEFAULTS);
      await encryptFileTo(src, enc, key, nonce);
      const badKey = await deriveKey('wrong-password', salt, KDF_DEFAULTS);
      await expect(decryptFileTo(enc, dec, badKey, nonce)).rejects.toThrow(
        AppError,
      );
      await expect(decryptFileTo(enc, dec, badKey, nonce)).rejects.toMatchObject({
        code: 'PASSWORD_WRONG',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('篡改密文 → 校验失败', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpack-crypto-'));
    try {
      const src = path.join(dir, 'plain.txt');
      const enc = path.join(dir, 'enc.bin');
      const dec = path.join(dir, 'dec.bin');
      fs.writeFileSync(src, 'tamper test');
      const salt = randomSaltHex();
      const nonce = randomNonceHex();
      const key = await deriveKey('Str0ngPass!', salt, KDF_DEFAULTS);
      await encryptFileTo(src, enc, key, nonce);
      const buf = fs.readFileSync(enc);
      buf[0] = buf[0]! ^ 0xff;
      fs.writeFileSync(enc, buf);
      await expect(decryptFileTo(enc, dec, key, nonce)).rejects.toMatchObject({
        code: 'PASSWORD_WRONG',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Node 18+ 全局 crypto（webcrypto）；这里只用 randomBytes，避免额外依赖
import crypto from 'node:crypto';
