import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Built-in tool definition with execution function
 */
export interface BuiltInTool {
  /**
   * Tool definition
   */
  tool: Tool;

  /**
   * Tool implementation function
   * @param params - Tool parameters
   * @returns Tool execution result
   */
  execute: (params: unknown) => Promise<unknown>;
}

/**
 * Registry of built-in tools
 */
export class BuiltInToolRegistry {
  private tools: Map<string, BuiltInTool> = new Map();

  /**
   * Register a built-in tool
   * @param id - Tool ID
   * @param tool - Tool definition
   * @param executeFn - Tool execution function
   */
  public registerTool(
    id: string,
    tool: Tool,
    executeFn: (params: unknown) => Promise<unknown>
  ): void {
    this.tools.set(id, { tool, execute: executeFn });
  }

  /**
   * Get a built-in tool by ID
   * @param id - Tool ID
   * @returns Built-in tool or undefined if not found
   */
  public getTool(id: string): BuiltInTool | undefined {
    return this.tools.get(id);
  }

  /**
   * Get all built-in tools
   * @returns Array of built-in tools
   */
  public getAllTools(): [string, BuiltInTool][] {
    return Array.from(this.tools.entries());
  }

  /**
   * Check if a tool ID exists in the registry
   * @param id - Tool ID
   * @returns True if the tool exists, false otherwise
   */
  public hasToolId(id: string): boolean {
    return this.tools.has(id);
  }
}

/**
 * Default built-in tool registry instance
 */
export const builtInToolRegistry = new BuiltInToolRegistry();

// Define the greeting tool
const greetingTool: Tool = {
  name: 'greeting',
  description:
    'A simple greeting tool that returns a greeting for the provided name',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name to greet',
      },
    },
    required: ['name'],
  },
};

// Register the greeting tool with its execution function
builtInToolRegistry.registerTool(
  'built_in_greeting',
  greetingTool,
  async (params: unknown) => {
    const { name } = params as { name: string };
    return `Hello, ${name}!`;
  }
);

/**
 * Helper function to register a new built-in tool
 * @param id - Tool ID
 * @param name - Tool name
 * @param description - Tool description
 * @param inputSchema - Tool input schema
 * @param executeFn - Tool execution function
 */
export function registerBuiltInTool(
  id: string,
  name: string,
  description: string,
  inputSchema: Tool['inputSchema'],
  executeFn: (params: unknown) => Promise<unknown>
): void {
  const tool: Tool = {
    name,
    description,
    inputSchema,
  };

  builtInToolRegistry.registerTool(id, tool, executeFn);
}
