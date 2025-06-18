import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Event, type Filter } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr';
import { createKeyManager } from '@dvmcp/commons/nostr';
import { EncryptionManager } from '@dvmcp/commons/encryption';
import { CompletionExecutor } from './completion-executor';
import { PingExecutor } from './ping-executor';
import type { DvmcpDiscoveryConfig } from './config-schema';
import {
  SERVER_ANNOUNCEMENT_KIND,
  TOOLS_LIST_KIND,
  RESOURCES_LIST_KIND,
  PROMPTS_LIST_KIND,
  TAG_SERVER_IDENTIFIER,
  TAG_UNIQUE_IDENTIFIER,
  TAG_SUPPORT_ENCRYPTION,
} from '@dvmcp/commons/core';
import {
  type Tool,
  type Resource,
  type ResourceTemplate,
  type ListToolsResult,
  type ListPromptsResult,
  type Prompt,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  type CompleteRequest,
  type CompleteResult,
  type InitializeResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry';
import { ToolExecutor } from './tool-executor';
import { ResourceRegistry } from './resource-registry';
import { ResourceExecutor } from './resource-executor';
import { PromptRegistry } from './prompt-registry';
import { PromptExecutor } from './prompt-executor';
import { ServerRegistry } from './server-registry';
import { loggerDiscovery } from '@dvmcp/commons/core';
import { initBuiltInTools } from './built-in-tools';
import { createCapabilityId } from '@dvmcp/commons/core';

export class DiscoveryServer {
  private mcpServer: McpServer;
  private relayHandler: RelayHandler;
  private keyManager: ReturnType<typeof createKeyManager>;
  private encryptionManager: EncryptionManager | null = null;

  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;
  private resourceRegistry: ResourceRegistry;
  private resourceExecutor: ResourceExecutor;
  private promptRegistry: PromptRegistry;
  private promptExecutor: PromptExecutor;
  private serverRegistry: ServerRegistry;
  private completionExecutor: CompletionExecutor;
  private pingExecutor: PingExecutor;
  private config: DvmcpDiscoveryConfig;
  private integratedRelays: Set<string> = new Set();

  constructor(config: DvmcpDiscoveryConfig) {
    this.config = config;
    this.relayHandler = new RelayHandler(config.nostr.relayUrls);
    this.keyManager = createKeyManager(config.nostr.privateKey);

    // Initialize encryption manager if encryption is configured
    if (config.encryption) {
      this.encryptionManager = new EncryptionManager(config.encryption);
      loggerDiscovery(
        `Encryption manager initialized with mode: ${config.encryption.mode || 'optional'}`
      );
    }

    this.mcpServer = new McpServer({
      name: config.mcp.name,
      version: config.mcp.version,
    });

    this.serverRegistry = new ServerRegistry(this.mcpServer);

    this.toolRegistry = new ToolRegistry(this.mcpServer);
    this.toolExecutor = new ToolExecutor(
      this.relayHandler,
      this.keyManager,
      this.toolRegistry,
      this.serverRegistry,
      this.config,
      this.encryptionManager || undefined
    );

    this.resourceRegistry = new ResourceRegistry(this.mcpServer);
    this.resourceExecutor = new ResourceExecutor(
      this.relayHandler,
      this.keyManager,
      this.resourceRegistry,
      this.serverRegistry,
      this.config,
      this.encryptionManager || undefined
    );

    this.promptRegistry = new PromptRegistry(this.mcpServer);
    this.promptExecutor = new PromptExecutor(
      this.relayHandler,
      this.keyManager,
      this.promptRegistry,
      this.serverRegistry,
      this.config,
      this.encryptionManager || undefined
    );

    this.completionExecutor = new CompletionExecutor(
      this.relayHandler,
      this.keyManager,
      this.promptRegistry,
      this.resourceRegistry,
      this.serverRegistry,
      this.encryptionManager || undefined
    );

    this.pingExecutor = new PingExecutor(
      this.relayHandler,
      this.keyManager,
      this.serverRegistry,
      this.encryptionManager || undefined
    );

    this.toolRegistry.setExecutionCallback(async (toolId, args) => {
      return this.toolExecutor.executeTool(toolId, args);
    });

    this.resourceRegistry.setExecutionCallback(async (resourceId, params) => {
      return this.resourceExecutor.executeResource(resourceId, params);
    });

    this.promptRegistry.setExecutionCallback(async (promptId, args) => {
      return this.promptExecutor.executePrompt(promptId, args);
    });

    // Initialize built-in tools if interactive mode is enabled
    if (this.config.featureFlags?.interactive) {
      loggerDiscovery('Interactive mode enabled: Registering built-in tools.');
      initBuiltInTools(this.mcpServer, this.toolRegistry, this);
    }
  }

  private async startDiscovery() {
    loggerDiscovery('Starting discovery of MCP capabilities...');

    const filter: Filter = {
      kinds: [
        SERVER_ANNOUNCEMENT_KIND,
        TOOLS_LIST_KIND,
        RESOURCES_LIST_KIND,
        PROMPTS_LIST_KIND,
      ],
    };

    if (this.config.discovery?.limit) {
      const limitValue = parseInt(String(this.config.discovery.limit), 10);

      if (!isNaN(limitValue)) {
        filter.limit = limitValue;
        loggerDiscovery(`Limiting DVM discovery to ${limitValue}`);
      } else {
        loggerDiscovery(
          `Invalid discovery limit value: ${this.config.discovery.limit}, ignoring limit`
        );
      }
    }

    loggerDiscovery('Querying Nostr relays for capability announcements...');
    const events = await this.relayHandler.queryEvents(filter);
    loggerDiscovery(
      `Received ${events.length} announcement events from relays`
    );

    await this.processAnnouncementEvents(events);

    loggerDiscovery('Discovery process completed');
  }

  /**
   * Process announcement events by grouping them by kind and processing each group
   * This method ensures proper ordering: server announcements first, then capability lists
   * @param events - Array of events to process
   */
  private async processAnnouncementEvents(events: Event[]) {
    const serverAnnouncements = events.filter(
      (e) => e.kind === SERVER_ANNOUNCEMENT_KIND
    );
    const toolsLists = events.filter((e) => e.kind === TOOLS_LIST_KIND);
    const resourcesLists = events.filter((e) => e.kind === RESOURCES_LIST_KIND);
    const promptsLists = events.filter((e) => e.kind === PROMPTS_LIST_KIND);

    loggerDiscovery(
      `Processing events: ${serverAnnouncements.length} server announcements, ` +
        `${toolsLists.length} tools lists, ${resourcesLists.length} resources lists, ` +
        `${promptsLists.length} prompts lists`
    );

    if (serverAnnouncements.length > 0) {
      loggerDiscovery('Processing server announcements...');
      for (const event of serverAnnouncements) {
        await this.handleServerAnnouncement(event);
      }
    }

    if (toolsLists.length > 0) {
      loggerDiscovery('Processing tools lists...');
      for (const event of toolsLists) {
        await this.handleToolsList(event);
      }
    }

    if (resourcesLists.length > 0) {
      loggerDiscovery('Processing resources lists...');
      for (const event of resourcesLists) {
        await this.handleResourcesList(event);
      }
    }

    if (promptsLists.length > 0) {
      loggerDiscovery('Processing prompts lists...');
      for (const event of promptsLists) {
        await this.handlePromptsList(event);
      }
    }
  }

  private registerToolsFromAnnouncement(
    pubkey: string,
    tools: Tool[],
    serverId?: string
  ): void {
    for (const tool of tools) {
      const toolId = createCapabilityId(tool.name, pubkey);
      this.toolRegistry.registerTool(toolId, tool, pubkey, serverId);
    }
  }

  /**
   * Check if a tool is already registered
   * @param toolName - Tool name
   * @param pubkey - Provider public key
   * @returns Boolean indicating if the tool is already registered
   */
  public isToolRegistered(toolName: string, pubkey: string): boolean {
    const toolId = createCapabilityId(toolName, pubkey);
    return this.toolRegistry.getTool(toolId) !== undefined;
  }

  public registerToolFromAnnouncement(
    pubkey: string,
    tool: Tool,
    serverId: string
  ): string {
    const toolId = createCapabilityId(tool.name, pubkey);

    if (this.isToolRegistered(tool.name, pubkey)) {
      loggerDiscovery(
        `Tool ${tool.name} (${toolId}) is already registered, skipping registration`
      );
      return toolId;
    }

    this.toolRegistry.registerTool(toolId, tool, pubkey, serverId);
    loggerDiscovery(`Registered tool from announcement: ${toolId}`);

    return toolId;
  }

  /**
   * Add a relay to the relay handler and track it as an integrated relay
   * @param relayUrl - Relay URL to add
   * @returns true if the relay was added, false if it was already in the list
   */
  public addRelay(relayUrl: string): boolean {
    if (this.integratedRelays.has(relayUrl)) {
      loggerDiscovery(`Relay ${relayUrl} is already integrated`);
      return false;
    }

    this.integratedRelays.add(relayUrl);
    loggerDiscovery(`Added relay ${relayUrl} to integrated relays`);

    const allRelays = [...new Set([...this.config.nostr.relayUrls, relayUrl])];

    this.config.nostr.relayUrls = allRelays;

    const newRelayHandler = new RelayHandler(allRelays);

    this.relayHandler.cleanup();

    this.relayHandler = newRelayHandler;

    this.toolExecutor.updateRelayHandler(this.relayHandler);
    this.resourceExecutor.updateRelayHandler(this.relayHandler);
    this.promptExecutor.updateRelayHandler(this.relayHandler);
    this.pingExecutor.updateRelayHandler(this.relayHandler);

    loggerDiscovery(
      `Updated relay handler with new relay: ${relayUrl}. Total relays: ${allRelays.length}`
    );

    return true;
  }

  /**
   * Update the relay handler reference
   * This is needed when new relays are added to the pool
   * @param relayHandler - The updated relay handler
   */
  public updateRelayHandler(relayHandler: RelayHandler): void {
    this.relayHandler = relayHandler;

    this.toolExecutor.updateRelayHandler(relayHandler);
    this.resourceExecutor.updateRelayHandler(relayHandler);
    this.promptExecutor.updateRelayHandler(relayHandler);
    this.pingExecutor.updateRelayHandler(relayHandler);

    loggerDiscovery('Updated relay handler in discovery server');
  }

  /**
   * Get the relay handler instance
   * @returns The relay handler instance
   */
  public getRelayHandler(): RelayHandler {
    return this.relayHandler;
  }

  /**
   * Handle a server announcement event
   * @param event - Server announcement event
   */
  private async handleServerAnnouncement(event: Event) {
    try {
      if (!this.isAllowedDVM(event.pubkey)) {
        loggerDiscovery('DVM not in whitelist:', event.pubkey);
        return;
      }

      const serverId = event.tags.find(
        (t) => t[0] === TAG_UNIQUE_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Server announcement missing server ID');
        return;
      }
      // Extract support_encryption tag
      const supportsEncryptionTag = event.tags.find(
        (tag) => tag[0] === TAG_SUPPORT_ENCRYPTION
      );
      const supportsEncryption =
        supportsEncryptionTag && supportsEncryptionTag[1] === 'true'
          ? true
          : false;

      this.serverRegistry.registerServer(
        serverId,
        event.pubkey,
        event.content,
        supportsEncryption
      );
      loggerDiscovery(
        `Registered server: ${serverId} from ${event.pubkey}, encryption support: ${supportsEncryption}`
      );
    } catch (error) {
      console.error('Error processing server announcement:', error);
    }
  }

  /**
   * Handle a tools list event
   * @param event - Tools list event
   */
  private async handleToolsList(event: Event) {
    try {
      if (!this.isAllowedDVM(event.pubkey)) {
        loggerDiscovery('DVM not in whitelist:', event.pubkey);
        return;
      }

      const serverId = event.tags.find(
        (t) => t[0] === TAG_SERVER_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Tools list missing server ID');
        return;
      }

      let toolsList: Tool[] = [];
      try {
        const content: ListToolsResult = JSON.parse(event.content);
        toolsList = content.tools;
      } catch (error) {
        console.error('Error parsing tools list content:', error);
      }

      if (toolsList.length > 0) {
        this.registerToolsFromAnnouncement(event.pubkey, toolsList, serverId);
        loggerDiscovery(
          `Registered ${toolsList.length} tools from server ${serverId}`
        );
      } else {
        loggerDiscovery(`No tools found in tools list from server ${serverId}`);
      }
    } catch (error) {
      console.error('Error processing tools list:', error);
    }
  }

  /**
   * Handle a resources list event
   * @param event - Resources list event
   */
  private async handleResourcesList(event: Event) {
    try {
      if (!this.isAllowedDVM(event.pubkey)) {
        loggerDiscovery('DVM not in whitelist:', event.pubkey);
        return;
      }

      const serverId = event.tags.find(
        (t) => t[0] === TAG_SERVER_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Resources list missing server ID');
        return;
      }

      const uniqueId = event.tags.find(
        (t) => t[0] === TAG_UNIQUE_IDENTIFIER
      )?.[1];
      if (uniqueId?.includes('resources/templates/list')) {
        this.handleResourceTemplatesList(event, serverId);
        return;
      }

      let resourcesList: Resource[] = [];
      try {
        const content: ListResourcesResult = JSON.parse(event.content);
        resourcesList = content.resources;
      } catch (error) {
        console.error('Error parsing resources list content:', error);
      }

      if (resourcesList.length > 0) {
        this.resourceRegistry.registerServerResources(
          serverId,
          resourcesList,
          event.pubkey
        );
        loggerDiscovery(
          `Registered ${resourcesList.length} resources from server ${serverId} (provider: ${event.pubkey})`
        );
      } else {
        loggerDiscovery(
          `No resources found in resources list from server ${serverId}`
        );
      }
    } catch (error) {
      console.error('Error processing resources list:', error);
    }
  }

  /**
   * Handle a resource templates list event
   * @param event - Resource templates list event
   * @param serverId - Server identifier
   */
  private async handleResourceTemplatesList(event: Event, serverId: string) {
    try {
      let resourceTemplatesList: ResourceTemplate[] = [];
      try {
        const content: ListResourceTemplatesResult = JSON.parse(event.content);
        if (!content.resourceTemplates) {
          loggerDiscovery(
            'No resource templates found in resource templates list'
          );
          return;
        }
        resourceTemplatesList = content.resourceTemplates;
      } catch (error) {
        console.error('Error parsing resource templates list content:', error);
      }
      if (resourceTemplatesList.length > 0) {
        this.resourceRegistry.registerServerResourceTemplates(
          serverId,
          resourceTemplatesList,
          event.pubkey
        );
        loggerDiscovery(
          `Registered ${resourceTemplatesList.length} resource templates from server ${serverId} (provider: ${event.pubkey})`
        );
      } else {
        loggerDiscovery(
          `No resource templates found in list from server ${serverId}`
        );
      }
    } catch (error) {
      console.error('Error processing resource templates list:', error);
    }
  }
  /**
   * Notify clients that the tool list has changed
   * This uses the MCP protocol to signal that tools have been added or removed
   */
  public notifyToolListChanged(): void {
    try {
      this.mcpServer.server
        .sendToolListChanged()
        .then(() => {
          loggerDiscovery('Sent tool list changed notification to clients');
        })
        .catch((error) => {
          console.error(
            'Failed to send tool list changed notification:',
            error
          );
        });
    } catch (error) {
      console.error('Error sending tool list changed notification:', error);
    }
  }

  /**
   * Handle a prompts list event
   * @param event - Prompts list event
   */
  private async handlePromptsList(event: Event) {
    try {
      if (!this.isAllowedDVM(event.pubkey)) {
        loggerDiscovery('DVM not in whitelist:', event.pubkey);
        return;
      }

      const serverId = event.tags.find(
        (t) => t[0] === TAG_SERVER_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Prompts list missing server ID');
        return;
      }

      let promptsList: Prompt[] = [];
      try {
        const content: ListPromptsResult = JSON.parse(event.content);

        promptsList = content.prompts;
      } catch (error) {
        console.error('Error parsing prompts list content:', error);
      }

      // Register prompts with the registry
      if (promptsList.length > 0) {
        this.promptRegistry.registerServerPrompts(
          serverId,
          promptsList,
          event.pubkey
        );
        loggerDiscovery(
          `Registered ${promptsList.length} prompts from server ${serverId} (provider: ${event.pubkey})`
        );
      } else {
        loggerDiscovery(
          `No prompts found in prompts list from server ${serverId}`
        );
      }
    } catch (error) {
      console.error('Error processing prompts list:', error);
    }
  }

  /**
   * Get the current configuration
   * @returns The current configuration
   */
  public getConfig(): DvmcpDiscoveryConfig {
    return this.config;
  }

  private isAllowedDVM(pubkey: string): boolean {
    // If whitelist is defined and has entries, check if the pubkey is in the list
    const allowedDVMs = this.config.whitelist?.allowedDVMs;
    if (allowedDVMs && allowedDVMs.length > 0) {
      return allowedDVMs.includes(pubkey);
    }
    // If no whitelist or empty whitelist, allow all
    return true;
  }

  /**
   * List all tools in the registry
   * @returns Array of tools
   */
  public async listTools(): Promise<Tool[]> {
    return this.toolRegistry.listTools();
  }

  /**
   * List all tools in the registry with their IDs
   * @returns Array of [toolId, tool] pairs
   */
  public async listToolsWithIds(): Promise<[string, Tool][]> {
    return this.toolRegistry.listToolsWithIds();
  }

  /**
   * List all resources in the registry
   * @returns Array of resources
   */
  public async listResources(): Promise<Resource[]> {
    return this.resourceRegistry.listResources();
  }

  /**
   * List all resources in the registry with their IDs
   * @returns Array of [resourceId, resource] pairs
   */
  public async listResourcesWithIds(): Promise<[string, Resource][]> {
    return this.resourceRegistry.listResourcesWithIds();
  }

  /**
   * List all prompts in the registry
   * @returns Array of prompts
   */
  public async listPrompts(): Promise<Prompt[]> {
    return this.promptRegistry.listPrompts();
  }

  /**
   * List all prompts in the registry with their IDs
   * @returns Array of [promptId, prompt] pairs
   */
  public async listPromptsWithIds(): Promise<[string, Prompt][]> {
    return this.promptRegistry.listPromptsWithIds();
  }

  /**
   * Remove a tool from the registry by its ID
   * @param toolId - ID of the tool to remove
   * @returns true if the tool was removed, false if it wasn't found
   */
  public removeTool(toolId: string): boolean {
    return this.toolRegistry.removeTool(toolId);
  }

  /**
   * Remove all tools from a specific provider
   * @param providerPubkey - Public key of the provider whose tools should be removed
   * @returns Array of removed tool IDs
   */
  public removeToolsByProvider(providerPubkey: string): string[] {
    const removedTools =
      this.toolRegistry.removeToolsByProvider(providerPubkey);
    if (removedTools.length > 0) {
      this.notifyToolListChanged();
      loggerDiscovery(
        `Removed ${removedTools.length} tools from provider ${providerPubkey}`
      );
    }
    return removedTools;
  }

  /**
   * Remove tools matching a regex pattern
   * @param pattern - Regex pattern to match against tool IDs
   * @returns Array of removed tool IDs
   */
  public removeToolsByPattern(pattern: RegExp): string[] {
    const removedTools = this.toolRegistry.removeToolsByPattern(pattern);
    if (removedTools.length > 0) {
      this.notifyToolListChanged();
      loggerDiscovery(
        `Removed ${removedTools.length} tools matching pattern ${pattern}`
      );
    }
    return removedTools;
  }

  public async registerDirectServerTools(
    pubkey: string,
    announcement: InitializeResult,
    serverId: string
  ) {
    loggerDiscovery(
      'Starting discovery server with direct server capabilities...'
    );

    if (announcement.serverInfo) {
      this.serverRegistry.registerServer(
        serverId,
        pubkey,
        JSON.stringify({
          protocolVersion: announcement.protocolVersion || '2025-03-26',
          capabilities: announcement.capabilities || {},
          serverInfo: announcement.serverInfo,
          instructions: announcement.instructions,
        }),
        // For direct servers, assuming no explicit 'support_encryption' tag in InitializeResult.
        // If the MCP protocol or InitializeResult type is extended to include encryption info,
        // this logic would need to be updated to extract it.
        // For now, we default to false for direct servers unless explicitly handled.
        false // Defaulting to false for direct server encryption support
      );
      loggerDiscovery(
        `Registered direct server: ${announcement.serverInfo.name || serverId} (${serverId})`
      );
    }

    const tools: Tool[] = Array.isArray(announcement.tools)
      ? (announcement.tools as Tool[])
      : Array.isArray(announcement.capabilities?.tools)
        ? (announcement.capabilities.tools as Tool[])
        : [];
    if (tools.length > 0) {
      this.registerToolsFromAnnouncement(pubkey, tools, serverId);
      loggerDiscovery(`Registered ${tools.length} tools from direct server`);
    } else {
      loggerDiscovery('No tools found in server announcement');
    }

    const resources: Resource[] = Array.isArray(announcement.resources)
      ? (announcement.resources as Resource[])
      : [];
    if (resources.length > 0) {
      this.resourceRegistry.registerServerResources(
        serverId,
        resources,
        pubkey
      );
      loggerDiscovery(
        `Registered ${resources.length} resources from direct server`
      );
    }

    const resourceTemplates: ResourceTemplate[] = Array.isArray(
      announcement.resourceTemplates
    )
      ? (announcement.resourceTemplates as ResourceTemplate[])
      : [];
    if (resourceTemplates.length > 0) {
      this.resourceRegistry.registerServerResourceTemplates(
        serverId,
        resourceTemplates,
        pubkey
      );
      loggerDiscovery(
        `Registered ${resourceTemplates.length} resource templates from direct server`
      );
    }

    const prompts: Prompt[] = Array.isArray(announcement.prompts)
      ? (announcement.prompts as Prompt[])
      : [];
    if (prompts.length > 0) {
      this.promptRegistry.registerServerPrompts(serverId, prompts, pubkey);
      loggerDiscovery(
        `Registered ${prompts.length} prompts from direct server`
      );
    }

    loggerDiscovery(
      `Direct server registration complete: ` +
        `${this.toolRegistry.listTools().length} tools, ` +
        `${this.resourceRegistry.listResources().length} resources, ` +
        `${this.resourceRegistry.listResourceTemplates().length} resource templates, ` +
        `${this.promptRegistry.listPrompts().length} prompts`
    );

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    loggerDiscovery('DVMCP Discovery Server started');
  }

  public async start(options?: { forceDiscovery?: boolean }) {
    const isInteractive = this.config.featureFlags?.interactive === true;
    const forceDiscovery = options?.forceDiscovery === true;

    loggerDiscovery(
      `Starting discovery server with interactive mode: ${isInteractive ? 'enabled' : 'disabled'}`
    );
    loggerDiscovery(
      `Relay URLs: ${this.config.nostr.relayUrls.length > 0 ? this.config.nostr.relayUrls.join(', ') : 'none'}`
    );

    if (!isInteractive || forceDiscovery) {
      if (this.config.nostr.relayUrls.length > 0) {
        if (forceDiscovery && isInteractive) {
          loggerDiscovery(
            'Force discovery enabled - running discovery despite interactive mode'
          );
        }
        await this.startDiscovery();
        loggerDiscovery(
          `Discovery complete: ${this.toolRegistry.listTools().length} tools, ` +
            `${this.resourceRegistry.listResources().length} resources, ` +
            `${this.promptRegistry.listPrompts().length} prompts`
        );
      } else {
        loggerDiscovery('Skipping discovery as no relay URLs are configured');
      }
    } else {
      loggerDiscovery(
        'Skipping discovery as running in interactive mode - using only built-in tools'
      );
    }
    this.serverRegistry.setupCompletionHandler(this.mcpServer, (params) =>
      this.getCompletions(params)
    );

    this.serverRegistry.setupPingHandler(this.mcpServer, () =>
      this.handlePing()
    );

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    loggerDiscovery('MCP server connected');

    loggerDiscovery('DVMCP Discovery Server started');
  }

  /**
   * Get the server registry instance
   * @returns The server registry
   */
  public getServerRegistry(): ServerRegistry {
    return this.serverRegistry;
  }

  /**
   * Get completions for a prompt or resource argument
   * @param params - Completion request parameters
   * @returns Completion result with suggested values
   */
  public async getCompletions(
    params: CompleteRequest['params']
  ): Promise<CompleteResult> {
    return this.completionExecutor.getCompletions(params);
  }

  /**
   * Handle ping requests from MCP clients by propagating to DVMCP servers
   * @param params - Ping request parameters
   * @returns Empty object as per MCP ping specification
   */
  public async handlePing(): Promise<{}> {
    loggerDiscovery(
      'Received ping request from MCP client, propagating to DVMCP servers'
    );

    // Get all registered servers with their IDs
    const serversWithIds = this.serverRegistry.listServersWithIds();

    if (serversWithIds.length === 0) {
      loggerDiscovery('No DVMCP servers to ping');
      return {};
    }

    // Ping the first available server (or could ping all/random selection)
    const [serverId, serverInfo] = serversWithIds[0];
    loggerDiscovery(`Pinging DVMCP server: ${serverInfo.pubkey} (${serverId})`);

    try {
      // Use the ping executor to ping the server with server ID
      const result = await this.pingExecutor.ping(serverInfo.pubkey, serverId);
      loggerDiscovery(
        `Ping result: ${result.success ? 'success' : 'failed'} in ${result.responseTime}ms`
      );
    } catch (error) {
      loggerDiscovery(`Ping failed with error: ${error}`);
    }

    // Always return empty object as per MCP spec
    return {};
  }

  /**
   * Send a ping request to a specific server
   * @param serverPubkey - Public key of the server to ping
   * @param serverId - Server identifier (optional)
   * @param options - Ping options
   * @returns Promise that resolves with ping result
   */
  public async ping(
    serverPubkey: string,
    serverId?: string,
    options?: { timeout?: number }
  ): Promise<{ success: boolean; responseTime?: number; error?: string }> {
    return this.pingExecutor.ping(serverPubkey, serverId, options);
  }

  public cleanup(): void {
    this.relayHandler.cleanup();
    this.toolExecutor.cleanup();
    this.resourceExecutor.cleanup();
    this.promptExecutor.cleanup();
    this.completionExecutor.cleanup();
    this.pingExecutor.cleanup();

    loggerDiscovery('DVMCP Discovery Server cleaned up');
  }
}
