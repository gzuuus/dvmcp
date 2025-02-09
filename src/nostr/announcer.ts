import { CONFIG } from '../config';
import { RelayHandler } from './relay';
import { keyManager } from './keys';
import { MCPClientHandler } from '../mcp-client';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

export class NostrAnnouncer {
  private relayHandler: RelayHandler;
  private mcpClient: MCPClientHandler;

  constructor(mcpClient: MCPClientHandler) {
    this.relayHandler = new RelayHandler(CONFIG.nostr.relayUrls);
    this.mcpClient = mcpClient;
  }

  async announceService() {
    const toolsResult: ListToolsResult = await this.mcpClient.listTools();

    const toolsListing = toolsResult.tools
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
      }))
      .slice(0, 100); // Hard limit to 100 tools

    const event = keyManager.signEvent({
      ...keyManager.createEventTemplate(31990),
      content: JSON.stringify({
        name: CONFIG.mcp.name,
        about: CONFIG.mcp.about,
        tools: toolsListing,
      }),
      tags: [
        ['d', 'dvm-announcement'],
        ['k', '5910'],
        ['capabilities', 'mcp-1.0'],
        ['t', 'mcp'],
        ...toolsListing.map((tool) => ['t', tool.name]),
      ],
    });

    await this.relayHandler.publishEvent(event);
    console.log(`Announced service with ${toolsListing.length} tools`);
  }

  async updateAnnouncement() {
    await this.announceService();
  }
}
