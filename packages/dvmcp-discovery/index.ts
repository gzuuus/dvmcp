import { loadDiscoveryConfig } from './src/config-loader';
import { DiscoveryServer } from './src/discovery-server';
import { UnifiedRegistration } from './src/unified-registration';
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

      // Use unified registration for direct servers
      const source = UnifiedRegistration.createDirectSource(
        directServerInfo.pubkey,
        directServerInfo.serverId!,
        false // Default to no encryption support for direct servers
      );

      // Prepare capabilities from the announcement
      const tools = Array.isArray(directServerInfo.announcement?.tools)
        ? directServerInfo.announcement.tools
        : Array.isArray(directServerInfo.announcement?.capabilities?.tools)
          ? directServerInfo.announcement.capabilities.tools
          : [];

      const resources = Array.isArray(directServerInfo.announcement?.resources)
        ? directServerInfo.announcement.resources
        : [];

      const resourceTemplates = Array.isArray(
        directServerInfo.announcement?.resourceTemplates
      )
        ? directServerInfo.announcement.resourceTemplates
        : [];

      const prompts = Array.isArray(directServerInfo.announcement?.prompts)
        ? directServerInfo.announcement.prompts
        : [];

      const capabilities = {
        serverInfo: directServerInfo.announcement!,
        tools: tools.length > 0 ? tools : undefined,
        resources: resources.length > 0 ? resources : undefined,
        resourceTemplates:
          resourceTemplates.length > 0 ? resourceTemplates : undefined,
        prompts: prompts.length > 0 ? prompts : undefined,
      };

      // Register capabilities using unified registration
      const stats = await server
        .getUnifiedRegistration()
        .registerServerCapabilities(source, capabilities);

      logger(
        `Direct server registration complete: ` +
          `${stats.toolsCount} tools, ` +
          `${stats.resourcesCount} resources, ` +
          `${stats.resourceTemplatesCount} resource templates, ` +
          `${stats.promptsCount} prompts`
      );

      // Start the MCP server
      await server.start();
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
