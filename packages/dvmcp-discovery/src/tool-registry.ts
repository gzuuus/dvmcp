import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { builtInToolRegistry } from './built-in-tools';

export class ToolRegistry {
  // Store all tools with their source information
  private tools: Map<
    string,
    {
      tool: Tool;
      providerPubkey?: string;
      isBuiltIn?: boolean;
    }
  > = new Map();

  constructor(private mcpServer: McpServer) {}

  public registerTool(
    toolId: string,
    tool: Tool,
    providerPubkey: string
  ): void {
    try {
      ToolSchema.parse(tool);
      this.tools.set(toolId, { tool, providerPubkey });
      this.registerWithMcp(toolId, tool);
    } catch (error) {
      console.error(`Invalid MCP tool format for ${toolId}:`, error);
      throw error;
    }
  }

  public getToolInfo(toolId: string) {
    return this.tools.get(toolId);
  }

  public getTool(toolId: string): Tool | undefined {
    return this.tools.get(toolId)?.tool;
  }

  public listTools(): Tool[] {
    return Array.from(this.tools.values()).map(({ tool }) => tool);
  }

  public clear(): void {
    // Remove all tools except built-in tools
    for (const [id, info] of this.tools.entries()) {
      if (!info.isBuiltIn) {
        this.tools.delete(id);
      }
    }
  }

  private registerWithMcp(toolId: string, tool: Tool, isBuiltIn = false): void {
    try {
      this.mcpServer.tool(
        toolId,
        tool.description ?? '',
        this.mapJsonSchemaToZod(tool.inputSchema),
        async (args: unknown) => {
          try {
            let result;

            const toolInfo = this.tools.get(toolId);

            // Handle built-in tools directly, otherwise use the execution callback
            if (toolInfo?.isBuiltIn) {
              result = await this.executeBuiltInTool(toolId, args);
            } else {
              result = await this.executionCallback?.(toolId, args);
            }

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
      loggerDiscovery('Tool registered successfully:', toolId);
    } catch (error) {
      // TODO: Handle collisions more intelligently, by keeping the newest
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
      this.tools.set(toolId, { tool, isBuiltIn: true });
      this.registerWithMcp(toolId, tool, true);
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
  ): Promise<unknown> {
    const builtInTool = builtInToolRegistry.getTool(toolId);
    if (!builtInTool) {
      throw new Error(`Built-in tool ${toolId} not found`);
    }

    return builtInTool.execute(args);
  }

  private executionCallback?: (
    toolId: string,
    args: unknown
  ) => Promise<unknown>;

  public setExecutionCallback(
    callback: (toolId: string, args: unknown) => Promise<unknown>
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
