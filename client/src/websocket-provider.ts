import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { ConnectionStatus } from './shared-types'

export interface WebsocketProvider {
  ws: WebSocket
  connectionStatus: ConnectionStatus
  destroy: () => void
  on: (event: string, callback: (data: any) => void) => void
}

export interface WebsocketProviderOptions {
  doc: Y.Doc & { awareness?: awarenessProtocol.Awareness }
  indexeddbProvider: IndexeddbPersistence
  config: {
    documentName: string
    password: string
  }
}

// Message types
const messageSync = 0
const messageAwareness = 1

export const createWebsocketProvider = (options: WebsocketProviderOptions): WebsocketProvider => {
  const { doc, indexeddbProvider, config } = options
  console.log('Creating new WebSocket connection...')
  
  const connectionStatus: ConnectionStatus = {
    isConnected: false,
    isAuthenticated: false
  }

  if (!config.password) {
    const statusBar = document.querySelector('footer')
    if (statusBar) {
      statusBar.textContent = 'Error: Password is required'
      statusBar.className = 'error'
    }
    throw new Error('Password is required')
  }
  
  // In development, use the proxy configured in vite.config.mts
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const wsUrl = isDev
    ? `/ws/${config.documentName}` // This will be proxied by Vite
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${config.documentName}`
  
  console.log('Connecting to WebSocket URL:', wsUrl)
  let ws = new WebSocket(wsUrl)
  let authenticationComplete = false
  let reconnectAttempts = 0
  const maxReconnectAttempts = 10
  const baseReconnectDelay = 1000
  const maxReconnectDelay = 30000
  const longPollingInterval = 60000 // 1 minute
  let reconnectTimeout: number | null = null
  let isLongPolling = false
  
  ws.binaryType = 'arraybuffer'
  
  const sendMessage = (message: string | ArrayBuffer) => {
    console.log("Sending message", message)
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
    }
  }

  const requestMissingUpdates = () => {
    console.log('Requesting missing updates from server')
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, doc)
    sendMessage(encoding.toUint8Array(encoder))
  }

  const attemptReconnect = () => {
    const delay = reconnectAttempts < maxReconnectAttempts
      ? Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), maxReconnectDelay)
      : longPollingInterval

    isLongPolling = reconnectAttempts >= maxReconnectAttempts
    
    console.log(
      isLongPolling
        ? `Polling for server availability every ${delay/1000} seconds`
        : `Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`
    )
    
    const statusBar = document.querySelector('footer')
    if (statusBar) {
      statusBar.textContent = isLongPolling
        ? `Offline - Checking for server every ${delay/1000} seconds`
        : `Reconnecting (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})...`
      statusBar.className = 'warning'
    }

    reconnectTimeout = window.setTimeout(() => {
      reconnectAttempts++
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      setupWebSocket(ws)
    }, delay)
  }

  const setupWebSocket = (socket: WebSocket) => {
    socket.onopen = () => {
      console.log('WebSocket connection opened successfully')
      reconnectAttempts = 0
      isLongPolling = false
      const statusBar = document.querySelector('footer')
      if (statusBar) {
        statusBar.textContent = 'Authenticating...'
      }
      console.log("Sending auth message")
      const authMessage = {
        type: 'auth',
        password: config.password
      }
      sendMessage(JSON.stringify(authMessage))
    }

    socket.onmessage = (event: MessageEvent) => {
      console.log('Received WebSocket message')
      
      if (!authenticationComplete) {
        if (typeof event.data === 'string') {
          try {
            const response = JSON.parse(event.data)
            if (response.type === 'auth') {
              if (response.status === 'success') {
                console.log('Authentication successful')
                authenticationComplete = true
                connectionStatus.isAuthenticated = true
                connectionStatus.isConnected = true
                const editor = document.getElementById('editor')
                if (editor) {
                  editor.contentEditable = 'true'
                }
                const statusBar = document.querySelector('footer')
                if (statusBar) {
                  statusBar.textContent = 'Connected'
                  statusBar.className = 'connected'
                }
                requestMissingUpdates()
              } else {
                console.error('Authentication failed:', response.message)
                const statusBar = document.querySelector('footer')
                if (statusBar) {
                  statusBar.textContent = 'Authentication failed - Invalid password'
                  statusBar.className = 'error'
                }
                socket.close()
              }
            }
          } catch (e) {
            console.error('Error parsing auth response:', e)
          }
        }
        return
      }

      if (event.data instanceof ArrayBuffer) {
        const message = new Uint8Array(event.data)
        const decoder = decoding.createDecoder(message)
        const encoder = encoding.createEncoder()
        const messageType = decoding.readVarUint(decoder)
        console.log('Message type:', messageType === messageSync ? 'sync' : 'awareness')
        
        switch (messageType) {
          case messageSync: {
            console.log('Processing sync message')
            encoding.writeVarUint(encoder, messageSync)
            syncProtocol.readSyncMessage(decoder, encoder, doc, sendMessage)
            
            if (encoding.length(encoder) > 1) {
              console.log('Sending sync response')
              sendMessage(encoding.toUint8Array(encoder))
            }
            break
          }
          case messageAwareness:
            awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), null)
            break
        }
      }
    }

    socket.onerror = (error: Event) => {
      console.error('WebSocket error:', error)
    }

    socket.onclose = (event: CloseEvent) => {
      console.log('WebSocket connection closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
      
      authenticationComplete = false
      connectionStatus.isAuthenticated = false
      connectionStatus.isConnected = false

      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout)
      }

      if (!event.wasClean) {
        attemptReconnect()
      }
    }
  }

  setupWebSocket(ws)

  doc.on('update', (update: Uint8Array, origin: any) => {
    if (origin === indexeddbProvider || origin === 'indexeddb') return

    console.log('Document update:', {
      updateLength: update.length,
      origin
    })
    
    if (connectionStatus.isConnected && connectionStatus.isAuthenticated) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeUpdate(encoder, update)
      const message = encoding.toUint8Array(encoder)
      console.log('Sending update to server')
      sendMessage(message)
    }
  })

  const eventCallbacks: { [key: string]: ((data: any) => void)[] } = {}

  return {
    ws,
    connectionStatus,
    destroy: () => {
      console.log('Destroying WebSocket connection')
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout)
      }
      ws.close()
    },
    on: (event: string, callback: (data: any) => void) => {
      if (event === 'status') {
        const originalOnOpen = ws.onopen
        ws.onopen = () => {
          console.log('Status: Connected')
          callback({ status: 'connected' })
          if (originalOnOpen) originalOnOpen.call(ws)
        }

        const originalOnClose = ws.onclose
        ws.onclose = (event) => {
          console.log('Status: Disconnected', {
            code: event.code,
            reason: event.reason
          })
          callback({ status: 'disconnected' })
          if (originalOnClose) originalOnClose.call(ws, event)
        }
      }
    }
  }
} 