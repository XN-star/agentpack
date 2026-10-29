import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  absToPlaceholder,
  defaultPathContext,
  expandPath,
} from '../src/paths';

const ctx = {
  home: 'C:\\Users\\测试用户',
  appdata: 'C:\\Users\\测试用户\\AppData\\Roaming',
  localappdata: 'C:\\Users\\测试用户\\AppData\\Local',
};

describe('路径占位符', () => {
  it('展开 {{home}}', () => {
    expect(expandPath('{{home}}/.zcode/config.json', ctx)).toBe(
      path.normalize('C:\\Users\\测试用户\\.zcode\\config.json'),
    );
  });

  it('展开 {{appdata}} 与 {{localappdata}}', () => {
    expect(expandPath('{{appdata}}/Trae CN/User/settings.json', ctx)).toBe(
      path.normalize('C:\\Users\\测试用户\\AppData\\Roaming\\Trae CN\\User\\settings.json'),
    );
    expect(expandPath('{{localappdata}}/hermes/config.yaml', ctx)).toBe(
      path.normalize('C:\\Users\\测试用户\\AppData\\Local\\hermes\\config.yaml'),
    );
  });

  it('占位符与本机路径互转（round-trip）', () => {
    const abs = 'C:\\Users\\测试用户\\.zcode\\skills\\foo\\SKILL.md';
    const ph = absToPlaceholder(abs, ctx);
    expect(ph).toBe('{{home}}/.zcode/skills/foo/SKILL.md');
    expect(expandPath(ph!, ctx)).toBe(abs);
  });

  it('AppData 下的路径优先匹配更长基准（不会误挂到 {{home}}）', () => {
    const abs = 'C:\\Users\\测试用户\\AppData\\Roaming\\Hermes\\skills';
    expect(absToPlaceholder(abs, ctx)).toBe('{{appdata}}/Hermes/skills');
  });

  it('基准目录之外的路径返回 null', () => {
    expect(absToPlaceholder('D:\\tools\\myagent', ctx)).toBeNull();
  });

  it('默认上下文包含三个基准', () => {
    const d = defaultPathContext();
    expect(d.home.length).toBeGreaterThan(0);
    expect(d.appdata.toLowerCase()).toContain('roaming');
    expect(d.localappdata.toLowerCase()).toContain('local');
  });
});
