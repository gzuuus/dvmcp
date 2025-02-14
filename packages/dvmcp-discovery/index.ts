import { DiscoveryServer } from './discovery-server';
import { CONFIG } from './config';

async function main() {
  try {
    const server = new DiscoveryServer(CONFIG);

    await server.start();

    console.log(`DVMCP Discovery Server (${CONFIG.mcp.version}) started`);
    console.log(`Connected to ${CONFIG.nostr.relayUrls.length} relays`);

    // Handle shutdown
    const cleanup = () => {
      server.cleanup();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
