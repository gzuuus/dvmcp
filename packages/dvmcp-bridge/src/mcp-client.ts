import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CONFIG } from './config';
import type { MCPServerConfig } from './types';
import { loggerBridge } from '@dvmcp/commons/logger';
import type {
  Implementation,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';

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

    this.client = new Client({
      name: CONFIG.mcp.clientName,
      version: CONFIG.mcp.clientVersion,
    });
  }

  getServerCapabilities() {
    return this.client.getServerCapabilities() as ServerCapabilities;
  }

  getServerVersion() {
    return this.client.getServerVersion() as Implementation;
  }

  getServerInstructions() {
    return this.client.getInstructions();
  }

  async connect() {
    await this.client.connect(this.transport);
    loggerBridge(
      'Connected to MCP server',
      this.client.getServerCapabilities(),
      this.client.getServerVersion()
    );
  }

  async listTools() {
    return (await this.client.listTools()).tools;
  }

  /**
   * List resources exposed by the connected MCP server.
   * Returns the full protocol object: { resources: ResourceType[] }
   */
  async listResources() {
    // Protocol: returns { resources: [ ... ] }
    return await this.client.listResources();
  }

  /**
   * Read the content of a specific resource by its URI or ID.
   * @param resourceUriOrId Resource URI or unique identifier
   * @returns Resource data per protocol/SDK
   */
  async readResource(resourceUriOrId: string) {
    // Pass the parameter as { uri: string }
    return await this.client.readResource({ uri: resourceUriOrId });
  }

  /**
   * List prompts exposed by the connected MCP server.
   * Returns the full protocol object: { prompts: PromptType[] }
   */
  async listPrompts() {
    // Protocol: returns { prompts: [ ... ] }
    return await this.client.listPrompts();
  }

  /**
   * Get details for a specific prompt by ID or name.
   * @param promptIdOrName Prompt id (string) or name
   * @returns Prompt data per protocol/SDK
   */
  async getPrompt(promptIdOrName: string) {
    // Pass the parameter as { name: string }
    return await this.client.getPrompt({ name: promptIdOrName });
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

// Explicitly export resource and prompt methods per refactor protocol
/**
 * Explicitly exported resource and prompt methods for MCP pool.
 * Each function takes an MCPClientHandler instance (handler) as first argument.
 */
export const listResources = (handler: MCPClientHandler) =>
  handler.listResources();
export const readResource = (handler: MCPClientHandler, uriOrId: string) =>
  handler.readResource(uriOrId);
export const listPrompts = (handler: MCPClientHandler) => handler.listPrompts();
export const getPrompt = (handler: MCPClientHandler, idOrName: string) =>
  handler.getPrompt(idOrName);
