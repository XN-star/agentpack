#!/usr/bin/env node
/**
 * 生成 AgentPack 应用图标：
 *   packages/gui/build/icon.ico（16-256 多尺寸，electron-builder 使用）
 *   packages/gui/build/icon.png（512px，用于打包配置/文档）
 * 设计：蓝紫渐变圆角方块 + 白色双向箭头（⇄ 配置转场品牌符号）
 * 用法：node packages/gui/scripts/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

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
  <!-- 渐变圆角底板 -->
  <rect x="32" y="32" width="448" height="448" rx="104" fill="url(#g)"/>
  <!-- 顶部高光 -->
  <ellipse cx="256" cy="118" rx="150" ry="60" fill="#ffffff" opacity="0.14"/>
  <!-- 双向箭头：上→右，下→左 -->
  <g stroke="#ffffff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M150 196 H322"/>
    <path d="M322 196 l-46 -44"/>
    <path d="M322 196 l-46 44"/>
    <path d="M362 316 H190"/>
    <path d="M190 316 l46 -44"/>
    <path d="M190 316 l46 44"/>
  </g>
  <!-- 中缝分隔点 -->
  <circle cx="256" cy="256" r="10" fill="#ffffff" opacity="0.9"/>
</svg>
`;

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = [];
for (const size of sizes) {
  const resvg = new Resvg(SVG, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  pngs.push({ size, png });
}

fs.mkdirSync(buildDir, { recursive: true });

// ico（多尺寸 PNG 条目，Windows Vista+ 支持）
const ico = await pngToIco(pngs.map((p) => p.png));
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);

// 512px PNG
const big = new Resvg(
  SVG,
  { fitTo: { mode: 'width', value: 512 } },
).render().asPng();
fs.writeFileSync(path.join(buildDir, 'icon.png'), big);

console.log(
  `图标已生成: ${path.join(buildDir, 'icon.ico')}（${sizes.join('/')}）+ icon.png(512)`,
);
