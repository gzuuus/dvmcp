import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export class ToolRegistry {
  private discoveredTools: Map<string, Tool> = new Map();

  constructor(private mcpServer: McpServer) {}

  public registerTool(toolId: string, tool: Tool): void {
    try {
      ToolSchema.parse(tool);
      this.discoveredTools.set(toolId, tool);
      this.registerWithMcp(toolId, tool);
    } catch (error) {
      console.error(`Invalid MCP tool format for ${toolId}:`, error);
      throw error;
    }
  }

  public getTool(toolId: string): Tool | undefined {
    return this.discoveredTools.get(toolId);
  }

  public listTools(): Tool[] {
    return Array.from(this.discoveredTools.values());
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
      console.log('Tool registered successfully:', toolId);
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
    const properties: z.ZodRawShape = {};
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (typeof prop === 'object' && prop && 'type' in prop) {
          switch (prop.type) {
            case 'string':
              properties[key] = z.string();
              break;
            case 'number':
              properties[key] = z.number();
              break;
            case 'integer':
              properties[key] = z.number().int();
              break;
            case 'boolean':
              properties[key] = z.boolean();
              break;
            default:
              properties[key] = z.any();
          }
        }
      }
    }
    return properties;
  }
}
