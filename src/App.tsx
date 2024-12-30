import { useEffect, useRef, useState } from 'react'
import './App.css'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'

function App() {
  const editorRef = useRef<HTMLDivElement>(null)
  const [wordCount, setWordCount] = useState(0)
  const [doc] = useState(() => new Y.Doc())
  const [text] = useState(() => doc.getText('editor'))
  const isUpdatingRef = useRef(false)

  // Initialize Y.js document and persistence
  useEffect(() => {
    // Set up IndexedDB persistence
    const provider = new IndexeddbPersistence('capture-editor', doc)
    
    provider.on('synced', () => {
      console.log('Content synced with IndexedDB')
      // Initial load of content
      if (editorRef.current && text.toString() !== editorRef.current.innerHTML) {
        editorRef.current.innerHTML = text.toString()
        updateWordCount(text.toString())
      }
    })

    // Observe changes to the shared text
    const observer = (event: Y.YTextEvent) => {
      if (isUpdatingRef.current) return // Skip if we're the ones updating
      if (editorRef.current && event.target.toString() !== editorRef.current.innerHTML) {
        editorRef.current.innerHTML = event.target.toString()
        updateWordCount(event.target.toString())
      }
    }
    text.observe(observer)

    return () => {
      text.unobserve(observer)
      provider.destroy()
    }
  }, [doc, text])

  // Handle content editable changes
  const handleInput = () => {
    if (editorRef.current) {
      const content = editorRef.current.innerHTML
      // Only update if content actually changed
      if (content !== text.toString()) {
        isUpdatingRef.current = true
        text.delete(0, text.length)
        text.insert(0, content)
        updateWordCount(content)
        isUpdatingRef.current = false
      }
    }
  }

  const updateWordCount = (content: string) => {
    const words = content
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .trim()
      .split(/\s+/)
      .filter(word => word.length > 0)
    setWordCount(words.length)
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>Capture</h1>
      </header>
      <div
        ref={editorRef}
        className="content-editable"
        contentEditable
        onInput={handleInput}
        suppressContentEditableWarning
      />
      <div className="status-bar">
        <div className="status-bar-content">
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </div>
      </div>
    </div>
  )
}

export default App 