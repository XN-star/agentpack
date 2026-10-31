import { describe, expect, it } from 'vitest';
import { rewriteSourcePaths } from '../src/transformers';
import type { PathContext } from '../src/types';

const sourceCtx: PathContext = {
  home: 'C:\\Users\\源用户',
  appdata: 'C:\\Users\\源用户\\AppData\\Roaming',
  localappdata: 'C:\\Users\\源用户\\AppData\\Local',
};
const targetCtx: PathContext = {
  home: 'C:\\Users\\目标用户',
  appdata: 'C:\\Users\\目标用户\\AppData\\Roaming',
  localappdata: 'C:\\Users\\目标用户\\AppData\\Local',
};

describe('rewriteSourcePaths：自定义路径映射（pathMap）', () => {
  it('正斜杠形式的前缀被改写', () => {
    const { text, changes } = rewriteSourcePaths(
      'plugins = "E:/MyTools/plugins/demo"',
      sourceCtx,
      targetCtx,
      [{ from: 'E:/MyTools', to: 'D:/TeamTools' }],
    );
    expect(text).toBe('plugins = "D:/TeamTools/plugins/demo"');
    expect(changes).toBe(1);
  });

  it('反斜杠形式的前缀被改写', () => {
    const { text, changes } = rewriteSourcePaths(
      'plugins = "E:\\MyTools\\plugins\\demo"',
      sourceCtx,
      targetCtx,
      [{ from: 'E:/MyTools', to: 'D:/TeamTools' }],
    );
    expect(text).toBe('plugins = "D:\\TeamTools\\plugins\\demo"');
    expect(changes).toBe(1);
  });

  it('JSON 转义反斜杠形式（\\\\）被改写', () => {
    const json = '{"path": "E:\\\\MyTools\\\\config.json"}';
    const { text, changes } = rewriteSourcePaths(
      json,
      sourceCtx,
      targetCtx,
      [{ from: 'E:/MyTools', to: 'D:/TeamTools' }],
    );
    expect(text).toBe('{"path": "D:\\\\TeamTools\\\\config.json"}');
    expect(changes).toBe(1);
  });

  it('前缀边界完整匹配：E:/MyTools2 不会被 E:/MyTools 误改', () => {
    const { text, changes } = rewriteSourcePaths(
      'a = "E:/MyTools2/x" b = "E:/MyTools/x"',
      sourceCtx,
      targetCtx,
      [{ from: 'E:/MyTools', to: 'D:/TeamTools' }],
    );
    expect(text).toBe('a = "E:/MyTools2/x" b = "D:/TeamTools/x"');
    expect(changes).toBe(1);
  });

  it('匹配不区分大小写（Windows）', () => {
    const { text } = rewriteSourcePaths(
      'a = "e:/mytools/x" b = "E:/MYTOOLS/x"',
      sourceCtx,
      targetCtx,
      [{ from: 'E:/MyTools', to: 'D:/TeamTools' }],
    );
    expect(text).toBe('a = "D:/TeamTools/x" b = "D:/TeamTools/x"');
  });

  it('恰好等于 from 本身也被改写', () => {
    const { text, changes } = rewriteSourcePaths(
      'root = "E:/MyTools"',
      sourceCtx,
      targetCtx,
      [{ from: 'E:/MyTools', to: 'D:/TeamTools' }],
    );
    expect(text).toBe('root = "D:/TeamTools"');
    expect(changes).toBe(1);
  });

  it('与来源基准目录重叠的映射被跳过（由基准逻辑处理，避免双重改写）', () => {
    const { text, changes } = rewriteSourcePaths(
      'home = "C:/Users/源用户/.zcode"',
      sourceCtx,
      targetCtx,
      [{ from: 'C:/Users/源用户', to: 'D:/其他' }],
    );
    // 由基准改写处理（正斜杠内容 → 正斜杠目标，现有行为）；pathMap 映射被跳过
    expect(text).toBe('home = "C:/Users/目标用户/.zcode"');
    expect(changes).toBe(1);
  });

  it('多条映射时最长前缀优先', () => {
    const { text } = rewriteSourcePaths(
      'p = "E:/MyTools/plugins/x"',
      sourceCtx,
      targetCtx,
      [
        { from: 'E:/MyTools', to: 'D:/Short' },
        { from: 'E:/MyTools/plugins', to: 'D:/Long/Plugins' },
      ],
    );
    expect(text).toBe('p = "D:/Long/Plugins/x"');
  });

  it('不传 pathMap 时行为与原来一致（基准改写仍生效）', () => {
    const { text, changes } = rewriteSourcePaths(
      'p = "C:\\\\Users\\\\源用户\\\\.zcode\\\\config.json"',
      sourceCtx,
      targetCtx,
    );
    expect(text).toBe('p = "C:\\\\Users\\\\目标用户\\\\.zcode\\\\config.json"');
    expect(changes).toBe(1); // JSON 转义内容只命中 jsonEscape 变体
  });
});
