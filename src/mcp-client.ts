import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CONFIG } from './config';
import type { MCPServerConfig } from './types';

export class MCPClientHandler {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(config: MCPServerConfig) {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
    });
    this.client = new Client(
      {
        name: CONFIG.mcp.clientName,
        version: CONFIG.mcp.clientVersion,
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      }
    );
  }

  async connect() {
    await this.client.connect(this.transport);
    console.log('Connected to MCP server');
  }

  async listTools() {
    return (await this.client.listTools()).tools;
  }

  async callTool(name: string, args: Record<string, any>) {
    return await this.client.callTool({
      name,
      arguments: args,
    });
  }

  async disconnect() {
    await this.transport.close();
  }
}
