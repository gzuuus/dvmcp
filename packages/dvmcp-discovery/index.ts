import { CONFIG } from './src/config';
import { DiscoveryServer } from './src/discovery-server';
import type { DVMAnnouncement } from './src/direct-discovery';

export interface DirectServerInfo {
  pubkey: string;
  announcement: DVMAnnouncement;
}

async function main(directServerInfo?: DirectServerInfo | null) {
  try {
    const server = new DiscoveryServer(CONFIG);

    if (directServerInfo) {
      // If we have direct server info, register tools from that server only
      console.log(
        `Using direct server with pubkey: ${directServerInfo.pubkey}`
      );
      await server.registerDirectServerTools(
        directServerInfo.pubkey,
        directServerInfo.announcement
      );
    } else {
      // Otherwise do normal discovery
      await server.start();
    }

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

export default main;
