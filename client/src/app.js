import * as Y from 'yjs'

// Create a WebSocket connection to our server
const wsProvider = (doc) => {
  console.log('Creating new WebSocket connection...');
  const ws = new WebSocket(`ws://${window.location.host}/default-doc`);
  
  ws.binaryType = 'arraybuffer';
  
  ws.onopen = () => {
    console.log('WebSocket connection opened successfully');
  };
  
  ws.onmessage = (event) => {
    console.log('Received WebSocket message');
    doc.transact(() => {
      Y.applyUpdate(doc, new Uint8Array(event.data));
    });
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
  const statusBar = document.getElementById('status');
  const doc = new Y.Doc();
  const text = doc.getText('editor');
  let isConnected = false;
  let isUpdating = false;

  // Set up WebSocket provider
  const provider = wsProvider(doc);
  
  provider.on('status', ({ status }) => {
    console.log('Connection status:', status);
    isConnected = status === 'connected';
    editor.contentEditable = String(isConnected); // Convert boolean to string
    
    statusBar.textContent = isConnected ? 
      'Connected - Editor enabled' : 
      'Disconnected - Editor disabled';
    statusBar.className = isConnected ? 'connected' : '';
    
    if (!isConnected) {
      editor.textContent = 'Connecting to server...';
    }
  });

  // Observe changes to the shared text
  text.observe(event => {
    if (isUpdating) return;
    if (!isConnected) return;
    
    try {
      if (editor && event.target.toString() !== editor.innerHTML) {
        const selection = window.getSelection();
        const range = selection?.getRangeAt(0);
        const start = range?.startOffset || 0;
        const end = range?.endOffset || 0;

        editor.innerHTML = event.target.toString();

        // Restore cursor position
        if (selection && range && editor.firstChild) {
          range.setStart(editor.firstChild, start);
          range.setEnd(editor.firstChild, end);
          selection.removeAllRanges();
          selection.addRange(range);
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
      const content = editor.innerHTML;
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