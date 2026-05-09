import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.tsx'),
      name: 'JellyfinRecents',
      formats: ['iife'],
      fileName: () => 'jellyfin-recents.js',
    },
    outDir: resolve(__dirname, '../JellyfinRecents.Plugin/Web'),
    emptyOutDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    proxy: {
      '/Users': { target: process.env.VITE_JELLYFIN_URL || 'http://localhost:8600', changeOrigin: true },
      '/Items': { target: process.env.VITE_JELLYFIN_URL || 'http://localhost:8600', changeOrigin: true },
      '/System': { target: process.env.VITE_JELLYFIN_URL || 'http://localhost:8600', changeOrigin: true },
      '/JellyfinRecents': { target: process.env.VITE_JELLYFIN_URL || 'http://localhost:8600', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['../../tests/frontend/**/*.test.ts', '../../tests/frontend/**/*.test.tsx'],
  },
})
