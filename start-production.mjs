#!/usr/bin/env node
/**
 * Production Startup Script
 *
 * Starts both Nitro server and WebSocket server in the same Node.js process.
 * This eliminates the need for start.sh and process management.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('[Production] Starting application...');

// 1. Import WebSocket server module
console.log('[Production] Loading WebSocket server...');
const { startWebSocketServer, seedSkillsStore } = await import(join(__dirname, 'ws-server.mjs'));

// 2. Seed Skills Store (sync built-in skills to data volume)
console.log('[Production] Seeding Skills Store...');
try {
  await seedSkillsStore();
  console.log('[Production] ✓ Skills Store seeded');
} catch (err) {
  console.error('[Production] ✗ Skills Store seed failed:', err.message);
  // Continue starting server even if seed fails
}

// 3. Start WebSocket server
const WS_PORT = Number.parseInt(process.env.WS_PORT || '3001', 10);
console.log(`[Production] Starting WebSocket server on port ${WS_PORT}...`);

const { httpServer: wsHttpServer, wss } = startWebSocketServer(WS_PORT);
console.log('[Production] ✓ WebSocket server started');

// 4. Start Nitro server
console.log('[Production] Loading Nitro server...');
const nitroPath = join(__dirname, '.output/server/index.mjs');

// Import and start Nitro
await import(nitroPath);
console.log('[Production] ✓ Nitro server started');

// 5. Graceful shutdown
const cleanup = () => {
  console.log('[Production] Shutting down...');

  // Close WebSocket server
  wss.clients.forEach((client) => {
    if (client.workerProcess) {
      client.workerProcess.kill('SIGTERM');
    }
    client.close();
  });

  wss.close(() => {
    console.log('[Production] WebSocket server closed');
  });

  wsHttpServer.close(() => {
    console.log('[Production] WebSocket HTTP server closed');
  });

  // Nitro will handle its own cleanup
  console.log('[Production] Cleanup complete');
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

console.log('[Production] Application started successfully');
