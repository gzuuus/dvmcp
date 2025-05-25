import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { DvmcpBridgeConfig } from './config-schema';
import { loggerBridge } from '@dvmcp/commons/core';
import {
  type CallToolResult,
  type GetPromptResult,
  type ListPromptsResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
  type Implementation,
  type ServerCapabilities,
  type CompleteRequest,
  type CompleteResult,
  CompleteResultSchema,
  type ListResourceTemplatesResult,
} from '@modelcontextprotocol/sdk/types.js';

export class MCPClientHandler {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(
    config: DvmcpBridgeConfig['mcp']['servers'][0],
    clientName: string,
    clientVersion: string
  ) {
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

  async listResources(): Promise<ListResourcesResult> {
    return await this.client.listResources();
  }

  async listResourceTemplates(): Promise<ListResourceTemplatesResult> {
    return await this.client.listResourceTemplates();
  }

  async readResource(
    resourceUri: string
  ): Promise<ReadResourceResult | undefined> {
    return await this.client.readResource({ uri: resourceUri });
  }

  async listPrompts(): Promise<ListPromptsResult> {
    return await this.client.listPrompts();
  }

  async getPrompt(
    promptName: string,
    args?: Record<string, any>
  ): Promise<GetPromptResult | undefined> {
    return await this.client.getPrompt({
      name: promptName,
      arguments: args,
    });
  }

  async callTool(
    name: string,
    args: Record<string, any>
  ): Promise<CallToolResult | undefined> {
    const result = (await this.client.callTool({
      name,
      arguments: args,
    })) as CallToolResult | undefined;
    return result;
  }

  async complete(
    params: CompleteRequest['params']
  ): Promise<CompleteResult | undefined> {
    const capabilities = this.getServerCapabilities();
    if (!capabilities.completions) {
      loggerBridge('Completions not supported by MCP server');
      return undefined;
    }

    try {
      return await this.client.request(
        { method: 'completion/complete', params },
        CompleteResultSchema
      );
    } catch (error) {
      loggerBridge('Error calling completion/complete:', error);
      throw error;
    }
  }

  async disconnect() {
    await this.transport.close();
  }
}

export const listResources = (
  handler: MCPClientHandler
): Promise<ListResourcesResult> => handler.listResources();

export const readResource = (
  handler: MCPClientHandler,
  uri: string
): Promise<ReadResourceResult | undefined> => handler.readResource(uri);

export const listPrompts = (
  handler: MCPClientHandler
): Promise<ListPromptsResult> => handler.listPrompts();

export const listTools = (
  handler: MCPClientHandler
): Promise<ListToolsResult> => handler.listTools();

export const getPrompt = (
  handler: MCPClientHandler,
  name: string,
  args?: Record<string, any>
): Promise<GetPromptResult | undefined> => handler.getPrompt(name, args);

export const callTool = (
  handler: MCPClientHandler,
  name: string,
  args: Record<string, any>
): Promise<CallToolResult | undefined> => handler.callTool(name, args);

export const complete = (
  handler: MCPClientHandler,
  params: CompleteRequest['params']
): Promise<CompleteResult | undefined> => handler.complete(params);
