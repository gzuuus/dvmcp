import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
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
} from '@dvmcp/commons/core';
import type { Event } from 'nostr-tools/pure';
import { loggerBridge } from '@dvmcp/commons/core';
import {
  type Implementation,
  LATEST_PROTOCOL_VERSION,
  type InitializeResult,
  type ListToolsResult,
  type ListResourcesResult,
  type ListPromptsResult,
  type ListResourceTemplatesResult,
} from '@modelcontextprotocol/sdk/types.js';
import { slugify } from '@dvmcp/commons/core';

function getNip89Tags(cfg: DvmcpBridgeConfig['mcp']): string[][] {
  const keys = ['name', 'about', 'picture', 'website', 'banner'] as const;
  return keys
    .filter((k) => cfg[k])
    .map((k) => [k, String(cfg[k as keyof typeof cfg])]);
}

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

  async announceToolsList(tools?: ListToolsResult) {
    const toolsResult = tools || (await this.mcpPool.listTools());
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/tools/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    if (toolsResult.tools && toolsResult.tools.length > 0) {
      for (const tool of toolsResult.tools) {
        const pricing = this.mcpPool.getToolPricing(tool.name);
        if (pricing?.price) {
          tags.push(['cap', tool.name, pricing.price, pricing.unit || 'sats']);
        }
      }
    }

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(TOOLS_LIST_KIND),
      content: JSON.stringify(toolsResult),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Tools list announced');
  }

  async announceResourcesList(resources?: ListResourcesResult) {
    const resourcesResult = resources || (await this.mcpPool.listResources());
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/resources/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    if (resourcesResult.resources && resourcesResult.resources.length > 0) {
      for (const resource of resourcesResult.resources) {
        if (resource.uri) {
          const pricing = this.mcpPool.getResourcePricing(resource.uri);
          if (pricing?.price) {
            tags.push([
              'cap',
              resource.uri,
              pricing.price,
              pricing.unit || 'sats',
            ]);
          }
        }
      }
    }

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(RESOURCES_LIST_KIND),
      content: JSON.stringify(resourcesResult),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Resources list announced');
  }

  async announceResourceTemplatesList(
    resourceTemplates?: ListResourceTemplatesResult
  ) {
    const resourceTemplatesResult =
      resourceTemplates || (await this.mcpPool.listResourceTemplates());
    if (
      !resourceTemplatesResult.resourceTemplates ||
      resourceTemplatesResult.resourceTemplates.length === 0
    ) {
      loggerBridge('No resource templates to announce');
      return;
    }

    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/resources/templates/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    // Add capability tags for each resource template name
    for (const template of resourceTemplatesResult.resourceTemplates) {
      if (template.name) {
        tags.push(['cap', template.name]);
      }
    }

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(RESOURCES_LIST_KIND),
      content: JSON.stringify(resourceTemplatesResult),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge(
      `Resource templates list announced with ${resourceTemplatesResult.resourceTemplates.length} templates`
    );
  }

  async announcePromptsList(prompts?: ListPromptsResult) {
    const promptsResult = prompts || (await this.mcpPool.listPrompts());
    const tags: string[][] = [
      [TAG_UNIQUE_IDENTIFIER, `${this.serverId}/prompts/list`],
      [TAG_SERVER_IDENTIFIER, this.serverId],
    ];

    if (promptsResult.prompts && promptsResult.prompts.length > 0) {
      for (const prompt of promptsResult.prompts) {
        if (prompt.name) {
          const pricing = this.mcpPool.getPromptPricing(prompt.name);
          if (pricing?.price) {
            tags.push([
              'cap',
              prompt.name,
              pricing.price,
              pricing.unit || 'sats',
            ]);
          }
        }
      }
    }

    const event = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(PROMPTS_LIST_KIND),
      content: JSON.stringify(promptsResult),
      tags,
    });

    await this.relayHandler.publishEvent(event);
    loggerBridge('Prompts list announced');
  }

  async updateAnnouncement() {
    const serverInfo = await this.announceServer();
    if (!serverInfo) return;

    const mainClient = this.mcpPool.getDefaultClient();
    const capabilities = mainClient?.getServerCapabilities() || {};
    const announcePromises: Promise<void>[] = [];

    const { tools, resources, prompts, resourceTemplates } =
      await this.fetchCapabilityData(capabilities);

    if (capabilities.tools && tools && tools.tools.length > 0) {
      announcePromises.push(this.announceToolsList(tools));
    }

    if (capabilities.resources && resources && resources.resources.length > 0) {
      announcePromises.push(this.announceResourcesList(resources));
      if (resourceTemplates && resourceTemplates.resourceTemplates.length > 0)
        announcePromises.push(
          this.announceResourceTemplatesList(resourceTemplates)
        );
    }

    if (capabilities.prompts && prompts && prompts.prompts.length > 0) {
      announcePromises.push(this.announcePromptsList(prompts));
    }

    announcePromises.push(this.announceRelayList());

    await Promise.all(announcePromises);
  }

  private async fetchCapabilityData(capabilities: Record<string, any>) {
    const result: {
      tools?: ListToolsResult;
      resources?: ListResourcesResult;
      prompts?: ListPromptsResult;
      resourceTemplates?: ListResourceTemplatesResult;
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
          result.resourceTemplates = await this.mcpPool.listResourceTemplates();
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
        '#d': [this.serverId],
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
