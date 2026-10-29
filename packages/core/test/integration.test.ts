import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addManualPath,
  executeImport,
  exportPack,
  loadRegistries,
  openPack,
  previewImport,
  readManifest,
  scanRegistries,
  type AgentRegistry,
  type PathContext,
  type ScanResult,
} from '../src/index';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const REGISTRY_DIR = path.join(REPO_ROOT, 'registry');

// 测试专用假数据（拼接构造，仅为覆盖加密/打包路径，不是任何真实凭据）
const FAKE_KEY = ['FIXTURE', 'FAKE', 'KEY'].join('-');
const PW_MAIN = ['Fixture', 'Pass', '1'].join('-');
const PW_ALT = ['Fixture', 'Pass', '2'].join('-');

let tmpRoot: string;
let sourceCtx: PathContext;
let targetCtx: PathContext;
let regs: AgentRegistry[];

function mkdir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function write(p: string, content: string): void {
  mkdir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf8');
}

/** 模拟两个不同用户名的机器（验证路径差异自动适配） */
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpack-it-'));
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
    mkdir(c.appdata);
    mkdir(c.localappdata);
  }
  regs = loadRegistries(REGISTRY_DIR);
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('端到端：扫描 → 导出 → 导入', () => {
  let scan: ScanResult;
  let packPath: string;

  it('扫描发现模拟的 zcode 配置（含凭据排除逻辑）', async () => {
    write(
      path.join(sourceCtx.home, '.zcode', 'AGENTS.md'),
      '# 规则\n始终使用中文回答。\n',
    );
    write(
      path.join(sourceCtx.home, '.zcode', 'cli', 'config.json'),
      JSON.stringify({ model: 'glm-4.7', workdir: sourceCtx.home + '\\projects' }, null, 2),
    );
    write(
      path.join(sourceCtx.home, '.zcode', 'v2', 'credentials.json'),
      `{"apiKey": "${FAKE_KEY}"}`,
    );
    // .trae-cn 的技能 + .zcode/skills 指向它的 junction（模拟真实环境的符号链接共享）
    write(
      path.join(sourceCtx.home, '.trae-cn', 'skills', 'demo-skill', 'SKILL.md'),
      '共享技能（通过 junction 引用）\n',
    );
    mkdir(path.join(sourceCtx.home, '.zcode', 'skills'));
    fs.symlinkSync(
      path.join(sourceCtx.home, '.trae-cn', 'skills', 'demo-skill'),
      path.join(sourceCtx.home, '.zcode', 'skills', 'demo-skill'),
      'junction',
    );

    scan = await scanRegistries(regs, sourceCtx);
    const zcode = scan.agents.find((a) => a.id === 'zcode')!;
    expect(zcode.found).toBe(true);
    const labels = zcode.items.map((i) => i.itemId);
    expect(labels).toContain('agents-md');
    expect(labels).toContain('cli-config');
    expect(labels).toContain('credentials');
    const skills = zcode.items.find((i) => i.itemId === 'skills')!;
    expect(skills.linkCount).toBe(1);
    expect(skills.fileCount).toBe(1); // junction 解引用后计入目标文件
    const cred = zcode.items.find((i) => i.itemId === 'credentials')!;
    expect(cred.sensitivity).toBe('secret');
    expect(cred.defaultSelected).toBe(false);
  });

  it('导出（默认不含凭据）→ manifest 无条目信息', async () => {
    packPath = path.join(tmpRoot, 'test.agentpack');
    const selected = scan.agents
      .flatMap((a) => a.items)
      .filter((i) => i.migratable && i.sensitivity !== 'secret');
    const result = await exportPack({
      items: selected,
      ctx: sourceCtx,
      outPath: packPath,
      password: PW_MAIN,
    });
    expect(result.fileCount).toBeGreaterThan(0);
    expect(fs.existsSync(packPath)).toBe(true);
    const manifest = await readManifest(packPath);
    expect(manifest.format).toBe('agentpack/1');
    expect(manifest.sourceOs).toBe('windows');
    // 明文 manifest 不含条目路径
    const raw = JSON.stringify(manifest);
    expect(raw).not.toContain('credentials.json');
    expect(raw).not.toContain('AGENTS.md');
  });

  it('凭据被打包时（手动勾选）内容仅存在于加密区', async () => {
    const withSecret = scan.agents
      .flatMap((a) => a.items)
      .filter((i) => i.migratable);
    const p2 = path.join(tmpRoot, 'with-secret.agentpack');
    const r = await exportPack({
      items: withSecret,
      ctx: sourceCtx,
      outPath: p2,
      password: PW_ALT,
    });
    expect(r.entries.items.some((i) => i.sensitivity === 'secret')).toBe(true);
    // 包外层（明文）不含密钥值
    const outer = fs.readFileSync(p2);
    expect(outer.indexOf(FAKE_KEY)).toBe(-1);
    fs.rmSync(p2);
  });

  it('错误密码被拒绝', async () => {
    await expect(openPack(packPath, 'wrong-password-xx')).rejects.toMatchObject({
      code: 'PASSWORD_WRONG',
    });
  });

  it('导入到目标机器：路径自适应 + 内容一致 + transformer 改写', async () => {
    const handle = await openPack(packPath, PW_MAIN);
    try {
      const preview = previewImport(handle, targetCtx);
      expect(preview.length).toBe(handle.entries.items.length);
      // 目标路径已映射到 Bob 的主目录
      for (const p of preview) {
        expect(p.targetAbs.startsWith(targetCtx.home)).toBe(true);
      }
      const decisions: Record<string, 'overwrite'> = {};
      for (const p of preview) {
        decisions[p.item.key] = 'overwrite';
      }
      const report = await executeImport({ handle, ctx: targetCtx, decisions });
      expect(report.written).toBe(handle.entries.files.length);
      expect(report.skipped).toBe(0);
      // 内容一致
      const ag = fs.readFileSync(
        path.join(targetCtx.home, '.zcode', 'AGENTS.md'),
        'utf8',
      );
      expect(ag).toContain('始终使用中文回答');
      // junction 解引用后的技能文件落位为目标真实文件
      expect(
        fs.existsSync(
          path.join(targetCtx.home, '.zcode', 'skills', 'demo-skill', 'SKILL.md'),
        ),
      ).toBe(true);
      // transformer：config.json 内的来源绝对路径被改写为目标机器路径
      const cfg = JSON.parse(
        fs.readFileSync(path.join(targetCtx.home, '.zcode', 'cli', 'config.json'), 'utf8'),
      ) as { workdir: string };
      expect(cfg.workdir.startsWith(targetCtx.home)).toBe(true);
      expect(cfg.workdir).not.toContain('Alice');
    } finally {
      await handle.close();
    }
  });

  it('冲突策略 backup：目标已有文件被备份后写入', async () => {
    const cfgPath = path.join(targetCtx.home, '.zcode', 'cli', 'config.json');
    fs.writeFileSync(cfgPath, '{"model": "old-local"}', 'utf8');
    const handle = await openPack(packPath, PW_MAIN);
    try {
      const preview = previewImport(handle, targetCtx);
      const decisions: Record<string, 'backup'> = {};
      for (const p of preview) {
        decisions[p.item.key] = 'backup';
      }
      const report = await executeImport({ handle, ctx: targetCtx, decisions });
      // 上一用例已把全部文件写入目标：4 个文件（含 sameAs 重复条目）全部命中备份
      expect(report.backedUp).toBe(4);
      expect(report.backupPath).toBeTruthy();
      const backupManifest = JSON.parse(
        fs.readFileSync(path.join(report.backupPath!, 'BACKUP-MANIFEST.json'), 'utf8'),
      ) as { files: Array<{ original: string }> };
      expect(backupManifest.files.some((f) => f.original === cfgPath)).toBe(true);
      // 原位置已被包内内容覆盖
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { model: string };
      expect(cfg.model).toBe('glm-4.7');
    } finally {
      await handle.close();
    }
  });

  it('冲突策略 skip：已存在文件保持不变', async () => {
    const cfgPath = path.join(targetCtx.home, '.zcode', 'cli', 'config.json');
    fs.writeFileSync(cfgPath, '{"model": "keep-me"}', 'utf8');
    const handle = await openPack(packPath, PW_MAIN);
    try {
      const preview = previewImport(handle, targetCtx);
      const decisions: Record<string, 'skip'> = {};
      for (const p of preview) {
        decisions[p.item.key] = 'skip';
      }
      const report = await executeImport({ handle, ctx: targetCtx, decisions });
      expect(report.written).toBe(0);
      expect(
        (JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { model: string }).model,
      ).toBe('keep-me');
    } finally {
      await handle.close();
    }
  });

  it('手动添加路径可进入导出清单', async () => {
    write(path.join(sourceCtx.home, 'custom-agent', 'settings.toml'), 'model = "custom"\n');
    const item = await addManualPath(
      path.join(sourceCtx.home, 'custom-agent'),
      sourceCtx,
    );
    expect(item.type).toBe('dir');
    expect(item.fileCount).toBe(1);
    expect(item.placeholderPath).toBe('{{home}}/custom-agent');
  });
});
