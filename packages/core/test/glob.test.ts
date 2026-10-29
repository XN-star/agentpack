import { describe, expect, it } from 'vitest';
import { buildExcludeMatcher, globToRegExp } from '../src/glob';

describe('glob 匹配', () => {
  it('单星不跨目录', () => {
    const re = globToRegExp('*.json');
    expect(re.test('config.json')).toBe(true);
    expect(re.test('sub/config.json')).toBe(false);
  });

  it('双星跨目录', () => {
    const re = globToRegExp('**/*.log');
    expect(re.test('a.log')).toBe(true);
    expect(re.test('x/y/z/a.log')).toBe(true);
  });

  it('目录前缀', () => {
    const re = globToRegExp('node_modules/**');
    expect(re.test('node_modules/foo/index.js')).toBe(true);
    expect(re.test('src/index.js')).toBe(false);
  });

  it('排除器：空模式恒不排除，命中任一即排除', () => {
    expect(buildExcludeMatcher(undefined)('anything')).toBe(false);
    const m = buildExcludeMatcher(['*.tmp', 'cache/**']);
    expect(m('a.tmp')).toBe(true);
    expect(m('cache/x/y')).toBe(true);
    expect(m('src/a.ts')).toBe(false);
  });
});
