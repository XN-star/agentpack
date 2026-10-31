import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  executeImport,
  exportPack,
  loadRegistries,
  openPack,
  previewImport,
  scanRegistries,
  type AgentRegistry,
  type PathContext,
} from '../src/index';

const PW = ['Json', 'Merge', '1'].join('-');

let tmpRoot: string;
let sourceCtx: PathContext;
let targetCtx: PathContext;

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

/** 含 json-fields 条目的临时 registry */
function buildRegistry(dir: string): AgentRegistry {
  const reg: AgentRegistry = {
    id: 'claude-code',
    name: 'Claude Code',
    restartHint: '重启后生效',
    roots: [
      {
        id: 'home',
        base: '{{home}}',
        items: [
          {
            id: 'claude-json-subset',
            label: 'MCP/项目配置子集',
            path: '.claude.json',
            type: 'json-fields',
            fields: ['projects'],
            category: 'mcp',
            sensitivity: 'normal',
            defaultSelected: true,
          },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'claude-code.json'), JSON.stringify(reg));
  return reg;
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpack-jf-'));
  sourceCtx = {
    home: path.join(tmpRoot, 'Alice'),
    appdata: path.join(tmpRoot, 'Alice', 'AppData', 'Roaming'),
    localappdata: path.join(tmpRoot, 'Alice', 'AppData', 'Local'),
  };
  targetCtx = {
    home: path.join(tmpRoot, 'Bob'),
    appdata: path.join(tmpRoot, 'Bob', 'AppData', 'Roaming'),
    localappdata: path.join(tmpRoot, 'Bob', 'AppData', 'Local'),
  };
  for (const c of [sourceCtx, targetCtx]) {
    fs.mkdirSync(c.appdata, { recursive: true });
    fs.mkdirSync(c.localappdata, { recursive: true });
  }
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('json-fields：子集提取与深合并导入', () => {
  it('导出只含白名单字段；导入保留目标账号态并合并项目配置', async () => {
    const regDir = path.join(tmpRoot, 'registry');
    fs.mkdirSync(regDir, { recursive: true });
    const reg = buildRegistry(regDir);

    // 来源机器：账号态 + 项目 MCP 配置混在同一文件
    write(
      path.join(sourceCtx.home, '.claude.json'),
      JSON.stringify({
        userID: 'SOURCE-ACCOUNT',
        machineID: 'src-machine',
        projects: {
          'D:\\work\\alpha': { mcpServers: { fs: { command: 'npx' } } },
        },
      }),
    );
    // 目标机器：已有自己的账号态与一个既有项目
    write(
      path.join(targetCtx.home, '.claude.json'),
      JSON.stringify({
        userID: 'TARGET-ACCOUNT',
        hasCompletedOnboarding: true,
        projects: {
          'D:\\work\\beta': { allowedTools: ['Read'] },
          'D:\\work\\alpha': { allowedTools: ['Read'] },
        },
      }),
    );

    const regs = loadRegistries(regDir);
    const scan = await scanRegistries(regs, sourceCtx);
    const items = scan.agents
      .flatMap((a) => a.items)
      .filter((i) => i.migratable);
    expect(items.length).toBe(1);
    expect(items[0]!.type).toBe('json-fields');

    const packPath = path.join(tmpRoot, 'jf.agentpack');
    const exported = await exportPack({
      items,
      ctx: sourceCtx,
      outPath: packPath,
      password: PW,
    });
    // 包里只有白名单字段的子集，不含账号字段
    const subset = exported.entries.files[0]!;
    expect(subset.merge).toBe(true);
    expect(exported.fileCount).toBe(1);

    const handle = await openPack(packPath, PW);
    try {
      const preview = previewImport(handle, targetCtx);
      const decisions: Record<string, 'overwrite'> = {};
      for (const p of preview) {
        decisions[p.item.key] = 'overwrite';
      }
      const report = await executeImport({
        handle,
        ctx: targetCtx,
        decisions,
      });
      expect(report.written).toBe(1);

      const merged = JSON.parse(
        fs.readFileSync(path.join(targetCtx.home, '.claude.json'), 'utf8'),
      ) as {
        userID: string;
        hasCompletedOnboarding: boolean;
        projects: Record<string, unknown>;
      };
      // 目标账号态保留
      expect(merged.userID).toBe('TARGET-ACCOUNT');
      expect(merged.hasCompletedOnboarding).toBe(true);
      // 来源项目合入，重叠项目深合并（source 覆盖同名字段，target 独有字段保留）
      expect(Object.keys(merged.projects).sort()).toEqual([
        'D:\\work\\alpha',
        'D:\\work\\beta',
      ]);
      const alpha = merged.projects['D:\\work\\alpha'] as Record<string, unknown>;
      expect(alpha.mcpServers).toBeDefined();
      expect(alpha.allowedTools).toEqual(['Read']);
    } finally {
      await handle.close();
    }
  });
});
