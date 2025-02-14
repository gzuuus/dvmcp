import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Event, type Filter } from 'nostr-tools';
import { z } from 'zod';
import { RelayHandler } from 'commons/nostr/relay-handler';
import { createKeyManager } from 'commons/nostr/key-manager';
import { CONFIG, type Config } from './config';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface DVMTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  dvmPubkey: string;
}

export class DiscoveryServer {
  private mcpServer: McpServer;
  private relayHandler: RelayHandler;
  private keyManager: ReturnType<typeof createKeyManager>;
  private discoveredTools: Map<string, DVMTool> = new Map();
  private executionSubscriptions: Map<string, () => void> = new Map();

  constructor(config: Config) {
    this.relayHandler = new RelayHandler(config.nostr.relayUrls);
    this.keyManager = createKeyManager(config.nostr.privateKey);

    this.mcpServer = new McpServer({
      name: config.mcp.name,
      version: config.mcp.version,
    });

    this.startDiscovery();
  }

  private async startDiscovery() {
    // Query existing announcements
    const filter: Filter = {
      kinds: [31990],
      '#t': ['mcp'],
    };

    const events = await this.relayHandler.queryEvents(filter);
    events.forEach((event) => this.handleDVMAnnouncement(event));

    // Subscribe to new announcements
    this.relayHandler.subscribeToRequests((event) => {
      if (event.kind === 31990) {
        this.handleDVMAnnouncement(event);
      }
    });
  }

  private handleDVMAnnouncement(event: Event) {
    try {
      // Check whitelist if enabled
      if (
        CONFIG.whitelist?.allowedDVMs &&
        !CONFIG.whitelist.allowedDVMs.has(event.pubkey)
      ) {
        return;
      }
      const content = JSON.parse(event.content);
      if (!content.tools || !Array.isArray(content.tools)) return;

      content.tools.forEach((tool: any) => {
        const toolId = `${event.pubkey}:${tool.name}`;

        this.discoveredTools.set(toolId, {
          name: tool.name,
          description: tool.description,
          inputSchema: z.object(tool.inputSchema.properties),
          dvmPubkey: event.pubkey,
        });

        this.registerTool(toolId, tool);
      });
    } catch (error) {
      console.error('Error processing DVM announcement:', error);
    }
  }

  private registerTool(toolId: string, toolDef: DVMTool) {
    this.mcpServer.tool(
      toolId,
      toolDef.inputSchema.shape,
      async (
        args: z.infer<typeof toolDef.inputSchema>
      ): Promise<CallToolResult> => {
        try {
          const result = await this.executeDVMTool(toolId, args);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result),
              },
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  private async executeDVMTool(
    toolId: string,
    params: z.infer<DVMTool['inputSchema']>
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tool = this.discoveredTools.get(toolId);
      if (!tool) {
        reject(new Error('Tool not found'));
        return;
      }

      // Create execution request event
      const requestEvent = this.keyManager.createEventTemplate(5910);
      requestEvent.content = JSON.stringify(params);
      requestEvent.tags.push(['c', 'execute-tool'], ['name', tool.name]);

      const signedEvent = this.keyManager.signEvent(requestEvent);
      const executionId = signedEvent.id;

      // Set up response listener
      const sub = this.relayHandler.subscribeToRequests((event) => {
        if (
          event.kind === 6910 &&
          event.tags.some((t) => t[0] === 'e' && t[1] === executionId)
        ) {
          try {
            const result = JSON.parse(event.content);
            resolve(result);
            cleanup();
          } catch (error) {
            reject(error);
            cleanup();
          }
        }

        if (
          event.kind === 7000 &&
          event.tags.some((t) => t[0] === 'e' && t[1] === executionId)
        ) {
          const status = event.tags.find((t) => t[0] === 'status')?.[1];
          if (status === 'error') {
            reject(new Error(event.content));
            cleanup();
          }
        }
      });

      // Cleanup function
      const cleanup = () => {
        sub.close();
        this.executionSubscriptions.delete(executionId);
      };

      // Store cleanup function
      this.executionSubscriptions.set(executionId, cleanup);

      // Publish request
      this.relayHandler.publishEvent(signedEvent).catch(reject);

      // Set execution timeout
      setTimeout(() => {
        reject(new Error('Tool execution timeout'));
        cleanup();
      }, 30000); // 30 second timeout
    });
  }

  public async start() {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.log('DVMCP Discovery Server started');
  }

  public cleanup() {
    this.relayHandler.cleanup();
    this.executionSubscriptions.forEach((cleanup) => cleanup());
    this.executionSubscriptions.clear();
  }
}
