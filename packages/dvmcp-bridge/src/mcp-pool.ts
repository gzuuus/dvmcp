import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCPClientHandler } from './mcp-client';
import type { MCPServerConfig } from './types';

export class MCPPool {
  private clients: Map<string, MCPClientHandler> = new Map();
  private toolRegistry: Map<string, MCPClientHandler> = new Map();

  constructor(serverConfigs: MCPServerConfig[]) {
    serverConfigs.forEach((config) => {
      const client = new MCPClientHandler(config);
      this.clients.set(config.name, client);
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
      });
      allTools.push(...tools);
    }
    return allTools;
  }

  async callTool(name: string, args: Record<string, any>) {
    const client = this.toolRegistry.get(name);
    if (!client) {
      throw new Error(`No MCP server found for tool: ${name}`);
    }
    return await client.callTool(name, args);
  }

  async disconnect() {
    await Promise.all(
      Array.from(this.clients.values()).map((client) => client.disconnect())
    );
  }
}
