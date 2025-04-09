import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { DVM_ANNOUNCEMENT_KIND } from '@dvmcp/commons/constants';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import type { Filter } from 'nostr-tools';
import type { DVMAnnouncement } from './direct-discovery';
import type { DiscoveryServer } from './discovery-server';
import { DEFAULT_VALUES } from './constants';
import { NWCPaymentHandler } from './nwc-payment';
import { getConfig } from './config';

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
  name: 'discover',
  description:
    'Discovers new tools with optional keyword filtering and tool integration. Use no keywords for broad discovery, or provide keywords as individual words or exact matches in quotes. Only integrate tools when explicitly required.',
  inputSchema: {
    type: 'object',
    properties: {
      keywords: {
        type: 'string',
        description:
          'Optional keywords to filter tools. Supports quoted phrases, comma-separated values, or space-separated words',
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
  },
};

// Register the discover_and_integrate tool with its execution function
builtInToolRegistry.registerTool(
  'discover',
  discoverAndIntegrateTool,
  async (params: unknown) => {
    // Type assertion for params
    const typedParams = params as {
      keywords?: string;
      relay?: string;
      limit?: number;
      matchThreshold?: number;
      integrate?: boolean;
    };

    const {
      keywords: keywordsInput,
      relay: userRelay,
      limit,
      matchThreshold = 1,
    } = typedParams;

    // Define integrate explicitly to avoid redeclaration issues
    const integrate = typedParams.integrate; // Default to true if not explicitly set to false

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
        since: Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60,
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

      // Define the type for matchedAnnouncements
      interface MatchedAnnouncement {
        pubkey: string;
        identifier: string;
        name: string;
        matchCount: number;
        exactMatch?: boolean;
        tools: Tool[];
        content: DVMAnnouncement;
      }

      // Create a properly typed array for matched announcements
      const matchedAnnouncements: MatchedAnnouncement[] = [];

      // Step 2: Filter announcements based on keywords (if provided)
      const lowerKeywords = keywords.map((k) => k.toLowerCase());
      const hasKeywords = keywords.length > 0;

      // Check if we have a multi-word query
      const isMultiWordQuery = keywords.length > 1;
      const fullQueryString = keywords.join(' ').toLowerCase();

      loggerDiscovery(
        hasKeywords
          ? `Processing ${events.length} announcements for ${isMultiWordQuery ? 'multi-word' : 'single-word'} query: "${fullQueryString}"`
          : `Processing ${events.length} announcements for wide discovery...`
      );

      for (const event of events) {
        try {
          const content = JSON.parse(event.content) as DVMAnnouncement;

          // Skip announcements without tools
          if (!content.tools || content.tools.length === 0) {
            continue;
          }

          const dTag =
            event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
          const providerName = (content.name || '').toLowerCase();
          const providerAbout = (content.about || '').toLowerCase();

          // If no keywords provided, include all tools with a minimum match count
          if (!hasKeywords) {
            matchedAnnouncements.push({
              pubkey: event.pubkey,
              identifier: dTag,
              name: content.name || 'Unnamed DVM',
              matchCount: 1, // Minimum match count for wide discovery
              tools: content.tools,
              content,
            });
            continue;
          }

          // SIMPLIFIED APPROACH: For multi-word queries, first check for exact matches
          if (isMultiWordQuery) {
            // Check for exact match with provider name
            const exactNameMatch = providerName === fullQueryString;

            if (exactNameMatch) {
              // Found an exact match - this gets highest priority
              loggerDiscovery(
                `EXACT MATCH: Provider '${content.name}' exactly matches full query '${fullQueryString}'`
              );

              // Add this provider with all its tools and a very high score
              matchedAnnouncements.push({
                pubkey: event.pubkey,
                identifier: dTag,
                name: content.name || 'Unnamed DVM',
                matchCount: 100, // Very high score for exact matches
                exactMatch: true,
                tools: content.tools,
                content,
              });

              // Continue to next announcement - we've already added this one
              continue;
            }
          }

          // For non-exact matches or single-word queries, use a simpler scoring approach
          let matchCount = 0;
          let matchedKeywordsCount = 0;
          const matchedTools = [];

          // Check if provider information matches any keywords
          for (const keyword of lowerKeywords) {
            // Check for exact matches first (higher score)
            if (providerName === keyword || providerAbout === keyword) {
              matchCount += 3;
              matchedKeywordsCount++;
            }
            // Then check for partial matches
            else if (
              providerName.includes(keyword) ||
              providerAbout.includes(keyword)
            ) {
              matchCount += 1;
              matchedKeywordsCount++;
            }
          }

          // Check each tool for keyword matches
          for (const tool of content.tools) {
            const toolName = (tool.name || '').toLowerCase();
            const toolDescription = (tool.description || '').toLowerCase();
            let toolMatched = false;

            for (const keyword of lowerKeywords) {
              // Check for exact matches in tool name (highest score)
              if (toolName === keyword) {
                matchCount += 3;
                toolMatched = true;
                matchedKeywordsCount++;
              }
              // Check for partial matches in name or description
              else if (
                toolName.includes(keyword) ||
                toolDescription.includes(keyword)
              ) {
                matchCount += 1;
                toolMatched = true;
                matchedKeywordsCount++;
              }
            }

            if (toolMatched) {
              matchedTools.push(tool);
            }
          }

          // For multi-word queries, we want to match most of the keywords
          const requiredMatchCount = isMultiWordQuery
            ? Math.max(matchThreshold, Math.ceil(keywords.length * 0.6)) // Match at least 60% of keywords
            : matchThreshold;

          // Add to matched announcements if we meet the threshold
          if (matchCount >= requiredMatchCount) {
            // For multi-word queries, only include tools that matched keywords
            // For single-word queries, include all tools from the provider
            const toolsToInclude = content.tools;

            loggerDiscovery(
              `Found matching announcement: ${content.name} with ${toolsToInclude.length} tools (score: ${matchCount})`
            );

            matchedAnnouncements.push({
              pubkey: event.pubkey,
              identifier: dTag,
              name: content.name || 'Unnamed DVM',
              matchCount,
              exactMatch: false,
              tools: toolsToInclude,
              content,
            });
          }
        } catch (error) {
          loggerDiscovery(`Failed to parse announcement: ${error}`);
          continue;
        }
      }

      // Sort matched announcements by exactMatch first, then by match count
      if (hasKeywords && matchedAnnouncements.length > 1) {
        matchedAnnouncements.sort((a, b) => {
          // First prioritize exact matches
          if (a.exactMatch && !b.exactMatch) return -1;
          if (!a.exactMatch && b.exactMatch) return 1;
          // Then sort by match count (higher first)
          return b.matchCount - a.matchCount;
        });

        // If we have an exact match, only keep that one
        const hasExactMatch = matchedAnnouncements.some((a) => a.exactMatch);
        if (hasExactMatch) {
          loggerDiscovery(`Found exact match, keeping only exact matches`);
          // Keep only exact matches
          const exactMatches = matchedAnnouncements.filter((a) => a.exactMatch);
          matchedAnnouncements.length = 0;
          matchedAnnouncements.push(...exactMatches);
        }
        // For multi-word queries without exact matches, limit to top results
        else if (keywords.length > 1 && matchedAnnouncements.length > 3) {
          loggerDiscovery(`Multi-word query, limiting to top 3 results`);
          matchedAnnouncements.splice(3); // Keep only top 3 results for multi-word queries
        }
      }

      if (matchedAnnouncements.length === 0) {
        return {
          success: false,
          message:
            keywords.length > 0
              ? `No tools matching keywords (${keywords.join(', ')}) found`
              : 'No tools found in the specified relay',
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
          message:
            keywords.length > 0
              ? `Successfully discovered ${matchedAnnouncements.length} announcements with tools matching keywords (${keywords.join(', ')})`
              : `Successfully discovered ${matchedAnnouncements.length} announcements with tools`,
          matchedAnnouncements: matchedAnnouncements.length,
          matchedTools: matchedAnnouncements.reduce(
            (count: number, announcement: MatchedAnnouncement) =>
              count + announcement.tools.length,
            0
          ),
          providers: matchedAnnouncements.map(
            (announcement: MatchedAnnouncement) => ({
              name: announcement.name,
              pubkey: announcement.pubkey,
              identifier: announcement.identifier,
              toolCount: announcement.tools.length,
              toolNames: announcement.tools.map((tool) => tool.name),
            })
          ),
          integratedTools: 0,
        };
      }

      // Step 3: Integrate matched tools
      let totalIntegratedTools = 0;
      const integratedProviders = [];

      // IMPORTANT: Add the relay to the main relay handler to ensure communication works
      try {
        if (!discoveryServerRef) {
          throw new Error('Discovery server reference is not set');
        }
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
              if (!discoveryServerRef) {
                throw new Error('Discovery server reference is not set');
              }
              const toolId = discoveryServerRef.createToolId(
                tool.name,
                announcement.pubkey
              ); //`${tool.name}_${announcement.pubkey.slice(0, 4)}`;

              // Skip already registered tools
              if (
                discoveryServerRef &&
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
              if (discoveryServerRef) {
                discoveryServerRef.registerToolFromAnnouncement(
                  announcement.pubkey,
                  tool,
                  false // Don't notify for each individual tool
                );
              }

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
          if (discoveryServerRef) {
            discoveryServerRef.notifyToolListChanged();
          }
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
            ? keywords.length > 0
              ? `Successfully discovered and integrated ${totalIntegratedTools} tools matching keywords (${keywords.join(', ')})`
              : `Successfully discovered and integrated ${totalIntegratedTools} tools`
            : keywords.length > 0
              ? `Found matching tools but failed to integrate any`
              : `Found tools but failed to integrate any`,
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
// Define the list_tools tool
const listToolsTool: Tool = {
  name: 'list_tools',
  description:
    'Lists all tools currently available in the registry with their IDs',
  inputSchema: {
    type: 'object',
    properties: {
      detailed: {
        type: 'boolean',
        description:
          'Whether to include detailed information about each tool (default: false)',
      },
    },
  },
};

// Register the list_tools tool with its execution function
/**
 * Register the pay_invoice tool if NWC is configured
 */
function registerPayInvoiceTool(): void {
  // Check if NWC is configured
  const config = getConfig();
  if (!config.nwc?.connectionString) {
    loggerDiscovery(
      'NWC connection string not configured. Skipping pay_invoice tool registration.'
    );
    return;
  }

  // Define the pay_invoice tool
  const payInvoiceTool: Tool = {
    name: 'pay_invoice',
    description:
      'Pay a Lightning invoice using the configured NWC (Nostr Wallet Connect) connection. Returns true if payment was successful, false otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice: {
          type: 'string',
          description: 'The Lightning invoice (BOLT11) to pay',
        },
      },
      required: ['invoice'],
    },
  };

  // Register the pay_invoice tool with its execution function
  builtInToolRegistry.registerTool(
    'pay_invoice',
    payInvoiceTool,
    async (params: unknown) => {
      // Type assertion for params
      const typedParams = params as { invoice: string };
      const { invoice } = typedParams;

      if (!invoice) {
        throw new Error('Invoice is required');
      }

      try {
        // Create a new NWC payment handler
        const paymentHandler = new NWCPaymentHandler();

        // Attempt to pay the invoice
        loggerDiscovery(
          `Attempting to pay invoice: ${invoice.substring(0, 20)}...`
        );
        const result = await paymentHandler.payInvoice(invoice);

        // Clean up resources
        paymentHandler.cleanup();

        // Return the payment result
        return result;
      } catch (error) {
        loggerDiscovery('Error paying invoice:', error);
        throw new Error(
          `Failed to pay invoice: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  loggerDiscovery('Registered pay_invoice tool successfully');
}

// Call the function to register the pay_invoice tool if NWC is configured
registerPayInvoiceTool();

builtInToolRegistry.registerTool(
  'list_tools',
  listToolsTool,
  async (params: unknown) => {
    const { detailed = false } = params as { detailed?: boolean };

    if (!discoveryServerRef) {
      throw new Error('Discovery server reference not set');
    }

    try {
      // Get all tools with their IDs from the registry
      const toolsWithIds = await discoveryServerRef.listToolsWithIds();

      // Format the response based on the detailed flag
      if (detailed) {
        // Return detailed information about each tool
        return {
          success: true,
          message: `Found ${toolsWithIds.length} tools in the registry`,
          tools: toolsWithIds.map(([id, tool]) => ({
            id,
            name: tool.name,
            description: tool.description,
          })),
        };
      } else {
        // Return tool IDs and names
        return {
          success: true,
          message: `Found ${toolsWithIds.length} tools in the registry`,
          tools: toolsWithIds.map(([id, tool]) => ({
            id,
          })),
        };
      }
    } catch (error) {
      throw new Error(`Failed to list tools: ${error}`);
    }
  }
);

// Define the remove_tool tool with enhanced capabilities
const removeToolTool: Tool = {
  name: 'remove_tool',
  description: 'Removes tools from the registry by ID, pattern, or provider',
  inputSchema: {
    type: 'object',
    properties: {
      toolId: {
        type: 'string',
        description: 'ID of a specific tool to remove',
      },
      pattern: {
        type: 'string',
        description: 'Regex pattern to match against tool IDs',
      },
    },
    oneOf: [{ required: ['toolId'] }, { required: ['pattern'] }],
  },
};

// Register the enhanced remove_tool with its execution function
builtInToolRegistry.registerTool(
  'remove_tool',
  removeToolTool,
  async (params: unknown) => {
    const { toolId, pattern } = params as {
      toolId?: string;
      pattern?: string;
    };

    if (!discoveryServerRef) {
      throw new Error('Discovery server reference not set');
    }

    // Check that at least one of the required parameters is provided
    if (!toolId && !pattern) {
      throw new Error(
        'At least one of toolId, pattern, or providerPubkey is required'
      );
    }

    try {
      const toolRegistry = discoveryServerRef['toolRegistry'];

      if (!toolRegistry) {
        throw new Error('Tool registry not found');
      }

      // Case 1: Remove a specific tool by ID
      if (toolId) {
        // Get tool info for better logging
        const toolInfo = toolRegistry.getToolInfo(toolId);
        const toolName = toolInfo?.tool.name || 'unknown';

        // Check if it's a built-in tool (which shouldn't be removed)
        if (toolInfo?.isBuiltIn) {
          return {
            success: false,
            message: `Cannot remove built-in tool: ${toolId} (${toolName})`,
          };
        }

        // Remove the tool from the registry
        const result = toolRegistry.removeTool(toolId);

        // Notify clients about the tool list change
        if (result) {
          discoveryServerRef.notifyToolListChanged();
          loggerDiscovery(
            `Notified clients about tool removal: ${toolId} (${toolName})`
          );

          // Verify removal by checking if the tool still exists
          const stillExists = toolRegistry.getTool(toolId) !== undefined;
          if (stillExists) {
            loggerDiscovery(
              `Warning: Tool ${toolId} still exists after removal attempt`
            );
            return {
              success: false,
              message: `Failed to completely remove tool: ${toolId} (${toolName})`,
            };
          }
        }

        return {
          success: result,
          message: result
            ? `Successfully removed tool: ${toolId}`
            : `Failed to remove tool: ${toolId} (not found)`,
        };
      }

      // Case 2: Remove tools by pattern
      else if (pattern) {
        // Create a RegExp object from the pattern string
        const regexPattern = new RegExp(pattern);

        // Remove tools matching the pattern
        const removedTools = discoveryServerRef.removeToolsByPattern(
          regexPattern,
          true
        );

        return {
          success: removedTools.length > 0,
          message:
            removedTools.length > 0
              ? `Successfully removed ${removedTools.length} tools matching pattern ${pattern}`
              : `No tools found matching pattern ${pattern}`,
          removedTools,
        };
      }

      // This should never happen due to the earlier check
      return {
        success: false,
        message: 'Invalid parameters provided',
      };
    } catch (error) {
      throw new Error(`Failed to remove tools: ${error}`);
    }
  }
);

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
