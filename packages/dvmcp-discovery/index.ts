import { loadDiscoveryConfig } from './src/config-loader';
import { DiscoveryServer } from './src/discovery-server';
import { loggerDiscovery as logger } from '@dvmcp/commons/core';
import type { DvmcpDiscoveryConfig } from './src/config-schema';
import type { InitializeResult } from '@modelcontextprotocol/sdk/types.js';

export interface DirectServerInfo {
  pubkey: string;
  announcement: InitializeResult | null;
  serverId?: string;
}

async function main(
  directServerInfo?: DirectServerInfo | null,
  preloadedConfig?: DvmcpDiscoveryConfig
) {
  try {
    const config = preloadedConfig || (await loadDiscoveryConfig());
    const server = new DiscoveryServer(config);

    if (directServerInfo) {
      logger(`Using direct server with pubkey: ${directServerInfo.pubkey}`);
      await server.registerDirectServerTools(
        directServerInfo.pubkey,
        directServerInfo.announcement!,
        directServerInfo.serverId!
      );
    } else {
      await server.start();
    }

    logger(`DVMCP Discovery Server (${config.mcp.version}) started`);
    logger(`Connected to ${config.nostr.relayUrls.length} relays`);

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
