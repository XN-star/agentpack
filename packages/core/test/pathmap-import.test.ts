import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addManualPath,
  executeImport,
  exportPack,
  openPack,
  previewImport,
} from '../src/index';
import type { PathContext } from '../src/index';

// 三基准之外的路径映射（pathMap）端到端：导出含三基准外手动条目的包 → 带映射导入
describe('三基准外路径的导入映射（pathMap）', () => {
  let tmpRoot: string;
  let sourceCtx: PathContext;
  let targetCtx: PathContext;
  let srcTools: string; // 来源机器的非标准工具目录
  let dstTools: string; // 目标机器的对应目录
  let packPath: string;
  let itemKey = '';

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpack-pm-'));
    sourceCtx = {
      home: path.join(tmpRoot, 'src-home', 'Alice'),
      appdata: path.join(tmpRoot, 'src-home', 'Alice', 'AppData', 'Roaming'),
      localappdata: path.join(tmpRoot, 'src-home', 'Alice', 'AppData', 'Local'),
    };
    targetCtx = {
      home: path.join(tmpRoot, 'dst-home', 'Bob'),
      appdata: path.join(tmpRoot, 'dst-home', 'Bob', 'AppData', 'Roaming'),
      localappdata: path.join(tmpRoot, 'dst-home', 'Bob', 'AppData', 'Local'),
    };
    for (const c of [sourceCtx, targetCtx]) {
      fs.mkdirSync(c.appdata, { recursive: true });
      fs.mkdirSync(c.localappdata, { recursive: true });
    }
    srcTools = path.join(tmpRoot, 'src-tools');
    dstTools = path.join(tmpRoot, 'dst-tools');
    fs.mkdirSync(path.join(srcTools, 'MyTools'), { recursive: true });

    // 源配置内容引用源机器的非标准路径（反斜杠形式）
    fs.writeFileSync(
      path.join(srcTools, 'MyTools', 'settings.toml'),
      `pluginPath = "${path.join(srcTools, 'MyTools', 'plugins')}"\n`,
      'utf8',
    );

    const item = await addManualPath(
      path.join(srcTools, 'MyTools'),
      sourceCtx,
    );
    const result = await exportPack({
      items: [item],
      ctx: sourceCtx,
      outPath: path.join(tmpRoot, 'pm.agentpack'),
      password: ['Fixture', 'Pm', '1'].join('-'),
    });
    itemKey = result.entries.items[0].key;
    packPath = path.join(tmpRoot, 'pm.agentpack');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('previewImport 标记非标准路径条目', async () => {
    const handle = await openPack(packPath, ['Fixture', 'Pm', '1'].join('-'));
    try {
      const preview = previewImport(handle, targetCtx);
      expect(preview).toHaveLength(1);
      expect(preview[0].nonStandardPath).toBe(true);
      // 未提供映射时 targetAbs 仍为源绝对路径（供 UI 展示原始来源）
      expect(preview[0].targetAbs).toBe(
        path.normalize(preview[0].item.placeholderPath),
      );
    } finally {
      await handle.close();
    }
  });

  it('带 pathMap 导入：落位到映射目标 + 内容引用同步改写', async () => {
    const handle = await openPack(packPath, ['Fixture', 'Pm', '1'].join('-'));
    try {
      const pathMap = [
        { from: srcTools.replace(/\\/g, '/'), to: dstTools.replace(/\\/g, '/') },
      ];
      const preview = previewImport(handle, targetCtx, pathMap);
      // 预览已展示映射后的落位
      expect(preview[0].targetAbs).toBe(
        path.join(dstTools, 'MyTools'),
      );
      const report = await executeImport({
        handle,
        ctx: targetCtx,
        decisions: { [itemKey]: 'overwrite' },
        pathMap,
      });
      expect(report.written).toBe(1);
      const destFile = path.join(dstTools, 'MyTools', 'settings.toml');
      expect(fs.existsSync(destFile)).toBe(true);
      const content = fs.readFileSync(destFile, 'utf8');
      // 内容里对源机器 src-tools 的引用已改写为目标 dst-tools
      expect(content).toBe(
        `pluginPath = "${path.join(dstTools, 'MyTools', 'plugins')}"\n`,
      );
    } finally {
      await handle.close();
    } 
  });

  it('无 pathMap 导入保持原路径（向后兼容）', async () => {
    const handle = await openPack(packPath, ['Fixture', 'Pm', '1'].join('-'));
    try {
      const report = await executeImport({
        handle,
        ctx: targetCtx,
        decisions: { [itemKey]: 'overwrite' },
      });
      expect(report.written).toBe(1);
      // 行为与旧版本一致：写入源绝对路径位置（本测试在 tmpRoot 内，无副作用）
      expect(fs.existsSync(path.join(srcTools, 'MyTools', 'settings.toml'))).toBe(true);
    } finally {
      handle.close();
    }
  });
});
