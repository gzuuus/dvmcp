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
              // Register by id, uri, and name if available and type is string
              if (typeof resource.id === 'string')
                this.resourceRegistry.set(resource.id, client);
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
              // Register by id and name if available and type is string
              if (typeof prompt.id === 'string')
                this.promptRegistry.set(prompt.id, client);
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
   * Find and return a resource matching the given URI/ID, routing to the correct client.
   * @param resourceUriOrId
   * @returns Resource or throws if not found
   */
  /**
   * Find and return a resource matching the given URI/ID, using the resource registry.
   * @param resourceUriOrId
   * @returns Resource or throws if not found
   */
  async readResource(resourceUriOrId: string): Promise<Resource | undefined> {
    // Helper type guard
    function isResource(obj: unknown): obj is Resource {
      return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof (obj as Resource).name === 'string' &&
        typeof (obj as Resource).uri === 'string'
      );
    }

    let handler = this.resourceRegistry.get(resourceUriOrId);
    // If registry is not populated, refresh it
    if (!handler) {
      await this.listResources();
      handler = this.resourceRegistry.get(resourceUriOrId);
    }
    if (!handler) {
      // Not found, but do not throw; return undefined for robustness
      console.warn(
        `[readResource] Resource handler not found for: ${resourceUriOrId}`
      );
      return undefined;
    }
    try {
      // Catch backend errors (including missing capability) and log
      const result = await handler.readResource(resourceUriOrId);
      const out =
        result && typeof result === 'object' && 'resource' in result
          ? (result as unknown as { resource: unknown }).resource
          : result;
      if (isResource(out)) {
        return out;
      }
      // Not a valid resource, return undefined
      console.warn(
        `[readResource] Invalid resource structure for: ${resourceUriOrId}`
      );
      return undefined;
    } catch (err: any) {
      // Handle capability missing or -32601
      console.warn(
        `[readResource] Failed to read '${resourceUriOrId}' from backend:`,
        err && (err.message || err)
      );
      // Log but return undefined, preserving function signature/type.
      return undefined;
    }
  }

  /**
   * Find and return a prompt matching the given id or name, routing to correct client.
   * @param promptIdOrName
   * @returns Prompt or throws if not found
   */
  /**
   * Find and return a prompt matching the given id or name, using the prompt registry.
   * @param promptIdOrName
   * @returns Prompt or throws if not found
   */
  async getPrompt(promptIdOrName: string): Promise<Prompt | undefined> {
    // Helper type guard
    function isPrompt(obj: unknown): obj is Prompt {
      return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof (obj as Prompt).name === 'string'
      );
    }

    let handler = this.promptRegistry.get(promptIdOrName);
    // If registry is not populated, refresh it
    if (!handler) {
      await this.listPrompts();
      handler = this.promptRegistry.get(promptIdOrName);
    }
    if (!handler) {
      // Not found, log and return undefined
      console.warn(
        `[getPrompt] Prompt handler not found for: ${promptIdOrName}`
      );
      return undefined;
    }
    try {
      // Catch errors due to missing backend capability
      const result = await handler.getPrompt(promptIdOrName);
      const out =
        result && typeof result === 'object' && 'prompt' in result
          ? (result as unknown as { prompt: unknown }).prompt
          : result;
      if (isPrompt(out)) {
        return out;
      }
      console.warn(
        `[getPrompt] Invalid prompt structure for: ${promptIdOrName}`
      );
      return undefined;
    } catch (err: any) {
      console.warn(
        `[getPrompt] Failed to get prompt '${promptIdOrName}' from backend:`,
        err && (err.message || err)
      );
      // Log but return undefined, preserving function signature/type.
      return undefined;
    }
  }
  async callTool(name: string, args: Record<string, any>) {
    const client = this.toolRegistry.get(name);
    if (!client) {
      console.warn(`[callTool] No MCP server found for tool: ${name}`);
      return { error: `No MCP server found for tool: ${name}`, code: -32601 };
    }
    try {
      // Wrap backend call in try/catch to intercept capability/other errors.
      return await client.callTool(name, args);
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

  getDefaultClient(): MCPClientHandler | undefined {
    // Returns the first client in the Map, or undefined if empty
    return this.clients.values().next().value;
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
