import type {
  Prompt,
  Resource,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { MCPClientHandler } from './mcp-client';
import type { MCPServerConfig } from './types';

export class MCPPool {
  private clients: Map<string, MCPClientHandler> = new Map();
  private toolRegistry: Map<string, MCPClientHandler> = new Map();
  private resourceRegistry: Map<string, MCPClientHandler> = new Map();
  private promptRegistry: Map<string, MCPClientHandler> = new Map();
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
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.tools) {
        try {
          // Only attempt if client supports tools capability
          const tools = await client.listTools();
          tools.forEach((tool) => {
            this.toolRegistry.set(tool.name, client);
            allTools.push(tool);
          });
        } catch (err) {
          console.warn(
            `[listTools] Failed for client '${clientName}':`,
            (err as any)?.message || err
          );
        }
      }
      // If client does not advertise capability, skip.
    }
    return allTools;
  }

  /**
   * Aggregate resources from all connected clients, protocol-compliant, and update registry.
   * @returns { resources: Resource[] }
   */
  async listResources(): Promise<Resource[]> {
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
          console.warn(
            `[listResources] Failed for client '${clientName}':`,
            (err as any)?.message || err
          );
        }
      }
      // If client does not advertise capability, skip.
    }
    return allResources;
  }

  /**
   * Aggregate prompts from all connected clients, protocol-compliant, and update registry.
   * @returns { prompts: Prompt[] }
   */
  async listPrompts(): Promise<Prompt[]> {
    const allPrompts: Prompt[] = [];
    this.promptRegistry.clear();
    for (const [clientName, client] of this.clients.entries()) {
      const caps = client.getServerCapabilities();
      if (caps && caps.prompts) {
        try {
          // Catch per-client errors and continue processing others
          const promptObj = await client.listPrompts();
          if (promptObj && Array.isArray(promptObj.prompts)) {
            for (const prompt of promptObj.prompts) {
              // Register by name if available and type is string
              if (typeof prompt.name === 'string')
                this.promptRegistry.set(prompt.name, client);
              allPrompts.push(prompt);
            }
          }
        } catch (err) {
          // Log but continue aggregating other clients
          // Use 'as any' to avoid TS error about 'message'
          console.warn(
            `[listPrompts] Failed for client '${clientName}':`,
            (err as any)?.message || err
          );
        }
      }
    }
    return allPrompts;
  }

  /**
   * Find and return a resource matching the given URI, using the resource registry.
   * @param resourceUri
   * @returns Resource or throws if not found
   */
  async readResource(resourceUri: string): Promise<Resource | undefined> {
    // Helper type guard
    function isResource(obj: unknown): obj is Resource {
      return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof (obj as Resource).name === 'string' &&
        typeof (obj as Resource).uri === 'string'
      );
    }

    let handler = this.resourceRegistry.get(resourceUri);
    // If registry is not populated, refresh it
    if (!handler) {
      await this.listResources();
      handler = this.resourceRegistry.get(resourceUri);
    }
    if (!handler) {
      // Not found, but do not throw; return undefined for robustness
      console.warn(
        `[readResource] Resource handler not found for: ${resourceUri}`
      );
      return undefined;
    }
    try {
      // Catch backend errors (including missing capability) and log
      const result = await handler.readResource(resourceUri);
      const out =
        result && typeof result === 'object' && 'resource' in result
          ? (result as unknown as { resource: unknown }).resource
          : result;
      if (isResource(out)) {
        return out;
      }
      // Not a valid resource, return undefined
      console.warn(
        `[readResource] Invalid resource structure for: ${resourceUri}`
      );
      return undefined;
    } catch (err: any) {
      // Handle capability missing or -32601
      console.warn(
        `[readResource] Failed to read '${resourceUri}' from backend:`,
        err && (err.message || err)
      );
      // Log but return undefined, preserving function signature/type.
      return undefined;
    }
  }

  /**
   * Find and return a prompt matching the given name, using the prompt registry.
   * @param promptName
   * @returns Prompt or throws if not found
   */
  async getPrompt(promptName: string): Promise<Prompt | undefined> {
    // Helper type guard
    function isPrompt(obj: unknown): obj is Prompt {
      return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof (obj as Prompt).name === 'string'
      );
    }

    let handler = this.promptRegistry.get(promptName);
    // If registry is not populated, refresh it
    if (!handler) {
      await this.listPrompts();
      handler = this.promptRegistry.get(promptName);
    }
    if (!handler) {
      // Not found, log and return undefined
      console.warn(`[getPrompt] Prompt handler not found for: ${promptName}`);
      return undefined;
    }
    try {
      // Catch errors due to missing backend capability
      const result = await handler.getPrompt(promptName);
      const out =
        result && typeof result === 'object' && 'prompt' in result
          ? (result as unknown as { prompt: unknown }).prompt
          : result;
      if (isPrompt(out)) {
        return out;
      }
      console.warn(`[getPrompt] Invalid prompt structure for: ${promptName}`);
      return undefined;
    } catch (err: any) {
      console.warn(
        `[getPrompt] Failed to get prompt '${promptName}' from backend:`,
        err && (err.message || err)
      );
      // Log but return undefined, preserving function signature/type.
      return undefined;
    }
  }
  /**
   * Call a tool by name with the given arguments
   * @param name - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @returns Result of the tool call or error
   */
  async callTool(name: string, args: Record<string, any>) {
    // First check if we have a specific client registered for this tool
    const client = this.toolRegistry.get(name);

    try {
      // Wrap backend call in try/catch to intercept capability/other errors
      return await client?.callTool(name, args);
    } catch (err: any) {
      console.warn(
        `[callTool] Failed to call tool '${name}':`,
        err && (err.message || err)
      );
      return {
        error: `Failed to call tool: ${err?.message || err}`,
        code: err?.code || -32601,
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
