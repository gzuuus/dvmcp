import { loggerDiscovery } from '@dvmcp/commons/core';
import { BaseRegistry } from './base-registry';
import type { DVMCPBridgeServer } from './base-interfaces';
import {
  CompleteRequestSchema,
  PingRequestSchema,
  type ServerCapabilities,
  type CompleteRequest,
  type CompleteResult,
  type PingRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ServerInfo {
  pubkey: string;
  content: string;
  capabilities?: ServerCapabilities;
}

export class ServerRegistry extends BaseRegistry<DVMCPBridgeServer> {
  private servers: Map<string, ServerInfo> = new Map();

  /**
   * Register a server with the registry
   * @param serverId - Server's unique identifier
   * @param pubkey - Provider's public key
   * @param content - Server announcement content
   */
  public registerServer(
    serverId: string,
    pubkey: string,
    content: string
  ): void {
    let capabilities: ServerCapabilities | undefined;
    try {
      const announcement = JSON.parse(content);
      if (announcement.capabilities) {
        capabilities = announcement.capabilities;
      }
    } catch (error) {
      loggerDiscovery(`Error parsing server announcement: ${error}`);
    }

    const serverInfo: ServerInfo = { pubkey, content, capabilities };
    this.servers.set(serverId, serverInfo);

    const serverCapability: DVMCPBridgeServer = {
      id: serverId,
      type: 'server',
      pubkey,
      content,
    };

    this.items.set(serverId, {
      item: serverCapability,
      providerPubkey: pubkey,
      serverId,
    });

    loggerDiscovery(`Registered server ${serverId} from ${pubkey}`);
  }

  /**
   * Get server information by ID
   * @param serverId - Server's unique identifier
   * @returns Server information or undefined if not found
   */
  public getServer(serverId: string): ServerInfo | undefined {
    return this.servers.get(serverId);
  }

  /**
   * List all registered servers
   * @returns Array of server information
   */
  public listServers(): ServerInfo[] {
    return Array.from(this.servers.values());
  }

  /**
   * List all registered servers with their IDs
   * @returns Array of [serverId, serverInfo] pairs
   */
  public listServersWithIds(): [string, ServerInfo][] {
    return Array.from(this.servers.entries());
  }

  /**
   * Remove a server from the registry
   * @param serverId - Server's unique identifier
   * @returns true if the server was removed, false if it wasn't found
   */
  public removeServer(serverId: string): boolean {
    const server = this.servers.get(serverId);
    if (!server) {
      loggerDiscovery(`Server not found for removal: ${serverId}`);
      return false;
    }

    this.servers.delete(serverId);
    this.items.delete(serverId);

    loggerDiscovery(`Server removed from registry: ${serverId}`);
    return true;
  }

  /**
   * Remove all servers from a specific provider
   * @param providerPubkey - Public key of the provider whose servers should be removed
   * @returns Array of removed server IDs
   */
  public removeServersByProvider(providerPubkey: string): string[] {
    const removed: string[] = [];

    for (const [id, server] of this.servers.entries()) {
      if (server.pubkey === providerPubkey) {
        this.servers.delete(id);
        this.items.delete(id);
        removed.push(id);
      }
    }

    return removed;
  }

  /**
   * Clear all servers from the registry
   */
  public clear(): void {
    this.servers.clear();
    this.items.clear();
  }

  /**
   * Check if a server supports completions
   * @param serverId - Server's unique identifier
   * @returns true if the server supports completions, false otherwise
   */
  public supportsCompletions(serverId: string): boolean {
    const server = this.servers.get(serverId);
    return !!server?.capabilities?.completions;
  }

  protected registerWithMcp(): void {
    // No-op for server registry as servers are not registered with MCP directly
  }

  /**
   * Set up the completion request handler in the MCP server if any registered servers support completions
   * @param mcpServer - The MCP server instance
   * @param completionHandler - Function to handle completion requests
   */
  public setupCompletionHandler(
    mcpServer: McpServer,
    completionHandler: (
      params: CompleteRequest['params']
    ) => Promise<CompleteResult>
  ): void {
    // Check if any registered servers support completions
    const hasCompletionsSupport = Array.from(this.servers.keys()).some(
      (serverId) => this.supportsCompletions(serverId)
    );

    if (hasCompletionsSupport) {
      loggerDiscovery('Setting up completion request handler');
      mcpServer.server.setRequestHandler(
        CompleteRequestSchema,
        async (request) => {
          try {
            return await completionHandler(request.params);
          } catch (error) {
            loggerDiscovery(`Error handling completion request: ${error}`);
            throw error;
          }
        }
      );
    } else {
      loggerDiscovery(
        'No servers with completions capability found, skipping handler setup'
      );
    }
  }

  /**
   * Set up the ping request handler in the MCP server
   * @param mcpServer - The MCP server instance
   * @param pingHandler - Function to handle ping requests
   */
  public setupPingHandler(
    mcpServer: McpServer,
    pingHandler: (params: PingRequest['params']) => Promise<{}>
  ): void {
    loggerDiscovery('Setting up ping request handler');
    mcpServer.server.setRequestHandler(PingRequestSchema, async (request) => {
      try {
        return await pingHandler(request.params);
      } catch (error) {
        loggerDiscovery(`Error handling ping request: ${error}`);
        throw error;
      }
    });
  }
}
