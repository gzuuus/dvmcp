import {
  type ReadResourceRequest,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplate as ResourceTemplateType,
} from '@modelcontextprotocol/sdk/types.js';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggerDiscovery } from '@dvmcp/commons/core';
import { BaseRegistry } from './base-registry';
import type { Capability, ProviderServerMeta } from './base-interfaces';
import { createCapabilityId } from '@dvmcp/commons/core';

export interface ResourceCapability extends Resource, Capability {
  type: 'resource';
}

export interface ResourceTemplateCapability
  extends ResourceTemplateType,
    Capability {
  type: 'resourceTemplate';
}

export class ResourceRegistry extends BaseRegistry<ResourceCapability> {
  private serverResources: Map<string, Resource[]> = new Map();
  private resourceTemplates: Map<
    string,
    { item: ResourceTemplateCapability } & ProviderServerMeta
  > = new Map();
  private serverResourceTemplates: Map<string, ResourceTemplateType[]> =
    new Map();

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
    this.serverResourceTemplates.clear();
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

  /**
   * Register a resource template with the registry
   * @param templateId - ID of the resource template
   * @param template - Resource template definition
   * @param providerPubkey - Provider's public key
   * @param serverId - Server's unique identifier
   */
  public registerResourceTemplate(
    templateId: string,
    template: ResourceTemplateType,
    providerPubkey: string,
    serverId?: string
  ): void {
    try {
      const templateCapability: ResourceTemplateCapability = {
        ...template,
        id: templateId,
        type: 'resourceTemplate',
      };

      this.resourceTemplates.set(templateId, {
        item: templateCapability,
        providerPubkey,
        serverId,
      });

      loggerDiscovery(`Registered resource template: ${templateId}`);

      this.registerTemplateWithMcp(templateId, templateCapability);
    } catch (error) {
      loggerDiscovery(`Error registering resource template: ${error}`);
      throw error;
    }
  }

  /**
   * Register resource templates for a server
   * @param serverId - Server's unique identifier
   * @param templates - Array of resource templates to register
   * @param providerPubkey - Provider's public key
   */
  public registerServerResourceTemplates(
    serverId: string,
    templates: ResourceTemplateType[],
    providerPubkey: string
  ): void {
    this.serverResourceTemplates.set(serverId, templates);
    loggerDiscovery(
      `Registered ${templates.length} resource templates for server ${serverId}`
    );

    templates.forEach((template) => {
      const templateId = createCapabilityId(template.name, providerPubkey);
      this.registerResourceTemplate(
        templateId,
        template,
        providerPubkey,
        serverId
      );
    });
  }

  /**
   * Get resource templates for a server
   * @param serverId - Server's unique identifier
   * @returns Array of resource templates or undefined if not found
   */
  public getServerResourceTemplates(
    serverId: string
  ): ResourceTemplateType[] | undefined {
    return this.serverResourceTemplates.get(serverId);
  }

  /**
   * List all resource templates
   * @returns Array of resource templates
   */
  public listResourceTemplates(): ResourceTemplateCapability[] {
    return Array.from(this.resourceTemplates.values()).map(({ item }) => item);
  }

  /**
   * Get a resource template by its ID
   * @param templateId - ID of the resource template
   * @returns Resource template or undefined if not found
   */
  public getResourceTemplate(
    templateId: string
  ): ResourceTemplateCapability | undefined {
    return this.resourceTemplates.get(templateId)?.item;
  }

  /**
   * Get resource template information by ID
   * @param templateId - ID of the resource template
   * @returns Resource template information or undefined if not found
   */
  public getResourceTemplateInfo(
    templateId: string
  ): ProviderServerMeta | undefined {
    const info = this.resourceTemplates.get(templateId);
    if (!info) return undefined;

    return {
      providerPubkey: info.providerPubkey,
      serverId: info.serverId,
    };
  }

  /**
   * Register a resource template with the MCP server
   * @param templateId - ID of the resource template
   * @param template - Resource template capability
   */
  protected registerTemplateWithMcp(
    templateId: string,
    template: ResourceTemplateCapability
  ): void {
    try {
      const ref = this.mcpServer.resource(
        templateId,
        new ResourceTemplate(template.uriTemplate, { list: undefined }),
        async (uri: URL | string, params: Record<string, any>) => {
          try {
            const uriString = typeof uri === 'string' ? uri : uri.toString();
            loggerDiscovery(
              `Executing resource template ${templateId} with URI: ${uriString}`
            );

            const result = await this.executionCallback?.(templateId, {
              uri: uriString,
              arguments: params,
            });
            if (!result)
              throw new Error(`No result for resource template ${templateId}`);
            return result;
          } catch (error) {
            loggerDiscovery(`Error executing resource template: ${error}`);
            return {
              contents: [
                {
                  uri: typeof uri === 'string' ? uri : uri.toString(),
                  text: `Error executing resource template: ${error}`,
                  mimeType: 'text/plain',
                },
              ],
            };
          }
        }
      );

      this.storeRegisteredRef(templateId, ref);

      loggerDiscovery(
        `Registered resource template with MCP server: ${templateId}`
      );
    } catch (error) {
      loggerDiscovery(
        `Error registering resource template with MCP server: ${error}`
      );
    }
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
