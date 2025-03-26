import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerDiscovery } from '@dvmcp/commons/logger';

export class ToolRegistry {
  private discoveredTools: Map<string, { tool: Tool; providerPubkey: string }> =
    new Map();

  constructor(private mcpServer: McpServer) {}

  public registerTool(
    toolId: string,
    tool: Tool,
    providerPubkey: string
  ): void {
    try {
      ToolSchema.parse(tool);
      this.discoveredTools.set(toolId, { tool, providerPubkey });
      this.registerWithMcp(toolId, tool);
    } catch (error) {
      console.error(`Invalid MCP tool format for ${toolId}:`, error);
      throw error;
    }
  }

  public getToolInfo(toolId: string) {
    return this.discoveredTools.get(toolId);
  }

  public getTool(toolId: string): Tool | undefined {
    return this.discoveredTools.get(toolId)?.tool;
  }

  public listTools(): Tool[] {
    return Array.from(this.discoveredTools.values()).map(({ tool }) => tool);
  }

  public clear(): void {
    this.discoveredTools.clear();
  }

  private registerWithMcp(toolId: string, tool: Tool): void {
    try {
      this.mcpServer.tool(
        toolId,
        tool.description ?? '',
        this.mapJsonSchemaToZod(tool.inputSchema),
        async (args: unknown) => {
          try {
            const result = await this.executionCallback?.(toolId, args);
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
      console.error('Error registering tool:', toolId, error);
    }
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
