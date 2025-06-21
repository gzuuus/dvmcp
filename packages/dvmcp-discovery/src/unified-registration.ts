import { loggerDiscovery, createCapabilityId } from '@dvmcp/commons/core';
import type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  InitializeResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolRegistry } from './tool-registry';
import type { ResourceRegistry } from './resource-registry';
import type { PromptRegistry } from './prompt-registry';
import type { ServerRegistry } from './server-registry';
// TODO: improve types and simplify registration methods, at the end all is based on nostr events, so we can simplify this massively

/**
 * Source information for server registration
 */
export interface ServerRegistrationSource {
  /** Provider's public key */
  pubkey: string;
  /** Server identifier */
  serverId: string;
  /** Whether this server supports encryption */
  supportsEncryption: boolean;
  /** Source type for tracking */
  source: 'direct' | 'private' | 'event';
  /** Original event or data source */
  sourceData?: any;
}

/**
 * Capabilities to register for a server
 */
export interface ServerCapabilities {
  /** Server information from InitializeResult */
  serverInfo?: InitializeResult;
  /** Tools to register */
  tools?: Tool[];
  /** Resources to register */
  resources?: Resource[];
  /** Resource templates to register */
  resourceTemplates?: ResourceTemplate[];
  /** Prompts to register */
  prompts?: Prompt[];
}

/**
 * Registration statistics
 */
export interface RegistrationStats {
  /** Number of tools registered */
  toolsCount: number;
  /** Number of resources registered */
  resourcesCount: number;
  /** Number of resource templates registered */
  resourceTemplatesCount: number;
  /** Number of prompts registered */
  promptsCount: number;
  /** Whether server info was registered */
  serverRegistered: boolean;
}

/**
 * Unified registration interface that consolidates all server and capability registration logic
 */
export class UnifiedRegistration {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly resourceRegistry: ResourceRegistry,
    private readonly promptRegistry: PromptRegistry,
    private readonly serverRegistry: ServerRegistry
  ) {}

  /**
   * Register server capabilities in a unified way
   * @param source - Source information for the registration
   * @param capabilities - Capabilities to register
   * @returns Registration statistics
   */
  public async registerServerCapabilities(
    source: ServerRegistrationSource,
    capabilities: ServerCapabilities
  ): Promise<RegistrationStats> {
    const stats: RegistrationStats = {
      toolsCount: 0,
      resourcesCount: 0,
      resourceTemplatesCount: 0,
      promptsCount: 0,
      serverRegistered: false,
    };

    loggerDiscovery(
      `Starting unified registration for server ${source.serverId} from ${source.pubkey} (source: ${source.source}, encryption: ${source.supportsEncryption})`
    );

    // 1. Register server information first
    if (capabilities.serverInfo) {
      await this.registerServerInfo(source, capabilities.serverInfo);
      stats.serverRegistered = true;
    }

    // 2. Register tools
    if (capabilities.tools && capabilities.tools.length > 0) {
      stats.toolsCount = await this.registerTools(source, capabilities.tools);
    }

    // 3. Register resources
    if (capabilities.resources && capabilities.resources.length > 0) {
      stats.resourcesCount = await this.registerResources(
        source,
        capabilities.resources
      );
    }

    // 4. Register resource templates
    if (
      capabilities.resourceTemplates &&
      capabilities.resourceTemplates.length > 0
    ) {
      stats.resourceTemplatesCount = await this.registerResourceTemplates(
        source,
        capabilities.resourceTemplates
      );
    }

    // 5. Register prompts
    if (capabilities.prompts && capabilities.prompts.length > 0) {
      stats.promptsCount = await this.registerPrompts(
        source,
        capabilities.prompts
      );
    }

    loggerDiscovery(
      `Unified registration complete for server ${source.serverId}: ` +
        `${stats.toolsCount} tools, ${stats.resourcesCount} resources, ` +
        `${stats.resourceTemplatesCount} resource templates, ${stats.promptsCount} prompts`
    );

    return stats;
  }

  /**
   * Register server information
   */
  private async registerServerInfo(
    source: ServerRegistrationSource,
    serverInfo: InitializeResult
  ): Promise<void> {
    const content = JSON.stringify({
      protocolVersion: serverInfo.protocolVersion || '2025-03-26',
      capabilities: serverInfo.capabilities || {},
      serverInfo: serverInfo.serverInfo,
      instructions: serverInfo.instructions,
    });

    this.serverRegistry.registerServer(
      source.serverId,
      source.pubkey,
      content,
      source.supportsEncryption
    );

    loggerDiscovery(
      `Registered server info: ${serverInfo.serverInfo?.name || source.serverId} ` +
        `(${source.serverId}) with encryption support: ${source.supportsEncryption}`
    );
  }

  /**
   * Register tools
   */
  private async registerTools(
    source: ServerRegistrationSource,
    tools: Tool[]
  ): Promise<number> {
    let registeredCount = 0;

    for (const tool of tools) {
      try {
        // Use the existing tool registration method from ToolRegistry
        const toolId = createCapabilityId(tool.name, source.pubkey);

        // Check if tool is already registered to avoid duplicates
        if (this.toolRegistry.getTool(toolId)) {
          loggerDiscovery(
            `Tool ${tool.name} (${toolId}) already registered, skipping`
          );
          continue;
        }

        this.toolRegistry.registerTool(
          toolId,
          tool,
          source.pubkey,
          source.serverId
        );
        registeredCount++;
      } catch (error) {
        loggerDiscovery(`Error registering tool ${tool.name}: ${error}`);
      }
    }

    if (registeredCount > 0) {
      loggerDiscovery(
        `Registered ${registeredCount} tools from ${source.source} server ${source.serverId}`
      );
    }

    return registeredCount;
  }

  /**
   * Register resources
   */
  private async registerResources(
    source: ServerRegistrationSource,
    resources: Resource[]
  ): Promise<number> {
    try {
      this.resourceRegistry.registerServerResources(
        source.serverId,
        resources,
        source.pubkey
      );

      loggerDiscovery(
        `Registered ${resources.length} resources from ${source.source} server ${source.serverId}`
      );

      return resources.length;
    } catch (error) {
      loggerDiscovery(`Error registering resources: ${error}`);
      return 0;
    }
  }

  /**
   * Register resource templates
   */
  private async registerResourceTemplates(
    source: ServerRegistrationSource,
    resourceTemplates: ResourceTemplate[]
  ): Promise<number> {
    try {
      this.resourceRegistry.registerServerResourceTemplates(
        source.serverId,
        resourceTemplates,
        source.pubkey
      );

      loggerDiscovery(
        `Registered ${resourceTemplates.length} resource templates from ${source.source} server ${source.serverId}`
      );

      return resourceTemplates.length;
    } catch (error) {
      loggerDiscovery(`Error registering resource templates: ${error}`);
      return 0;
    }
  }

  /**
   * Register prompts
   */
  private async registerPrompts(
    source: ServerRegistrationSource,
    prompts: Prompt[]
  ): Promise<number> {
    try {
      this.promptRegistry.registerServerPrompts(
        source.serverId,
        prompts,
        source.pubkey
      );

      loggerDiscovery(
        `Registered ${prompts.length} prompts from ${source.source} server ${source.serverId}`
      );

      return prompts.length;
    } catch (error) {
      loggerDiscovery(`Error registering prompts: ${error}`);
      return 0;
    }
  }

  /**
   * Create a ServerRegistrationSource from direct server registration
   */
  public static createDirectSource(
    pubkey: string,
    serverId: string,
    supportsEncryption: boolean = false
  ): ServerRegistrationSource {
    return {
      pubkey,
      serverId,
      supportsEncryption,
      source: 'direct',
    };
  }

  /**
   * Create a ServerRegistrationSource from private server discovery
   */
  public static createPrivateSource(
    pubkey: string,
    serverId: string,
    supportsEncryption: boolean = true
  ): ServerRegistrationSource {
    return {
      pubkey,
      serverId,
      supportsEncryption,
      source: 'private',
    };
  }

  /**
   * Create a ServerRegistrationSource from event processing
   */
  public static createEventSource(
    pubkey: string,
    serverId: string,
    supportsEncryption: boolean,
    sourceEvent: any
  ): ServerRegistrationSource {
    return {
      pubkey,
      serverId,
      supportsEncryption,
      source: 'event',
      sourceData: sourceEvent,
    };
  }
}
