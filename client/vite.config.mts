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
    emptyOutDir: true,
    rollupOptions: {
      external: ['y-indexeddb'],
      output: {
        globals: {
          'y-indexeddb': 'Y_IndexedDB'
        }
      }
    }
  },
  optimizeDeps: {
    include: ['yjs', 'lib0', 'y-indexeddb']
  },
  resolve: {
    dedupe: ['yjs']
  }
}) 