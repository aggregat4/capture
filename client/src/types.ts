import { Config, ConnectionStatus, WebsocketProviderInstance } from './shared-types'

export { Config, ConnectionStatus, WebsocketProviderInstance }

export interface CursorPosition {
  start: number
  end: number
  startContainer: Node
  endContainer: Node
}

export interface EditorState {
  isUpdating: boolean
  hasLoadedFromIndexedDB: boolean
}

export interface DOMPurifyConfig {
  ALLOWED_TAGS: string[]
  ALLOWED_ATTR: string[]
  KEEP_CONTENT: boolean
  ALLOW_EMPTY_TAGS: string[]
} 