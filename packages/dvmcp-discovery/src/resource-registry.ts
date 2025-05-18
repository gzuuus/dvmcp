import {
  type Resource,
  type ResourceContents,
} from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCapabilityId } from './utils/capabilities';
import { BaseRegistry } from './base-registry';
import type { Capability } from './base-interfaces';

// Extend Resource interface to include Capability properties
export interface ResourceCapability extends Resource, Capability {
  type: 'resource';
}

export class ResourceRegistry extends BaseRegistry<ResourceCapability> {
  // Store server resources by server ID
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
      // Convert Resource to ResourceCapability
      const resourceCapability: ResourceCapability = {
        ...resource,
        id: resourceId,
        type: 'resource',
      };

      // Use the base class method to store the item
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

    // Convert back to the expected format for backward compatibility
    return {
      resource: info.item,
      providerPubkey: info.providerPubkey,
      serverId: info.serverId,
    };
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

    // If resource doesn't exist, return false
    if (!resourceInfo) {
      loggerDiscovery(`Resource not found for removal: ${resourceId}`);
      return false;
    }

    // Use the base class method to remove the item
    const result = this.removeItem(resourceId);
    if (result) {
      loggerDiscovery(`Resource removed from registry: ${resourceId}`);
    }

    // Note: The MCP server doesn't have a direct method to remove resources
    // The resource list changed notification will be handled by the discovery server
    return result;
  }

  /**
   * Remove all resources from a specific provider
   * @param providerPubkey - Public key of the provider whose resources should be removed
   * @returns Array of removed resource IDs
   */
  public removeResourcesByProvider(providerPubkey: string): string[] {
    // Use the base class method
    return this.removeItemsByProvider(providerPubkey);
  }

  /**
   * Remove resources matching a regex pattern
   * @param pattern - Regex pattern to match against resource IDs
   * @returns Array of removed resource IDs
   */
  public removeResourcesByPattern(pattern: RegExp): string[] {
    // Use the base class method
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

    // Register each resource individually
    resources.forEach((resource, index) => {
      const resourceId = createCapabilityId(resource.uri, providerPubkey);
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
      // Ensure we have a valid MIME type
      const mimeType = resource.mimeType || 'text/plain';

      this.registerIndividualResource(resourceId, resource, mimeType);

      loggerDiscovery('Resource registered successfully:', resourceId);
    } catch (error) {
      console.error('Error registering resource:', resourceId, error);
    }
  }

  /**
   * Register an individual resource (a resource that doesn't list child resources)
   * @param resourceId - ID of the resource
   * @param resource - Resource definition
   * @param mimeType - MIME type of the resource
   */
  private registerIndividualResource(
    resourceId: string,
    resource: Resource,
    mimeType: string
  ): void {
    // Register the resource directly with the MCP server (no template)
    this.mcpServer.resource(
      resourceId,
      resource.uri,
      async (uri: string, params: Record<string, unknown>) => {
        try {
          // Convert params to a simple Record<string, string> for the callback
          const simpleParams: Record<string, string> = {};
          for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string') {
              simpleParams[key] = value;
            } else if (Array.isArray(value)) {
              simpleParams[key] = value.join(',');
            }
          }

          // Call the execution callback if set
          const result = await this.executionCallback?.(
            resourceId,
            uri,
            simpleParams
          );

          // Prepare the response based on the result type
          return this.createResourceResponse(uri, result, mimeType);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `Error executing individual resource ${resourceId}:`,
            errorMessage
          );
          throw error;
        }
      }
    );
  }

  /**
   * Create a resource response object based on the result type and MIME type
   * @param uri - Resource URI
   * @param result - Result from the execution callback
   * @param mimeType - MIME type of the resource
   * @returns Resource response object
   */
  private createResourceResponse(
    uri: string,
    result: unknown,
    mimeType: string
  ): { contents: Array<ResourceContents> } {
    // Determine if this is a binary resource based on the MIME type
    const isBinary =
      mimeType.startsWith('image/') ||
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('application/octet-stream');

    // Create the appropriate response based on the resource type
    if (isBinary && typeof result === 'string') {
      // For binary resources, return blob data
      return {
        contents: [
          {
            uri,
            blob: result,
            mimeType,
          },
        ],
      };
    } else {
      // For text resources, return text content
      return {
        contents: [
          {
            uri,
            text: String(result || ''),
            mimeType,
          },
        ],
      };
    }
  }

  private executionCallback?: (
    resourceId: string,
    uri: string,
    params: unknown
  ) => Promise<unknown>;

  /**
   * Set the execution callback for resources
   * @param callback - Callback function to execute resources
   */
  public setExecutionCallback(
    callback: (
      resourceId: string,
      uri: string,
      params: unknown
    ) => Promise<unknown>
  ): void {
    this.executionCallback = callback;
  }
}
