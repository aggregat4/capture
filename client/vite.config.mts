import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:1234',
        ws: true
      }
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  optimizeDeps: {
    include: ['yjs', 'lib0']
  },
  resolve: {
    dedupe: ['yjs']
  }
}) 