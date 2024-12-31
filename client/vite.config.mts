import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/default-doc': {
        target: 'ws://localhost:1234',
        ws: true
      }
    }
  },
  optimizeDeps: {
    include: ['yjs', 'lib0']
  },
  resolve: {
    dedupe: ['yjs']
  }
}) 