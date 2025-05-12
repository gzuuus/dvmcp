import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import type { KeyManager } from '@dvmcp/commons/nostr/key-manager';
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
  type ListToolsResult,
  type ListResourcesResult,
  type ListPromptsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { slugify } from './utils.js';

function getNip89Tags(cfg: DvmcpBridgeConfig['mcp']): string[][] {
  const keys = ['name', 'about', 'picture', 'website', 'banner'] as const;
  return keys
    .filter((k) => cfg[k])
    .map((k) => [k, String(cfg[k as keyof typeof cfg])]);
}
/**
 * NostrAnnouncer handles publishing MCP server announcements to Nostr relays
 * It manages server, tools, resources, and prompts announcements
 */
export class NostrAnnouncer {
  private relayHandler: RelayHandler;
  private mcpPool: MCPPool;
  private config: DvmcpBridgeConfig;
  public readonly keyManager: KeyManager;
  private readonly serverId: string;

  constructor(
    mcpPool: MCPPool,
    config: DvmcpBridgeConfig,
    relayHandler: RelayHandler,
    serverId: string,
    keyManager: KeyManager
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
    loggerBridge('Server announced');
    return { event, serverId: this.serverId, announcementObject };
  }

  /**
   * Publishes tools list (Kind 31317)
   * @param tools Optional pre-fetched tools list result
   */
  async announceToolsList(tools?: ListToolsResult) {
    const toolsResult = tools || (await this.mcpPool.listTools());
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/tools/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(TOOLS_LIST_KIND),
      content: JSON.stringify(toolsResult),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Tools list announced');
  }

  /**
   * Publishes resources list (Kind 31318)
   * @param resources Optional pre-fetched resources list result
   */
  async announceResourcesList(resources?: ListResourcesResult) {
    const resourcesResult = resources || (await this.mcpPool.listResources());
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/resources/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(RESOURCES_LIST_KIND),
      content: JSON.stringify(resourcesResult),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Resources list announced');
  }

  /**
   * Publishes prompts list (Kind 31319)
   * @param prompts Optional pre-fetched prompts list result
   */
  async announcePromptsList(prompts?: ListPromptsResult) {
    const promptsResult = prompts || (await this.mcpPool.listPrompts());
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/prompts/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(PROMPTS_LIST_KIND),
      content: JSON.stringify(promptsResult),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Prompts list announced');
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

    // Fetch all capabilities data in parallel first to avoid duplicate calls
    const { tools, resources, prompts } =
      await this.fetchCapabilityData(capabilities);

    // Announce tools list only if capability present and there are tools
    if (capabilities.tools && tools && tools.tools.length > 0) {
      announcePromises.push(this.announceToolsList(tools));
    }

    // Announce resources list only if capability present and there are resources
    if (capabilities.resources && resources && resources.resources.length > 0) {
      announcePromises.push(this.announceResourcesList(resources));
    }

    // Announce prompts list only if capability present and there are prompts
    if (capabilities.prompts && prompts && prompts.prompts.length > 0) {
      announcePromises.push(this.announcePromptsList(prompts));
    }

    // Always announce relay list
    announcePromises.push(this.announceRelayList());

    await Promise.all(announcePromises);
  }

  /**
   * Fetches all capability data in parallel to avoid duplicate calls
   * @param capabilities The server capabilities object
   * @returns Object containing all fetched capability data
   */
  private async fetchCapabilityData(capabilities: Record<string, any>) {
    const result: {
      tools?: ListToolsResult;
      resources?: ListResourcesResult;
      prompts?: ListPromptsResult;
    } = {};

    const fetchPromises: Promise<void>[] = [];

    if (capabilities.tools) {
      fetchPromises.push(
        (async () => {
          result.tools = await this.mcpPool.listTools();
        })()
      );
    }

    if (capabilities.resources) {
      fetchPromises.push(
        (async () => {
          result.resources = await this.mcpPool.listResources();
        })()
      );
    }

    if (capabilities.prompts) {
      fetchPromises.push(
        (async () => {
          result.prompts = await this.mcpPool.listPrompts();
        })()
      );
    }

    await Promise.all(fetchPromises);
    return result;
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
