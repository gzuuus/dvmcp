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
} from '@modelcontextprotocol/sdk/types.js';
import { MCPClientHandler } from './mcp-client';
import {
  dvmcpBridgeConfigSchema,
  type DvmcpBridgeConfig,
} from './config-schema';
import { slugify } from './utils';
import { loggerBridge } from '@dvmcp/commons/logger';
export class MCPPool {
  private clients: Map<string, MCPClientHandler> = new Map();
  private toolRegistry: Map<string, MCPClientHandler> = new Map();
  private resourceRegistry: Map<string, MCPClientHandler> = new Map();
  private promptRegistry: Map<string, MCPClientHandler> = new Map();
  private toolPricing: Map<string, { price?: string; unit?: string }> =
    new Map();
  private serverConfigs: Map<string, DvmcpBridgeConfig['mcp']['servers'][0]> =
    new Map();

  constructor(
    private config: DvmcpBridgeConfig | DvmcpBridgeConfig['mcp']['servers']
  ) {
    // Handle both full config objects and direct server config arrays (for testing)
    let servers: DvmcpBridgeConfig['mcp']['servers'];

    // Get default values from the config schema
    const defaultName = dvmcpBridgeConfigSchema.mcp.fields.name
      .default as string;

    // Initialize with defaults
    let name = defaultName;
    let clientVersion = '1.0.0'; // No default in schema, using fallback

    if (Array.isArray(this.config)) {
      // For tests: direct array of server configs
      servers = this.config;
    } else {
      // Normal case: full config object
      servers = this.config.mcp.servers;
      name = this.config.mcp.name || defaultName;
      clientVersion = this.config.mcp.clientVersion || '1.0.0';
    }

    servers.forEach((serverConfig, index) => {
      // Generate a server ID based on index
      const serverId = `server-${index}`;

      // Create a copy of the server config with the generated ID
      const serverConfigWithId = { ...serverConfig, _serverId: serverId };

      const client = new MCPClientHandler(
        serverConfigWithId,
        slugify(name),
        clientVersion
      );

      // Use the generated server ID as the key
      this.clients.set(serverId, client);
      // Store the server config for later reference
      this.serverConfigs.set(serverId, serverConfigWithId);

      // Register tool pricing if available
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
    });
  }

  async connect() {
    await Promise.all(
      Array.from(this.clients.values()).map((client) => client.connect())
    );
  }

  /**
   * Aggregate tools from all connected clients and update registry.
   * @returns ListToolsResult containing tools array
   */
  async listTools(): Promise<ListToolsResult> {
    const allTools: Tool[] = [];
    this.toolRegistry.clear();
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.tools) {
        try {
          // Only attempt if client supports tools capability
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
      // If client does not advertise capability, skip.
    }

    // Return a properly structured ListToolsResult object
    return { tools: allTools };
  }

  /**
   * Aggregate resources from all connected clients, protocol-compliant, and update registry.
   * @returns ListResourcesResult containing resources array
   */
  async listResources(): Promise<ListResourcesResult> {
    const allResources: Resource[] = [];
    this.resourceRegistry.clear();
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.resources) {
        try {
          // Only attempt if client supports resources capability
          const resObj = await client.listResources();
          if (resObj && Array.isArray(resObj.resources)) {
            for (const resource of resObj.resources) {
              // Register by uri and name if available and type is string
              if (typeof resource.uri === 'string')
                this.resourceRegistry.set(resource.uri, client);
              if (typeof resource.name === 'string')
                this.resourceRegistry.set(resource.name, client);
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
      // If client does not advertise capability, skip.
    }

    // Return a properly structured ListResourcesResult object
    return { resources: allResources };
  }

  /**
   * Aggregate prompts from all connected clients, protocol-compliant, and update registry.
   * @returns ListPromptsResult containing the prompts array
   */
  async listPrompts(): Promise<ListPromptsResult> {
    const allPrompts: Prompt[] = [];
    this.promptRegistry.clear();
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.prompts) {
        try {
          // Catch per-client errors and continue processing others
          const promptResult = await client.listPrompts();
          if (promptResult && Array.isArray(promptResult.prompts)) {
            for (const prompt of promptResult.prompts) {
              // Register by name if available and type is string
              if (typeof prompt.name === 'string') {
                this.promptRegistry.set(prompt.name, client);
              }
              allPrompts.push(prompt);
            }
          }
        } catch (err) {
          // Log but continue aggregating other clients
          loggerBridge(
            `[listPrompts] Failed for client '${clientName}':`,
            (err as any)?.message || err
          );
        }
      }
    }

    // Return a properly structured ListPromptsResult object
    return { prompts: allPrompts };
  }

  /**
   * Find and return a resource matching the given URI, using the resource registry.
   * @param resourceUri - URI of the resource to retrieve
   * @returns ReadResourceResult containing the resource data
   */
  async readResource(
    resourceUri: string
  ): Promise<ReadResourceResult | undefined> {
    let handler = this.resourceRegistry.get(resourceUri);
    // If registry is not populated, refresh it
    if (!handler) {
      await this.listResources();
      handler = this.resourceRegistry.get(resourceUri);
    }
    if (!handler) {
      // Not found, but do not throw; return undefined for robustness
      loggerBridge(
        `[readResource] Resource handler not found for: ${resourceUri}`
      );
      return undefined;
    }

    try {
      // Catch backend errors (including missing capability) and log
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
      // Handle capability missing or -32601
      loggerBridge(
        `[readResource] Failed to read '${resourceUri}' from backend:`,
        err && (err.message || err)
      );
      return undefined;
    }
  }

  /**
   * Find and return a prompt matching the given name, using the prompt registry.
   * @param promptName - Name of the prompt to retrieve
   * @returns Prompt or undefined if not found
   */
  async getPrompt(promptName: string): Promise<GetPromptResult | undefined> {
    let handler = this.promptRegistry.get(promptName);
    // If registry is not populated, refresh it
    if (!handler) {
      await this.listPrompts();
      handler = this.promptRegistry.get(promptName);
    }
    if (!handler) {
      // Not found, log and return undefined
      loggerBridge(`[getPrompt] Prompt handler not found for: ${promptName}`);
      return undefined;
    }

    try {
      // Catch errors due to missing backend capability
      const result: GetPromptResult | undefined =
        await handler.getPrompt(promptName);
      loggerBridge('prompt get result', result);

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
  /**
   * Call a tool by name with the given arguments
   * @param name - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @returns CallToolResult containing the result or error information
   */
  async callTool(
    name: string,
    args: Record<string, any>
  ): Promise<CallToolResult> {
    // First check if we have a specific client registered for this tool
    const client = this.toolRegistry.get(name);

    if (!client) {
      loggerBridge(`[callTool] No client found for tool: ${name}`);
      return {
        content: [
          {
            type: 'text',
            text: `Tool not found: ${name}`,
          },
        ],
        isError: true,
        _meta: {
          error: {
            code: -32601,
            message: `Tool not found: ${name}`,
          },
        },
      };
    }

    try {
      // Wrap backend call in try/catch to intercept capability/other errors
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

  getToolPricing(
    toolName: string
  ): { price?: string; unit?: string } | undefined {
    return this.toolPricing.get(toolName);
  }

  /**
   * Get all available clients
   * @returns Array of all MCPClientHandler instances
   */
  getAllClients(): MCPClientHandler[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get the default client for general operations
   * This method prioritizes clients with more capabilities
   * @returns The most capable client, or undefined if no clients are available
   */
  getDefaultClient(): MCPClientHandler | undefined {
    // If there's only one client, return it
    if (this.clients.size === 1) {
      return this.clients.values().next().value;
    }

    // Otherwise, find the client with the most capabilities
    const allClients = this.getAllClients();
    if (allClients.length === 0) return undefined;

    return allClients.reduce((bestClient, currentClient) => {
      const bestCaps = bestClient.getServerCapabilities();
      const currentCaps = currentClient.getServerCapabilities();

      // Count the number of capabilities for each client
      const bestCapCount = Object.values(bestCaps || {}).filter(Boolean).length;
      const currentCapCount = Object.values(currentCaps || {}).filter(
        Boolean
      ).length;

      return currentCapCount > bestCapCount ? currentClient : bestClient;
    }, allClients[0]);
  }

  /**
   * Get all server configurations
   * @returns Array of server configurations
   */
  getServerConfigs(): DvmcpBridgeConfig['mcp']['servers'] {
    return Array.from(this.serverConfigs.values());
  }

  /**
   * Get the environment variables for a specific server
   * @param serverName - Name of the server
   * @returns Environment variables for the server or undefined if not found
   */
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
