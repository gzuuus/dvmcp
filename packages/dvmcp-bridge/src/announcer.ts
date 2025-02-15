import type { RelayHandler } from 'commons/nostr/relay-handler';
import { CONFIG } from './config';
import { createKeyManager } from 'commons/nostr/key-manager';
import type { MCPPool } from './mcp-pool';
import { relayHandler } from './relay';

export const keyManager = createKeyManager(CONFIG.nostr.privateKey);

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
