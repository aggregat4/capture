import { useEffect, useRef, useState } from 'react'
import './App.css'
import * as Y from 'yjs'

// Create a WebSocket connection to our server instead of using WebRTC
const wsProvider = (doc: Y.Doc) => {
  const ws = new WebSocket(`ws://${window.location.host}/ws`);
  
  ws.binaryType = 'arraybuffer';
  
  ws.onmessage = (event) => {
    doc.transact(() => {
      Y.applyUpdate(doc, new Uint8Array(event.data));
    });
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed');
  };

  return {
    ws,
    destroy: () => ws.close(),
    on: (event: string, callback: any) => {
      if (event === 'status') {
        ws.onopen = () => callback({ status: 'connected' });
        ws.onclose = () => callback({ status: 'disconnected' });
      }
    }
  };
};

function App() {
  const editorRef = useRef<HTMLDivElement>(null)
  const [doc] = useState(() => new Y.Doc())
  const [text] = useState(() => doc.getText('editor'))
  const [isConnected, setIsConnected] = useState(false)
  const isUpdatingRef = useRef(false)

  // Initialize Y.js document and WebSocket connection
  useEffect(() => {
    console.log('Initializing WebSocket connection...')
    
    // Set up WebSocket provider
    const provider = wsProvider(doc)
    
    provider.on('status', ({ status }: { status: 'connected' | 'disconnected' }) => {
      console.log('Connection status:', status)
      setIsConnected(status === 'connected')
    })

    // Observe changes to the shared text
    const observer = (event: Y.YTextEvent) => {
      if (isUpdatingRef.current) return // Skip if we're the ones updating
      if (!isConnected) return // Skip if not connected
      
      try {
        if (editorRef.current && event.target.toString() !== editorRef.current.innerHTML) {
          const selection = window.getSelection()
          const range = selection?.getRangeAt(0)
          const start = range?.startOffset || 0
          const end = range?.endOffset || 0

          editorRef.current.innerHTML = event.target.toString()

          // Restore cursor position
          if (selection && range && editorRef.current.firstChild) {
            range.setStart(editorRef.current.firstChild, start)
            range.setEnd(editorRef.current.firstChild, end)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      } catch (error) {
        console.error('Error in text observer:', error)
      }
    }
    text.observe(observer)

    return () => {
      text.unobserve(observer)
      provider.destroy()
    }
  }, [doc, text, isConnected])

  // Handle content editable changes
  const handleInput = () => {
    if (!editorRef.current || !isConnected) return
    
    try {
      const content = editorRef.current.innerHTML
      // Only update if content actually changed
      if (content !== text.toString()) {
        isUpdatingRef.current = true
        doc.transact(() => {
          text.delete(0, text.length)
          text.insert(0, content)
        })
        isUpdatingRef.current = false
      }
    } catch (error) {
      console.error('Error handling input:', error)
    }
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>Capture</h1>
      </header>
      <div
        ref={editorRef}
        className="content-editable"
        contentEditable={isConnected}
        onInput={handleInput}
        suppressContentEditableWarning
      >
        {!isConnected && <div className="placeholder">Connecting to server...</div>}
      </div>
      <div className="status-bar">
        <div className="status-bar-content">
          {!isConnected && <span className="connection-status">Disconnected - Editor disabled</span>}
          {isConnected && <span className="connection-status connected">Connected - Editor enabled</span>}
        </div>
      </div>
    </div>
  )
}

export default App 