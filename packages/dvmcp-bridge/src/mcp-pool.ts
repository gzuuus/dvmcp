import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCPClientHandler } from './mcp-client';
import type { MCPServerConfig } from './types';

export class MCPPool {
  private clients: Map<string, MCPClientHandler> = new Map();
  private toolRegistry: Map<string, MCPClientHandler> = new Map();
  private toolPricing: Map<string, { price?: string; unit?: string }> =
    new Map();
  private serverConfigs: Map<string, MCPServerConfig> = new Map();

  constructor(serverConfigs: MCPServerConfig[]) {
    serverConfigs.forEach((config) => {
      const client = new MCPClientHandler(config);
      this.clients.set(config.name, client);
      // Store the server config for later reference
      this.serverConfigs.set(config.name, config);

      // Register tool pricing if available
      if (config.tools && config.tools.length > 0) {
        config.tools.forEach((tool) => {
          if (tool.price || tool.unit) {
            this.toolPricing.set(tool.name, {
              price: tool.price,
              unit: tool.unit,
            });
          }
        });
      }
    });
  }

  async connect() {
    await Promise.all(
      Array.from(this.clients.values()).map((client) => client.connect())
    );
  }

  async listTools(): Promise<Tool[]> {
    const allTools: Tool[] = [];
    for (const client of this.clients.values()) {
      const tools = await client.listTools();
      tools.forEach((tool) => {
        this.toolRegistry.set(tool.name, client);
        allTools.push(tool);
      });
    }
    return allTools;
  }

  async callTool(name: string, args: Record<string, any>) {
    const client = this.toolRegistry.get(name);
    if (!client) {
      console.error(`No MCP server found for tool: ${name}`);
      return;
    }
    return await client.callTool(name, args);
  }

  getToolPricing(
    toolName: string
  ): { price?: string; unit?: string } | undefined {
    return this.toolPricing.get(toolName);
  }

  /**
   * Get the environment variables for a specific server
   * @param serverName - Name of the server
   * @returns Environment variables for the server or undefined if not found
   */
  getServerEnvironment(serverName: string): Record<string, string> | undefined {
    const config = this.serverConfigs.get(serverName);
    return config?.env;
  }

  /**
   * Get all server configurations
   * @returns Array of server configurations
   */
  getServerConfigs(): MCPServerConfig[] {
    return Array.from(this.serverConfigs.values());
  }

  async disconnect() {
    await Promise.all(
      Array.from(this.clients.values()).map((client) => client.disconnect())
    );
  }
}
