import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Event, type Filter } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { CONFIG, type Config } from './config';
import { DVM_ANNOUNCEMENT_KIND } from '@dvmcp/commons/constants';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry';
import { ToolExecutor } from './tool-executor';

interface DVMAnnouncement {
  name: string;
  about: string;
  tools: Tool[];
}

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
    this.toolExecutor = new ToolExecutor(this.relayHandler, this.keyManager);

    this.toolRegistry.setExecutionCallback(async (toolId, args) => {
      const tool = this.toolRegistry.getTool(toolId);
      if (!tool) throw new Error('Tool not found');
      return this.toolExecutor.executeTool(tool, args);
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

  private async handleDVMAnnouncement(event: Event) {
    try {
      if (!this.isAllowedDVM(event.pubkey)) {
        console.log('DVM not in whitelist:', event.pubkey);
        return;
      }

      const announcement = this.parseAnnouncement(event.content);
      if (!announcement?.tools) return;

      for (const tool of announcement.tools) {
        const toolId = `${event.pubkey.slice(0, 12)}:${tool.name}`;
        this.toolRegistry.registerTool(toolId, tool);
      }
    } catch (error) {
      console.error('Error processing DVM announcement:', error);
    }
  }

  private isAllowedDVM(pubkey: string): boolean {
    if (
      !CONFIG.whitelist?.allowedDVMs ||
      CONFIG.whitelist.allowedDVMs.size === 0
    ) {
      return true;
    }
    return CONFIG.whitelist.allowedDVMs.has(pubkey);
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

  public async start() {
    console.log('Starting discovery server...');

    await this.startDiscovery();
    console.log(`Discovered ${this.toolRegistry.listTools().length} tools`);

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    console.log('DVMCP Discovery Server started');
  }

  public async cleanup(): Promise<void> {
    this.toolExecutor.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.relayHandler.cleanup();
    this.toolRegistry.clear();
  }
}
