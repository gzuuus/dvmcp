import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Event, type Filter } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { getConfig, type Config } from './config';
import { DVM_ANNOUNCEMENT_KIND } from '@dvmcp/commons/constants';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry';
import { ToolExecutor } from './tool-executor';
import type { DVMAnnouncement } from './direct-discovery';
import { loggerDiscovery } from '@dvmcp/commons/logger';

export class DiscoveryServer {
  private mcpServer: McpServer;
  private relayHandler: RelayHandler;
  private keyManager: ReturnType<typeof createKeyManager>;
  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;

  constructor(config: Config) {
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
  }

  private async startDiscovery() {
    const filter: Filter = {
      kinds: [DVM_ANNOUNCEMENT_KIND],
      '#t': ['mcp'],
    };

    const events = await this.relayHandler.queryEvents(filter);
    await Promise.all(events.map((event) => this.handleDVMAnnouncement(event)));
  }

  private createToolId(toolName: string, pubkey: string): string {
    return `${toolName}_${pubkey.slice(0, 4)}`;
  }

  private registerToolsFromAnnouncement(pubkey: string, tools: Tool[]): void {
    for (const tool of tools) {
      const toolId = this.createToolId(tool.name, pubkey);
      this.toolRegistry.registerTool(toolId, tool, pubkey);
    }
  }

  private async handleDVMAnnouncement(event: Event) {
    try {
      if (!this.isAllowedDVM(event.pubkey)) {
        loggerDiscovery('DVM not in whitelist:', event.pubkey);
        return;
      }

      const announcement = this.parseAnnouncement(event.content);
      if (!announcement?.tools) return;

      this.registerToolsFromAnnouncement(event.pubkey, announcement.tools);
    } catch (error) {
      console.error('Error processing DVM announcement:', error);
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

  public async listTools(): Promise<Tool[]> {
    return this.toolRegistry.listTools();
  }

  public async registerDirectServerTools(
    pubkey: string,
    announcement: DVMAnnouncement
  ) {
    loggerDiscovery('Starting discovery server with direct server tools...');

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
    loggerDiscovery('Starting discovery server...');

    await this.startDiscovery();
    loggerDiscovery(`Discovered ${this.toolRegistry.listTools().length} tools`);

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    loggerDiscovery('DVMCP Discovery Server started');
  }

  public async cleanup(): Promise<void> {
    this.toolExecutor.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.relayHandler.cleanup();
    this.toolRegistry.clear();
  }
}
