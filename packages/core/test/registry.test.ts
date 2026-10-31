import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRegistries } from '../src/registry';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const REGISTRY_DIR = path.join(REPO_ROOT, 'registry');

describe('registry 清单', () => {
  it('加载 6 个内置 agent 且字段完整', () => {
    const regs = loadRegistries(REGISTRY_DIR);
    const ids = regs.map((r) => r.id).sort();
    expect(ids).toEqual([
      'cherrystudio',
      'claude-code',
      'codex',
      'cursor',
      'hermes',
      'opencode',
      'pi',
      'qoder',
      'trae-cn',
      'workbuddy',
      'zcode',
    ]);
    for (const r of regs) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.restartHint.length).toBeGreaterThan(0);
      expect(r.roots.length).toBeGreaterThan(0);
      for (const root of r.roots) {
        expect(root.base.startsWith('{{')).toBe(true);
        expect(root.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('条目 id 在同一 agent 内唯一，凭据类默认不勾选', () => {
    const regs = loadRegistries(REGISTRY_DIR);
    for (const r of regs) {
      const ids = r.roots.flatMap((root) => root.items.map((i) => i.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of r.roots.flatMap((root) => root.items)) {
        if (item.sensitivity === 'secret') {
          expect(item.defaultSelected).toBe(false);
        }
      }
    }
  });

  it('拒绝非法清单', () => {
    const dir = fs.mkdtempSync('agentpack-badreg-');
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ id: 'x' }));
    expect(() => loadRegistries(dir)).toThrow(/restartHint/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
