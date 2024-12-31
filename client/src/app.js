import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

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
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

// Create a WebSocket connection to our server
const wsProvider = (doc) => {
  console.log('Creating new WebSocket connection...');
  const config = loadConfig();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/${config.documentName}`;
  const ws = new WebSocket(wsUrl);
  if (config.password) {
    ws.onopen = () => {
      const authMessage = {
        type: 'auth',
        password: config.password
      };
      ws.send(JSON.stringify(authMessage));
    };
  }
  
  ws.binaryType = 'arraybuffer';
  
  const sendMessage = (message) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  };
  
  ws.onopen = () => {
    console.log('WebSocket connection opened successfully');
    // Send sync step 1 when connection opens
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    sendMessage(encoding.toUint8Array(encoder));
  };
  
  ws.onmessage = (event) => {
    console.log('Received WebSocket message');
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
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = (event) => {
    console.log('WebSocket connection closed', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    });
  };

  return {
    ws,
    destroy: () => {
      console.log('Destroying WebSocket connection');
      ws.close();
    },
    on: (event, callback) => {
      if (event === 'status') {
        ws.onopen = () => {
          console.log('Status: Connected');
          callback({ status: 'connected' });
        };
        ws.onclose = (event) => {
          console.log('Status: Disconnected', {
            code: event.code,
            reason: event.reason
          });
          callback({ status: 'disconnected' });
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

  // Initialize awareness
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);

  // Set up WebSocket provider
  const provider = wsProvider(doc);
  
  // Handle document updates
  doc.on('update', (update, origin) => {
    console.log('Document update:', {
      updateLength: update.length,
      updateContent: Array.from(update).map(byte => byte.toString(16)).join(' '),
      origin
    });
    // We want to send all local updates to the server
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    console.log('Sending update to server:', {
      messageLength: message.length,
      messageContent: Array.from(message).map(byte => byte.toString(16)).join(' ')
    });
    provider.ws.send(message);
  });

  provider.on('status', ({ status }) => {
    console.log('Connection status:', status);
    isConnected = status === 'connected';
    editor.contentEditable = String(isConnected);
    
    statusBar.textContent = isConnected ? 
      'Connected - Editor enabled' : 
      'Disconnected - Editor disabled';
    statusBar.className = isConnected ? 'connected' : '';
  });

  // Observe changes to the shared text
  text.observe(event => {
    if (isUpdating) return;
    if (!isConnected) return;
    
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
    if (!isConnected) return;
    
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
    provider.destroy();
  });
}); 