import {
  type ReadResourceRequest,
  type ReadResourceResult,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { BaseRegistry } from './base-registry';
import type { Capability } from './base-interfaces';
import { createCapabilityId } from '@dvmcp/commons/utils';

export interface ResourceCapability extends Resource, Capability {
  type: 'resource';
}

export class ResourceRegistry extends BaseRegistry<ResourceCapability> {
  private serverResources: Map<string, Resource[]> = new Map();

  constructor(mcpServer: McpServer) {
    super(mcpServer);
  }

  /**
   * Register a resource with the registry
   * @param resourceId - ID of the resource
   * @param resource - Resource definition
   * @param providerPubkey - Provider's public key
   * @param serverId - Server's unique identifier
   */
  public registerResource(
    resourceId: string,
    resource: Resource,
    providerPubkey: string,
    serverId?: string
  ): void {
    try {
      const resourceCapability: ResourceCapability = {
        ...resource,
        id: resourceId,
        type: 'resource',
      };

      this.items.set(resourceId, {
        item: resourceCapability,
        providerPubkey,
        serverId,
      });
      this.registerWithMcp(resourceId, resourceCapability);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get resource information by ID
   * @param resourceId - ID of the resource
   * @returns Resource information or undefined if not found
   */
  public getResourceInfo(resourceId: string) {
    const info = this.getItemInfo(resourceId);
    if (!info) return undefined;

    return info;
  }

  /**
   * Get a resource by its ID
   * @param resourceId - ID of the resource
   * @returns Resource or undefined if not found
   */
  public getResource(resourceId: string): Resource | undefined {
    return this.getItem(resourceId);
  }

  /**
   * List all resources in the registry
   * @returns Array of resources
   */
  public listResources(): Resource[] {
    return this.listItems();
  }

  /**
   * List all resources with their IDs
   * @returns Array of [resourceId, resource] pairs
   */
  public listResourcesWithIds(): [string, Resource][] {
    return this.listItemsWithIds();
  }

  /**
   * Clear all resources from the registry
   */
  public clear(): void {
    super.clear();
    this.serverResources.clear();
  }

  /**
   * Remove a resource from the registry
   * @param resourceId - ID of the resource to remove
   * @returns true if the resource was removed, false if it wasn't found
   */
  public removeResource(resourceId: string): boolean {
    const resourceInfo = this.getItemInfo(resourceId);

    if (!resourceInfo) {
      loggerDiscovery(`Resource not found for removal: ${resourceId}`);
      return false;
    }

    const result = this.removeItem(resourceId);
    if (result) {
      loggerDiscovery(`Resource removed from registry: ${resourceId}`);
    }

    return result;
  }

  /**
   * Remove all resources from a specific provider
   * @param providerPubkey - Public key of the provider whose resources should be removed
   * @returns Array of removed resource IDs
   */
  public removeResourcesByProvider(providerPubkey: string): string[] {
    return this.removeItemsByProvider(providerPubkey);
  }

  /**
   * Remove resources matching a regex pattern
   * @param pattern - Regex pattern to match against resource IDs
   * @returns Array of removed resource IDs
   */
  public removeResourcesByPattern(pattern: RegExp): string[] {
    return this.removeItemsByPattern(pattern);
  }

  /**
   * Register resources for a server
   * @param serverId - Server's unique identifier
   * @param resources - Array of resources to register
   */
  public registerServerResources(
    serverId: string,
    resources: Resource[],
    providerPubkey: string
  ): void {
    this.serverResources.set(serverId, resources);
    loggerDiscovery(
      `Registered ${resources.length} resources for server ${serverId}`
    );

    resources.forEach((resource) => {
      const resourceId = createCapabilityId(resource.name, providerPubkey);
      this.registerResource(
        resourceId,
        resource,
        providerPubkey || '',
        serverId
      );
    });
  }

  /**
   * Get resources for a server
   * @param serverId - Server's unique identifier
   * @returns Array of resources or undefined if not found
   */
  public getServerResources(serverId: string): Resource[] | undefined {
    return this.serverResources.get(serverId);
  }

  /**
   * List all server resources
   * @returns Array of [serverId, resources] pairs
   */
  public listServerResources(): [string, Resource[]][] {
    return Array.from(this.serverResources.entries());
  }

  protected registerWithMcp(
    resourceId: string,
    resource: ResourceCapability
  ): void {
    try {
      const registeredResource = this.mcpServer.resource(
        resourceId,
        resource.uri,
        async (uri) => {
          try {
            const uriString = typeof uri === 'string' ? uri : uri.toString();
            const params = { uri: uriString };
            const result = await this.executionCallback?.(resourceId, params);

            return (
              result || {
                contents: [
                  {
                    text: `Resource not found: ${uriString}`,
                    uri: uriString,
                    mimeType: 'text/plain',
                  },
                ],
              }
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(
              `Error executing resource ${resourceId}:`,
              errorMessage
            );
            const uriString = typeof uri === 'string' ? uri : uri.toString();
            return {
              contents: [
                {
                  text: `Error: ${errorMessage}`,
                  uri: uriString,
                  mimeType: 'text/plain',
                },
              ],
            };
          }
        }
      );

      this.storeRegisteredRef(resourceId, registeredResource);

      loggerDiscovery('Resource registered successfully:', resourceId);
    } catch (error) {
      console.error('Error registering resource:', resourceId, error);
    }
  }

  private executionCallback?: (
    resourceId: string,
    params: ReadResourceRequest['params']
  ) => Promise<ReadResourceResult>;

  /**
   * Set the execution callback for resources
   * @param callback - Callback function to execute resources
   */
  public setExecutionCallback(
    callback: (
      resourceId: string,
      params: ReadResourceRequest['params']
    ) => Promise<ReadResourceResult>
  ): void {
    this.executionCallback = callback;
  }
}
