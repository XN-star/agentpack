import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        // 直接从源码内联打包 core（避免 workspace 链接进 asar 的问题）
        '@agentpack/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      },
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: 'src/main/index.ts',
        external: ['archiver', 'yauzl'],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: 'src/preload/index.ts' },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: 'src/renderer/index.html' },
    },
  },
});
