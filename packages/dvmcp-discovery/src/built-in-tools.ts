import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolRegistry } from './tool-registry';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { type Event, type Filter } from 'nostr-tools';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  TAG_SERVER_IDENTIFIER,
  TOOLS_LIST_KIND,
} from '@dvmcp/commons/constants';
import type { DiscoveryServer } from './discovery-server';

/**
 * Initialize built-in tools for interactive mode
 *
 * @param server - McpServer instance to register tools with
 * @param toolRegistry - ToolRegistry instance to interact with
 * @param discoveryServer - DiscoveryServer instance for advanced operations
 */
export function initBuiltInTools(
  server: McpServer,
  toolRegistry: ToolRegistry,
  discoveryServer: DiscoveryServer
) {
  server.tool(
    'list_tools',
    'Lists all currently registered tools, including built-in and discovered tools.',
    {},
    async () => {
      loggerDiscovery('Executing built-in tool: list_tools');
      const tools = toolRegistry.listToolsWithIds();

      let responseContent = 'Registered Tools:\n';
      if (tools.length === 0) {
        responseContent += '  No tools currently registered.';
      } else {
        tools.forEach(([id, tool]) => {
          responseContent += `  - ID: ${id}\n`;
          responseContent += `    Name: ${tool.name}\n`;
          responseContent += `    Description: ${tool.description || 'N/A'}\n`;
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: responseContent,
          },
        ],
      };
    }
  );

  server.tool(
    'remove_tool',
    'Removes tools from the registry by ID, pattern, or author.',
    {
      toolId: z.string().optional(),
      pattern: z.string().optional(),
      author: z.string().optional(),
    },
    async (args) => {
      const { toolId, pattern, author } = args;
      loggerDiscovery(`Executing built-in tool: remove_tool with params:`, {
        toolId,
        pattern,
        author,
      });

      try {
        if (toolId) {
          const removed = toolRegistry.removeTool(toolId);
          if (removed) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tool '${toolId}' removed successfully.`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tool '${toolId}' not found or could not be removed.`,
                },
              ],
              isError: true,
            };
          }
        }

        if (pattern) {
          try {
            const regex = new RegExp(pattern);
            const removedTools = toolRegistry.removeToolsByPattern(regex);

            if (removedTools.length > 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Removed ${removedTools.length} tools matching pattern '${pattern}':\n${removedTools.join('\n')}`,
                  },
                ],
              };
            } else {
              return {
                content: [
                  {
                    type: 'text',
                    text: `No tools found matching pattern '${pattern}'.`,
                  },
                ],
                isError: true,
              };
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Invalid regular expression pattern: ${errorMessage}`,
                },
              ],
              isError: true,
            };
          }
        }

        if (author) {
          const removedTools = toolRegistry.removeToolsByProvider(author);

          if (removedTools.length > 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Removed ${removedTools.length} tools from author '${author}':\n${removedTools.join('\n')}`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `No tools found from author '${author}'.`,
                },
              ],
              isError: true,
            };
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: 'Error: No removal criteria provided. Please specify toolId, pattern, or author.',
            },
          ],
          isError: true,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error removing tool '${toolId}': ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'discover',
    'Discovers new tools with optional keyword filtering and tool integration. Use no keywords for broad discovery, or provide keywords as individual words or exact matches in quotes. Only integrate tools when explicitly required.',
    {
      keywords: z.string().optional(),
      relay: z.string().optional(),
      limit: z.number().int().optional(),
      matchThreshold: z.number().int().default(1),
      integrate: z.boolean().default(true),
    },
    async ({
      keywords,
      relay,
      limit,
      matchThreshold = 1,
      integrate = true,
    }) => {
      loggerDiscovery(
        `Executing built-in tool: discover with keywords: ${keywords || 'none'}, relay: ${relay || 'default'}, limit: ${limit || 'none'}, matchThreshold: ${matchThreshold}, integrate: ${integrate}`
      );

      try {
        if (relay) {
          discoveryServer.addRelay(relay);
        }

        const relayHandler = discoveryServer.getRelayHandler();

        const filter: Filter = {
          kinds: [TOOLS_LIST_KIND],
        };

        if (limit && !isNaN(limit) && limit > 0) {
          filter.limit = limit;
        }

        loggerDiscovery('Querying Nostr relays for tool announcements...');
        const events = await relayHandler.queryEvents(filter);
        loggerDiscovery(
          `Received ${events.length} tool announcement events from relays`
        );
        const discoveredTools: Array<{
          event: Event;
          tool: Tool;
          score: number;
        }> = [];

        const keywordTerms = keywords ? parseKeywords(keywords) : [];

        for (const event of events) {
          try {
            const content = JSON.parse(event.content);
            if (!content.tools || !Array.isArray(content.tools)) {
              continue;
            }

            for (const tool of content.tools) {
              const score =
                keywordTerms.length > 0
                  ? calculateMatchScore(tool, keywordTerms)
                  : 1;

              if (score >= matchThreshold) {
                discoveredTools.push({
                  event,
                  tool,
                  score,
                });
              }
            }
          } catch (error) {
            loggerDiscovery(
              `Error processing tool announcement event: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        discoveredTools.sort((a, b) => b.score - a.score);

        let responseContent = `Discovered ${discoveredTools.length} tools`;
        if (keywords) {
          responseContent += ` matching keywords: ${keywords}`;
        }
        responseContent += '\n\n';

        const integratedTools: string[] = [];
        const skippedTools: string[] = [];

        if (discoveredTools.length === 0) {
          responseContent += 'No tools found matching the criteria.';
        } else {
          for (const { event, tool, score } of discoveredTools) {
            const pubkey = event.pubkey;
            const serverId = event.tags.find(
              (t) => t[0] === TAG_SERVER_IDENTIFIER
            )?.[1];
            if (!serverId) {
              loggerDiscovery(
                `Tool announcement missing server identifier: ${event.id}`
              );
              continue;
            }
            const isRegistered = discoveryServer.isToolRegistered(
              tool.name,
              pubkey
            );

            responseContent += `- ${tool.name} (Score: ${score})\n`;
            responseContent += `  Description: ${tool.description || 'N/A'}\n`;
            responseContent += `  Provider: ${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 4)}\n`;

            if (isRegistered) {
              responseContent += `  Status: Already registered\n`;
              skippedTools.push(tool.name);
            } else if (integrate) {
              const toolId = discoveryServer.registerToolFromAnnouncement(
                pubkey,
                tool,
                serverId
              );
              responseContent += `  Status: Integrated with ID ${toolId}\n`;
              integratedTools.push(tool.name);
            } else {
              responseContent += `  Status: Not integrated (integrate=false)\n`;
            }
            responseContent += '\n';
          }

          if (integrate) {
            responseContent += `\nSummary: `;
            if (integratedTools.length > 0) {
              responseContent += `Integrated ${integratedTools.length} new tools. `;
            }
            if (skippedTools.length > 0) {
              responseContent += `Skipped ${skippedTools.length} already registered tools.`;
            }
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: responseContent,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error discovering tools: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Parse keywords string into an array of terms
 * Handles quoted phrases, comma-separated values, and space-separated words
 *
 * @param keywords - Keywords string to parse
 * @returns Array of keyword terms
 */
function parseKeywords(keywords: string): string[] {
  if (!keywords || keywords.trim() === '') {
    return [];
  }

  const terms: string[] = [];
  let currentTerm = '';
  let inQuotes = false;

  for (let i = 0; i < keywords.length; i++) {
    const char = keywords[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if ((char === ',' || char === ' ') && !inQuotes) {
      if (currentTerm.trim()) {
        terms.push(currentTerm.trim().toLowerCase());
      }
      currentTerm = '';
      continue;
    }

    currentTerm += char;
  }

  if (currentTerm.trim()) {
    terms.push(currentTerm.trim().toLowerCase());
  }

  return terms;
}

/**
 * Calculate a match score for a tool based on how well it matches the keywords
 *
 * @param tool - Tool to check for matches
 * @param keywords - Array of keyword terms to match against
 * @returns Match score (higher is better match)
 */
function calculateMatchScore(tool: Tool, keywords: string[]): number {
  if (!keywords || keywords.length === 0) {
    return 1;
  }

  let score = 0;
  const name = (tool.name || '').toLowerCase();
  const description = (tool.description || '').toLowerCase();

  for (const keyword of keywords) {
    if (name === keyword) {
      score += 5;
    } else if (name.includes(keyword)) {
      score += 3;
    }

    if (description.includes(keyword)) {
      score += 2;
    }

    if (tool.inputSchema && tool.inputSchema.properties) {
      const properties = Object.keys(tool.inputSchema.properties);
      for (const prop of properties) {
        if (prop.toLowerCase().includes(keyword)) {
          score += 1;
        }
      }
    }
  }

  return score;
}
