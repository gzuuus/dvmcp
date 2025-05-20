import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Event, type Filter } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { CompletionExecutor } from './completion-executor';
import type { DvmcpDiscoveryConfig } from './config-schema';
import {
  SERVER_ANNOUNCEMENT_KIND,
  TOOLS_LIST_KIND,
  RESOURCES_LIST_KIND,
  PROMPTS_LIST_KIND,
  TAG_SERVER_IDENTIFIER,
  TAG_UNIQUE_IDENTIFIER,
} from '@dvmcp/commons/constants';
import {
  type Tool,
  type Resource,
  type ListToolsResult,
  type ListPromptsResult,
  type Prompt,
  type ListResourcesResult,
  type CompleteRequest,
  type CompleteResult,
  CompleteRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry';
import { ToolExecutor } from './tool-executor';
import { ResourceRegistry } from './resource-registry';
import { ResourceExecutor } from './resource-executor';
import { PromptRegistry } from './prompt-registry';
import { PromptExecutor } from './prompt-executor';
import { ServerRegistry } from './server-registry';
import type { DVMAnnouncement } from './direct-discovery';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import {
  builtInToolRegistry,
  setDiscoveryServerReference,
} from './built-in-tools';
import { createCapabilityId } from './utils';

export class DiscoveryServer {
  private mcpServer: McpServer;
  private relayHandler: RelayHandler;
  private keyManager: ReturnType<typeof createKeyManager>;

  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;
  private resourceRegistry: ResourceRegistry;
  private resourceExecutor: ResourceExecutor;
  private promptRegistry: PromptRegistry;
  private promptExecutor: PromptExecutor;
  private serverRegistry: ServerRegistry;
  private completionExecutor: CompletionExecutor;
  private config: DvmcpDiscoveryConfig;
  private integratedRelays: Set<string> = new Set();

  constructor(config: DvmcpDiscoveryConfig) {
    this.config = config;
    this.relayHandler = new RelayHandler(config.nostr.relayUrls);
    this.keyManager = createKeyManager(config.nostr.privateKey);
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
      this.config
    );

    this.resourceRegistry = new ResourceRegistry(this.mcpServer);
    this.resourceExecutor = new ResourceExecutor(
      this.relayHandler,
      this.keyManager,
      this.resourceRegistry,
      this.config
    );

    this.promptRegistry = new PromptRegistry(this.mcpServer);
    this.promptExecutor = new PromptExecutor(
      this.relayHandler,
      this.keyManager,
      this.promptRegistry,
      this.config
    );

    this.completionExecutor = new CompletionExecutor(
      this.relayHandler,
      this.keyManager,
      this.promptRegistry,
      this.resourceRegistry,
      this.serverRegistry
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

    setDiscoveryServerReference(this);
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

    if (this.config.discovery?.limit !== undefined) {
      filter.limit = this.config.discovery.limit;
      loggerDiscovery(
        `Limiting DVM discovery to ${this.config.discovery.limit}`
      );
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

  public registerToolFromAnnouncement(pubkey: string, tool: Tool): string {
    const toolId = createCapabilityId(tool.name, pubkey);

    if (this.isToolRegistered(tool.name, pubkey)) {
      loggerDiscovery(
        `Tool ${tool.name} (${toolId}) is already registered, skipping registration`
      );
      return toolId;
    }

    this.toolRegistry.registerTool(toolId, tool, pubkey);
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
      this.serverRegistry.registerServer(serverId, event.pubkey, event.content);
      loggerDiscovery(`Registered server: ${serverId} from ${event.pubkey}`);
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
   * @param excludeBuiltIn - Whether to exclude built-in tools from removal (default: true)
   * @returns Array of removed tool IDs
   */
  public removeToolsByProvider(
    providerPubkey: string,
    excludeBuiltIn: boolean = true
  ): string[] {
    const removedTools = this.toolRegistry.removeToolsByProvider(
      providerPubkey,
      excludeBuiltIn
    );
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
   * @param excludeBuiltIn - Whether to exclude built-in tools from removal (default: true)
   * @returns Array of removed tool IDs
   */
  public removeToolsByPattern(
    pattern: RegExp,
    excludeBuiltIn: boolean = true
  ): string[] {
    const removedTools = this.toolRegistry.removeToolsByPattern(
      pattern,
      excludeBuiltIn
    );
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
    announcement: DVMAnnouncement
  ) {
    loggerDiscovery(
      'Starting discovery server with direct server capabilities...'
    );

    this.registerBuiltInCapabilities();

    if (announcement?.tools && announcement.tools.length > 0) {
      this.registerToolsFromAnnouncement(pubkey, announcement.tools);
      loggerDiscovery(
        `Registered ${announcement.tools.length} tools from direct server`
      );
    } else {
      loggerDiscovery('No tools found in server announcement');
    }

    if (announcement?.resources && announcement.resources.length > 0) {
      const serverId = `direct_${pubkey.slice(0, 8)}`;
      this.resourceRegistry.registerServerResources(
        serverId,
        announcement.resources,
        pubkey
      );
      loggerDiscovery(
        `Registered ${announcement.resources.length} resources from direct server`
      );
    }

    if (announcement?.prompts && announcement.prompts.length > 0) {
      const serverId = `direct_${pubkey.slice(0, 8)}`;
      this.promptRegistry.registerServerPrompts(
        serverId,
        announcement.prompts,
        pubkey
      );
      loggerDiscovery(
        `Registered ${announcement.prompts.length} prompts from direct server`
      );
    }

    loggerDiscovery(
      `Direct server registration complete: ` +
        `${this.toolRegistry.listTools().length} tools, ` +
        `${this.resourceRegistry.listResources().length} resources, ` +
        `${this.promptRegistry.listPrompts().length} prompts`
    );

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    loggerDiscovery('DVMCP Discovery Server started');
  }

  public async start() {
    const isInteractive = this.config.featureFlags?.interactive === true;
    loggerDiscovery(
      `Starting discovery server with interactive mode: ${isInteractive ? 'enabled' : 'disabled'}`
    );
    loggerDiscovery(
      `Relay URLs: ${this.config.nostr.relayUrls.length > 0 ? this.config.nostr.relayUrls.join(', ') : 'none'}`
    );

    this.registerBuiltInCapabilities();

    if (this.config.nostr.relayUrls.length > 0 || !isInteractive) {
      await this.startDiscovery();
      loggerDiscovery(
        `Discovery complete: ${this.toolRegistry.listTools().length} tools, ` +
          `${this.resourceRegistry.listResources().length} resources, ` +
          `${this.promptRegistry.listPrompts().length} prompts`
      );
    } else {
      loggerDiscovery(
        'Skipping discovery as no relay URLs are configured and running in interactive mode'
      );
    }
    // Set up the completion request handler if any servers support completions
    this.serverRegistry.setupCompletionHandler(this.mcpServer, (params) =>
      this.getCompletions(params)
    );

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    loggerDiscovery('MCP server connected');

    loggerDiscovery('DVMCP Discovery Server started');
  }

  /**
   * Register all built-in capabilities (tools, resources, prompts) with their respective registries
   * @private
   */
  private registerBuiltInCapabilities(): void {
    // Check if interactive mode is enabled in the configuration
    const isInteractiveMode = this.config.featureFlags?.interactive === true;

    if (!isInteractiveMode) {
      loggerDiscovery(
        'Interactive mode is disabled. Skipping built-in capabilities registration.'
      );
      return;
    }

    loggerDiscovery(
      'Interactive mode is enabled. Registering built-in capabilities...'
    );

    this.registerBuiltInTools();
  }

  /**
   * Register built-in tools with the tool registry
   * @private
   */
  private registerBuiltInTools(): void {
    // Get all built-in tools and register them
    const builtInTools = builtInToolRegistry.getAllTools();
    let registeredCount = 0;

    for (const [toolId, builtInTool] of builtInTools) {
      try {
        this.toolRegistry.registerBuiltInTool(toolId, builtInTool.tool);
        loggerDiscovery(`Registered built-in tool: ${toolId}`);
        registeredCount++;
      } catch (error) {
        console.error(`Failed to register built-in tool ${toolId}:`, error);
      }
    }

    if (registeredCount > 0) {
      loggerDiscovery(`Registered ${registeredCount} built-in tools`);
    } else {
      loggerDiscovery('No built-in tools were registered');
    }
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

  public cleanup(): void {
    this.relayHandler.cleanup();
    this.toolExecutor.cleanup();
    this.resourceExecutor.cleanup();
    this.promptExecutor.cleanup();
    this.completionExecutor.cleanup();

    loggerDiscovery('DVMCP Discovery Server cleaned up');
  }
}
