import { Plugin } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

export function swPlugin(): Plugin {
  return {
    name: 'sw-plugin',
    apply: 'build',
    generateBundle() {
      const swPath = resolve(__dirname, 'public/sw.js')
      const swContent = readFileSync(swPath, 'utf-8')
      
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: swContent
      })
    }
  }
} 