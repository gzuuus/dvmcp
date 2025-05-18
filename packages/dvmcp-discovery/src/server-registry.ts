import { loggerDiscovery } from '@dvmcp/commons/logger';
import { BaseRegistry } from './base-registry';
import type { DVMCPBridgeServer } from './base-interfaces';

export interface ServerInfo {
  pubkey: string;
  content: string;
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
    const serverInfo: ServerInfo = { pubkey, content };
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
  protected registerWithMcp(): void {
    // No-op for server registry as servers are not registered with MCP directly
  }
}
