import { type Event as NostrEvent } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr';
import { type KeyManager } from '@dvmcp/commons/nostr';
import { EncryptionManager } from '@dvmcp/commons/encryption';
import type { ServerRegistry } from './server-registry'; // Import ServerRegistry
import {
  type ReadResourceRequest,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { BaseExecutor } from './base-executor';
import type { ExecutionContext } from './base-interfaces';
import { ResourceRegistry, type ResourceCapability } from './resource-registry';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  TAG_PUBKEY,
  TAG_METHOD,
  TAG_SERVER_IDENTIFIER,
  TAG_STATUS,
  TAG_INVOICE,
} from '@dvmcp/commons/core';
import { loggerDiscovery } from '@dvmcp/commons/core';
import { NWCPaymentHandler } from './nwc-payment';
import type { DvmcpDiscoveryConfig } from './config-schema';

export class ResourceExecutor extends BaseExecutor<
  ResourceCapability,
  ReadResourceRequest['params'],
  ReadResourceResult
> {
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    relayHandler: RelayHandler,
    keyManager: KeyManager,
    private resourceRegistry: ResourceRegistry,
    protected serverRegistry: ServerRegistry, // Add serverRegistry
    private config: DvmcpDiscoveryConfig,
    encryptionManager?: EncryptionManager
  ) {
    super(
      relayHandler,
      keyManager,
      resourceRegistry,
      serverRegistry,
      encryptionManager
    );

    try {
      if (this.config.nwc?.connectionString) {
        this.nwcPaymentHandler = new NWCPaymentHandler(this.config);
      }
    } catch (error) {
      loggerDiscovery.error('Failed to initialize NWC payment handler:', error);
    }
  }

  public updateRelayHandler(relayHandler: RelayHandler): void {
    super.updateRelayHandler(relayHandler);
  }

  /**
   * Execute a resource with the given ID and parameters
   * @param resourceId - ID of the resource to execute (can be resource ID or URI)
   * @param params - Parameters to pass to the resource
   * @returns Resource execution result
   */
  public async executeResource(
    resourceId: string,
    params: ReadResourceRequest['params']
  ): Promise<ReadResourceResult> {
    // First try to find a regular resource by exact ID match
    const resource = this.resourceRegistry.getResource(resourceId);
    if (resource) {
      return this.execute(resourceId, resource as ResourceCapability, params);
    }

    // If no regular resource found, try to execute as a resource template
    return this.executeResourceTemplate(resourceId, params);
  }
  // TODO: Improve this, we shouldn't need to register the temporary resource template
  /**
   * Execute a resource template by URI pattern matching
   * @param uri - URI to match against resource templates
   * @param params - Parameters to pass to the resource
   * @returns Resource execution result
   */
  private async executeResourceTemplate(
    uri: string,
    params: ReadResourceRequest['params']
  ): Promise<ReadResourceResult> {
    const templateMatch = this.resourceRegistry.findResourceTemplateByUri(uri);
    if (!templateMatch) {
      throw new Error(`Resource not found: ${uri}`);
    }

    const { templateId, template } = templateMatch;
    const templateInfo =
      this.resourceRegistry.getResourceTemplateInfo(templateId);
    if (!templateInfo) {
      throw new Error(`Template info not found for: ${templateId}`);
    }

    // Convert resource template to resource capability for execution
    const resourceCapability: ResourceCapability = {
      id: uri,
      name: template.name,
      description: template.description,
      uri: uri,
      type: 'resource',
      pricing: template.pricing,
    };

    // Execute with temporary registration to provide provider info to createRequest
    return this.executeWithTemporaryRegistration(
      uri,
      resourceCapability,
      templateInfo.providerPubkey || '',
      templateInfo.serverId,
      params
    );
  }

  /**
   * Execute a resource with temporary registration for provider info lookup
   */
  private async executeWithTemporaryRegistration(
    resourceId: string,
    resourceCapability: ResourceCapability,
    providerPubkey: string,
    serverId: string | undefined,
    params: ReadResourceRequest['params']
  ): Promise<ReadResourceResult> {
    // Temporarily register the resource capability
    this.resourceRegistry.registerResource(
      resourceId,
      resourceCapability,
      providerPubkey,
      serverId
    );

    try {
      return await this.execute(resourceId, resourceCapability, params);
    } finally {
      // Always clean up the temporary registration
      this.resourceRegistry.removeResource(resourceId);
    }
  }

  public cleanup(): void {
    super.cleanup();

    if (this.nwcPaymentHandler) {
      this.nwcPaymentHandler.cleanup();
    }
  }

  /**
   * Handle a resource response event
   * @param event - Nostr event containing the response
   * @param context - Execution context
   * @param resolve - Function to resolve the promise
   * @param reject - Function to reject the promise
   */
  protected async handleResponse(
    event: NostrEvent,
    context: ExecutionContext,
    resolve: (value: ReadResourceResult) => void,
    reject: (reason: Error) => void
  ): Promise<void> {
    if (event.kind === RESPONSE_KIND) {
      try {
        const response = JSON.parse(event.content);

        if (response.error) {
          this.cleanupExecution(context.executionId);
          reject(new Error('Read resource parse error'));
          return;
        }

        if (response.isError === true) {
          this.cleanupExecution(context.executionId);
          reject(
            new Error(
              typeof response.content === 'string'
                ? response.content
                : 'Resource execution error'
            )
          );
          return;
        }

        this.cleanupExecution(context.executionId);
        resolve(response);
      } catch (error) {
        this.cleanupExecution(context.executionId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    } else if (event.kind === NOTIFICATION_KIND) {
      const method = event.tags.find((t) => t[0] === TAG_METHOD)?.[1];
      const status = event.tags.find((t) => t[0] === TAG_STATUS)?.[1];

      if (status === 'error' || method === 'error') {
        this.cleanupExecution(context.executionId);
        reject(new Error(event.content || 'Error notification received'));
        return;
      }

      if (status === 'payment-required') {
        try {
          const invoice = event.tags.find((t) => t[0] === TAG_INVOICE)?.[1];
          if (!invoice) {
            throw new Error('No invoice found in payment-required event');
          }

          loggerDiscovery.info(
            'Payment required for resource execution. Invoice:',
            invoice
          );

          if (!this.nwcPaymentHandler) {
            loggerDiscovery.warn(
              'NWC payment handler not configured. Cannot process payment automatically.'
            );
            this.cleanupExecution(context.executionId);
            reject(
              new Error(
                'Resource requires payment but NWC is not configured. Please add NWC configuration to use paid resources.'
              )
            );
            return;
          }

          const success = await this.nwcPaymentHandler.payInvoice(invoice);
          if (success) {
            loggerDiscovery.info(
              'Payment successful, waiting for resource response...'
            );
          } else {
            throw new Error('Payment failed');
          }
        } catch (error) {
          loggerDiscovery.error('Payment error:', error);
          this.cleanupExecution(context.executionId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  /**
   * Create a resource request event
   * @param id - ID of the resource
   * @param item - Resource capability
   * @param args - Resource arguments
   * @returns Nostr event for the request
   */
  protected createRequest(
    id: string,
    item: ResourceCapability,
    args: ReadResourceRequest['params']['arguments']
  ): NostrEvent {
    const request = this.keyManager.createEventTemplate(REQUEST_KIND);

    const resourceInfo = this.resourceRegistry.getResourceInfo(id);
    if (!resourceInfo) throw new Error(`Resource ${id} not found`);

    const requestContent: ReadResourceRequest = {
      method: 'resources/read',
      params: {
        uri: item.uri,
        arguments: args,
      },
    };

    request.content = JSON.stringify({
      ...requestContent,
    });

    if (resourceInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, resourceInfo.providerPubkey]);
    }
    if (resourceInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, resourceInfo.providerPubkey]);
    }
    request.tags.push([TAG_METHOD, requestContent.method]);

    if (resourceInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, resourceInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
