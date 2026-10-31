#!/usr/bin/env node
/**
 * 生成 AgentPack 应用图标（Windows 兼容的规范 ICO）：
 *   packages/gui/build/icon.ico —— 16/24/32/48/64/128 为 BMP(DIB) 条目，
 *   256 为 PNG 条目（Windows 快捷方式图标解析器对小尺寸 PNG 支持不佳，
 *   纯 PNG ico 会导致「更改图标」失败并回退默认图标）
 *   packages/gui/build/icon.png —— 512px 预览图
 * 设计：蓝紫渐变圆角方块 + 白色双向箭头（⇄ 配置转场品牌符号）
 * 用法：node packages/gui/scripts/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(here, '../build');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2F6BFF"/>
      <stop offset="0.55" stop-color="#5B54F0"/>
      <stop offset="1" stop-color="#7B3FF2"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="104" fill="url(#g)"/>
  <ellipse cx="256" cy="118" rx="150" ry="60" fill="#ffffff" opacity="0.14"/>
  <g stroke="#ffffff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M150 196 H322"/>
    <path d="M322 196 l-46 -44"/>
    <path d="M322 196 l-46 44"/>
    <path d="M362 316 H190"/>
    <path d="M190 316 l46 -44"/>
    <path d="M190 316 l46 44"/>
  </g>
  <circle cx="256" cy="256" r="10" fill="#ffffff" opacity="0.9"/>
</svg>
`;

/** RGBA 像素 → ICO 的 BMP(DIB) 条目（32bpp + 1bpp AND 掩码，行序自底向上） */
function dibFromRgba(width, height, pixels) {
  const xorSize = width * height * 4;
  // 1bpp AND 掩码，每行按 4 字节对齐
  const andRowBytes = Math.ceil(width / 32) * 4;
  const andSize = andRowBytes * height;
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0); // biSize
  bih.writeInt32LE(width, 4); // biWidth
  bih.writeInt32LE(height * 2, 8); // biHeight = XOR + AND 两段
  bih.writeUInt16LE(1, 12); // biPlanes
  bih.writeUInt16LE(32, 14); // biBitCount
  bih.writeUInt32LE(0, 16); // biCompression = BI_RGB
  bih.writeUInt32LE(xorSize + andSize, 20); // biSizeImage
  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 4;
    const dstRow = (height - 1 - y) * width * 4; // 自底向上
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      xor[d] = pixels[s + 2]; // B
      xor[d + 1] = pixels[s + 1]; // G
      xor[d + 2] = pixels[s]; // R
      xor[d + 3] = pixels[s + 3]; // A
    }
  }
  // AND 掩码全 0 = 不透明（透明度由 alpha 通道表达）
  const and = Buffer.alloc(andSize);
  return Buffer.concat([bih, xor, and]);
}

function renderRgba(size) {
  const resvg = new Resvg(SVG, { fitTo: { mode: 'width', value: size } });
  const image = resvg.render();
  return { width: image.width, height: image.height, pixels: image.pixels };
}

/** 组装 ICO：<=128 BMP(DIB)，256 PNG */
function buildIco(sizes) {
  const images = sizes.map((size) => {
    if (size === 256) {
      const png = new Resvg(SVG, {
        fitTo: { mode: 'width', value: 256 },
      })
        .render()
        .asPng();
      return { size, data: png, isPng: true };
    }
    const { width, height, pixels } = renderRgba(size);
    return { size, data: dibFromRgba(width, height, pixels), isPng: false };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width（0 表示 256）
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    e.writeUInt8(0, 2); // 调色板色数
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bitCount
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

fs.mkdirSync(buildDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(sizes));
fs.writeFileSync(
  path.join(buildDir, 'icon.png'),
  new Resvg(SVG, { fitTo: { mode: 'width', value: 512 } }).render().asPng(),
);

console.log(
  `图标已生成: ${path.join(buildDir, 'icon.ico')}（${sizes.join('/')}，规范 BMP+PNG 混合条目）+ icon.png(512)`,
);
