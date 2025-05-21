import type {
  CallToolResult,
  GetPromptResult,
  ListPromptsResult,
  ListResourcesResult,
  ListToolsResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
  CompleteRequest,
  CompleteResult,
} from '@modelcontextprotocol/sdk/types.js';
import { MCPClientHandler } from './mcp-client';
import {
  dvmcpBridgeConfigSchema,
  type DvmcpBridgeConfig,
} from './config-schema';
import { loggerBridge } from '@dvmcp/commons/logger';
import { slugify } from '@dvmcp/commons/utils';

export class MCPPool {
  private clients: Map<string, MCPClientHandler> = new Map();
  private toolRegistry: Map<string, MCPClientHandler> = new Map();
  private resourceRegistry: Map<string, MCPClientHandler> = new Map();
  private promptRegistry: Map<string, MCPClientHandler> = new Map();
  private completionCapableServers: Map<string, MCPClientHandler> = new Map();
  private toolPricing: Map<string, { price?: string; unit?: string }> =
    new Map();
  private promptPricing: Map<string, { price?: string; unit?: string }> =
    new Map();
  private resourcePricing: Map<string, { price?: string; unit?: string }> =
    new Map();
  private serverConfigs: Map<string, DvmcpBridgeConfig['mcp']['servers'][0]> =
    new Map();

  constructor(
    private config: DvmcpBridgeConfig | DvmcpBridgeConfig['mcp']['servers']
  ) {
    // Handle both full config objects and direct server config arrays (for testing)
    let servers: DvmcpBridgeConfig['mcp']['servers'];

    const defaultName = dvmcpBridgeConfigSchema.mcp.fields?.name
      .default as string;

    let name = defaultName;
    let clientVersion = '1.0.0';

    if (Array.isArray(this.config)) {
      servers = this.config;
    } else {
      servers = this.config.mcp.servers;
      name = this.config.mcp.name || defaultName;
      clientVersion = this.config.mcp.clientVersion || '1.0.0';
    }

    servers.forEach((serverConfig, index) => {
      const serverId = `server-${index}`;

      const serverConfigWithId = { ...serverConfig, _serverId: serverId };

      const client = new MCPClientHandler(
        serverConfigWithId,
        slugify(name),
        clientVersion
      );

      this.clients.set(serverId, client);
      this.serverConfigs.set(serverId, serverConfigWithId);
      if (serverConfig.tools && serverConfig.tools.length > 0) {
        serverConfig.tools.forEach((tool) => {
          if (tool.price || tool.unit) {
            this.toolPricing.set(tool.name, {
              price: tool.price,
              unit: tool.unit,
            });
          }
        });
      }

      if (serverConfig.prompts && serverConfig.prompts.length > 0) {
        serverConfig.prompts.forEach((prompt) => {
          if (prompt.price || prompt.unit) {
            this.promptPricing.set(prompt.name, {
              price: prompt.price,
              unit: prompt.unit,
            });
          }
        });
      }

      if (serverConfig.resources && serverConfig.resources.length > 0) {
        serverConfig.resources.forEach((resource) => {
          if (resource.price || resource.unit) {
            this.resourcePricing.set(resource.uri, {
              price: resource.price,
              unit: resource.unit,
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

    // Identify servers that support completions
    for (const [clientId, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.completions) {
        this.completionCapableServers.set(clientId, client);
        loggerBridge(`Server ${clientId} supports completions capability`);
      }
    }
  }

  async listTools(): Promise<ListToolsResult> {
    const allTools: Tool[] = [];
    this.toolRegistry.clear();
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.tools) {
        try {
          const toolsResult = await client.listTools();
          if (toolsResult && Array.isArray(toolsResult.tools)) {
            for (const tool of toolsResult.tools) {
              this.toolRegistry.set(tool.name, client);
              allTools.push(tool);
            }
          }
        } catch (err) {
          loggerBridge(
            `[listTools] Failed for client '${clientName}':`,
            (err as any)?.message || err
          );
        }
      }
    }
    return { tools: allTools };
  }

  async listResources(): Promise<ListResourcesResult> {
    const allResources: Resource[] = [];
    this.resourceRegistry.clear();
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.resources) {
        try {
          const resObj = await client.listResources();
          if (resObj && Array.isArray(resObj.resources)) {
            for (const resource of resObj.resources) {
              if (typeof resource.uri === 'string')
                this.resourceRegistry.set(resource.uri, client);
              allResources.push(resource);
            }
          }
        } catch (err) {
          loggerBridge(
            `[listResources] Failed for client '${clientName}':`,
            (err as any)?.message || err
          );
        }
      }
    }
    return { resources: allResources };
  }

  async listPrompts(): Promise<ListPromptsResult> {
    const allPrompts: Prompt[] = [];
    this.promptRegistry.clear();
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.prompts) {
        try {
          const promptResult = await client.listPrompts();
          if (promptResult && Array.isArray(promptResult.prompts)) {
            for (const prompt of promptResult.prompts) {
              if (typeof prompt.name === 'string') {
                this.promptRegistry.set(prompt.name, client);
              }
              allPrompts.push(prompt);
            }
          }
        } catch (err) {
          loggerBridge(
            `[listPrompts] Failed for client '${clientName}':`,
            (err as any)?.message || err
          );
        }
      }
    }
    return { prompts: allPrompts };
  }

  private async ensureHandler<K extends string>(
    registry: Map<K, MCPClientHandler>,
    key: K,
    refreshMethod: () => Promise<any>
  ): Promise<MCPClientHandler | undefined> {
    let handler = registry.get(key);
    if (handler) return handler;

    if (registry.size === 0 || !handler) {
      await refreshMethod();
      return registry.get(key);
    }
  }

  async readResource(
    resourceUri: string
  ): Promise<ReadResourceResult | undefined> {
    const handler = await this.ensureHandler(
      this.resourceRegistry,
      resourceUri,
      () => this.listResources()
    );

    if (!handler) {
      loggerBridge(
        `[readResource] Resource handler not found for: ${resourceUri}`
      );
      return undefined;
    }

    try {
      const result: ReadResourceResult | undefined =
        await handler.readResource(resourceUri);
      if (!result) {
        loggerBridge(
          `[readResource] Empty result for resource: ${resourceUri}`
        );
        return undefined;
      }

      return result;
    } catch (err: any) {
      loggerBridge(
        `[readResource] Failed to read '${resourceUri}' from backend:`,
        err && (err.message || err)
      );
      return undefined;
    }
  }

  async getPrompt(
    promptName: string,
    args?: Record<string, any>
  ): Promise<GetPromptResult | undefined> {
    const handler = await this.ensureHandler(
      this.promptRegistry,
      promptName,
      () => this.listPrompts()
    );

    if (!handler) {
      loggerBridge(`[getPrompt] Prompt handler not found for: ${promptName}`);
      return undefined;
    }

    try {
      const result: GetPromptResult | undefined = await handler.getPrompt(
        promptName,
        args
      );
      loggerBridge('prompt get result with args:', args, result);

      if (!result) {
        loggerBridge(`[getPrompt] Empty result for prompt: ${promptName}`);
        return undefined;
      }

      loggerBridge('created prompt from SDK result', result);
      return result;
    } catch (err: any) {
      loggerBridge(
        `[getPrompt] Failed to get prompt '${promptName}' from backend:`,
        err && (err.message || err)
      );
      return undefined;
    }
  }

  async callTool(
    name: string,
    args: Record<string, any>
  ): Promise<CallToolResult> {
    const client = await this.ensureHandler(this.toolRegistry, name, () =>
      this.listTools()
    );

    if (!client) {
      loggerBridge(`[callTool] No client found for tool: ${name}`);
      return {
        content: [{ type: 'text', text: `Tool not found: ${name}` }],
        isError: true,
        _meta: { error: { code: -32601, message: `Tool not found: ${name}` } },
      };
    }

    try {
      const result: CallToolResult | undefined = await client.callTool(
        name,
        args
      );
      loggerBridge(`[callTool] Result for tool '${name}':`, result);
      if (!result) {
        loggerBridge(`[callTool] Empty result for tool: ${name}`);
        return {
          content: [
            {
              type: 'text',
              text: `Empty result for tool: ${name}`,
            },
          ],
          isError: true,
          _meta: {
            error: {
              code: -32601,
              message: `Empty result for tool: ${name}`,
            },
          },
        };
      }
      return result;
    } catch (err: any) {
      loggerBridge(
        `[callTool] Failed to call tool '${name}':`,
        err && (err.message || err)
      );
      return {
        content: [
          {
            type: 'text',
            text: `Failed to call tool: ${err?.message || err}`,
          },
        ],
        isError: true,
        _meta: {
          error: {
            code: err?.code || -32000,
            message: `Failed to call tool: ${err?.message || err}`,
          },
        },
      };
    }
  }

  /**
   * Handle a completion request for a prompt or resource argument
   * @param params - Completion request parameters
   * @returns Completion result with suggested values or undefined if not supported
   */
  async complete(
    params: CompleteRequest['params']
  ): Promise<CompleteResult | undefined> {
    const { ref } = params;
    let handler: MCPClientHandler | undefined;

    // Find the appropriate handler based on the reference type
    if (ref.type === 'ref/prompt') {
      handler = await this.ensureHandler(this.promptRegistry, ref.name, () =>
        this.listPrompts()
      );

      if (!handler) {
        loggerBridge(`[complete] Prompt handler not found for: ${ref.name}`);
        return undefined;
      }
    } else if (ref.type === 'ref/resource') {
      handler = await this.ensureHandler(this.resourceRegistry, ref.uri, () =>
        this.listResources()
      );

      if (!handler) {
        loggerBridge(`[complete] Resource handler not found for: ${ref.uri}`);
        return undefined;
      }
    } else {
      loggerBridge(`[complete] Unsupported reference type`);
      return undefined;
    }

    // Check if the handler supports completions
    const caps = handler.getServerCapabilities();
    if (!caps.completions) {
      loggerBridge(
        `[complete] Server does not support completions for ${ref.type === 'ref/prompt' ? ref.name : ref.uri}`
      );
      return undefined;
    }

    try {
      // Call the completion method on the handler
      loggerBridge(
        `[complete] Result for ${ref.type === 'ref/prompt' ? ref.name : ref.uri}`
      );
      return await handler.complete(params);
    } catch (err: any) {
      loggerBridge(
        `[complete] Failed to get completions:`,
        err && (err.message || err)
      );
      return undefined;
    }
  }

  getToolPricing(
    toolName: string
  ): { price?: string; unit?: string } | undefined {
    return this.toolPricing.get(toolName);
  }

  getPromptPricing(
    promptName: string
  ): { price?: string; unit?: string } | undefined {
    return this.promptPricing.get(promptName);
  }

  getResourcePricing(
    resourceUri: string
  ): { price?: string; unit?: string } | undefined {
    return this.resourcePricing.get(resourceUri);
  }

  getAllClients(): MCPClientHandler[] {
    return Array.from(this.clients.values());
  }

  getDefaultClient(): MCPClientHandler | undefined {
    if (this.clients.size === 1) {
      return this.clients.values().next().value;
    }

    const allClients = this.getAllClients();
    if (allClients.length === 0) return undefined;

    return allClients.reduce((bestClient, currentClient) => {
      const bestCaps = bestClient.getServerCapabilities();
      const currentCaps = currentClient.getServerCapabilities();

      const bestCapCount = Object.values(bestCaps || {}).filter(Boolean).length;
      const currentCapCount = Object.values(currentCaps || {}).filter(
        Boolean
      ).length;

      return currentCapCount > bestCapCount ? currentClient : bestClient;
    }, allClients[0]);
  }

  getServerConfigs(): DvmcpBridgeConfig['mcp']['servers'] {
    return Array.from(this.serverConfigs.values());
  }

  getServerEnvironment(serverName: string): Record<string, string> | undefined {
    const serverConfig = this.serverConfigs.get(serverName);
    return serverConfig?.env;
  }

  async disconnect() {
    await Promise.all(
      Array.from(this.clients.values()).map((client) => client.disconnect())
    );
  }
}
