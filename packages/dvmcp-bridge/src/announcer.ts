import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { CONFIG } from './config';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import type { MCPPool } from './mcp-pool';
import { relayHandler } from './relay';
import {
  DVM_ANNOUNCEMENT_KIND,
  TOOL_REQUEST_KIND,
} from '@dvmcp/commons/constants';

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
      ...keyManager.createEventTemplate(DVM_ANNOUNCEMENT_KIND),
      content: JSON.stringify({
        name: CONFIG.mcp.name,
        about: CONFIG.mcp.about,
        picture: CONFIG.mcp.picture,
        website: CONFIG.mcp.website,
        banner: CONFIG.mcp.banner,
        tools: tools,
      }),
      tags: [
        ['d', 'dvm-announcement'],
        ['k', `${TOOL_REQUEST_KIND}`],
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
