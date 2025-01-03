import { defineConfig } from 'vite'
import { resolve } from 'path'
import { serviceWorkerPlugin } from './vite-sw-plugin'

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
  },
  optimizeDeps: {
    include: ['yjs', 'lib0', 'y-indexeddb']
  },
  resolve: {
    dedupe: ['yjs']
  },
  plugins: [
    serviceWorkerPlugin()
  ]
}) 