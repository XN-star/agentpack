import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  absToPlaceholder,
  applyPathMapping,
  defaultPathContext,
  expandPath,
  parsePathMappingSpecs,
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

describe('applyPathMapping：落位前缀映射', () => {
  const pathMap = [{ from: 'E:/MyTools', to: 'D:/TeamTools' }];

  it('普通前缀映射（正斜杠）', () => {
    expect(
      applyPathMapping('E:/MyTools/plugins/demo/config.json', pathMap),
    ).toBe('D:/TeamTools/plugins/demo/config.json');
  });

  it('恰好等于 from 也映射', () => {
    expect(applyPathMapping('E:/MyTools', pathMap)).toBe('D:/TeamTools');
  });

  it('前缀边界完整匹配：E:/MyTools2 不被 E:/MyTools 误吞', () => {
    expect(applyPathMapping('E:/MyTools2/x', pathMap)).toBe('E:/MyTools2/x');
  });

  it('大小写不敏感匹配，余部保留原样', () => {
    expect(applyPathMapping('e:/mytools/Skills/X.json', pathMap)).toBe(
      'D:/TeamTools/Skills/X.json',
    );
  });

  it('from 给反斜杠形式也能匹配', () => {
    expect(applyPathMapping('E:/MyTools/x', [{ from: 'E:\\MyTools', to: 'D:/TeamTools' }])).toBe(
      'D:/TeamTools/x',
    );
  });

  it('无匹配时原样返回', () => {
    expect(applyPathMapping('F:/Other/x', pathMap)).toBe('F:/Other/x');
  });

  it('占位符路径不参与映射', () => {
    expect(
      applyPathMapping('{{home}}/.zcode/config.json', [
        { from: '{{home}}', to: 'D:/x' },
      ]),
    ).toBe('{{home}}/.zcode/config.json');
  });

  it('多条映射时最长前缀优先', () => {
    expect(
      applyPathMapping('E:/MyTools/plugins/x', [
        { from: 'E:/MyTools', to: 'D:/Short' },
        { from: 'E:/MyTools/plugins', to: 'D:/Long/Plugins' },
      ]),
    ).toBe('D:/Long/Plugins/x');
  });

  it('空映射原样返回', () => {
    expect(applyPathMapping('E:/Keep/x', [])).toBe('E:/Keep/x');
  });
});

describe('parsePathMappingSpecs：CLI/GUI 映射参数解析', () => {
  it('解析 来源=目标', () => {
    expect(parsePathMappingSpecs(['E:/MyTools=D:/TeamTools'])).toEqual([
      { from: 'E:/MyTools', to: 'D:/TeamTools' },
    ]);
  });

  it('反斜杠输入规范化为正斜杠', () => {
    expect(parsePathMappingSpecs(['E:\\MyTools=D:\\TeamTools'])).toEqual([
      { from: 'E:/MyTools', to: 'D:/TeamTools' },
    ]);
  });

  it('目标路径中可以包含等号（按第一个 = 分割）', () => {
    expect(parsePathMappingSpecs(['E:/A=D:/a=b'])).toEqual([
      { from: 'E:/A', to: 'D:/a=b' },
    ]);
  });

  it('缺少 = 分隔符时报错', () => {
    expect(() => parsePathMappingSpecs(['E:/MyTools'])).toThrow();
  });

  it('from 或 to 为空时报错', () => {
    expect(() => parsePathMappingSpecs(['=D:/B'])).toThrow();
    expect(() => parsePathMappingSpecs(['E:/A='])).toThrow();
  });

  it('空数组返回空映射', () => {
    expect(parsePathMappingSpecs([])).toEqual([]);
  });
});
