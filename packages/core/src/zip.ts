import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { AppError } from './errors';
import { hashThrough } from './hash';

/* ---------- 读取（yauzl） ---------- */

async function openZipFile(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (err, zf) =>
        err || !zf ? reject(err ?? new Error('打开 zip 失败')) : resolve(zf),
    );
  });
}

/** 列出 zip 内全部条目 */
export async function listZipEntries(
  zipPath: string,
): Promise<Map<string, yauzl.Entry>> {
  const zf = await openZipFile(zipPath);
  const map = new Map<string, yauzl.Entry>();
  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('error', reject);
      zf.on('entry', (entry: yauzl.Entry) => {
        map.set(entry.fileName, entry);
        zf.readEntry();
      });
      zf.on('end', () => resolve());
      zf.readEntry();
    });
  } finally {
    zf.close();
  }
  return map;
}

/**
 * 在 zip 中定位目标条目并对其应用 job（拿到可读流）。
 * 找不到条目时抛 PACK_CORRUPT。
 */
async function withZipEntry<T>(
  zipPath: string,
  entryName: string,
  job: (entry: yauzl.Entry, rs: Readable) => Promise<T>,
): Promise<T> {
  const zf = await openZipFile(zipPath);
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      zf.on('error', (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      });
      zf.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) {
          zf.readEntry();
          return;
        }
        zf.openReadStream(entry, (err, rs) => {
          if (err || !rs) {
            if (!settled) {
              settled = true;
              reject(err ?? new Error('无法读取 zip 条目'));
            }
            return;
          }
          job(entry, rs as unknown as Readable)
            .then((val) => {
              if (!settled) {
                settled = true;
                resolve(val);
              }
            })
            .catch((e) => {
              if (!settled) {
                settled = true;
                reject(e);
              }
            });
        });
      });
      zf.on('end', () => {
        if (!settled) {
          settled = true;
          reject(
            new AppError('PACK_CORRUPT', `zip 中缺少条目: ${entryName}`),
          );
        }
      });
      zf.readEntry();
    });
  } finally {
    zf.close();
  }
}

/** 读取一个条目的全部内容（用于 manifest/entries.json 等小文件） */
export async function readEntryBuffer(
  zipPath: string,
  entryName: string,
  maxBytes = 64 * 1024 * 1024,
): Promise<Buffer> {
  return withZipEntry(zipPath, entryName, async (_entry, rs) => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of rs) {
      const buf = chunk as Buffer;
      total += buf.length;
      if (total > maxBytes) {
        throw new AppError('PACK_CORRUPT', `条目过大: ${entryName}`);
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  });
}

/** 解压一个条目到输出文件（流式），返回内容 sha256 与大小 */
export async function extractEntryToFile(
  zipPath: string,
  entryName: string,
  outPath: string,
): Promise<{ sha256: string; size: number }> {
  return withZipEntry(zipPath, entryName, async (entry, rs) => {
    const { transform, digestHex } = hashThrough();
    await pipeline(rs, transform, fs.createWriteStream(outPath));
    return { sha256: digestHex(), size: entry.uncompressedSize };
  });
}

/** 解压一个条目到输出文件（不做哈希，用于快速写入） */
export async function extractEntryToFileFast(
  zipPath: string,
  entryName: string,
  outPath: string,
): Promise<void> {
  await withZipEntry(zipPath, entryName, async (_entry, rs) => {
    await pipeline(rs, fs.createWriteStream(outPath));
  });
}

/* ---------- 写入（archiver） ---------- */

export class ZipWriter {
  private readonly archive: archiver.Archiver;
  private readonly out: fs.WriteStream;
  private readonly errors: Error[] = [];

  constructor(outPath: string) {
    this.archive = archiver('zip', { zlib: { level: 6 } });
    this.out = fs.createWriteStream(outPath);
    this.archive.on('warning', () => {
      /* 非致命告警忽略 */
    });
    this.archive.on('error', (e) => this.errors.push(e));
    this.archive.pipe(this.out);
  }

  addBuffer(name: string, buf: Buffer): void {
    this.archive.append(buf, { name });
  }

  addStream(name: string, rs: Readable): void {
    this.archive.append(rs, { name });
  }

  async finalize(): Promise<void> {
    await this.archive.finalize();
    await new Promise<void>((resolve, reject) => {
      this.out.on('close', () => resolve());
      this.out.on('error', reject);
    });
    if (this.errors.length > 0) {
      throw new AppError('IO_ERROR', 'zip 写入失败', this.errors[0]?.message);
    }
  }
}
