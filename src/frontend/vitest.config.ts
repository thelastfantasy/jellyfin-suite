import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      // Allow tests to import from src/frontend/src
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    root: resolve(__dirname, '../..'),
    include: ['tests/frontend/**/*.test.ts', 'tests/frontend/**/*.test.tsx'],
    server: {
      fs: {
        allow: [resolve(__dirname, '../..')],
      },
    },
  },
})
