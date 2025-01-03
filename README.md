# Capture - Real-time Collaborative Text Editor

A secure, real-time collaborative text editor with offline capabilities.

## Features

- 🔄 Real-time collaboration with multiple users
- 🔒 Password-protected documents
- 💾 Offline support with automatic synchronization
- 📝 Simple and intuitive text editing interface
- 🌐 WebSocket-based communication
- 🔄 Automatic conflict resolution
- 📱 Responsive design

## Architecture

### Overview

The application follows a client-server architecture using WebSocket for real-time communication:

- **Frontend**: Browser-based text editor built with vanilla JavaScript
- **Backend**: Node.js WebSocket server
- **Real-time Sync**: Uses [Yjs](https://github.com/yjs/yjs) for Conflict-free Replicated Data Type (CRDT) operations
- **Persistence**: 
  - Client: IndexedDB for offline capability
  - Server: File-based persistence

### Key Components

- `client/src/app.js`: Main client application logic
  - WebSocket connection management
  - Document synchronization
  - User awareness
  - Offline capabilities
  
- `server/server.js`: WebSocket server
  - Authentication handling
  - Document synchronization
  - Client message broadcasting

### Data Flow

1. Client connects to server via WebSocket
2. Authentication performed using document password
3. Upon successful auth, document syncing begins
4. Changes are:
   - Immediately applied locally
   - Stored in IndexedDB
   - Broadcast to all connected clients
   - Persisted on the server

## Building and Running

### Prerequisites

- Node.js (v14 or higher)
- pnpm package manager

### Installation

1. Clone the repository:
   ```bash
   git clone [repository-url]
   cd capture
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Create environment configuration:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your desired configuration.

### Development

1. Start the development server:
   ```bash
   pnpm dev
   ```

2. Open your browser and navigate to `http://localhost:3000`

### Production Deployment with PM2

1. Build the client:
   ```bash
   pnpm build
   ```

2. Install PM2 globally if you haven't already:
   ```bash
   npm install -g pm2
   ```

3. Start the service using PM2:
   ```bash
   pm2 start ecosystem.config.cjs
   ```

4. Useful PM2 commands:
   ```bash
   pm2 status        # Check status of services
   pm2 logs          # View logs
   pm2 monit         # Monitor CPU/Memory
   pm2 restart all   # Restart all services
   ```

5. To ensure PM2 starts on system reboot:
   ```bash
   pm2 startup
   pm2 save
   ```

## License

See [LICENSE](LICENSE) file for details. 