import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'jellyfin-suite-enhancer.js',
    },
    outDir: '../../src/JellyfinSuite.Plugin/Web',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // 单文件 bundle，无外部依赖
        inlineDynamicImports: true,
      },
    },
  },
})
