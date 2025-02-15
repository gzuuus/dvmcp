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
  private isConnected: boolean = false;

  constructor(config: Config) {
    this.relayHandler = new RelayHandler(config.nostr.relayUrls);
    this.keyManager = createKeyManager(config.nostr.privateKey);

    this.mcpServer = new McpServer({
      name: config.mcp.name,
      version: config.mcp.version,
    });
  }

  private async startDiscovery() {
    const filter: Filter = {
      kinds: [31990],
      '#t': ['mcp'],
    };

    const events = await this.relayHandler.queryEvents(filter);
    await Promise.all(events.map((event) => this.handleDVMAnnouncement(event)));

    this.relayHandler.subscribeToRequests((event) => {
      if (event.kind === 31990) {
        this.handleDVMAnnouncement(event);
      }
    });
  }

  private async handleDVMAnnouncement(event: Event) {
    try {
      if (
        CONFIG.whitelist?.allowedDVMs &&
        !CONFIG.whitelist.allowedDVMs.has(event.pubkey)
      ) {
        return;
      }
      const content = JSON.parse(event.content);
      if (!content.tools || !Array.isArray(content.tools)) return;

      for (const tool of content.tools) {
        const toolId = `${event.pubkey.slice(0, 12)}:${tool.name}`;

        const inputSchema = z.object(
          Object.fromEntries(
            Object.entries(tool.inputSchema.properties).map(
              ([key, value]: [string, any]) => [key, this.mapSchemaType(value)]
            )
          )
        );

        this.discoveredTools.set(toolId, {
          name: tool.name,
          description: tool.description,
          inputSchema: inputSchema,
          dvmPubkey: event.pubkey,
        });

        if (!this.isConnected) {
          this.registerTool(toolId, {
            name: tool.name,
            description: tool.description,
            inputSchema: inputSchema,
            dvmPubkey: event.pubkey,
          });
        }
      }
    } catch (error) {
      console.error('Error processing DVM announcement:', error);
    }
  }

  private mapSchemaType(schema: any): z.ZodTypeAny {
    switch (schema.type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(this.mapSchemaType(schema.items));
      case 'object':
        return z.object(
          Object.fromEntries(
            Object.entries(schema.properties).map(
              ([key, value]: [string, any]) => [key, this.mapSchemaType(value)]
            )
          )
        );
      default:
        return z.any();
    }
  }

  private registerTool(toolId: string, toolDef: DVMTool) {
    this.mcpServer.tool(
      toolId,
      toolDef.description,
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
      const requestEvent = this.keyManager.createEventTemplate(5910);
      requestEvent.content = JSON.stringify({
        name: tool.name,
        parameters: params,
      });
      requestEvent.tags.push(['c', 'execute-tool']);
      const signedEvent = this.keyManager.signEvent(requestEvent);
      const executionId = signedEvent.id;

      const defaultFilter: Filter = {
        kinds: [6910, 7000],
        since: Math.floor(Date.now() / 1000),
      };

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
          return;
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
      }, defaultFilter);

      const cleanup = () => {
        sub.close();
        this.executionSubscriptions.delete(executionId);
      };

      this.executionSubscriptions.set(executionId, cleanup);

      this.relayHandler.publishEvent(signedEvent).catch((err) => {
        reject(err);
        cleanup();
      });

      setTimeout(() => {
        reject(new Error('Tool execution timeout'));
        cleanup();
      }, 30000);
    });
  }

  public async start() {
    await this.startDiscovery();

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    this.isConnected = true;

    console.log('DVMCP Discovery Server started');
    console.log(`Discovered ${this.discoveredTools.size} tools`);
    this.discoveredTools.forEach((tool) => console.log(tool));
  }

  public cleanup() {
    this.isConnected = false;
    this.relayHandler.cleanup();
    this.executionSubscriptions.forEach((cleanup) => cleanup());
    this.executionSubscriptions.clear();
  }
}
