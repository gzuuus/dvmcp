import type { Capability, ProviderServerMeta } from './base-interfaces';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Type definition for a registered capability reference
 * This represents the object returned by mcpServer.tool(), mcpServer.resource(), etc.
 */
export interface RegisteredCapabilityRef {
  remove: () => void;
  disable?: () => void;
  enable?: () => void;
}

export abstract class BaseRegistry<T extends Capability> {
  protected items: Map<string, { item: T } & ProviderServerMeta> = new Map();
  protected serverItems: Map<string, T[]> = new Map();

  // Map to store registered capability references returned by mcpServer methods
  protected registeredRefs: Map<string, RegisteredCapabilityRef> = new Map();

  constructor(protected mcpServer: McpServer) {}

  public getItem(id: string): T | undefined {
    return this.items.get(id)?.item;
  }

  public getItemInfo(
    id: string
  ): ({ item: T } & ProviderServerMeta) | undefined {
    return this.items.get(id);
  }

  public listItems(): T[] {
    return Array.from(this.items.values()).map(({ item }) => item);
  }

  public listItemsWithIds(): [string, T][] {
    return Array.from(this.items.entries()).map(([id, { item }]) => [id, item]);
  }

  /**
   * Remove an item from the registry
   * @param id - ID of the item to remove
   * @returns true if the item was removed, false if it wasn't found
   */
  public removeItem(id: string): boolean {
    const result = this.items.delete(id);

    // Also remove from the McpServer if we have a reference
    this.removeFromMcp(id);

    return result;
  }

  /**
   * Remove an item from the McpServer
   * @param id - ID of the item to remove
   * @returns true if the item was removed, false if it wasn't found
   */
  protected removeFromMcp(id: string): boolean {
    const ref = this.registeredRefs.get(id);
    if (ref) {
      try {
        ref.remove();
        this.registeredRefs.delete(id);
        loggerDiscovery(`Item removed from McpServer: ${id}`);
        return true;
      } catch (error) {
        loggerDiscovery(`Error removing item from McpServer: ${id}`, error);
      }
    }
    return false;
  }

  /**
   * Remove all items from a specific provider
   * @param providerPubkey - Public key of the provider whose items should be removed
   * @returns Array of removed item IDs
   */
  public removeItemsByProvider(providerPubkey: string): string[] {
    const removed: string[] = [];
    for (const [id, meta] of this.items.entries()) {
      if (meta.providerPubkey === providerPubkey) {
        this.items.delete(id);
        this.removeFromMcp(id);
        removed.push(id);
      }
    }
    return removed;
  }

  /**
   * Remove items matching a regex pattern
   * @param pattern - Regex pattern to match against item IDs
   * @returns Array of removed item IDs
   */
  public removeItemsByPattern(pattern: RegExp): string[] {
    const removed: string[] = [];
    for (const [id, meta] of this.items.entries()) {
      if (pattern.test(id)) {
        this.items.delete(id);
        this.removeFromMcp(id);
        removed.push(id);
      }
    }
    return removed;
  }

  /**
   * Clear all items from the registry
   */
  public clear(): void {
    // Remove all items from the McpServer first
    for (const [id, ref] of this.registeredRefs.entries()) {
      try {
        ref.remove();
        loggerDiscovery(`Item removed from McpServer during clear: ${id}`);
      } catch (error) {
        loggerDiscovery(
          `Error removing item from McpServer during clear: ${id}`,
          error
        );
      }
    }
    this.registeredRefs.clear();

    // Then clear the registry
    this.items.clear();
    this.serverItems.clear();
  }

  /**
   * Store a reference to a registered capability
   * @param id - ID of the capability
   * @param ref - Reference to the registered capability
   */
  protected storeRegisteredRef(id: string, ref: RegisteredCapabilityRef): void {
    this.registeredRefs.set(id, ref);
  }

  /**
   * Register a capability with the McpServer
   * @param id - ID of the capability
   * @param item - Capability to register
   */
  protected abstract registerWithMcp(id: string, item: T): void;
}
