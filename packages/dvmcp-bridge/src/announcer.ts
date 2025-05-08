import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import type { MCPPool } from './mcp-pool';
import type { DvmcpBridgeConfig } from './config-schema.js';
import {
  SERVER_ANNOUNCEMENT_KIND,
  TOOLS_LIST_KIND,
  RESOURCES_LIST_KIND,
  PROMPTS_LIST_KIND,
  REQUEST_KIND,
  TAG_UNIQUE_IDENTIFIER,
  TAG_KIND,
  TAG_SERVER_IDENTIFIER,
} from '@dvmcp/commons/constants';
import type { Event } from 'nostr-tools/pure';
import { loggerBridge } from '@dvmcp/commons/logger';
import {
  type Implementation,
  LATEST_PROTOCOL_VERSION,
  type InitializeResult,
} from '@modelcontextprotocol/sdk/types.js';
import { slugify, getServerId } from './utils.js';

function getNip89Tags(cfg: DvmcpBridgeConfig['mcp']): string[][] {
  const keys = ['name', 'about', 'picture', 'website', 'banner'] as const;
  return keys
    .filter((k) => cfg[k])
    .map((k) => [k, String(cfg[k as keyof typeof cfg])]);
}

// Helper to generate NIP-89 tags from config

export class NostrAnnouncer {
  private relayHandler: RelayHandler;
  private mcpPool: MCPPool;
  private config: DvmcpBridgeConfig;
  public readonly keyManager: ReturnType<typeof createKeyManager>;
  private readonly serverId: string;

  constructor(
    mcpPool: MCPPool,
    config: DvmcpBridgeConfig,
    relayHandler: RelayHandler,
    serverId: string,
    keyManager: ReturnType<typeof createKeyManager>
  ) {
    this.relayHandler = relayHandler;
    this.mcpPool = mcpPool;
    this.config = config;
    this.serverId = serverId;
    this.keyManager = keyManager;
  }

  async announceRelayList() {
    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(10002),
      tags: this.config.nostr.relayUrls.map((url: string) => ['r', url]),
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Announced relay list metadata');
  }

  /**
   * Publishes the primary server announcement (Kind 31316)
   */
  async announceServer() {
    const mainClient = this.mcpPool.getDefaultClient();
    if (!mainClient) {
      loggerBridge('No MCP server client available for server announcement.');
      return;
    }

    const serverInfo: Implementation = {
      name: slugify(this.config.mcp.name),
      version: this.config.mcp.clientVersion || '1.0.0',
    };

    const announcementObject: InitializeResult = {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: mainClient.getServerCapabilities(),
      serverInfo: serverInfo,
      instructions: this.config.mcp.instructions,
    };

    const announcementContent = JSON.stringify(announcementObject);

    loggerBridge(`Using server ID: ${this.serverId}`);

    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, this.serverId],
      [TAG_KIND, `${REQUEST_KIND}`],
      ...getNip89Tags(this.config.mcp),
    ];
    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(SERVER_ANNOUNCEMENT_KIND),
      content: announcementContent,
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Announced server with Kind 31316 event');
    return { event, serverId: this.serverId, announcementObject };
  }

  /**
   * Publishes tools list (Kind 31317)
   */
  async announceToolsList() {
    const tools = await this.mcpPool.listTools();
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/tools/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(TOOLS_LIST_KIND),
      content: JSON.stringify(tools),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Announced tools list (Kind 31317)');
  }

  /**
   * Publishes resources list (Kind 31318)
   */
  async announceResourcesList() {
    const resources = await this.mcpPool.listResources();
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/resources/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(RESOURCES_LIST_KIND),
      content: JSON.stringify(resources),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Announced resources list (Kind 31318)');
  }

  /**
   * Publishes prompts list (Kind 31319)
   */
  async announcePromptsList() {
    const prompts = await this.mcpPool.listPrompts();
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/prompts/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(PROMPTS_LIST_KIND),
      content: JSON.stringify(prompts),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Announced prompts list (Kind 31319)');
  }

  /**
   * Updates all relevant announcements to relays (Kind 31316/31317/31318/31319 + relay list)
   */
  async updateAnnouncement() {
    const serverInfo = await this.announceServer();
    if (!serverInfo) return;

    const mainClient = this.mcpPool.getDefaultClient();
    const capabilities = mainClient?.getServerCapabilities() || {};

    const announcePromises: Promise<void>[] = [];

    // Announce tools list only if capability present and there are tools
    if (capabilities.tools) {
      announcePromises.push(
        (async () => {
          const tools = await this.mcpPool.listTools();
          if (tools.length > 0) {
            await this.announceToolsList();
          }
        })()
      );
    }

    // Announce resources list only if capability present and there are resources
    if (capabilities.resources) {
      announcePromises.push(
        (async () => {
          const resources = await this.mcpPool.listResources();
          if (resources.length > 0) {
            await this.announceResourcesList();
          }
        })()
      );
    }

    // Announce prompts list only if capability present and there are prompts
    if (capabilities.prompts) {
      announcePromises.push(
        (async () => {
          const prompts = await this.mcpPool.listPrompts();
          if (prompts.length > 0) {
            await this.announcePromptsList();
          }
        })()
      );
    }

    // Always announce relay list
    announcePromises.push(this.announceRelayList());

    await Promise.all(announcePromises);
  }

  /**
   * Deletes all announcement events (Kind 31316/31317/31318/31319) by serverId with NIP-09
   * @param reason Optional reason for deletion
   * @returns Deletion event(s) published
   */
  async deleteAnnouncement(
    reason: string = 'Service offline'
  ): Promise<Event[]> {
    const mainClient = this.mcpPool.getDefaultClient();
    if (!mainClient) {
      loggerBridge('No MCP server client available for deletion.');
      return [];
    }

    const kinds = [
      SERVER_ANNOUNCEMENT_KIND,
      TOOLS_LIST_KIND,
      RESOURCES_LIST_KIND,
      PROMPTS_LIST_KIND,
    ];
    const allDeletionEvents: Event[] = [];

    for (const kind of kinds) {
      const filter = {
        kinds: [kind],
        authors: [this.keyManager.getPublicKey()],
        '#d': [this.serverId], // Unique identifier tag
        '#s': [this.serverId],
      };
      const events = await this.relayHandler.queryEvents(filter);

      if (!events.length) continue;

      const deletionEvent = this.keyManager.signEvent({
        ...this.keyManager.createEventTemplate(5),
        content: reason,
        tags: [
          ...events.map((ev) => ['e', ev.id]),
          [TAG_UNIQUE_IDENTIFIER, this.serverId],
        ],
      });

      await this.relayHandler.publishEvent(deletionEvent);
      loggerBridge(`Published deletion event for kind ${kind} (serverId tag)`);
      allDeletionEvents.push(deletionEvent);
    }

    return allDeletionEvents;
  }
}
