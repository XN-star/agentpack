import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

/** 边转发边计算 sha256 的 Transform */
export function hashThrough(): { transform: Transform; digestHex: () => string } {
  const h = crypto.createHash('sha256');
  let hex: string | null = null;
  const transform = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      h.update(chunk);
      cb(null, chunk);
    },
    flush(cb) {
      hex = h.digest('hex');
      cb(null);
    },
  });
  return {
    transform,
    digestHex: () => {
      if (hex === null) {
        throw new Error('哈希尚未计算完成');
      }
      return hex;
    },
  };
}

export async function sha256OfFile(p: string): Promise<string> {
  const { transform, digestHex } = hashThrough();
  // Transform 必须有下游消费者，否则大数据量会因背压死锁；
  // 这里用空 drain 消费输出，只取哈希副作用
  await pipeline(
    fs.createReadStream(p),
    transform,
    async function* drain(src) {
      for await (const _chunk of src) {
        // 丢弃
      }
    },
  );
  return digestHex();
}

export function sha256OfBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
