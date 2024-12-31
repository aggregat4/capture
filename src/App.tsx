import { useEffect, useRef, useState } from 'react'
import './App.css'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

function App() {
  const editorRef = useRef<HTMLDivElement>(null)
  const [doc] = useState(() => new Y.Doc())
  const [text] = useState(() => doc.getText('editor'))
  const [isConnected, setIsConnected] = useState(false)
  const isUpdatingRef = useRef(false)

  // Initialize Y.js document and WebRTC connection
  useEffect(() => {
    console.log('Initializing WebRTC connection...')
    
    // Set up WebRTC provider: the document should probably be a high entropy secret so we can securely
    // collaborate on it and the password should be a secret shared amongst collaborators
    // TODO: This means that in the app we need a way to either generate or input a document id and password
    const provider = new WebrtcProvider('capture-document', doc, { password: 'secret-password' })
    
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