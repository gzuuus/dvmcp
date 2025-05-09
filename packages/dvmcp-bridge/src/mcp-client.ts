import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { DvmcpBridgeConfig } from './config-schema';
import { loggerBridge } from '@dvmcp/commons/logger';
import type {
  CallToolResult,
  GetPromptResult,
  ListPromptsResult,
  ListResourcesResult,
  ListToolsResult,
  ReadResourceResult,
  Implementation,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';

export class MCPClientHandler {
  private client: Client;
  private transport: StdioClientTransport;

  /**
   * @param config - Server configuration from DvmcpBridgeConfig (per-server process launch/config)
   * @param clientName - Unified client name from schema config (config.mcp.clientName)
   * @param clientVersion - Unified client version from schema config (config.mcp.clientVersion)
   */
  constructor(
    config: DvmcpBridgeConfig['mcp']['servers'][0],
    clientName: string,
    clientVersion: string
  ) {
    // Only use the explicit env provided in config (do not merge with process.env)
    const envVars = config.env ? { ...config.env } : undefined;

    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: envVars,
    });

    this.client = new Client({
      name: clientName,
      version: clientVersion,
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

  async listTools(): Promise<ListToolsResult> {
    return await this.client.listTools();
  }

  /**
   * List resources exposed by the connected MCP server.
   * @returns ListResourcesResult containing resources array
   */
  async listResources(): Promise<ListResourcesResult> {
    return await this.client.listResources();
  }

  /**
   * Read the content of a specific resource by its URI or ID.
   * @param resourceUriOrId Resource URI or unique identifier
   * @returns ReadResourceResult containing the resource data
   */
  async readResource(
    resourceUriOrId: string
  ): Promise<ReadResourceResult | undefined> {
    return await this.client.readResource({ uri: resourceUriOrId });
  }

  /**
   * List prompts exposed by the connected MCP server.
   * @returns ListPromptsResult containing prompts array
   */
  async listPrompts(): Promise<ListPromptsResult> {
    return await this.client.listPrompts();
  }

  /**
   * Get details for a specific prompt by name.
   * @param promptName Prompt name
   * @returns Prompt data per protocol/SDK
   */
  async getPrompt(promptName: string): Promise<GetPromptResult | undefined> {
    // Pass the parameter as { name: string }
    return await this.client.getPrompt({ name: promptName });
  }

  /**
   * Call a tool by name with the given arguments
   * @param name Name of the tool to call
   * @param args Arguments to pass to the tool
   * @returns CallToolResult containing the result from the tool execution
   */
  async callTool(
    name: string,
    args: Record<string, any>
  ): Promise<CallToolResult | undefined> {
    // Use type assertion to handle the SDK's return type
    const result = (await this.client.callTool({
      name,
      arguments: args,
    })) as CallToolResult | undefined;
    return result;
  }

  async disconnect() {
    await this.transport.close();
  }
}

// Explicitly export resource and prompt methods per refactor protocol
/**
 * Explicitly exported resource and prompt methods for MCP pool.
 * Each function takes an MCPClientHandler instance (handler) as first argument.
 */
export const listResources = (
  handler: MCPClientHandler
): Promise<ListResourcesResult> => handler.listResources();

export const readResource = (
  handler: MCPClientHandler,
  uriOrId: string
): Promise<ReadResourceResult | undefined> => handler.readResource(uriOrId);

export const listPrompts = (
  handler: MCPClientHandler
): Promise<ListPromptsResult> => handler.listPrompts();

export const listTools = (
  handler: MCPClientHandler
): Promise<ListToolsResult> => handler.listTools();

export const getPrompt = (
  handler: MCPClientHandler,
  name: string
): Promise<GetPromptResult | undefined> => handler.getPrompt(name);

export const callTool = (
  handler: MCPClientHandler,
  name: string,
  args: Record<string, any>
): Promise<CallToolResult | undefined> => handler.callTool(name, args);
