import { CONFIG } from '../config';
import { RelayHandler } from './relay';
import { keyManager } from './keys';
import relayHandler from './relay';
import type { MCPPool } from '../mcp-pool';

export class NostrAnnouncer {
  private relayHandler: RelayHandler;
  private mcpPool: MCPPool;

  constructor(mcpPool: MCPPool) {
    this.relayHandler = relayHandler;
    this.mcpPool = mcpPool;
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
    const tools = await this.mcpPool.listTools();
    const event = keyManager.signEvent({
      ...keyManager.createEventTemplate(31990),
      content: JSON.stringify({
        name: CONFIG.mcp.name,
        about: CONFIG.mcp.about,
        tools: tools,
      }),
      tags: [
        ['d', 'dvm-announcement'],
        ['k', '5910'],
        ['capabilities', 'mcp-1.0'],
        ['t', 'mcp'],
        ...tools.map((tool) => ['t', tool.name]),
      ],
    });
    await this.relayHandler.publishEvent(event);
    console.log(`Announced service with ${tools.length} tools`);
  }

  async updateAnnouncement() {
    await Promise.all([this.announceService(), this.announceRelayList()]);
  }
}
