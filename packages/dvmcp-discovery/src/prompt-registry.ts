import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { z } from 'zod';
import { createCapabilityId } from './utils/capabilities';
import { BaseRegistry } from './base-registry';
import type { Capability } from './base-interfaces';
import type {
  GetPromptRequest,
  GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js';

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
  type?: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'file';
  options?: string[]; // For 'select' type
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: PromptArgument[];
}

// Extend PromptDefinition interface to include Capability properties
export interface PromptCapability extends PromptDefinition, Capability {
  type: 'prompt';
}

export class PromptRegistry extends BaseRegistry<PromptCapability> {
  // Store server prompts by server ID
  private serverPrompts: Map<string, PromptDefinition[]> = new Map();

  constructor(mcpServer: McpServer) {
    super(mcpServer);
  }

  /**
   * Register a prompt with the registry
   * @param promptId - ID of the prompt
   * @param prompt - Prompt definition
   * @param providerPubkey - Provider's public key
   * @param serverId - Server's unique identifier
   */
  public registerPrompt(
    promptId: string,
    prompt: PromptDefinition,
    providerPubkey: string,
    serverId?: string
  ): void {
    try {
      // Convert PromptDefinition to PromptCapability
      const promptCapability: PromptCapability = {
        ...prompt,
        id: promptId,
        type: 'prompt',
      };

      // Use the base class method to store the item
      this.items.set(promptId, {
        item: promptCapability,
        providerPubkey,
        serverId,
      });
      this.registerWithMcp(promptId, promptCapability);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get prompt information by ID
   * @param promptId - ID of the prompt
   * @returns Prompt information or undefined if not found
   */
  public getPromptInfo(promptId: string) {
    const info = this.getItemInfo(promptId);
    if (!info) return undefined;

    return info;
  }

  /**
   * Get a prompt by its ID
   * @param promptId - ID of the prompt
   * @returns Prompt or undefined if not found
   */
  public getPrompt(promptId: string): PromptDefinition | undefined {
    return this.getItem(promptId);
  }

  /**
   * List all prompts in the registry
   * @returns Array of prompts
   */
  public listPrompts(): PromptDefinition[] {
    return this.listItems();
  }

  /**
   * List all prompts with their IDs
   * @returns Array of [promptId, prompt] pairs
   */
  public listPromptsWithIds(): [string, PromptDefinition][] {
    return this.listItemsWithIds();
  }

  /**
   * Clear all prompts from the registry
   */
  public clear(): void {
    super.clear();
    this.serverPrompts.clear();
  }

  /**
   * Remove a prompt from the registry
   * @param promptId - ID of the prompt to remove
   * @returns true if the prompt was removed, false if it wasn't found
   */
  public removePrompt(promptId: string): boolean {
    const promptInfo = this.getItemInfo(promptId);

    // If prompt doesn't exist, return false
    if (!promptInfo) {
      loggerDiscovery(`Prompt not found for removal: ${promptId}`);
      return false;
    }

    // Use the base class method to remove the item
    const result = this.removeItem(promptId);
    if (result) {
      loggerDiscovery(`Prompt removed from registry: ${promptId}`);
    }

    // Note: The MCP server doesn't have a direct method to remove prompts
    // The prompt list changed notification will be handled by the discovery server
    return result;
  }

  /**
   * Remove all prompts from a specific provider
   * @param providerPubkey - Public key of the provider whose prompts should be removed
   * @returns Array of removed prompt IDs
   */
  public removePromptsByProvider(providerPubkey: string): string[] {
    // Use the base class method
    return this.removeItemsByProvider(providerPubkey);
  }

  /**
   * Remove prompts matching a regex pattern
   * @param pattern - Regex pattern to match against prompt IDs
   * @returns Array of removed prompt IDs
   */
  public removePromptsByPattern(pattern: RegExp): string[] {
    // Use the base class method
    return this.removeItemsByPattern(pattern);
  }

  /**
   * Register prompts for a server
   * @param serverId - Server's unique identifier
   * @param prompts - Array of prompts to register
   */
  public registerServerPrompts(
    serverId: string,
    prompts: PromptDefinition[],
    providerPubkey: string
  ): void {
    this.serverPrompts.set(serverId, prompts);
    loggerDiscovery(
      `Registered ${prompts.length} prompts for server ${serverId}`
    );

    // Register each prompt individually
    prompts.forEach((prompt) => {
      const promptId = createCapabilityId(prompt.name, providerPubkey);
      this.registerPrompt(promptId, prompt, providerPubkey || '', serverId);
    });
  }

  /**
   * Get prompts for a server
   * @param serverId - Server's unique identifier
   * @returns Array of prompts or undefined if not found
   */
  public getServerPrompts(serverId: string): PromptDefinition[] | undefined {
    return this.serverPrompts.get(serverId);
  }

  /**
   * List all server prompts
   * @returns Array of [serverId, prompts] pairs
   */
  public listServerPrompts(): [string, PromptDefinition[]][] {
    return Array.from(this.serverPrompts.entries());
  }

  protected registerWithMcp(promptId: string, prompt: PromptCapability): void {
    try {
      // Create a zod schema for the prompt arguments according to the MCP specification
      const zodSchema: z.ZodRawShape = {};

      // Handle case where prompt.arguments is undefined or not an array
      if (Array.isArray(prompt.arguments)) {
        for (const arg of prompt.arguments) {
          const isRequired = arg.required === true;
          zodSchema[arg.name] = isRequired ? z.string() : z.string().optional();
        }

        loggerDiscovery(
          `Created schema for prompt ${promptId} with ${prompt.arguments.length} arguments`
        );
      } else {
        // Log warning if arguments are missing
        loggerDiscovery(`Warning: Prompt ${promptId} has no arguments defined`);
      }

      // Register the prompt with the MCP server
      this.mcpServer.prompt(
        promptId,
        prompt.description || `Prompt: ${promptId}`,
        zodSchema,
        async (params: GetPromptRequest['params']) => {
          try {
            // Call the execution callback if set
            const result = await this.executionCallback?.(promptId, params);

            return result;
          } catch (error) {
            // TODO: send error
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(`Error executing prompt ${promptId}:`, errorMessage);
            throw error;
          }
        }
      );

      loggerDiscovery('Prompt registered successfully:', promptId);
    } catch (error) {
      console.error('Error registering prompt:', promptId, error);
    }
  }

  private executionCallback?: (
    promptId: string,
    params: GetPromptRequest['params']
  ) => Promise<GetPromptResult>;

  /**
   * Set the execution callback for prompts
   * @param callback - Callback function to execute prompts
   */
  public setExecutionCallback(
    callback: (
      promptId: string,
      params: GetPromptRequest['params']
    ) => Promise<GetPromptResult>
  ): void {
    this.executionCallback = callback;
  }
}
