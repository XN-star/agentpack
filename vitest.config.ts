import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    env: {
      // 测试不写真实历史记录
      AGENTPACK_HISTORY_OFF: '1',
    },
  },
});
