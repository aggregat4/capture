import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import { createWebsocketProvider } from './websocket-provider'
import { loadConfig, saveConfig } from './config'
import { wrapInParagraphs, plainTextToHtml, getXmlFragmentContent } from './utils'
import { EditorState, CursorPosition } from './types'
import DOMPurify from 'dompurify'
import { purifyConfig } from './utils'
import { getChildNodesArray, getElementChildrenArray, isChildNode } from './dom-utils'

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Check if we're in development mode
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

    if (isDev) {
      // Unregister all service workers in development
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister()
        }
      })
    } else {
      // Register service worker in production
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('ServiceWorker registration successful')
        })
        .catch(err => {
          console.error('ServiceWorker registration failed:', err)
        })
    }
  })
}

// Initialize the editor when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('editor')
  const statusBar = document.querySelector('footer')
  const configSection = document.querySelector('.config-section')
  const configToggle = document.querySelector('.config-toggle')
  const toolbar = document.querySelector('.toolbar')
  
  if (!editor || !statusBar || !configSection || !configToggle || !toolbar) {
    console.error('Required DOM elements not found')
    return
  }

  editor.contentEditable = 'false'
  
  // Handle formatting buttons
  toolbar.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const button = target.closest('button')
    if (!button) return
    
    e.preventDefault()
    const format = button.dataset.format
    
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return
    
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.commonAncestorContainer)) return
    
    switch (format) {
      case 'bold':
        applyInlineFormat('strong', range)
        break
      case 'italic':
        applyInlineFormat('em', range)
        break
      case 'list':
        applyListFormat(range)
        break
    }
    
    // Update button state based on current selection
    updateToolbarState()
    
    // Force an input event to sync changes
    editor.dispatchEvent(new Event('input'))
  })
  
  // Apply inline formatting (bold/italic)
  const applyInlineFormat = (tag: string, range: Range) => {
    const isFormatted = isInlineFormatted(tag, range)
    
    if (isFormatted) {
      // Remove formatting
      const elements = getElementsInRange(tag, range)
      elements.forEach(element => {
        const parent = element.parentNode
        if (parent) {
          while (element.firstChild) {
            parent.insertBefore(element.firstChild, element)
          }
          parent.removeChild(element)
        }
      })
    } else {
      // Apply formatting
      const element = document.createElement(tag)
      range.surroundContents(element)
    }
  }
  
  // Apply list formatting
  const applyListFormat = (range: Range) => {
    const listElement = getParentOfType('ul', range.commonAncestorContainer)
    
    if (listElement) {
      // Remove list formatting
      const items = Array.from(listElement.children)
      items.forEach(item => {
        if (item.tagName.toLowerCase() === 'li') {
          const p = document.createElement('p')
          p.innerHTML = item.innerHTML
          listElement.parentNode?.insertBefore(p, listElement)
        }
      })
      listElement.parentNode?.removeChild(listElement)
    } else {
      // Apply list formatting
      const ul = document.createElement('ul')
      const li = document.createElement('li')
      
      // If the selection is within a paragraph, convert it to a list item
      const paragraph = getParentOfType('p', range.commonAncestorContainer)
      if (paragraph) {
        li.innerHTML = paragraph.innerHTML
        ul.appendChild(li)
        paragraph.parentNode?.replaceChild(ul, paragraph)
      } else {
        // Otherwise, wrap the selection in a list item
        li.appendChild(range.extractContents())
        ul.appendChild(li)
        range.insertNode(ul)
      }
    }
  }
  
  // Helper function to get all elements of a type within a range
  const getElementsInRange = (tag: string, range: Range): Element[] => {
    const elements: Element[] = []
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (node.nodeName.toLowerCase() === tag && range.intersectsNode(node)) {
            return NodeFilter.FILTER_ACCEPT
          }
          return NodeFilter.FILTER_SKIP
        }
      }
    )
    
    let node: Node | null
    while (node = walker.nextNode()) {
      elements.push(node as Element)
    }
    return elements
  }
  
  // Helper function to check if a range has inline formatting
  const isInlineFormatted = (tag: string, range: Range): boolean => {
    // If it's a collapsed cursor, check if we're inside the formatting
    if (range.collapsed) {
      let node: Node | null = range.startContainer
      
      // If we're in a text node, start with its parent
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentNode
      }
      
      // Check if we're inside the formatting tag
      while (node && node !== editor) {
        if (node.nodeName.toLowerCase() === tag) {
          return true
        }
        node = node.parentNode
      }
      return false
    }
    
    // For selections, check if any part is formatted
    return getElementsInRange(tag, range).length > 0
  }
  
  // Helper function to get nearest parent of specific type
  const getParentOfType = (tag: string, node: Node | null): Element | null => {
    while (node && node !== editor) {
      if (node.nodeName.toLowerCase() === tag) {
        return node as Element
      }
      node = node.parentNode
    }
    return null
  }
  
  // Update toolbar state based on current selection
  const updateToolbarState = () => {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return
    
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.commonAncestorContainer)) return
    
    const buttons = toolbar.querySelectorAll('button')
    buttons.forEach(button => {
      const format = button.dataset.format
      switch (format) {
        case 'bold':
          button.classList.toggle('active', isInlineFormatted('strong', range))
          break
        case 'italic':
          button.classList.toggle('active', isInlineFormatted('em', range))
          break
        case 'list':
          button.classList.toggle('active', !!getParentOfType('ul', range.commonAncestorContainer))
          break
      }
    })
  }
  
  // Update toolbar state when selection changes
  editor.addEventListener('keyup', updateToolbarState)
  editor.addEventListener('mouseup', updateToolbarState)
  editor.addEventListener('selectionchange', updateToolbarState)
  
  // Load and display current config
  const config = loadConfig()
  const docNameInput = document.getElementById('docName') as HTMLInputElement
  const docPasswordInput = document.getElementById('docPassword') as HTMLInputElement
  
  if (!docNameInput || !docPasswordInput) {
    console.error('Config inputs not found')
    return
  }

  docNameInput.value = config.documentName
  docPasswordInput.value = config.password
  
  // Handle config toggle
  configToggle.addEventListener('click', () => {
    configSection.classList.toggle('visible')
    configToggle.classList.toggle('active')
  })
  
  // Handle config updates
  const saveConfigButton = document.getElementById('saveConfig')
  if (saveConfigButton) {
    saveConfigButton.addEventListener('click', () => {
      const newConfig = {
        documentName: docNameInput.value,
        password: docPasswordInput.value
      }
      saveConfig(newConfig)
      window.location.reload() // Reload to reconnect with new config
    })
  }

  const doc = new Y.Doc()
  
  // Initialize the shared type first
  const text = doc.get('editor', Y.XmlFragment)
  
  // Create initial structure in a transaction
  doc.transact(() => {
    // Wait for the document to be ready
    if (!text.length) {
      const initialParagraph = new Y.XmlElement('p')
      const initialText = new Y.XmlText('')
      initialParagraph.insert(0, [initialText])
      text.insert(0, [initialParagraph])
    }
  })
  
  const editorState: EditorState = {
    isUpdating: false,
    hasLoadedFromIndexedDB: false
  }

  // Initialize IndexedDB persistence
  const indexeddbProvider = new IndexeddbPersistence(config.documentName, doc)
  
  // Wait for IndexedDB to load
  indexeddbProvider.on('synced', () => {
    console.log('Content from IndexedDB loaded into the editor')
    if (editorState.hasLoadedFromIndexedDB) return // Only load from IndexedDB once
    editorState.hasLoadedFromIndexedDB = true
    
    try {
      // Get the initial content
      const content = getXmlFragmentContent(text)
      console.log('Loaded content:', content)
      
      // Convert to HTML with proper structure
      const htmlContent = plainTextToHtml(content)
      console.log('Converted to HTML:', htmlContent)
      
      // Update editor with sanitized HTML
      if (htmlContent) {
        editor.innerHTML = DOMPurify.sanitize(htmlContent, purifyConfig)
      }
      
      // Enable editing
      editor.contentEditable = 'true'
      if (!websocketProvider.connectionStatus.isConnected) {
        statusBar.textContent = 'Offline'
        statusBar.className = 'warning'
      }
    } catch (error) {
      console.error('Error loading content from IndexedDB:', error)
    }
  })

  // Initialize awareness
  const awareness = new Awareness(doc)
  awareness.setLocalState(null)

  // Set up WebSocket provider with indexeddbProvider reference
  const websocketProvider = createWebsocketProvider({
    doc,
    indexeddbProvider,
    config
  })

  // Disable editor until authenticated and connected
  editor.contentEditable = 'false'
  statusBar.textContent = 'Connecting...'
  
  // Observe changes to the shared text
  text.observe(() => {
    if (editorState.isUpdating) return
    
    try {
      const content = getXmlFragmentContent(text)
      const htmlContent = plainTextToHtml(content)
      
      if (editor.innerHTML !== htmlContent) {
        // Store current selection if it exists
        let cursorPosition: CursorPosition | null = null
        const selection = window.getSelection()
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0)
          if (range && editor.contains(range.startContainer)) {
            cursorPosition = {
              start: range.startOffset,
              end: range.endOffset,
              startContainer: range.startContainer,
              endContainer: range.endContainer
            }
          }
        }

        // Update content with sanitized and structured HTML
        editor.innerHTML = DOMPurify.sanitize(htmlContent, purifyConfig)

        // Restore cursor position if we had one
        if (cursorPosition && selection) {
          try {
            // Try to find equivalent positions in the new DOM
            const newRange = document.createRange()
            
            // Find the closest matching position in the new DOM
            const findEquivalentNode = (oldNode: Node, root: Node): Node => {
              if (oldNode === editor) return root
              const path: number[] = []
              let node: Node | null = oldNode
              while (node && node !== editor) {
                const parent = node.parentNode
                if (!parent) break
                const siblings = getChildNodesArray(parent)
                const index = siblings.findIndex(sibling => sibling === node)
                if (index === -1) break
                path.unshift(index)
                node = parent
              }
              
              // Follow the same path in the new DOM
              let newNode = root
              for (const index of path) {
                const siblings = getChildNodesArray(newNode)
                if (siblings[index]) {
                  newNode = siblings[index]
                } else {
                  return root
                }
              }
              return newNode
            }
            
            const newStartNode = findEquivalentNode(cursorPosition.startContainer, editor)
            const newEndNode = findEquivalentNode(cursorPosition.endContainer, editor)
            
            const startLength = newStartNode.textContent?.length || 0
            const endLength = newEndNode.textContent?.length || 0
            
            newRange.setStart(newStartNode, Math.min(cursorPosition.start, startLength))
            newRange.setEnd(newEndNode, Math.min(cursorPosition.end, endLength))
            
            selection.removeAllRanges()
            selection.addRange(newRange)
          } catch (error) {
            console.error('Error restoring cursor position:', error)
          }
        }
      }
    } catch (error) {
      console.error('Error in text observer:', error)
    }
  })

  // Extract full sync into a shared function
  const performFullSync = (doc: Y.Doc, text: Y.XmlFragment, editor: HTMLElement, editorState: EditorState) => {
    console.log('Performing full sync')
    const dirtyContent = editor.innerHTML
    const cleanContent = wrapInParagraphs(dirtyContent)
    
    editorState.isUpdating = true
    doc.transact(() => {
      // Clear existing content
      text.delete(0, text.length)
      
      // Parse the HTML and create XML elements
      const div = document.createElement('div')
      div.innerHTML = cleanContent
      
      const addNode = (parent: Y.XmlFragment, node: Node, state = { index: 0 }) => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent) {
          const trimmedContent = node.textContent.trim()
          if (trimmedContent) {
            parent.insert(state.index, [new Y.XmlText(node.textContent)])
            state.index++
          }
        } else if (node.nodeType === Node.ELEMENT_NODE && node instanceof HTMLElement) {
          const tag = node.tagName.toLowerCase()
          // Map b to strong and i to em for consistency
          const mappedTag = {
            'b': 'strong',
            'i': 'em'
          }[tag] || tag
          
          if (['p', 'ul', 'li', 'strong', 'em'].includes(mappedTag)) {
            const xmlElement = new Y.XmlElement(mappedTag)
            const elementState = { index: 0 }
            
            if (mappedTag === 'ul') {
              // Process all li elements in order
              Array.from(node.children).forEach(child => {
                if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'li') {
                  const liElement = new Y.XmlElement('li')
                  liElement.insert(0, [new Y.XmlText(child.innerHTML)])
                  xmlElement.insert(elementState.index, [liElement])
                  elementState.index++
                }
              })
            } else {
              Array.from(node.childNodes).forEach(child => {
                addNode(xmlElement, child, elementState)
              })
            }
            
            parent.insert(state.index, [xmlElement])
            state.index++
          }
        }
      }
      
      const documentState = { index: 0 }
      Array.from(div.childNodes).forEach(child => {
        addNode(text, child, documentState)
      })
    })
    editorState.isUpdating = false
  }

  // Handle content editable changes
  editor.addEventListener('input', () => {
    try {
      const selection = window.getSelection()
      if (!selection) return
      
      const range = selection.getRangeAt(0)
      
      // Check if this is a multi-element change
      const isMultiElementChange = () => {
        const startElement = range.startContainer.nodeType === Node.TEXT_NODE 
          ? range.startContainer.parentElement 
          : range.startContainer
        const endElement = range.endContainer.nodeType === Node.TEXT_NODE 
          ? range.endContainer.parentElement 
          : range.endContainer
        
        // If start and end are different elements, or if we've deleted content
        // that spans multiple elements, do a full sync
        if (startElement !== endElement || editor.childNodes.length !== text.length) {
          console.log('Multi-element change detected')
          return true
        }
        return false
      }

      // If this is a multi-element change, do a full sync
      if (isMultiElementChange()) {
        console.log('Handling multi-element change with full sync')
        performFullSync(doc, text, editor, editorState)
        return
      }

      // Rest of the existing single-element change handling code...
      const startContainer = range.startContainer
      
      // Find the nearest parent element that we track in Y.js (p, ul, li)
      const findNearestTrackedElement = (node: Node | null): HTMLElement | null => {
        while (node && node !== editor) {
          if (node instanceof HTMLElement) {
            const tagName = node.tagName.toLowerCase()
            // For list items, we want to track the ul parent instead
            if (tagName === 'li') {
              const ul = node.closest('ul')
              if (ul) return ul
            }
            if (['p', 'ul'].includes(tagName)) {
              return node
            }
          }
          node = node.parentElement
        }
        return null
      }

      // Get the nearest tracked element
      const trackedElement = findNearestTrackedElement(
        startContainer.nodeType === Node.TEXT_NODE ? startContainer.parentElement : startContainer
      )
      
      console.log('Found tracked element:', trackedElement?.tagName, trackedElement)
      
      if (trackedElement) {
        // Find the Y.js node that corresponds to the changed DOM node
        const findYjsNode = (domNode: HTMLElement, yjsParent: Y.XmlFragment): Y.XmlElement | null => {
          if (!yjsParent || !domNode) return null
          
          // Get the index of this node among siblings of the same type
          const getDomNodeIndex = (node: HTMLElement): number => {
            let index = 0
            let sibling = node.previousElementSibling
            while (sibling) {
              if (sibling.tagName === node.tagName) {
                index++
              }
              sibling = sibling.previousElementSibling
            }
            return index
          }

          // Find direct match in the Y.js parent
          const nodeIndex = getDomNodeIndex(domNode)
          const tag = domNode.tagName.toLowerCase()
          console.log('Looking for node:', { tag, nodeIndex })

          let matchCount = 0
          let foundNode: Y.XmlElement | null = null

          yjsParent.forEach((node) => {
            if (node instanceof Y.XmlElement && node.nodeName === tag) {
              if (matchCount === nodeIndex) {
                foundNode = node
                return false // Break the forEach loop
              }
              matchCount++
            }
          })

          if (!foundNode) {
            console.log('No matching node found. Total matches of type:', matchCount)
          } else {
            console.log('Found matching node at index:', nodeIndex)
          }

          return foundNode
        }

        const yjsNode = findYjsNode(trackedElement, text)
        console.log('Found Y.js node:', yjsNode?.nodeName, yjsNode)
        
        if (yjsNode) {
          editorState.isUpdating = true
          doc.transact(() => {
            // Update the content of the Y.js node to match the DOM
            const newContent = DOMPurify.sanitize(trackedElement.innerHTML, purifyConfig)
            console.log('Updating node content:', newContent)
            
            // Clear existing content of this node
            if (yjsNode.length > 0) {
              yjsNode.delete(0, yjsNode.length)
            }
            
            // For lists, we need to create proper li elements
            if (trackedElement.tagName.toLowerCase() === 'ul') {
              getElementChildrenArray(trackedElement).forEach(li => {
                if (li.tagName.toLowerCase() === 'li') {
                  const liElement = new Y.XmlElement('li')
                  liElement.insert(0, [new Y.XmlText(li.innerHTML)])
                  yjsNode.insert(yjsNode.length, [liElement])
                }
              })
            } else {
              // For other elements, just insert the content
              if (newContent.trim()) {
                yjsNode.insert(0, [new Y.XmlText(newContent)])
              }
            }
          })
          editorState.isUpdating = false
          return
        }
      }
      
      console.log('Falling back to full sync')
      // If we couldn't find a matching node or if the change was at the root level,
      // fall back to full sync
      performFullSync(doc, text, editor, editorState)
    } catch (error) {
      console.error('Error handling input:', error)
      editorState.isUpdating = false
    }
  })

  // Clean up on page unload
  window.addEventListener('unload', () => {
    websocketProvider.destroy()
    indexeddbProvider.destroy()
  })
}) 