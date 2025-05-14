import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Event, type Filter } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { getConfig, type Config } from './config';
import {
  SERVER_ANNOUNCEMENT_KIND,
  TOOLS_LIST_KIND,
  RESOURCES_LIST_KIND,
  PROMPTS_LIST_KIND,
  TAG_SERVER_IDENTIFIER,
  TAG_CAPABILITY,
  TAG_UNIQUE_IDENTIFIER,
} from '@dvmcp/commons/constants';
import type { Tool, Resource } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry';
import { ToolExecutor } from './tool-executor';
import type { DVMAnnouncement } from './direct-discovery';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import {
  builtInToolRegistry,
  setDiscoveryServerReference,
} from './built-in-tools';

export class DiscoveryServer {
  private mcpServer: McpServer;
  private relayHandler: RelayHandler;
  private keyManager: ReturnType<typeof createKeyManager>;
  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;
  private config: Config;
  private integratedRelays: Set<string> = new Set();

  constructor(config: Config) {
    this.config = config;
    this.relayHandler = new RelayHandler(config.nostr.relayUrls);
    this.keyManager = createKeyManager(config.nostr.privateKey);
    this.mcpServer = new McpServer({
      name: config.mcp.name,
      version: config.mcp.version,
    });

    this.toolRegistry = new ToolRegistry(this.mcpServer);
    this.toolExecutor = new ToolExecutor(
      this.relayHandler,
      this.keyManager,
      this.toolRegistry
    );

    this.toolRegistry.setExecutionCallback(async (toolId, args) => {
      const tool = this.toolRegistry.getTool(toolId);
      if (!tool) throw new Error('Tool not found');
      return this.toolExecutor.executeTool(toolId, tool, args);
    });

    // Set the discovery server reference for the integration tool
    setDiscoveryServerReference(this);
  }
  private async startDiscovery() {
    const filter: Filter = {
      kinds: [
        SERVER_ANNOUNCEMENT_KIND, // 31316
        TOOLS_LIST_KIND, // 31317
        RESOURCES_LIST_KIND, // 31318
        PROMPTS_LIST_KIND, // 31319
      ],
    };

    // Add limit to the filter if it's specified in the configuration
    if (this.config.discovery?.limit !== undefined) {
      filter.limit = this.config.discovery.limit;
      loggerDiscovery(
        `Limiting DVM discovery to ${this.config.discovery.limit}`
      );
    }

    const events = await this.relayHandler.queryEvents(filter);
    await this.processAnnouncementEvents(events);
  }

  /**
   * Process announcement events by grouping them by kind and processing each group
   * @param events - Array of events to process
   */
  private async processAnnouncementEvents(events: Event[]) {
    // Group events by kind for processing
    const serverAnnouncements = events.filter(
      (e) => e.kind === SERVER_ANNOUNCEMENT_KIND
    );
    const toolsLists = events.filter((e) => e.kind === TOOLS_LIST_KIND);
    const resourcesLists = events.filter((e) => e.kind === RESOURCES_LIST_KIND);
    const promptsLists = events.filter((e) => e.kind === PROMPTS_LIST_KIND);

    // Process server announcements first
    for (const event of serverAnnouncements) {
      await this.handleServerAnnouncement(event);
    }

    // Then process capability lists
    for (const event of toolsLists) {
      await this.handleToolsList(event);
    }

    for (const event of resourcesLists) {
      await this.handleResourcesList(event);
    }

    for (const event of promptsLists) {
      await this.handlePromptsList(event);
    }
  }

  public createToolId(toolName: string, pubkey: string): string {
    return `${toolName}_${pubkey.slice(0, 4)}`;
  }

  private registerToolsFromAnnouncement(
    pubkey: string,
    tools: Tool[],
    serverId?: string
  ): void {
    for (const tool of tools) {
      const toolId = this.createToolId(tool.name, pubkey);
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
    const toolId = this.createToolId(toolName, pubkey);
    return this.toolRegistry.getTool(toolId) !== undefined;
  }

  /**
   * Register a tool from an announcement (public method for built-in tools)
   * @param pubkey - Provider public key
   * @param tool - Tool definition
   * @param notifyClient - Whether to notify clients about the tool list change
   * @returns Tool ID
   */
  public registerToolFromAnnouncement(
    pubkey: string,
    tool: Tool,
    notifyClient: boolean = false
  ): string {
    const toolId = this.createToolId(tool.name, pubkey);

    // Check if the tool is already registered
    if (this.isToolRegistered(tool.name, pubkey)) {
      loggerDiscovery(
        `Tool ${tool.name} (${toolId}) is already registered, skipping registration`
      );
      return toolId;
    }

    this.toolRegistry.registerTool(toolId, tool, pubkey);
    loggerDiscovery(`Registered tool from announcement: ${toolId}`);

    // If notifyClient is true, notify clients about the tool list change
    if (notifyClient) {
      this.notifyToolListChanged();
    }

    return toolId;
  }

  /**
   * Notify clients that the tool list has changed
   * This uses the MCP protocol to signal that tools have been added or removed
   */
  public notifyToolListChanged(): void {
    try {
      // Send the tool list changed notification to clients
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
   * Add a relay to the relay handler and track it as an integrated relay
   * @param relayUrl - Relay URL to add
   * @returns true if the relay was added, false if it was already in the list
   */
  public addRelay(relayUrl: string): boolean {
    if (this.integratedRelays.has(relayUrl)) {
      loggerDiscovery(`Relay ${relayUrl} is already integrated`);
      return false;
    }

    // Track the integrated relay
    this.integratedRelays.add(relayUrl);
    loggerDiscovery(`Added relay ${relayUrl} to integrated relays`);

    // Create a new relay handler with all relays (existing + new)
    const currentRelays = this.config.nostr.relayUrls;
    const allRelays = [...new Set([...currentRelays, relayUrl])];

    // Update the config with the new relay list
    this.config.nostr.relayUrls = allRelays;

    // Create a new relay handler with the updated relay list
    const newRelayHandler = new RelayHandler(allRelays);

    // Clean up the old relay handler
    this.relayHandler.cleanup();

    // Replace the relay handler with the new one
    this.relayHandler = newRelayHandler;

    // Update the tool executor with the new relay handler
    this.toolExecutor.updateRelayHandler(this.relayHandler);

    loggerDiscovery(
      `Updated relay handler with new relay: ${relayUrl}. Total relays: ${allRelays.length}`
    );

    return true;
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

      // Extract server ID from d tag
      const serverId = event.tags.find(
        (t) => t[0] === TAG_UNIQUE_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Server announcement missing server ID');
        return;
      }

      // Store server information for later use
      this.toolRegistry.registerServer(serverId, event.pubkey, event.content);
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

      // Extract server ID from s tag
      const serverId = event.tags.find(
        (t) => t[0] === TAG_SERVER_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Tools list missing server ID');
        return;
      }

      // Extract tool names from cap tags
      const toolNames = event.tags
        .filter((t) => t[0] === TAG_CAPABILITY)
        .map((t) => t[1]);

      // Parse content as JSON
      let toolsList: Tool[] = [];
      try {
        const content = JSON.parse(event.content);
        // Check for both formats: direct array or nested under result
        if (Array.isArray(content.tools)) {
          toolsList = content.tools;
        } else if (content.result?.tools) {
          toolsList = content.result.tools;
        }
      } catch (error) {
        console.error('Error parsing tools list content:', error);
      }

      // Register tools with the registry
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
      // Extract server ID from s tag
      const serverId = event.tags.find(
        (t) => t[0] === TAG_SERVER_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Resources list missing server ID');
        return;
      }

      // Extract resource names from cap tags
      const resourceNames = event.tags
        .filter((t) => t[0] === TAG_CAPABILITY)
        .map((t) => t[1]);

      // Parse content as JSON
      let resourcesList: Resource[] = [];
      try {
        const content = JSON.parse(event.content);
        // Check for both formats: direct array or nested under result
        if (Array.isArray(content.resources)) {
          resourcesList = content.resources;
        } else if (content.result?.resources) {
          resourcesList = content.result.resources;
        }
      } catch (error) {
        console.error('Error parsing resources list content:', error);
      }

      // Register resources with the registry
      if (resourcesList.length > 0) {
        this.toolRegistry.registerResources(serverId, resourcesList);
        loggerDiscovery(
          `Registered ${resourcesList.length} resources from server ${serverId}`
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
   * Handle a prompts list event
   * @param event - Prompts list event
   */
  private async handlePromptsList(event: Event) {
    try {
      // Extract server ID from s tag
      const serverId = event.tags.find(
        (t) => t[0] === TAG_SERVER_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Prompts list missing server ID');
        return;
      }

      // Extract prompt names from cap tags
      const promptNames = event.tags
        .filter((t) => t[0] === TAG_CAPABILITY)
        .map((t) => t[1]);

      // Parse content as JSON
      let promptsList: any[] = [];
      try {
        const content = JSON.parse(event.content);
        // Check for both formats: direct array or nested under result
        if (Array.isArray(content.prompts)) {
          promptsList = content.prompts;
        } else if (content.result?.prompts) {
          promptsList = content.result.prompts;
        }
      } catch (error) {
        console.error('Error parsing prompts list content:', error);
      }

      // Register prompts with the registry (if implemented)
      if (promptsList.length > 0) {
        // TODO: Implement prompt registration when needed
        loggerDiscovery(
          `Found ${promptsList.length} prompts from server ${serverId}`
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

  private isAllowedDVM(pubkey: string): boolean {
    const config = getConfig();
    if (
      !config.whitelist?.allowedDVMs ||
      config.whitelist.allowedDVMs.size == 0
    ) {
      return true;
    }
    return config.whitelist.allowedDVMs.has(pubkey);
  }

  private parseAnnouncement(content: string): DVMAnnouncement | null {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
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
    loggerDiscovery('Starting discovery server with direct server tools...');

    // Register built-in tools first
    this.registerBuiltInTools();

    if (!announcement?.tools) {
      console.error('No tools found in server announcement');
      return;
    }

    this.registerToolsFromAnnouncement(pubkey, announcement.tools);

    loggerDiscovery(
      `Registered ${announcement.tools.length} tools from direct server`
    );

    // Connect the MCP server
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    loggerDiscovery('DVMCP Discovery Server started');
  }

  public async start() {
    const config = getConfig();
    this.config = config;

    // Log interactive mode and relay configuration
    const isInteractive = config.featureFlags?.interactive === true;
    loggerDiscovery(
      `Starting discovery server with interactive mode: ${isInteractive ? 'enabled' : 'disabled'}`
    );
    loggerDiscovery(
      `Relay URLs: ${config.nostr.relayUrls.length > 0 ? config.nostr.relayUrls.join(', ') : 'none'}`
    );

    // Register built-in tools
    this.registerBuiltInTools();

    // Only if we have relay URLs or if not in interactive-only mode
    if (config.nostr.relayUrls.length > 0 || !isInteractive) {
      await this.startDiscovery();
      loggerDiscovery(
        `Discovered ${this.toolRegistry.listTools().length} tools`
      );
    } else {
      loggerDiscovery(
        'Skipping discovery as no relay URLs are configured and running in interactive mode'
      );
    }

    // Connect the MCP server AFTER all tools are registered
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    loggerDiscovery('MCP server connected');

    loggerDiscovery('DVMCP Discovery Server started');
  }

  /**
   * Register built-in tools with the tool registry
   * @private
   */
  private registerBuiltInTools(): void {
    // Check if interactive mode is enabled in the configuration
    const config = getConfig();

    const isInteractiveMode = config.featureFlags?.interactive === true;

    if (!isInteractiveMode) {
      loggerDiscovery(
        'Interactive mode is disabled. Skipping built-in tools registration.'
      );
      return;
    }

    loggerDiscovery(
      'Interactive mode is enabled. Registering built-in tools...'
    );

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

  public async cleanup(): Promise<void> {
    this.toolExecutor.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.relayHandler.cleanup();
    this.toolRegistry.clear();
  }
}
