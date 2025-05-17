import { type Tool, type Resource } from '@modelcontextprotocol/sdk/types.js';
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
      serverId?: string;
    }
  > = new Map();

  // Store server information
  private servers: Map<
    string,
    {
      pubkey: string;
      content: string;
      metadata?: any;
    }
  > = new Map();

  // Store resources by server ID
  private resources: Map<string, Resource[]> = new Map();

  constructor(private mcpServer: McpServer) {}

  public registerTool(
    toolId: string,
    tool: Tool,
    providerPubkey: string,
    serverId?: string
  ): void {
    try {
      ToolSchema.parse(tool);
      this.tools.set(toolId, { tool, providerPubkey, serverId });
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

  public listToolsWithIds(): [string, Tool][] {
    return Array.from(this.tools.entries()).map(([id, info]) => [
      id,
      info.tool,
    ]);
  }

  public clear(): void {
    // Remove all tools except built-in tools
    for (const [id, info] of this.tools.entries()) {
      if (!info.isBuiltIn) {
        this.tools.delete(id);
      }
    }
  }

  /**
   * Remove a tool from the registry
   * @param toolId - ID of the tool to remove
   * @returns true if the tool was removed, false if it wasn't found
   */
  /**
   * Remove a tool from the registry by its ID
   * @param toolId - ID of the tool to remove
   * @returns true if the tool was removed, false if it wasn't found
   */
  public removeTool(toolId: string): boolean {
    const toolInfo = this.tools.get(toolId);

    // If tool doesn't exist, return false
    if (!toolInfo) {
      loggerDiscovery(`Tool not found for removal: ${toolId}`);
      return false;
    }

    // Remove the tool from the registry
    this.tools.delete(toolId);
    loggerDiscovery(`Tool removed from registry: ${toolId}`);

    // Note: The MCP server doesn't have a direct method to remove tools
    // The tool list changed notification will be handled by the discovery server
    return true;
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
    const removedToolIds: string[] = [];

    // Find all tools from this provider
    for (const [id, info] of this.tools.entries()) {
      // Skip built-in tools if excludeBuiltIn is true
      if (excludeBuiltIn && info.isBuiltIn) {
        continue;
      }

      // Check if this tool belongs to the specified provider
      if (info.providerPubkey === providerPubkey) {
        // Remove the tool
        this.tools.delete(id);
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
    const removedToolIds: string[] = [];

    // Find all tools matching the pattern
    for (const [id, info] of this.tools.entries()) {
      // Skip built-in tools if excludeBuiltIn is true
      if (excludeBuiltIn && info.isBuiltIn) {
        continue;
      }

      // Check if this tool ID matches the pattern
      if (pattern.test(id)) {
        // Remove the tool
        this.tools.delete(id);
        removedToolIds.push(id);
        loggerDiscovery(`Removed tool ${id} matching pattern ${pattern}`);
      }
    }

    return removedToolIds;
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

  /**
   * Register a server with the registry
   * @param serverId - Server's unique identifier
   * @param pubkey - Provider's public key
   * @param content - Server announcement content
   * @param metadata - Optional metadata about the server
   */
  public registerServer(
    serverId: string,
    pubkey: string,
    content: string,
    metadata?: any
  ): void {
    this.servers.set(serverId, { pubkey, content, metadata });
    loggerDiscovery(`Registered server ${serverId} from ${pubkey}`);
  }

  /**
   * Get server information by ID
   * @param serverId - Server's unique identifier
   * @returns Server information or undefined if not found
   */
  public getServer(
    serverId: string
  ): { pubkey: string; content: string; metadata?: any } | undefined {
    return this.servers.get(serverId);
  }

  /**
   * List all registered servers
   * @returns Array of [serverId, serverInfo] pairs
   */
  public listServers(): [
    string,
    { pubkey: string; content: string; metadata?: any },
  ][] {
    return Array.from(this.servers.entries());
  }

  /**
   * Register resources for a server
   * @param serverId - Server's unique identifier
   * @param resources - Array of resources to register
   */
  public registerResources(serverId: string, resources: Resource[]): void {
    this.resources.set(serverId, resources);
    loggerDiscovery(
      `Registered ${resources.length} resources for server ${serverId}`
    );
  }

  /**
   * Get resources for a server
   * @param serverId - Server's unique identifier
   * @returns Array of resources or undefined if not found
   */
  public getResources(serverId: string): Resource[] | undefined {
    return this.resources.get(serverId);
  }

  /**
   * List all registered resources
   * @returns Array of [serverId, resources] pairs
   */
  public listResources(): [string, Resource[]][] {
    return Array.from(this.resources.entries());
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
