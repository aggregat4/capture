// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Check if we're in development mode
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isDev) {
      // Unregister all service workers in development
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
        }
      });
    } else {
      // Register service worker in production
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('ServiceWorker registration successful');
        })
        .catch(err => {
          console.error('ServiceWorker registration failed:', err);
        });
    }
  });
}

import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { IndexeddbPersistence } from 'y-indexeddb'
import DOMPurify from 'dompurify';

// Configure DOMPurify to allow specific formatting tags
const purifyConfig = {
  ALLOWED_TAGS: ['p', 'strong', 'em', 'b', 'i', 'ul', 'li', 'br'],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
  // Ensure empty paragraphs are preserved
  ALLOW_EMPTY_TAGS: ['p', 'li']
};

// Helper to ensure content is properly wrapped in paragraphs
const wrapInParagraphs = (html) => {
  const div = document.createElement('div');
  div.innerHTML = DOMPurify.sanitize(html, purifyConfig);
  
  // Convert text nodes and br tags at the root level into paragraphs
  const fragment = document.createDocumentFragment();
  let currentP = null;
  
  Array.from(div.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') {
      if (!currentP) {
        currentP = document.createElement('p');
        fragment.appendChild(currentP);
      }
      currentP.appendChild(node.cloneNode(true));
      if (node.nodeName === 'BR') {
        currentP = null;
      }
    } else {
      currentP = null;
      fragment.appendChild(node.cloneNode(true));
    }
  });
  
  // If we have a pending paragraph with content, append it
  if (currentP && currentP.textContent.trim()) {
    fragment.appendChild(currentP);
  }
  
  div.innerHTML = '';
  div.appendChild(fragment);
  return div.innerHTML;
};

// Convert HTML to plain text while preserving structure
const htmlToPlainText = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  
  const walk = (node) => {
    let text = '';
    
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map(walk).join('');
      
      switch (tag) {
        case 'p':
          // If this paragraph is empty or only contains whitespace/breaks
          if (!children.trim()) {
            return '\n';
          }
          return children + '\n';
        case 'br':
          return '\n';
        case 'ul':
          return children;
        case 'li':
          return '• ' + children + '\n';
        case 'strong':
          return `<strong>${children}</strong>`;
        case 'em':
          return `<em>${children}</em>`;
        default:
          return children;
      }
    }
    
    return '';
  };
  
  return walk(div).replace(/\n{3,}/g, '\n\n').trim() + '\n';
};

// Convert plain text to HTML with proper structure
const plainTextToHtml = (text) => {
  if (!text) return '';
  
  // Since we're now dealing with HTML content, not just plain text
  // We'll parse it as HTML first to preserve formatting tags
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = text;
  
  const lines = tempDiv.innerHTML.split('\n');
  let inList = false;
  let html = '';
  let skipNextEmptyLine = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const isLastLine = i === lines.length - 1;
    
    if (trimmedLine.startsWith('•')) {
      skipNextEmptyLine = false;
      // Start a new list if we're not in one
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      // Remove the bullet point but preserve any HTML tags inside
      html += `<li>${trimmedLine.substring(1).trim()}</li>`;
    } else {
      // End the list if we were in one
      if (inList) {
        html += '</ul>';
        inList = false;
        skipNextEmptyLine = true;
      }
      
      // Handle empty lines
      if (!trimmedLine) {
        if (!skipNextEmptyLine && !isLastLine) {
          html += '<p></p>';
        }
        skipNextEmptyLine = false;
      } else {
        skipNextEmptyLine = false;
        // Preserve any HTML tags in the line
        html += `<p>${trimmedLine}</p>`;
      }
    }
  }
  
  // Close any open list
  if (inList) {
    html += '</ul>';
  }
  
  return html;
};

// Message types
const messageSync = 0;
const messageAwareness = 1;

// Configuration management
const CONFIG_KEY = 'editor_config';
const defaultConfig = {
  documentName: 'default-doc',
  password: ''
};

const loadConfig = () => {
  const stored = localStorage.getItem(CONFIG_KEY);
  return stored ? JSON.parse(stored) : defaultConfig;
};

const saveConfig = (config) => {
  if (!config.password) {
    throw new Error('Password is required');
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

// Create a WebSocket connection to our server
const wsProvider = (doc) => {
  console.log('Creating new WebSocket connection...');
  const config = loadConfig();
  const connectionStatus = {
    isConnected: false,
    isAuthenticated: false
  };

  if (!config.password) {
    const statusBar = document.querySelector('footer');
    statusBar.textContent = 'Error: Password is required';
    statusBar.className = 'error';
    throw new Error('Password is required');
  }
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/${config.documentName}`;
  let ws = new WebSocket(wsUrl);
  let authenticationComplete = false;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000; // Start with 1 second
  let reconnectTimeout = null;
  
  ws.binaryType = 'arraybuffer';
  
  const sendMessage = (message) => {
    console.log("Sending message", message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  };

  const attemptReconnect = () => {
    reconnectAttempts++;
    let delay;
    
    if (reconnectAttempts <= 5) {
      // Use exponential backoff for the first 5 attempts
      delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 30000);
    } else {
      // After 5 attempts, try every 30 seconds
      delay = 30000;
    }
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
    
    const statusBar = document.querySelector('footer');
    statusBar.textContent = `Reconnecting (attempt ${reconnectAttempts})...`;
    statusBar.className = 'warning';

    reconnectTimeout = setTimeout(() => {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      setupWebSocket(ws);
    }, delay);
  };

  const setupWebSocket = (socket) => {
    socket.onopen = () => {
      console.log('WebSocket connection opened successfully');
      reconnectAttempts = 0; // Reset reconnection attempts on successful connection
      const statusBar = document.querySelector('footer');
      statusBar.textContent = 'Authenticating...';
      console.log("Sending auth message");
      const authMessage = {
        type: 'auth',
        password: config.password
      };
      sendMessage(JSON.stringify(authMessage));
    };

    socket.onmessage = (event) => {
      console.log('Received WebSocket message');
      
      // Handle authentication response
      if (!authenticationComplete) {
        if (typeof event.data === 'string') {
          try {
            const response = JSON.parse(event.data);
            if (response.type === 'auth') {
              if (response.status === 'success') {
                console.log('Authentication successful');
                authenticationComplete = true;
                connectionStatus.isAuthenticated = true;
                connectionStatus.isConnected = true;
                // Enable editor
                const editor = document.getElementById('editor');
                editor.contentEditable = 'true';
                const statusBar = document.querySelector('footer');
                statusBar.textContent = 'Connected';
                statusBar.className = 'connected';
                
                // Force a full sync after reconnection
                const encoder = encoding.createEncoder();
                encoding.writeVarUint(encoder, messageSync);
                syncProtocol.writeSyncStep1(encoder, doc);
                sendMessage(encoding.toUint8Array(encoder));

                // Also send any pending local updates
                const update = Y.encodeStateAsUpdate(doc);
                if (update.length > 0) {
                  console.log('Sending pending offline changes');
                  const updateEncoder = encoding.createEncoder();
                  encoding.writeVarUint(updateEncoder, messageSync);
                  syncProtocol.writeUpdate(updateEncoder, update);
                  sendMessage(encoding.toUint8Array(updateEncoder));
                }
              } else {
                console.error('Authentication failed:', response.message);
                const statusBar = document.querySelector('footer');
                statusBar.textContent = 'Authentication failed - Invalid password';
                statusBar.className = 'error';
                socket.close();
              }
            }
          } catch (e) {
            console.error('Error parsing auth response:', e);
          }
        }
        return; // Don't process any messages until authentication is complete
      }

      // Handle binary messages
      if (event.data instanceof ArrayBuffer) {
        const message = new Uint8Array(event.data);
        const encoder = encoding.createEncoder();
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        console.log('Message type:', messageType === messageSync ? 'sync' : 'awareness');
        
        switch (messageType) {
          case messageSync: {
            console.log('Processing sync message');
            encoding.writeVarUint(encoder, messageSync);
            syncProtocol.readSyncMessage(decoder, encoder, doc, sendMessage);
            
            // Only try to access the XmlFragment if we have a response to send
            if (encoding.length(encoder) > 1) {
              // Make sure the XmlFragment exists
              doc.transact(() => {
                const xmlFragment = doc.get('editor', Y.XmlFragment);
                if (Array.from(xmlFragment).length === 0) {
                  const initialParagraph = new Y.XmlElement('p');
                  initialParagraph.insert(0, ['']); // Empty paragraph
                  xmlFragment.insert(0, [initialParagraph]);
                }
              });
              
              const response = encoding.toUint8Array(encoder);
              console.log('Sending sync response', {
                responseLength: response.length,
                responseContent: Array.from(response).map(byte => byte.toString(16)).join(' ')
              });
              sendMessage(response);
            }
            break;
          }
          case messageAwareness:
            awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), null);
            break;
        }
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = (event) => {
      console.log('WebSocket connection closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });
      
      authenticationComplete = false;
      connectionStatus.isAuthenticated = false;
      connectionStatus.isConnected = false;

      // Clear any existing reconnect timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      // Attempt to reconnect unless it was a clean close (e.g., user navigating away)
      if (!event.wasClean) {
        attemptReconnect();
      }
    };
  };

  setupWebSocket(ws);

  return {
    ws,
    connectionStatus,
    destroy: () => {
      console.log('Destroying WebSocket connection');
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      ws.close();
    },
    on: (event, callback) => {
      if (event === 'status') {
        // Store the original onopen handler
        const originalOnOpen = ws.onopen;
        ws.onopen = () => {
          console.log('Status: Connected');
          callback({ status: 'connected' });
          // Call the original onopen handler
          if (originalOnOpen) originalOnOpen();
        };

        // Store the original onclose handler
        const originalOnClose = ws.onclose;
        ws.onclose = (event) => {
          console.log('Status: Disconnected', {
            code: event.code,
            reason: event.reason
          });
          callback({ status: 'disconnected' });
          // Call the original onclose handler
          if (originalOnClose) originalOnClose(event);
        };
      }
    }
  };
};

// Convert XmlFragment to text content
const getXmlFragmentContent = (xmlFragment) => {
  let content = '';
  xmlFragment.forEach(item => {
    if (typeof item === 'string') {
      content += item;
    } else if (item instanceof Y.XmlText) {
      content += item.toString();
    } else if (item instanceof Y.XmlElement) {
      const tag = item.nodeName;
      const innerContent = getXmlFragmentContent(item);
      switch (tag) {
        case 'p':
          content += innerContent + '\n';
          break;
        case 'ul':
          content += innerContent + '\n';
          break;
        case 'li':
          content += '• ' + innerContent + '\n';
          break;
        case 'strong':
        case 'b':
          content += `<strong>${innerContent}</strong>`;
          break;
        case 'em':
        case 'i':
          content += `<em>${innerContent}</em>`;
          break;
        default:
          content += innerContent;
      }
    }
  });
  return content.trim();
};

// Initialize the editor when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('editor');
  const statusBar = document.querySelector('footer');
  const configSection = document.querySelector('.config-section');
  const configToggle = document.querySelector('.config-toggle');
  const toolbar = document.querySelector('.toolbar');
  
  // Handle formatting buttons
  toolbar.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    
    e.preventDefault();
    const format = button.dataset.format;
    
    switch (format) {
      case 'bold':
        document.execCommand('bold', false);
        break;
      case 'italic':
        document.execCommand('italic', false);
        break;
      case 'list':
        document.execCommand('insertUnorderedList', false);
        break;
    }
    
    // Update button state based on current selection
    updateToolbarState();
    
    // Force an input event to sync changes
    editor.dispatchEvent(new Event('input'));
  });
  
  // Update toolbar state based on current selection
  const updateToolbarState = () => {
    const buttons = toolbar.querySelectorAll('button');
    buttons.forEach(button => {
      const format = button.dataset.format;
      switch (format) {
        case 'bold':
          button.classList.toggle('active', document.queryCommandState('bold'));
          break;
        case 'italic':
          button.classList.toggle('active', document.queryCommandState('italic'));
          break;
        case 'list':
          button.classList.toggle('active', document.queryCommandState('insertUnorderedList'));
          break;
      }
    });
  };
  
  // Update toolbar state when selection changes
  editor.addEventListener('keyup', updateToolbarState);
  editor.addEventListener('mouseup', updateToolbarState);
  editor.addEventListener('selectionchange', updateToolbarState);
  
  // Load and display current config
  const config = loadConfig();
  document.getElementById('docName').value = config.documentName;
  document.getElementById('docPassword').value = config.password;
  
  // Handle config toggle
  configToggle.addEventListener('click', () => {
    configSection.classList.toggle('visible');
    configToggle.classList.toggle('active');
  });
  
  // Handle config updates
  document.getElementById('saveConfig').addEventListener('click', () => {
    const newConfig = {
      documentName: document.getElementById('docName').value,
      password: document.getElementById('docPassword').value
    };
    saveConfig(newConfig);
    window.location.reload(); // Reload to reconnect with new config
  });

  const doc = new Y.Doc();
  
  // Initialize the shared type first
  const text = doc.get('editor', Y.XmlFragment);
  
  // Create initial structure in a transaction
  doc.transact(() => {
    // Use Array.from to safely check length
    if (Array.from(text).length === 0) {
      const initialParagraph = new Y.XmlElement('p');
      initialParagraph.insert(0, ['']); // Empty paragraph
      text.insert(0, [initialParagraph]);
    }
  });
  
  let isConnected = false;
  let isUpdating = false;

  // Initialize IndexedDB persistence
  const indexeddbProvider = new IndexeddbPersistence(config.documentName, doc);
  
  // Wait for IndexedDB to load
  let hasLoadedFromIndexedDB = false;
  
  indexeddbProvider.on('synced', () => {
    console.log('Content from IndexedDB loaded into the editor');
    if (hasLoadedFromIndexedDB) return; // Only load from IndexedDB once
    hasLoadedFromIndexedDB = true;
    
    try {
      // Get the initial content
      const content = getXmlFragmentContent(text);
      console.log('Loaded content:', content);
      
      // Convert to HTML with proper structure
      const htmlContent = plainTextToHtml(content);
      console.log('Converted to HTML:', htmlContent);
      
      // Update editor with sanitized HTML
      if (htmlContent) {
        editor.innerHTML = DOMPurify.sanitize(htmlContent, purifyConfig);
      }
      
      // Enable editing
      editor.contentEditable = 'true';
      if (!websocketProvider.connectionStatus.isConnected) {
        statusBar.textContent = 'Offline';
        statusBar.className = 'warning';
      }
    } catch (error) {
      console.error('Error loading content from IndexedDB:', error);
    }
  });

  // Initialize awareness
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);

  // Set up WebSocket provider
  const websocketProvider = wsProvider(doc);

  // Disable editor until authenticated and connected
  editor.contentEditable = 'false';
  statusBar.textContent = 'Connecting...';
  
  // Handle document updates
  doc.on('update', (update, origin) => {
    // Allow updates even when offline - they will be synced when we reconnect
    if (origin === indexeddbProvider) return;

    console.log('Document update:', {
      updateLength: update.length,
      updateContent: Array.from(update).map(byte => byte.toString(16)).join(' '),
      origin
    });
    
    // Only send updates to server if we're connected
    if (websocketProvider.connectionStatus.isConnected && websocketProvider.connectionStatus.isAuthenticated) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      console.log('Sending update to server:', {
        messageLength: message.length,
        messageContent: Array.from(message).map(byte => byte.toString(16)).join(' ')
      });
      websocketProvider.ws.send(message);
    }
  });

  websocketProvider.on('status', ({ status }) => {
    console.log('Connection status:', status);
    websocketProvider.connectionStatus.isConnected = status === 'connected';
    
    if (!websocketProvider.connectionStatus.isConnected) {
      // When disconnected, we still allow editing if we have local data
      editor.contentEditable = 'true';
      statusBar.textContent = 'Offline';
      statusBar.className = 'warning';
    } else {
      statusBar.textContent = 'Connected';
      statusBar.className = 'connected';
    }
  });

  // Observe changes to the shared text
  text.observe(event => {
    if (isUpdating) return;
    
    try {
      const content = getXmlFragmentContent(text);
      const htmlContent = plainTextToHtml(content);
      
      if (editor && editor.innerHTML !== htmlContent) {
        // Store current selection if it exists
        let cursorPosition = null;
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (range && editor.contains(range.startContainer)) {
            cursorPosition = {
              start: range.startOffset,
              end: range.endOffset,
              startContainer: range.startContainer,
              endContainer: range.endContainer
            };
          }
        }

        // Update content with sanitized and structured HTML
        editor.innerHTML = DOMPurify.sanitize(htmlContent, purifyConfig);

        // Restore cursor position if we had one
        if (cursorPosition && selection) {
          try {
            // Try to find equivalent positions in the new DOM
            const newRange = document.createRange();
            
            // Find the closest matching position in the new DOM
            const findEquivalentNode = (oldNode, root) => {
              if (oldNode === editor) return root;
              const path = [];
              let node = oldNode;
              while (node && node !== editor) {
                const parent = node.parentNode;
                if (!parent) break;
                path.unshift(Array.from(parent.childNodes).indexOf(node));
                node = parent;
              }
              
              // Follow the same path in the new DOM
              let newNode = root;
              for (const index of path) {
                if (newNode.childNodes[index]) {
                  newNode = newNode.childNodes[index];
                } else {
                  return null;
                }
              }
              return newNode;
            };
            
            const newStartNode = findEquivalentNode(cursorPosition.startContainer, editor) || editor;
            const newEndNode = findEquivalentNode(cursorPosition.endContainer, editor) || editor;
            
            newRange.setStart(newStartNode, Math.min(cursorPosition.start, newStartNode.textContent.length));
            newRange.setEnd(newEndNode, Math.min(cursorPosition.end, newEndNode.textContent.length));
            
            selection.removeAllRanges();
            selection.addRange(newRange);
          } catch (error) {
            console.error('Error restoring cursor position:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error in text observer:', error);
    }
  });

  // Handle content editable changes
  editor.addEventListener('input', () => {
    try {
      const selection = window.getSelection();
      const range = selection.getRangeAt(0);
      
      // Check if this is a multi-element change
      const isMultiElementChange = () => {
        const startElement = range.startContainer.nodeType === Node.TEXT_NODE 
          ? range.startContainer.parentElement 
          : range.startContainer;
        const endElement = range.endContainer.nodeType === Node.TEXT_NODE 
          ? range.endContainer.parentElement 
          : range.endContainer;
        
        // If start and end are different elements, or if we've deleted content
        // that spans multiple elements, do a full sync
        if (startElement !== endElement || editor.childNodes.length !== text.length) {
          console.log('Multi-element change detected');
          return true;
        }
        return false;
      };

      // If this is a multi-element change, do a full sync
      if (isMultiElementChange()) {
        console.log('Handling multi-element change with full sync');
        const dirtyContent = editor.innerHTML;
        const cleanContent = wrapInParagraphs(dirtyContent);
        
        isUpdating = true;
        doc.transact(() => {
          // Clear existing content
          text.delete(0, text.length);
          
          // Parse the HTML and create XML elements
          const div = document.createElement('div');
          div.innerHTML = cleanContent;
          
          const addNode = (parent, node, state = { index: 0 }) => {
            if (node.nodeType === Node.TEXT_NODE) {
              if (node.textContent.trim()) {
                parent.insert(state.index, [node.textContent]);
                state.index++;
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const tag = node.tagName.toLowerCase();
              // Map b to strong and i to em for consistency
              const mappedTag = {
                'b': 'strong',
                'i': 'em'
              }[tag] || tag;
              
              if (['p', 'ul', 'li', 'strong', 'em'].includes(mappedTag)) {
                const element = new Y.XmlElement(mappedTag);
                const elementState = { index: 0 };
                Array.from(node.childNodes).forEach(child => addNode(element, child, elementState));
                parent.insert(state.index, [element]);
                state.index++;
              }
            }
          };
          
          const documentState = { index: 0 };
          Array.from(div.childNodes).forEach(node => addNode(text, node, documentState));
        });
        isUpdating = false;
        return;
      }

      // Rest of the existing single-element change handling code...
      const startContainer = range.startContainer;
      
      // Find the nearest parent element that we track in Y.js (p, ul, li)
      const findNearestTrackedElement = (node) => {
        while (node && node !== editor) {
          const tagName = node.tagName?.toLowerCase();
          // For list items, we want to track the ul parent instead
          if (tagName === 'li') {
            const ul = node.closest('ul');
            if (ul) return ul;
          }
          if (['p', 'ul'].includes(tagName)) {
            return node;
          }
          node = node.parentElement;
        }
        return null;
      };

      // Get the nearest tracked element
      const trackedElement = findNearestTrackedElement(
        startContainer.nodeType === Node.TEXT_NODE ? startContainer.parentElement : startContainer
      );
      
      console.log('Found tracked element:', trackedElement?.tagName, trackedElement);
      
      if (trackedElement) {
        // Find the Y.js node that corresponds to the changed DOM node
        const findYjsNode = (domNode, yjsParent) => {
          if (!yjsParent || !domNode) return null;
          
          // Get the full path to this node from the editor root
          const getNodePath = (node) => {
            const path = [];
            let current = node;
            while (current && current !== editor) {
              const parent = current.parentElement;
              if (!parent) break;
              
              // Count same-type siblings before this node
              let index = 0;
              let sibling = current.previousElementSibling;
              while (sibling) {
                if (sibling.tagName === current.tagName) {
                  index++;
                }
                sibling = sibling.previousElementSibling;
              }
              
              path.unshift({
                tag: current.tagName.toLowerCase(),
                index,
                content: current.textContent // Include content as part of matching
              });
              current = parent;
            }
            return path;
          };
          
          // Get path for the DOM node we're looking for
          const targetPath = getNodePath(domNode);
          console.log('Target path:', targetPath);
          
          // Helper to check if a Y.js node matches our target at a specific path level
          const nodeMatchesPathLevel = (node, pathLevel) => {
            if (!(node instanceof Y.XmlElement)) return false;
            if (node.nodeName !== pathLevel.tag) return false;
            
            // For leaf nodes, also check content similarity
            if (node.length === 0 || !node.get(0)) {
              return true; // Empty nodes match
            }
            
            // Get text content of Y.js node
            let nodeContent = '';
            let hasElementChildren = false;
            node.forEach(child => {
              if (typeof child === 'string') {
                nodeContent += child;
              } else if (child instanceof Y.XmlText) {
                nodeContent += child.toString();
              } else if (child instanceof Y.XmlElement) {
                hasElementChildren = true;
              }
            });
            
            // Compare content similarity if this is a leaf node (no element children)
            if (!hasElementChildren) {
              // Use string similarity for fuzzy matching
              const similar = (a, b) => {
                const normalize = str => str.trim().toLowerCase().replace(/\s+/g, ' ');
                return normalize(a) === normalize(b);
              };
              return similar(nodeContent, pathLevel.content);
            }
            
            return true;
          };
          
          // Recursively find matching node
          const findMatchingNode = (parent, pathIndex = 0) => {
            if (pathIndex >= targetPath.length) return null;
            
            const currentPathLevel = targetPath[pathIndex];
            let matchCount = 0;
            let result = null;
            
            parent.forEach(node => {
              if (result) return; // Stop if we found a match
              
              if (nodeMatchesPathLevel(node, currentPathLevel)) {
                if (matchCount === currentPathLevel.index) {
                  if (pathIndex === targetPath.length - 1) {
                    // Found the final node
                    result = node;
                  } else if (node instanceof Y.XmlElement) {
                    // Recurse into this node
                    result = findMatchingNode(node, pathIndex + 1);
                  }
                }
                matchCount++;
              }
            });
            
            return result;
          };
          
          const result = findMatchingNode(yjsParent);
          console.log('Found matching node:', result?.nodeName, result);
          return result;
        };

        const yjsNode = findYjsNode(trackedElement, text);
        console.log('Found Y.js node:', yjsNode?.nodeName, yjsNode);
        
        if (yjsNode) {
          isUpdating = true;
          doc.transact(() => {
            // Update the content of the Y.js node to match the DOM
            const newContent = DOMPurify.sanitize(trackedElement.innerHTML, purifyConfig);
            console.log('Updating node content:', newContent);
            
            // Clear existing content of this node
            if (yjsNode.length > 0) {
              yjsNode.delete(0, yjsNode.length);
            }
            
            // For lists, we need to create proper li elements
            if (trackedElement.tagName.toLowerCase() === 'ul') {
              Array.from(trackedElement.children).forEach((li, index) => {
                if (li.tagName.toLowerCase() === 'li') {
                  const liElement = new Y.XmlElement('li');
                  liElement.insert(0, [li.innerHTML]);
                  yjsNode.insert(index, [liElement]);
                }
              });
            } else {
              // For other elements, just insert the content
              if (newContent.trim()) {
                yjsNode.insert(0, [newContent]);
              }
            }
          });
          isUpdating = false;
          return;
        }
      }
      
      console.log('Falling back to full sync');
      // If we couldn't find a matching node or if the change was at the root level,
      // fall back to full sync
      const dirtyContent = editor.innerHTML;
      const cleanContent = wrapInParagraphs(dirtyContent);
      
      isUpdating = true;
      doc.transact(() => {
        // Clear existing content
        text.delete(0, text.length);
        
        // Parse the HTML and create XML elements
        const div = document.createElement('div');
        div.innerHTML = cleanContent;
        
        const addNode = (parent, node, state = { index: 0 }) => {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.trim()) {
              parent.insert(state.index, [node.textContent]);
              state.index++;
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            // Map b to strong and i to em for consistency
            const mappedTag = {
              'b': 'strong',
              'i': 'em'
            }[tag] || tag;
            
            if (['p', 'ul', 'li', 'strong', 'em'].includes(mappedTag)) {
              const element = new Y.XmlElement(mappedTag);
              const elementState = { index: 0 };
              
              // For lists, maintain the structure exactly as in DOM
              if (mappedTag === 'ul') {
                // Process all li elements in order
                Array.from(node.children).forEach(li => {
                  if (li.tagName.toLowerCase() === 'li') {
                    const liElement = new Y.XmlElement('li');
                    liElement.insert(0, [li.innerHTML]);
                    element.insert(elementState.index, [liElement]);
                    elementState.index++;
                  }
                });
              } else {
                Array.from(node.childNodes).forEach(child => addNode(element, child, elementState));
              }
              
              parent.insert(state.index, [element]);
              state.index++;
            }
          }
        };
        
        const documentState = { index: 0 };
        Array.from(div.childNodes).forEach(node => addNode(text, node, documentState));
      });
      isUpdating = false;
    } catch (error) {
      console.error('Error handling input:', error);
      isUpdating = false;
    }
  });

  // Clean up on page unload
  window.addEventListener('unload', () => {
    websocketProvider.destroy();
    indexeddbProvider.destroy();
  });
}); 