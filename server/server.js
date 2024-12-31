#!/usr/bin/env node

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

// WebSocket connection states
const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;
const wsReadyStateClosing = 2;
const wsReadyStateClosed = 3;

// Server configuration
const host = process.env.HOST || 'localhost';
const port = parseInt(process.env.PORT || '1234');
const pingTimeout = 30000;

// Callback handler implementation
const createCallbackHandler = (callback, timeout) => {
  let timer = null;
  let reply = null;
  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = null;
    reply = null;
  };
  
  timer = setTimeout(cleanup, timeout);
  
  return {
    reply: (message) => {
      reply = message;
      cleanup();
    },
    getReply: () => reply
  };
};

// Y.js document handling
const docs = new Map();
const messageSync = 0;
const messageAwareness = 1;
const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0';

const updateHandler = (update, origin, doc) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, conn) => send(doc, conn, message));
};

class WSSharedDoc extends Y.Doc {
  constructor() {
    super({ gc: gcEnabled });
    this.mux = mutex.createMutex();
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
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
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
      }
    }
  } catch (err) {
    console.error(err);
    doc.emit('error', [err]);
  }
};

const closeConn = (doc, conn) => {
  if (doc.conns.has(conn)) {
    const controlledIds = Array.from(doc.awareness.getStates().keys()).filter(
      (client) =>
        doc.awareness.getStates().get(client).clock === conn.clock
    );
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      controlledIds,
      null
    );
    if (doc.conns.size === 0 && !doc.gcEnabled) {
      doc.destroy();
    }
  }
  conn.close();
};

const send = (doc, conn, m) => {
  if (
    conn.readyState !== wsReadyStateConnecting &&
    conn.readyState !== wsReadyStateOpen
  ) {
    closeConn(doc, conn);
  }
  try {
    conn.send(m, (err) => {
      err != null && closeConn(doc, conn);
    });
  } catch (e) {
    closeConn(doc, conn);
  }
};

const setupWSConnection = (
  ws,
  req,
  { docName = req.url.slice(1).split('?')[0], gc = true } = {}
) => {
  ws.binaryType = 'arraybuffer';
  // get doc, initialize if it does not exist yet
  const doc = map.setIfUndefined(docs, docName, () => {
    const doc = new WSSharedDoc();
    doc.gcEnabled = gc;
    return doc;
  });
  doc.conns.set(ws, new Set());
  // listen and reply to events
  ws.on('message', (message) => messageListener(ws, doc, new Uint8Array(message)));

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
        closeConn(doc, ws);
        clearInterval(pingInterval);
      }
    }
  }, math.floor(pingTimeout / 2));
  ws.on('close', () => {
    closeConn(doc, ws);
    clearInterval(pingInterval);
  });
  ws.on('pong', () => {
    pongReceived = true;
  });

  // send sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, ws, encoding.toUint8Array(encoder));
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
};

// Create and start the server
const wss = new WebSocketServer({ noServer: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('okay');
});

wss.on('connection', setupWSConnection);

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});

server.listen(port, host, () => {
  console.log(`running at '${host}' on port ${port}`);
}); 