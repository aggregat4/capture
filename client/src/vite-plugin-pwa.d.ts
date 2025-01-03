declare module 'vite-plugin-pwa' {
  import { Plugin } from 'vite'

  export interface VitePWAOptions {
    registerType?: 'autoUpdate' | 'prompt'
    manifest?: {
      name?: string
      short_name?: string
      description?: string
      theme_color?: string
      icons?: Array<{
        src: string
        sizes: string
        type: string
      }>
    }
  }

  export function VitePWA(options?: VitePWAOptions): Plugin
} 