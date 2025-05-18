import {
  type Tool,
  type CallToolResult,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { builtInToolRegistry } from './built-in-tools';
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
    for (const [id, info] of this.items.entries()) {
      if (!info.item.isBuiltIn) {
        this.items.delete(id);
      }
    }
  }

  /**
   * Remove a tool from the registry by its ID
   * @param toolId - ID of the tool to remove
   * @returns true if the tool was removed, false if it wasn't found
   */
  public removeTool(toolId: string): boolean {
    const toolInfo = this.getItemInfo(toolId);

    if (!toolInfo) {
      loggerDiscovery(`Tool not found for removal: ${toolId}`);
      return false;
    }

    const result = this.removeItem(toolId);
    if (result) {
      loggerDiscovery(`Tool removed from registry: ${toolId}`);
    }
    return result;
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
    if (!excludeBuiltIn) {
      return this.removeItemsByProvider(providerPubkey);
    }

    const removedToolIds: string[] = [];

    for (const [id, info] of this.items.entries()) {
      if (excludeBuiltIn && info.item.isBuiltIn) {
        continue;
      }

      if (info.providerPubkey === providerPubkey) {
        this.items.delete(id);
        removedToolIds.push(id);
        loggerDiscovery(`Removed tool ${id} from provider ${providerPubkey}`);
      }
    }

    return removedToolIds;
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
    if (!excludeBuiltIn) {
      return this.removeItemsByPattern(pattern);
    }

    const removedToolIds: string[] = [];

    for (const [id, info] of this.items.entries()) {
      if (excludeBuiltIn && info.item.isBuiltIn) {
        continue;
      }

      if (pattern.test(id)) {
        this.items.delete(id);
        removedToolIds.push(id);
        loggerDiscovery(`Removed tool ${id} matching pattern ${pattern}`);
      }
    }

    return removedToolIds;
  }

  protected registerWithMcp(toolId: string, tool: ToolCapability): void {
    try {
      this.mcpServer.tool(
        toolId,
        tool.description ?? '',
        this.mapJsonSchemaToZod(tool.inputSchema),
        async (params: CallToolRequest['params']) => {
          try {
            let result: CallToolResult | undefined;

            const toolInfo = this.getItemInfo(toolId);

            if (toolInfo?.item.isBuiltIn) {
              result = await this.executeBuiltInTool(toolId, params);
            } else {
              result = await this.executionCallback?.(toolId, params);
            }
            return result;
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
      loggerDiscovery('Tool registered successfully:', toolId);
    } catch (error) {
      // TODO: Handle collisions more intelligently
      console.error('Error registering tool:', toolId, error);
    }
  }

  /**
   * Register a built-in tool with the registry
   * @param toolId - ID of the tool
   * @param tool - Tool definition
   */
  public registerBuiltInTool(toolId: string, tool: Tool): void {
    try {
      ToolSchema.parse(tool);
      const toolCapability: ToolCapability & { isBuiltIn: boolean } = {
        ...tool,
        id: toolId,
        type: 'tool',
        isBuiltIn: true,
      };

      this.items.set(toolId, { item: toolCapability });
      this.registerWithMcp(toolId, toolCapability);
    } catch (error) {
      console.error(`Invalid MCP built-in tool format for ${toolId}:`, error);
      throw error;
    }
  }

  /**
   * Execute a built-in tool
   * @param toolId - ID of the tool
   * @param args - Tool arguments
   * @returns Tool execution result
   */
  public async executeBuiltInTool(
    toolId: string,
    args: unknown
  ): Promise<CallToolResult> {
    const builtInTool = builtInToolRegistry.getTool(toolId);
    if (!builtInTool) {
      throw new Error(`Built-in tool ${toolId} not found`);
    }

    return builtInTool.execute(args) as Promise<CallToolResult>;
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
