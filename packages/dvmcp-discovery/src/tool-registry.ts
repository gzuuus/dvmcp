import {
  type Tool,
  type CallToolResult,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerDiscovery } from '@dvmcp/commons/core';
import { BaseRegistry } from './base-registry';
import type { Capability } from './base-interfaces';

export interface ToolCapability extends Tool, Capability {
  type: 'tool';
}

export class ToolRegistry extends BaseRegistry<ToolCapability> {
  constructor(mcpServer: McpServer) {
    super(mcpServer);
  }

  public registerTool(
    toolId: string,
    tool: Tool,
    providerPubkey: string,
    serverId?: string
  ): void {
    try {
      ToolSchema.parse(tool);
      const toolCapability: ToolCapability = {
        ...tool,
        id: toolId,
        type: 'tool',
      };

      this.items.set(toolId, {
        item: toolCapability,
        providerPubkey,
        serverId,
      });
      this.registerWithMcp(toolId, toolCapability);
    } catch (error) {
      throw error;
    }
  }

  public getToolInfo(toolId: string) {
    const info = this.getItemInfo(toolId);
    if (!info) return undefined;

    return info;
  }

  public getTool(toolId: string): Tool | undefined {
    return this.getItem(toolId);
  }

  public listTools(): Tool[] {
    return this.listItems();
  }

  public listToolsWithIds(): [string, Tool][] {
    return this.listItemsWithIds();
  }

  public clear(): void {
    super.clear();
  }

  /**
   * Remove a tool from the registry by its ID
   * @param toolId - ID of the tool to remove
   * @returns true if the tool was removed, false if it wasn't found
   */
  public removeTool(toolId: string): boolean {
    const toolInfo = this.getItemInfo(toolId);
    if (!toolInfo) {
      loggerDiscovery.warn(`Tool not found for removal: ${toolId}`);
      return false;
    }

    const result = this.removeItem(toolId);
    if (result) {
      loggerDiscovery.info(`Tool removed from registry: ${toolId}`);
    }
    return result;
  }

  /**
   * Remove all tools from a specific provider
   * @param providerPubkey - Public key of the provider whose tools should be removed
   * @returns Array of removed tool IDs
   */
  public removeToolsByProvider(providerPubkey: string): string[] {
    const removedToolIds: string[] = [];

    for (const [id, info] of this.items.entries()) {
      if (info.providerPubkey === providerPubkey) {
        this.removeItem(id);
        removedToolIds.push(id);
        loggerDiscovery.info(
          `Removed tool ${id} from provider ${providerPubkey}`
        );
      }
    }

    return removedToolIds;
  }

  /**
   * Remove tools matching a regex pattern
   * @param pattern - Regex pattern to match against tool IDs
   * @returns Array of removed tool IDs
   */
  public removeToolsByPattern(pattern: RegExp): string[] {
    const removedToolIds: string[] = [];

    for (const [id] of this.items.entries()) {
      if (pattern.test(id)) {
        this.removeItem(id);
        removedToolIds.push(id);
        loggerDiscovery.info(`Removed tool ${id} matching pattern ${pattern}`);
      }
    }

    return removedToolIds;
  }
  protected registerWithMcp(toolId: string, tool: ToolCapability): void {
    try {
      const registeredTool = this.mcpServer.tool(
        toolId,
        tool.description ?? '',
        this.mapJsonSchemaToZod(tool.inputSchema),
        async (args) => {
          try {
            const params = { ...args, name: toolId };
            const result = await this.executionCallback?.(toolId, params);
            return (
              result || {
                content: [
                  {
                    type: 'text',
                    text: 'No result returned from tool execution',
                  },
                ],
                isError: true,
              }
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${errorMessage}`,
                },
              ],
              isError: true,
            };
          }
        }
      );

      this.storeRegisteredRef(toolId, registeredTool);

      loggerDiscovery.info('Tool registered successfully:', toolId);
    } catch (error) {
      // TODO: Handle collisions more intelligently
      console.error('Error registering tool:', toolId, error);
    }
  }

  private executionCallback?: (
    toolId: string,
    params: CallToolRequest['params']
  ) => Promise<CallToolResult>;

  public setExecutionCallback(
    callback: (
      toolId: string,
      params: CallToolRequest['params']
    ) => Promise<CallToolResult>
  ): void {
    this.executionCallback = callback;
  }

  private mapJsonSchemaToZod(schema: Tool['inputSchema']): z.ZodRawShape {
    if (!schema.properties || Object.keys(schema.properties).length === 0) {
      return { _: z.object({}).optional() };
    }

    const properties: z.ZodRawShape = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (typeof prop === 'object' && prop && 'type' in prop) {
        let zodType: z.ZodType;
        switch (prop.type) {
          case 'string':
            zodType = z.string();
            break;
          case 'number':
            zodType = z.number();
            break;
          case 'integer':
            zodType = z.number().int();
            break;
          case 'boolean':
            zodType = z.boolean();
            break;
          default:
            zodType = z.any();
        }
        properties[key] =
          Array.isArray(schema.required) && schema.required.includes(key)
            ? zodType
            : zodType.optional();
      }
    }
    return properties;
  }
}
