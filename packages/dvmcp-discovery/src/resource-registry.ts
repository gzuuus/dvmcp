import { type Resource } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCapabilityId } from './utils/capabilities';

export class ResourceRegistry {
  // Store all resources with their source information
  private resources: Map<
    string,
    {
      resource: Resource;
      providerPubkey?: string;
      serverId?: string;
    }
  > = new Map();

  // Store server resources by server ID
  private serverResources: Map<string, Resource[]> = new Map();

  constructor(private mcpServer: McpServer) {}

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
      this.resources.set(resourceId, { resource, providerPubkey, serverId });
      this.registerWithMcp(resourceId, resource);
      loggerDiscovery(`Registered resource: ${resourceId}`);
    } catch (error) {
      console.error(`Error registering resource ${resourceId}:`, error);
      throw error;
    }
  }

  /**
   * Get resource information by ID
   * @param resourceId - ID of the resource
   * @returns Resource information or undefined if not found
   */
  public getResourceInfo(resourceId: string) {
    return this.resources.get(resourceId);
  }

  /**
   * Get a resource by its ID
   * @param resourceId - ID of the resource
   * @returns Resource or undefined if not found
   */
  public getResource(resourceId: string): Resource | undefined {
    return this.resources.get(resourceId)?.resource;
  }

  /**
   * List all resources in the registry
   * @returns Array of resources
   */
  public listResources(): Resource[] {
    return Array.from(this.resources.values()).map(({ resource }) => resource);
  }

  /**
   * List all resources with their IDs
   * @returns Array of [resourceId, resource] pairs
   */
  public listResourcesWithIds(): [string, Resource][] {
    return Array.from(this.resources.entries()).map(([id, info]) => [
      id,
      info.resource,
    ]);
  }

  /**
   * Clear all resources from the registry
   */
  public clear(): void {
    this.resources.clear();
    this.serverResources.clear();
  }

  /**
   * Remove a resource from the registry
   * @param resourceId - ID of the resource to remove
   * @returns true if the resource was removed, false if it wasn't found
   */
  public removeResource(resourceId: string): boolean {
    const resourceInfo = this.resources.get(resourceId);

    // If resource doesn't exist, return false
    if (!resourceInfo) {
      loggerDiscovery(`Resource not found for removal: ${resourceId}`);
      return false;
    }

    // Remove the resource from the registry
    this.resources.delete(resourceId);
    loggerDiscovery(`Resource removed from registry: ${resourceId}`);

    // Note: The MCP server doesn't have a direct method to remove resources
    // The resource list changed notification will be handled by the discovery server
    return true;
  }

  /**
   * Remove all resources from a specific provider
   * @param providerPubkey - Public key of the provider whose resources should be removed
   * @returns Array of removed resource IDs
   */
  public removeResourcesByProvider(providerPubkey: string): string[] {
    const removedResourceIds: string[] = [];

    // Find all resources from this provider
    for (const [id, info] of this.resources.entries()) {
      // Check if this resource belongs to the specified provider
      if (info.providerPubkey === providerPubkey) {
        // Remove the resource
        this.resources.delete(id);
        removedResourceIds.push(id);
        loggerDiscovery(
          `Removed resource ${id} from provider ${providerPubkey}`
        );
      }
    }

    return removedResourceIds;
  }

  /**
   * Remove resources matching a regex pattern
   * @param pattern - Regex pattern to match against resource IDs
   * @returns Array of removed resource IDs
   */
  public removeResourcesByPattern(pattern: RegExp): string[] {
    const removedResourceIds: string[] = [];

    // Find all resources matching the pattern
    for (const [id, info] of this.resources.entries()) {
      // Check if this resource ID matches the pattern
      if (pattern.test(id)) {
        // Remove the resource
        this.resources.delete(id);
        removedResourceIds.push(id);
        loggerDiscovery(`Removed resource ${id} matching pattern ${pattern}`);
      }
    }

    return removedResourceIds;
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

  private registerWithMcp(resourceId: string, resource: Resource): void {
    try {
      // Ensure we have a valid MIME type
      const mimeType = resource.mimeType || 'text/plain';

      // Check if this is a collection resource (URI ends with '/')
      const isCollection = resource.uri.endsWith('/');

      if (isCollection) {
        // For collection resources, register with list capability
        this.registerCollectionResource(resourceId, resource, mimeType);
      } else {
        // For individual resources, register as a simple resource
        this.registerIndividualResource(resourceId, resource, mimeType);
      }

      loggerDiscovery('Resource registered successfully:', resourceId);
    } catch (error) {
      console.error('Error registering resource:', resourceId, error);
    }
  }

  /**
   * Register a collection resource (a resource that can list child resources)
   * @param resourceId - ID of the resource
   * @param resource - Resource definition
   * @param mimeType - MIME type of the resource
   */
  private registerCollectionResource(
    resourceId: string,
    resource: Resource,
    mimeType: string
  ): void {
    // Create a list callback that returns an empty list by default
    // This can be extended in the future to return actual child resources
    const listCallback = async () => {
      return { resources: [] };
    };

    // Create a resource template with the collection URI pattern
    const template = new ResourceTemplate(resource.uri, { list: listCallback });

    // Register the resource with the MCP server
    this.mcpServer.resource(resourceId, template, async (uri, params) => {
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
        return this.createResourceResponse(uri.href, result, mimeType);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `Error executing collection resource ${resourceId}:`,
          errorMessage
        );
        throw error;
      }
    });
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
    this.mcpServer.resource(resourceId, resource.uri, async (uri, params) => {
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
        return this.createResourceResponse(uri.href, result, mimeType);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `Error executing individual resource ${resourceId}:`,
          errorMessage
        );
        throw error;
      }
    });
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
  ): { contents: Array<any> } {
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
    uri: URL,
    params: Record<string, string>
  ) => Promise<unknown>;

  /**
   * Set the execution callback for resources
   * @param callback - Callback function to execute resources
   */
  public setExecutionCallback(
    callback: (
      resourceId: string,
      uri: URL,
      params: Record<string, string>
    ) => Promise<unknown>
  ): void {
    this.executionCallback = callback;
  }
}
