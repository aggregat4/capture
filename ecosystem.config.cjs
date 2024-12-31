module.exports = {
  apps: [{
    name: 'capture',
    script: 'server/server.js',
    env: {
      NODE_ENV: 'production',
      PORT: '3000',  // Change this to your desired port
      HOST: '0.0.0.0'  // This allows external connections
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
} 