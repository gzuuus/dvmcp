import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CONFIG } from './config';
import type { MCPServerConfig } from './types';
import { loggerBridge } from '@dvmcp/commons/logger';

export class MCPClientHandler {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(config: MCPServerConfig) {
    const mergedEnv = this.prepareEnvironmentVariables(config.env);

    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: mergedEnv,
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
    loggerBridge('Connected to MCP server');
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

  /**
   * Prepare environment variables by merging custom env with process.env
   * @param customEnv - Custom environment variables to merge
   * @returns Merged environment variables or undefined if no custom env
   */
  private prepareEnvironmentVariables(
    customEnv?: Record<string, string>
  ): Record<string, string> | undefined {
    if (!customEnv) return undefined;

    // Convert process.env to Record<string, string> by filtering out undefined values
    const processEnv: Record<string, string> = {};
    Object.entries(process.env).forEach(([key, value]) => {
      if (value !== undefined) {
        processEnv[key] = value;
      }
    });

    // Merge with custom environment variables
    return { ...processEnv, ...customEnv };
  }
}
