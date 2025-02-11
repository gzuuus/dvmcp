import { CONFIG } from '../config';
import { RelayHandler } from './relay';
import { keyManager } from './keys';
import { MCPClientHandler } from '../mcp-client';
import relayHandler from './relay';

export class NostrAnnouncer {
  private relayHandler: RelayHandler;
  private mcpClient: MCPClientHandler;

  constructor(mcpClient: MCPClientHandler) {
    this.relayHandler = relayHandler;
    this.mcpClient = mcpClient;
  }

  async announceRelayList() {
    const event = keyManager.signEvent({
      ...keyManager.createEventTemplate(10002),
      content: '',
      tags: CONFIG.nostr.relayUrls.map((url) => ['r', url]),
    });

    await this.relayHandler.publishEvent(event);
    console.log('Announced relay list metadata');
  }

  async announceService() {
    const toolsResult = await this.mcpClient.listTools();
    const event = keyManager.signEvent({
      ...keyManager.createEventTemplate(31990),
      content: JSON.stringify({
        name: CONFIG.mcp.name,
        about: CONFIG.mcp.about,
        tools: toolsResult,
      }),
      tags: [
        ['d', 'dvm-announcement'],
        ['k', '5910'],
        ['capabilities', 'mcp-1.0'],
        ['t', 'mcp'],
        ...toolsResult.map((tool) => ['t', tool.name]),
      ],
    });
    await this.relayHandler.publishEvent(event);
    console.log(`Announced service with ${toolsResult.length} tools`);
  }

  async updateAnnouncement() {
    await Promise.all([this.announceService(), this.announceRelayList()]);
  }
}
