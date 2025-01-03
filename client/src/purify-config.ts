import { DOMPurifyConfig } from './types'
import DOMPurify from 'dompurify'

export const purifyConfig: DOMPurifyConfig = {
  ALLOWED_TAGS: ['p', 'strong', 'em', 'b', 'i', 'ul', 'li', 'br'],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
  ALLOW_EMPTY_TAGS: ['p', 'li']
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, purifyConfig)
} 