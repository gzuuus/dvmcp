import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { DVM_ANNOUNCEMENT_KIND } from '@dvmcp/commons/constants';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import type { Filter } from 'nostr-tools';
import type { DVMAnnouncement } from './direct-discovery';
import type { DiscoveryServer } from './discovery-server';
import { DEFAULT_VALUES } from './constants';

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

// Built-in tools are defined below

let discoveryServerRef: DiscoveryServer | null = null;

/**
 * Set the discovery server reference for the tool
 * @param server - Discovery server instance
 */
export function setDiscoveryServerReference(server: any): void {
  discoveryServerRef = server;
}

// Define the discover_and_integrate tool ("I'm feeling lucky")
const discoverAndIntegrateTool: Tool = {
  name: 'discover_and_integrate',
  description:
    'Searches for tools matching specified keywords and optionally registers them for immediate use. Keywords can be separated words or exact matches enclosed in single or double quotes',
  inputSchema: {
    type: 'object',
    properties: {
      keywords: {
        type: 'string',
        description:
          'Keywords to search for in tool names and descriptions. Supports quoted phrases ("like this"), comma-separated values (word1,word2), or space-separated words',
      },
      relay: {
        type: 'string',
        description:
          'Nostr relay URL to search for tools. Uses default relay if not specified',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of tool announcements to process',
      },
      matchThreshold: {
        type: 'integer',
        description:
          'Minimum match score required to include a tool (default: 1)',
      },
      integrate: {
        type: 'boolean',
        description:
          'Whether to integrate (register) the discovered tools (default: true)',
      },
    },
    required: ['keywords'],
  },
};

// Register the discover_and_integrate tool with its execution function
builtInToolRegistry.registerTool(
  'discover_and_integrate',
  discoverAndIntegrateTool,
  async (params: unknown) => {
    const {
      keywords: keywordsInput,
      relay: userRelay,
      limit,
      matchThreshold = 1,
      integrate = true,
    } = params as {
      keywords: string;
      relay?: string;
      limit?: number;
      matchThreshold?: number;
      integrate?: boolean;
    };

    // Process keywords with enhanced parsing for multi-word inputs
    let keywords: string[] = [];

    if (keywordsInput) {
      /**
       * Parse keywords from input string, supporting:
       * 1. Quoted phrases ("like this" or 'like this')
       * 2. Comma-separated values (word1,word2)
       * 3. Space-separated words (word1 word2)
       */
      const parseInput = (input: string): string[] => {
        // Regular expression to match:
        // - Quoted strings (both single and double quotes)
        // - Words separated by commas or spaces
        const regex = /(['"])(.+?)\1|[^\s,]+/g;
        const matches = [];
        let match;

        while ((match = regex.exec(input)) !== null) {
          // If it's a quoted string, use the content inside quotes (match[2])
          // Otherwise use the whole match (match[0])
          const keyword = match[2] || match[0];
          if (keyword.trim()) {
            matches.push(keyword.trim());
          }
        }

        return matches;
      };

      // Parse the keywords input
      keywords = parseInput(keywordsInput);

      // Log the parsed keywords for debugging
      loggerDiscovery(`Parsed keywords: ${JSON.stringify(keywords)}`);
    }

    if (keywords.length === 0) {
      throw new Error('At least one keyword is required');
    }

    if (!discoveryServerRef) {
      throw new Error('Discovery server reference not set');
    }

    // Use default relay if not provided
    const relay = userRelay || DEFAULT_VALUES.DEFAULT_RELAY_URL;

    // Validate relay URL
    try {
      const url = new URL(relay);
      if (!url.protocol.startsWith('ws')) {
        throw new Error('Relay URL must start with ws:// or wss://');
      }
    } catch (error) {
      throw new Error(`Invalid relay URL: ${relay}`);
    }

    // Create a temporary relay handler for this query
    const relayHandler = new RelayHandler([relay]);

    try {
      // Step 1: Discover tools
      loggerDiscovery(
        `Querying relay ${relay} for tools matching keywords: ${keywords.join(', ')}...`
      );

      // Create a filter for DVM announcements
      const filter: Filter = {
        kinds: [DVM_ANNOUNCEMENT_KIND],
        '#t': ['mcp'],
      };

      // Add limit to the filter if specified
      if (limit !== undefined && limit > 0) {
        filter.limit = limit;
      }

      const events = await relayHandler.queryEvents(filter);

      if (events.length === 0) {
        return {
          success: false,
          message: 'No announcements found on the specified relay',
          matchedTools: 0,
          integratedTools: 0,
        };
      }

      loggerDiscovery(
        `Found ${events.length} announcements, analyzing for keyword matches...`
      );

      // Step 2: Filter announcements based on keywords
      const matchedAnnouncements = [];
      const lowerKeywords = keywords.map((k) => k.toLowerCase());

      loggerDiscovery(
        `Processing ${events.length} announcements for keyword matches...`
      );

      for (const event of events) {
        try {
          const content = JSON.parse(event.content) as DVMAnnouncement;

          // Skip announcements without tools
          if (!content.tools || content.tools.length === 0) {
            continue;
          }

          const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1] || '';
          const providerName = (content.name || '').toLowerCase();
          const providerAbout = (content.about || '').toLowerCase();

          // Track matching information
          let matchCount = 0;
          let providerMatched = false;
          const matchedTools = [];

          // Check if provider information matches any keywords
          for (const keyword of lowerKeywords) {
            // Check for exact matches first (higher score)
            if (providerName === keyword || providerAbout === keyword) {
              matchCount += 2;
              providerMatched = true;
              loggerDiscovery(
                `Provider '${content.name}' exactly matches keyword '${keyword}'`
              );
            }
            // Then check for partial matches
            else if (
              providerName.includes(keyword) ||
              providerAbout.includes(keyword)
            ) {
              matchCount++;
              providerMatched = true;
              loggerDiscovery(
                `Provider '${content.name}' contains keyword '${keyword}'`
              );
            }
          }

          // Check each tool for keyword matches
          for (const tool of content.tools) {
            const toolName = (tool.name || '').toLowerCase();
            const toolDescription = (tool.description || '').toLowerCase();
            let toolMatched = false;

            for (const keyword of lowerKeywords) {
              // Prioritize exact matches in tool name (highest score)
              if (toolName === keyword) {
                matchCount += 3;
                toolMatched = true;
              }
              // Then exact matches in description
              else if (toolDescription === keyword) {
                matchCount += 2;
                toolMatched = true;
              }
              // Finally partial matches
              else if (
                toolName.includes(keyword) ||
                toolDescription.includes(keyword)
              ) {
                matchCount++;
                toolMatched = true;
              }
            }

            if (toolMatched) {
              matchedTools.push(tool);
            }
          }

          // If provider matched, include all its tools
          if (providerMatched) {
            // If we're not already including all tools, replace with the complete set
            if (matchedTools.length !== content.tools.length) {
              loggerDiscovery(
                `Provider '${content.name}' matched. Including all ${content.tools.length} tools.`
              );
              // Start fresh with all tools
              matchedTools.length = 0;
              matchedTools.push(...content.tools);
            }
          }

          // Add to matched announcements if we meet the threshold
          if (matchCount >= matchThreshold) {
            loggerDiscovery(
              `Found matching announcement: ${content.name} with ${matchedTools.length} tools (score: ${matchCount})`
            );

            matchedAnnouncements.push({
              pubkey: event.pubkey,
              identifier: dTag,
              name: content.name || 'Unnamed DVM',
              matchCount,
              tools: matchedTools,
              content,
            });
          }
        } catch (error) {
          loggerDiscovery(`Failed to parse announcement: ${error}`);
          continue;
        }
      }

      if (matchedAnnouncements.length === 0) {
        return {
          success: false,
          message: `No tools matching keywords (${keywords.join(', ')}) found`,
          matchedTools: 0,
          integratedTools: 0,
        };
      }

      loggerDiscovery(
        `Found ${matchedAnnouncements.length} announcements with matching keywords`
      );

      // If integration is not requested, return discovery results only
      if (!integrate) {
        return {
          success: true,
          message: `Successfully discovered ${matchedAnnouncements.length} announcements with tools matching keywords (${keywords.join(', ')})`,
          matchedAnnouncements: matchedAnnouncements.length,
          matchedTools: matchedAnnouncements.reduce(
            (count, announcement) => count + announcement.tools.length,
            0
          ),
          providers: matchedAnnouncements.map((announcement) => ({
            name: announcement.name,
            pubkey: announcement.pubkey,
            identifier: announcement.identifier,
            toolCount: announcement.tools.length,
            toolNames: announcement.tools.map((tool) => tool.name),
          })),
          integratedTools: 0,
        };
      }

      // Step 3: Integrate matched tools
      let totalIntegratedTools = 0;
      const integratedProviders = [];

      // IMPORTANT: Add the relay to the main relay handler to ensure communication works
      try {
        const relayAdded = discoveryServerRef.addRelay(relay);
        loggerDiscovery(
          `Relay integration result: ${relayAdded ? 'added new relay' : 'relay already integrated'}`
        );
      } catch (error) {
        loggerDiscovery(
          `Warning: Failed to add relay to the main handler: ${error}`
        );
        // Continue with tool integration even if relay integration fails
      }

      // Integrate tools from each matched announcement
      for (const announcement of matchedAnnouncements) {
        try {
          const registeredToolNames = [];
          let registeredCount = 0;

          loggerDiscovery(
            `Integrating ${announcement.tools.length} tools from ${announcement.name}`
          );

          // Skip if no valid content or tools
          if (!announcement.content?.tools?.length) {
            loggerDiscovery(
              `No valid tools found in announcement from ${announcement.name}`
            );
            continue;
          }

          // Process each tool for registration
          for (const tool of announcement.tools) {
            try {
              const toolId = discoveryServerRef.createToolId(
                tool.name,
                announcement.pubkey
              ); //`${tool.name}_${announcement.pubkey.slice(0, 4)}`;

              // Skip already registered tools
              if (
                discoveryServerRef.isToolRegistered(
                  tool.name,
                  announcement.pubkey
                )
              ) {
                loggerDiscovery(
                  `Tool ${tool.name} already registered, skipping`
                );
                registeredToolNames.push(tool.name);
                registeredCount++;
                continue;
              }

              // Register the tool
              discoveryServerRef.registerToolFromAnnouncement(
                announcement.pubkey,
                tool,
                false // Don't notify for each individual tool
              );

              loggerDiscovery(`Registered tool: ${tool.name} (${toolId})`);
              registeredToolNames.push(tool.name);
              registeredCount++;
            } catch (error) {
              loggerDiscovery(`Failed to register ${tool.name}: ${error}`);
            }
          }

          // Track successful integrations
          if (registeredCount > 0) {
            totalIntegratedTools += registeredCount;
            integratedProviders.push({
              name: announcement.name,
              toolCount: registeredCount,
              toolNames: registeredToolNames,
            });
          }
        } catch (error) {
          loggerDiscovery(
            `Failed to integrate tools from ${announcement.name}: ${error}`
          );
        }
      }

      // Send a single notification after all tools are registered
      if (totalIntegratedTools > 0) {
        try {
          // Notify clients that the tool list has changed
          discoveryServerRef.notifyToolListChanged();
          loggerDiscovery(
            `Notified clients about ${totalIntegratedTools} new tools`
          );
        } catch (error) {
          loggerDiscovery(
            `Warning: Failed to notify clients about tool list change: ${error}`
          );
        }
      }

      // Return the results
      return {
        success: totalIntegratedTools > 0,
        message:
          totalIntegratedTools > 0
            ? `Successfully discovered and integrated ${totalIntegratedTools} tools matching keywords (${keywords.join(', ')})`
            : `Found matching tools but failed to integrate any`,
        matchedAnnouncements: matchedAnnouncements.length,
        integratedTools: totalIntegratedTools,
        providers: integratedProviders,
      };
    } catch (error) {
      throw new Error(`Failed to discover and integrate tools: ${error}`);
    } finally {
      // Clean up the temporary relay handler
      relayHandler.cleanup();
    }
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
