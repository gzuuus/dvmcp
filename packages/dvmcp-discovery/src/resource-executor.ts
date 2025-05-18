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
    const resourceCapability = resource as ResourceCapability;
    return this.execute(resourceId, resourceCapability, params);
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
          const invoice = event.tags.find((t) => t[0] === 'invoice')?.[1];
          if (!invoice) {
            throw new Error('No invoice found in payment-required event');
          }

          loggerDiscovery(
            'Payment required for resource execution. Invoice:',
            invoice
          );

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

          const success = await this.nwcPaymentHandler.payInvoice(invoice);
          if (success) {
            loggerDiscovery(
              'Payment successful, waiting for resource response...'
            );
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
