/**
 * 轻量 glob 匹配：支持 **（跨目录）、*（单段内）、?（单字符）。
 * 输入路径一律使用正斜杠。
 */
export function globToRegExp(pattern: string): RegExp {
  const p = pattern.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        // '**' 或 '**/'
        if (p[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$', process.platform === 'win32' ? 'i' : '');
}

export interface GlobMatcher {
  (relPath: string): boolean;
}

/** 一组排除模式；任一命中即排除。空数组时恒为 false */
export function buildExcludeMatcher(patterns: string[] | undefined): GlobMatcher {
  if (!patterns || patterns.length === 0) {
    return () => false;
  }
  const regs = patterns.map(globToRegExp);
  return (rel) => {
    const fwd = rel.replace(/\\/g, '/');
    return regs.some((re) => re.test(fwd));
  };
}
