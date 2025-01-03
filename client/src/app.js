// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker registration successful');
      })
      .catch(err => {
        console.error('ServiceWorker registration failed:', err);
      });
  });
}

import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { IndexeddbPersistence } from 'y-indexeddb'

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
            console.log('Current document content:', doc.getText('editor').toString());
            if (encoding.length(encoder) > 1) {
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

// Initialize the editor when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('editor');
  const statusBar = document.querySelector('footer');
  const configSection = document.querySelector('.config-section');
  const configToggle = document.querySelector('.config-toggle');
  
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
  const text = doc.getText('editor');
  let isConnected = false;
  let isUpdating = false;

  // Initialize IndexedDB persistence
  const indexeddbProvider = new IndexeddbPersistence(config.documentName, doc);
  indexeddbProvider.on('synced', () => {
    console.log('Content from IndexedDB loaded into the editor');
    // Update the editor with the content from IndexedDB
    const content = text.toString();
    if (content && editor.textContent !== content) {
      editor.textContent = content;
    }
    // Enable editing when offline data is loaded
    editor.contentEditable = 'true';
    if (!websocketProvider.connectionStatus.isConnected) {
      statusBar.textContent = 'Offline';
      statusBar.className = 'warning';
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
      const newContent = event.target.toString();
      if (editor && editor.textContent !== newContent) {
        // Store current selection if it exists
        let cursorPosition = null;
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (range && editor.contains(range.startContainer)) {
            cursorPosition = {
              start: range.startOffset,
              end: range.endOffset
            };
          }
        }

        // Update content
        editor.textContent = newContent;

        // Restore cursor position if we had one
        if (cursorPosition && editor.firstChild) {
          const newRange = document.createRange();
          newRange.setStart(editor.firstChild, Math.min(cursorPosition.start, newContent.length));
          newRange.setEnd(editor.firstChild, Math.min(cursorPosition.end, newContent.length));
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    } catch (error) {
      console.error('Error in text observer:', error);
    }
  });

  // Handle content editable changes
  editor.addEventListener('input', () => {
    try {
      const content = editor.textContent;
      if (content !== text.toString()) {
        isUpdating = true;
        doc.transact(() => {
          text.delete(0, text.length);
          text.insert(0, content);
        });
        isUpdating = false;
      }
    } catch (error) {
      console.error('Error handling input:', error);
    }
  });

  // Clean up on page unload
  window.addEventListener('unload', () => {
    websocketProvider.destroy();
    indexeddbProvider.destroy();
  });
}); 