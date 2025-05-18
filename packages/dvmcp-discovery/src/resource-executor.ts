import { type Event as NostrEvent } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { type KeyManager } from '@dvmcp/commons/nostr/key-manager';
import {
  type ReadResourceRequest,
  type ReadResourceResult,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';
import { BaseExecutor } from './base-executor';
import type { ExecutionContext } from './base-interfaces';
import {
  ResourceRegistry,
  type ResourceCapability,
} from './resource-registry.js';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  TAG_PUBKEY,
  TAG_METHOD,
  TAG_SERVER_IDENTIFIER,
  TAG_STATUS,
} from '@dvmcp/commons/constants';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { NWCPaymentHandler } from './nwc-payment';
import { getConfig } from './config';

export class ResourceExecutor extends BaseExecutor<
  ResourceCapability,
  ReadResourceRequest['params'],
  ReadResourceResult
> {
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    relayHandler: RelayHandler,
    keyManager: KeyManager,
    private resourceRegistry: ResourceRegistry
  ) {
    super(relayHandler, keyManager, resourceRegistry);

    try {
      if (getConfig().nwc?.connectionString) {
        this.nwcPaymentHandler = new NWCPaymentHandler();
      }
    } catch (error) {
      loggerDiscovery('Failed to initialize NWC payment handler:', error);
    }
  }

  public updateRelayHandler(relayHandler: RelayHandler): void {
    super.updateRelayHandler(relayHandler);
  }

  /**
   * Execute a resource with the given ID, and parameters
   * @param resourceId - ID of the resource to execute
   * @param resource - Resource definition
   * @param params - Parameters to pass to the resource
   * @returns Resource execution result
   */
  public async executeResource(
    resourceId: string,
    resource: Resource,
    params: ReadResourceRequest['params']
  ): Promise<ReadResourceResult> {
    // Convert Resource to ResourceCapability if needed
    const resourceCapability = resource as ResourceCapability;

    // Use the base executor's execute method
    return this.execute(resourceId, resourceCapability, params);
  }

  public cleanup(): void {
    super.cleanup();

    // Clean up the NWC payment handler if it exists
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
        // Parse the response content according to the DVMCP specification
        const response: ReadResourceResult = JSON.parse(event.content);

        // Check if it's an error response
        if (response.error) {
          this.cleanupExecution(context.executionId);
          reject(new Error('Read resource parse error'));
          return;
        }

        // Check if it's an execution error (isError flag)
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

        // Handle successful response
        this.cleanupExecution(context.executionId);
        resolve(response);
      } catch (error) {
        this.cleanupExecution(context.executionId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    } else if (event.kind === NOTIFICATION_KIND) {
      // Check for method tag (MCP notification) or status tag (Nostr notification)
      const method = event.tags.find((t) => t[0] === TAG_METHOD)?.[1];
      const status = event.tags.find((t) => t[0] === TAG_STATUS)?.[1];

      // Handle error notifications
      if (status === 'error' || method === 'error') {
        this.cleanupExecution(context.executionId);
        reject(new Error(event.content || 'Error notification received'));
        return;
      }

      // Handle payment required notifications
      if (status === 'payment-required') {
        try {
          // Extract the invoice from the event
          const invoice = event.tags.find((t) => t[0] === 'invoice')?.[1];
          if (!invoice) {
            throw new Error('No invoice found in payment-required event');
          }

          loggerDiscovery(
            'Payment required for resource execution. Invoice:',
            invoice
          );

          // Check if we have a payment handler
          if (!this.nwcPaymentHandler) {
            loggerDiscovery(
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

          // Pay the invoice using NWC
          const success = await this.nwcPaymentHandler.payInvoice(invoice);
          if (success) {
            loggerDiscovery(
              'Payment successful, waiting for resource response...'
            );
            // Payment successful, now we wait for the actual resource response
            // Don't resolve or reject here, just continue waiting
          } else {
            throw new Error('Payment failed');
          }
        } catch (error) {
          loggerDiscovery('Payment error:', error);
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
   * @param params - Resource parameters
   * @returns Nostr event for the request
   */
  protected createRequest(
    id: string,
    item: ResourceCapability,
    params: ReadResourceRequest['params']
  ): NostrEvent {
    // Use the new request kind
    const request = this.keyManager.createEventTemplate(REQUEST_KIND); // 25910

    const resourceInfo = this.resourceRegistry.getResourceInfo(id);
    if (!resourceInfo) throw new Error(`Resource ${id} not found`);

    // Create a JSON-RPC request object according to the DVMCP specification
    const requestContent: ReadResourceRequest = {
      method: 'resources/read',
      params: {
        uri: item.uri,
        arguments: params,
      },
    };

    // Create a JSON-RPC request object according to the DVMCP specification
    request.content = JSON.stringify({
      ...requestContent,
    });

    // Add required tags according to the spec
    // Target provider pubkey
    if (resourceInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, resourceInfo.providerPubkey]);
    }

    // Add method tag according to the DVMCP specification
    request.tags.push([TAG_METHOD, requestContent.method]);

    // Add server ID tag if available
    if (resourceInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, resourceInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
