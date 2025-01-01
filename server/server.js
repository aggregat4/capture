#!/usr/bin/env node

import 'source-map-support/register.js';

// Load environment variables in development mode
if (process.env.NODE_ENV !== 'production') {
  const { config } = await import('dotenv');
  config();
}

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';
import * as mutex from 'lib0/mutex';
import * as math from 'lib0/math';
import { parseInt } from 'lib0/number';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { LeveldbPersistence } from 'y-leveldb';
import { mkdirSync, existsSync } from 'fs';

// Get the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));

// WebSocket connection states
const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;
const wsReadyStateClosing = 2;
const wsReadyStateClosed = 3;

// Server configuration
const host = process.env.HOST || 'localhost';
const port = parseInt(process.env.PORT || '1234');
const pingTimeout = 30000;
const editorPassword = process.env.EDITOR_PASSWORD;

// Validate required configuration
if (!editorPassword) {
  console.error('❌ EDITOR_PASSWORD environment variable is required');
  process.exit(1);
}

// Debug logging
const debug = {
  connection: (...args) => console.log('🔌 [Connection]:', ...args),
  document: (...args) => console.log('📄 [Document]:', ...args),
  message: (...args) => console.log('📨 [Message]:', ...args),
  error: (...args) => console.error('❌ [Error]:', ...args)
};

// Storage configuration
const storageLocation = join(__dirname, 'storage');
// Ensure storage directory exists
if (!existsSync(storageLocation)) {
  mkdirSync(storageLocation, { recursive: true });
  debug.document('Created storage directory:', storageLocation);
}

// Y.js document handling
const docs = new Map();
const messageSync = 0;
const messageAwareness = 1;
const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0';

// Initialize LevelDB persistence
const ldb = new LeveldbPersistence(storageLocation);

// Handle process termination for cleanup
const cleanup = async () => {
  debug.document('Starting server cleanup...');
  try {
    // Wait for all documents to finish pending operations
    const promises = Array.from(docs.values()).map(async (doc) => {
      try {
        const update = Y.encodeStateAsUpdate(doc);
        await ldb.storeUpdate(doc.name, update);
      } catch (err) {
        debug.error('Error storing final document state', { name: doc.name, error: err });
      }
    });
    
    await Promise.all(promises);
    
    if (ldb) {
      await ldb.destroy();
      debug.document('Database destroyed successfully');
    }
    
    process.exit(0);
  } catch (err) {
    debug.error('Error during cleanup', err);
    process.exit(1);
  }
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

const updateHandler = (update, origin, doc) => {
  debug.document('Update received', { 
    docName: doc.name, 
    updateLength: update.length,
    updateContent: Array.from(update).map(byte => byte.toString(16)).join(' ')
  });
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  debug.document('Broadcasting update to clients', {
    messageLength: message.length,
    messageContent: Array.from(message).map(byte => byte.toString(16)).join(' ')
  });
  doc.conns.forEach((_, conn) => send(doc, conn, message));
};

class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: gcEnabled });
    this.name = name;
    this.mux = mutex.createMutex();
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    debug.document('Created new document', { name });

    // Load initial state from storage
    ldb.getYDoc(name).then(async (persistedYDoc) => {
      if (persistedYDoc) {
        try {
          Y.applyUpdate(this, Y.encodeStateAsUpdate(persistedYDoc));
          debug.document('Loaded document from storage', { name });
        } catch (err) {
          debug.error('Error loading document from storage', { name, error: err });
        }
      }
    }).catch(err => {
      debug.error('Error retrieving document from storage', { name, error: err });
    });

    // Store updates with error handling and debouncing
    let updateTimeout = null;
    const storeUpdate = async (update) => {
      try {
        await ldb.storeUpdate(name, update);
        debug.document('Stored update to disk', { name });
      } catch (err) {
        debug.error('Error storing update', { name, error: err });
      }
    };

    this.on('update', async (update) => {
      // Clear existing timeout if there is one
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      
      // Debounce updates to reduce disk writes
      updateTimeout = setTimeout(() => {
        storeUpdate(update);
        updateTimeout = null;
      }, 200); // Debounce for 200ms
    });

    const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
      debug.document('Awareness changed', { added, updated, removed });
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
        );
        const buff = encoding.toUint8Array(encoder);
        this.conns.forEach((_, c) => {
          send(this, c, buff);
        });
      }
    };
    this.awareness.on('update', awarenessChangeHandler);
    this.on('update', updateHandler);
  }
}

const messageListener = (conn, doc, message) => {
  try {
    // Check if the connection is authenticated
    if (!conn.isAuthenticated) {
      debug.message('Processing auth message:', message);
      
      if (message && message.type === 'auth') {
        if (editorPassword && message.password === editorPassword) {
          conn.isAuthenticated = true;
          debug.connection('Client authenticated successfully');
          // Send a success message back to the client
          conn.send(JSON.stringify({ type: 'auth', status: 'success' }));
          return;
        } else {
          debug.error('Authentication failed - invalid password', {
            hasPassword: !!editorPassword,
            receivedPassword: !!message.password
          });
          conn.send(JSON.stringify({ type: 'auth', status: 'error', message: 'Invalid password' }));
          closeConn(doc, conn);
          return;
        }
      } else {
        debug.error('Invalid auth message format - missing type or not an auth message', { 
          messageType: message?.type,
          hasMessage: !!message
        });
        closeConn(doc, conn);
        return;
      }
    }

    // Handle binary messages for sync/awareness
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    debug.message('Received message', { 
      type: messageType === messageSync ? 'sync' : 'awareness', 
      docName: doc.name,
      messageLength: message.length,
      messageContent: Array.from(message).map(byte => byte.toString(16)).join(' ')
    });
    
    switch (messageType) {
      case messageSync:
        debug.message('Processing sync message');
        encoding.writeVarUint(encoder, messageSync);
        
        // Get the sync step from the message
        const syncStep = syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        debug.message('Sync step:', { step: syncStep });
        
        if (syncStep === 1) {
          // If this is sync step 1, send the full document state
          const state = Y.encodeStateAsUpdate(doc);
          const encoder2 = encoding.createEncoder();
          encoding.writeVarUint(encoder2, messageSync);
          syncProtocol.writeUpdate(encoder2, state);
          const response = encoding.toUint8Array(encoder2);
          debug.message('Sending full document state', {
            responseLength: response.length,
            responseContent: Array.from(response).map(byte => byte.toString(16)).join(' '),
            docContent: doc.getText('editor').toString()
          });
          send(doc, conn, response);
        } else if (encoding.length(encoder) > 1) {
          // For other sync steps, send the normal response
          const response = encoding.toUint8Array(encoder);
          debug.message('Sending sync response', {
            responseLength: response.length,
            responseContent: Array.from(response).map(byte => byte.toString(16)).join(' '),
            docContent: doc.getText('editor').toString()
          });
          send(doc, conn, response);
        } else {
          debug.message('No sync response needed');
        }
        break;
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
    }
  } catch (err) {
    debug.error('Error processing message', err);
    doc.emit('error', [err]);
  }
};

const closeConn = (doc, conn) => {
  if (doc.conns.has(conn)) {
    debug.connection('Closing connection', { docName: doc.name, remainingConns: doc.conns.size - 1 });
    const controlledIds = Array.from(doc.awareness.getStates().keys()).filter(
      (client) => doc.awareness.getStates().get(client).clock === conn.clock
    );
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      controlledIds,
      null
    );
  }
  conn.close();
};

const send = (doc, conn, m) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn);
  } else {
    try {
      conn.send(m, (err) => {
        err != null && closeConn(doc, conn);
      });
    } catch (e) {
      debug.error('Error sending message', e);
      closeConn(doc, conn);
    }
  }
};

// Add debug logging for document state
const logDocumentState = (doc) => {
  const state = doc.getText('editor').toString();
  debug.document('Current document state:', {
    name: doc.name,
    length: state.length,
    content: state
  });
};

const setupWSConnection = (
  ws,
  req,
  { docName = req.url.replace(/^\/ws\//, '').split('?')[0], gc = true } = {}
) => {
  debug.connection('New connection', { docName, ip: req.socket.remoteAddress });
  ws.binaryType = 'arraybuffer';
  ws.isAuthenticated = false;
  
  const doc = map.setIfUndefined(docs, docName, () => {
    debug.document('Creating new document', { name: docName });
    const doc = new WSSharedDoc(docName);
    doc.gcEnabled = gc;
    return doc;
  });
  
  // Log the document state when a new client connects
  logDocumentState(doc);
  
  doc.conns.set(ws, new Set());
  debug.document('Connection added to document', { name: docName, totalConns: doc.conns.size });
  
  ws.on('message', (message, isBinary) => {
    debug.message('Received message', {
      type: isBinary ? 'binary': 'string',
      content: isBinary
        ? Array.from(new Uint8Array(message)).map(byte => byte.toString(16)).join(' ')
        : message.toString()
    });
    // Handle authentication first
    if (!ws.isAuthenticated) {
      try {
        const authMessage = JSON.parse(message.toString());
        if (!authMessage || authMessage.type !== 'auth') {
          debug.error('Invalid auth message - missing type or not an auth message');
          closeConn(doc, ws);
          return;
        }
        
        if (authMessage.password === editorPassword) {
          ws.isAuthenticated = true;
          debug.connection('Client authenticated successfully');
          ws.send(JSON.stringify({ type: 'auth', status: 'success' }));
          
          // Send initial sync messages only after successful authentication
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.writeSyncStep1(encoder, doc);
          const syncStep1Message = encoding.toUint8Array(encoder);
          debug.message('Sending initial sync step 1', {
            messageLength: syncStep1Message.length,
            messageContent: Array.from(syncStep1Message).map(byte => byte.toString(16)).join(' ')
          });
          send(doc, ws, syncStep1Message);
          
          const awarenessStates = doc.awareness.getStates();
          if (awarenessStates.size > 0) {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageAwareness);
            encoding.writeVarUint8Array(
              encoder,
              awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
            );
            send(doc, ws, encoding.toUint8Array(encoder));
          }
        } else {
          debug.error('Authentication failed - invalid password');
          ws.send(JSON.stringify({ type: 'auth', status: 'error', message: 'Invalid password' }));
          closeConn(doc, ws);
        }
      } catch (e) {
        debug.error('Invalid auth message format', {
          error: e.message,
          message: message.toString()
        });
        closeConn(doc, ws);
      }
      return;
    } else {
      // Handle binary messages only after authentication
      if (isBinary) {
        messageListener(ws, doc, new Uint8Array(message));
      } else {
        debug.error('Expected binary message after authentication');
        closeConn(doc, ws);
      }
    }
    
  });
  
  ws.on('close', () => {
    debug.connection('Connection closed', { docName });
    closeConn(doc, ws);
    clearInterval(pingInterval);
  });
  
  // Check if connection is still alive
  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(ws)) {
        closeConn(doc, ws);
      }
      clearInterval(pingInterval);
    } else if (doc.conns.has(ws)) {
      pongReceived = false;
      try {
        ws.ping();
      } catch (e) {
        debug.error('Error pinging connection', e);
        closeConn(doc, ws);
        clearInterval(pingInterval);
      }
    }
  }, math.floor(pingTimeout / 2));
  ws.on('pong', () => {
    pongReceived = true;
  });
};

// Create and start the server
const wss = new WebSocketServer({ noServer: true });
const server = createServer((request, response) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const basePath = isDev ? join(__dirname, '..', 'client') : join(__dirname, '..', 'dist');
  const indexPath = join(basePath, 'index.html');

  // Skip handling WebSocket paths in the HTTP handler completely
  if (request.url.startsWith('/ws/')) {
    response.end();
    return;
  }

  try {
    let filePath;
    if (request.url === '/') {
      filePath = indexPath;
    } else {
      filePath = join(basePath, request.url);
    }

    const content = readFileSync(filePath);
    const ext = filePath.split('.').pop();
    const contentType = {
      'html': 'text/html',
      'js': 'text/javascript',
      'css': 'text/css',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif'
    }[ext] || 'text/plain';

    response.writeHead(200, { 'Content-Type': contentType });
    response.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File not found, return 404 without logging
      response.writeHead(404);
      response.end('Not Found');
    } else {
      // Log other errors
      debug.error('Error serving file', err);
      response.writeHead(500);
      response.end('Internal Server Error');
    }
  }
});

wss.on('connection', setupWSConnection);

server.on('upgrade', (request, socket, head) => {
  // Only handle upgrade for WebSocket paths
  if (!request.url.startsWith('/ws/')) {
    debug.error('Rejected upgrade for non-websocket path:', request.url);
    socket.destroy();
    return;
  }

  debug.connection('Handling WebSocket upgrade request', {
    url: request.url,
    headers: request.headers,
    protocol: request.headers['sec-websocket-protocol']
  });

  wss.handleUpgrade(request, socket, head, ws => {
    debug.connection('WebSocket upgrade successful, emitting connection');
    wss.emit('connection', ws, request);
  });
});

// Add error event handler for the WebSocket server
wss.on('error', (error) => {
  debug.error('WebSocket server error:', error);
});

server.on('error', (error) => {
  debug.error('HTTP server error:', error);
});

server.listen(port, host, () => {
  console.log(`🚀 Server running at 'http://${host}:${port}'`);
}); 