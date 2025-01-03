export interface ConnectionStatus {
  isConnected: boolean
  isAuthenticated: boolean
}

export interface Config {
  documentName: string
  password: string
}

export interface WebsocketProviderInstance {
  ws: WebSocket
  connectionStatus: ConnectionStatus
  destroy: () => void
  on: (event: string, callback: (data: any) => void) => void
} 