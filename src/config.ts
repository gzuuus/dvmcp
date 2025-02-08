import { config } from 'dotenv';
config();

export const CONFIG = {
  nostr: {
    privateKey: process.env.PRIVATE_KEY!,
    relayUrls: process.env.RELAY_URLS!.split(',').map((url) => url.trim()),
  },
  mcp: {
    // Service info
    name: process.env.MCP_SERVICE_NAME || 'DVM MCP Bridge',
    about:
      process.env.MCP_SERVICE_ABOUT ||
      'MCP-enabled DVM providing AI and computational tools',
    // Client connection info
    clientName: process.env.MCP_CLIENT_NAME!,
    clientVersion: process.env.MCP_CLIENT_VERSION!,
    serverCommand: process.env.MCP_SERVER_COMMAND!,
    serverArgs: process.env.MCP_SERVER_ARGS!.split(','),
  },
};
