import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { swPlugin } from './vite-sw-plugin'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Capture',
        short_name: 'Capture',
        description: 'A collaborative text editor',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    }),
    swPlugin()
  ] as const,
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:1234',
        ws: true
      }
    }
  }
}) 