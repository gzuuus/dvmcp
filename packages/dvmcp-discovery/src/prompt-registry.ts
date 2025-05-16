import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { z } from 'zod';

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

export class PromptRegistry {
  // Store all prompts with their source information
  private prompts: Map<
    string,
    {
      prompt: PromptDefinition;
      providerPubkey?: string;
      serverId?: string;
    }
  > = new Map();

  // Store server prompts by server ID
  private serverPrompts: Map<string, PromptDefinition[]> = new Map();

  constructor(private mcpServer: McpServer) {}

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
      this.prompts.set(promptId, { prompt, providerPubkey, serverId });
      this.registerWithMcp(promptId, prompt);
      loggerDiscovery(`Registered prompt: ${promptId}`);
    } catch (error) {
      console.error(`Error registering prompt ${promptId}:`, error);
      throw error;
    }
  }

  /**
   * Get prompt information by ID
   * @param promptId - ID of the prompt
   * @returns Prompt information or undefined if not found
   */
  public getPromptInfo(promptId: string) {
    return this.prompts.get(promptId);
  }

  /**
   * Get a prompt by its ID
   * @param promptId - ID of the prompt
   * @returns Prompt or undefined if not found
   */
  public getPrompt(promptId: string): PromptDefinition | undefined {
    return this.prompts.get(promptId)?.prompt;
  }

  /**
   * List all prompts in the registry
   * @returns Array of prompts
   */
  public listPrompts(): PromptDefinition[] {
    return Array.from(this.prompts.values()).map(({ prompt }) => prompt);
  }

  /**
   * List all prompts with their IDs
   * @returns Array of [promptId, prompt] pairs
   */
  public listPromptsWithIds(): [string, PromptDefinition][] {
    return Array.from(this.prompts.entries()).map(([id, info]) => [
      id,
      info.prompt,
    ]);
  }

  /**
   * Clear all prompts from the registry
   */
  public clear(): void {
    this.prompts.clear();
    this.serverPrompts.clear();
  }

  /**
   * Remove a prompt from the registry
   * @param promptId - ID of the prompt to remove
   * @returns true if the prompt was removed, false if it wasn't found
   */
  public removePrompt(promptId: string): boolean {
    const promptInfo = this.prompts.get(promptId);

    // If prompt doesn't exist, return false
    if (!promptInfo) {
      loggerDiscovery(`Prompt not found for removal: ${promptId}`);
      return false;
    }

    // Remove the prompt from the registry
    this.prompts.delete(promptId);
    loggerDiscovery(`Prompt removed from registry: ${promptId}`);

    // Note: The MCP server doesn't have a direct method to remove prompts
    // The prompt list changed notification will be handled by the discovery server
    return true;
  }

  /**
   * Remove all prompts from a specific provider
   * @param providerPubkey - Public key of the provider whose prompts should be removed
   * @returns Array of removed prompt IDs
   */
  public removePromptsByProvider(providerPubkey: string): string[] {
    const removedPromptIds: string[] = [];

    // Find all prompts from this provider
    for (const [id, info] of this.prompts.entries()) {
      // Check if this prompt belongs to the specified provider
      if (info.providerPubkey === providerPubkey) {
        // Remove the prompt
        this.prompts.delete(id);
        removedPromptIds.push(id);
        loggerDiscovery(`Removed prompt ${id} from provider ${providerPubkey}`);
      }
    }

    return removedPromptIds;
  }

  /**
   * Remove prompts matching a regex pattern
   * @param pattern - Regex pattern to match against prompt IDs
   * @returns Array of removed prompt IDs
   */
  public removePromptsByPattern(pattern: RegExp): string[] {
    const removedPromptIds: string[] = [];

    // Find all prompts matching the pattern
    for (const [id, info] of this.prompts.entries()) {
      // Check if this prompt ID matches the pattern
      if (pattern.test(id)) {
        // Remove the prompt
        this.prompts.delete(id);
        removedPromptIds.push(id);
        loggerDiscovery(`Removed prompt ${id} matching pattern ${pattern}`);
      }
    }

    return removedPromptIds;
  }

  /**
   * Register prompts for a server
   * @param serverId - Server's unique identifier
   * @param prompts - Array of prompts to register
   */
  public registerServerPrompts(
    serverId: string,
    prompts: PromptDefinition[],
    providerPubkey?: string
  ): void {
    this.serverPrompts.set(serverId, prompts);
    loggerDiscovery(
      `Registered ${prompts.length} prompts for server ${serverId}`
    );

    // Register each prompt individually
    prompts.forEach((prompt) => {
      const promptId = this.createPromptId(prompt.name, serverId);
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

  private createPromptId(promptName: string, serverId: string): string {
    return `${serverId}_${promptName}`;
  }

  private registerWithMcp(promptId: string, prompt: PromptDefinition): void {
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
        async (args: Record<string, unknown>) => {
          try {
            // Call the execution callback if set
            const result = await this.executionCallback?.(
              promptId,
              args as Record<string, string>
            );

            // Handle different result types
            if (typeof result === 'object' && result !== null) {
              // If the result is already in the expected format, return it directly
              if ('messages' in result) {
                return result as any;
              }
            }

            // Determine the content type based on the result
            let content: any;

            if (typeof result === 'string') {
              // If it's a string, use it as text content
              content = {
                type: 'text',
                text: result,
              };
            } else if (result === null || result === undefined) {
              // If it's null or undefined, use an empty string
              content = {
                type: 'text',
                text: '',
              };
            } else if (typeof result === 'object') {
              // If it's an object, check for specific content types
              if ('type' in result && typeof result.type === 'string') {
                // If it already has a type field, use it directly
                content = result;
              } else {
                // Otherwise, stringify the object
                content = {
                  type: 'text',
                  text: JSON.stringify(result),
                };
              }
            } else {
              // For any other type, convert to string
              content = {
                type: 'text',
                text: String(result),
              };
            }

            // Create the message with the appropriate content
            return {
              messages: [
                {
                  role: 'user',
                  content,
                },
              ],
            };
          } catch (error) {
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
    args: Record<string, string>
  ) => Promise<unknown>;

  /**
   * Set the execution callback for prompts
   * @param callback - Callback function to execute prompts
   */
  public setExecutionCallback(
    callback: (
      promptId: string,
      args: Record<string, string>
    ) => Promise<unknown>
  ): void {
    this.executionCallback = callback;
  }
}
