import { type Event as NostrEvent } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { PromptRegistry, type PromptCapability } from './prompt-registry';
import { BaseExecutor } from './base-executor';
import type { ExecutionContext } from './base-interfaces';
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
import type { DvmcpDiscoveryConfig } from './config-schema';
import type {
  GetPromptRequest,
  GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js';
// TODO: add completion feature
export class PromptExecutor extends BaseExecutor<
  PromptCapability,
  GetPromptRequest['params']['arguments'],
  GetPromptResult
> {
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    relayHandler: RelayHandler,
    keyManager: ReturnType<typeof createKeyManager>,
    private promptRegistry: PromptRegistry,
    private config: DvmcpDiscoveryConfig
  ) {
    super(relayHandler, keyManager, promptRegistry);

    try {
      if (this.config.nwc?.connectionString) {
        this.nwcPaymentHandler = new NWCPaymentHandler(this.config);
      }
    } catch (error) {
      loggerDiscovery('Failed to initialize NWC payment handler:', error);
    }
  }

  /**
   * Update the relay handler reference
   * This is needed when new relays are added to the pool
   * @param relayHandler - The updated relay handler
   */
  public updateRelayHandler(relayHandler: RelayHandler): void {
    super.updateRelayHandler(relayHandler);
  }

  /**
   * Execute a prompt with the given ID and parameters
   * @param promptId - ID of the prompt to execute
   * @param args - Parameters to pass to the prompt
   * @returns Prompt execution result
   */
  public async executePrompt(
    promptId: string,
    args: GetPromptRequest['params']['arguments']
  ): Promise<GetPromptResult> {
    const promptInfo = this.promptRegistry.getPromptInfo(promptId);
    if (!promptInfo) {
      throw new Error(`Prompt ${promptId} not found`);
    }

    const prompt = promptInfo.item as PromptCapability;

    return this.execute(promptId, prompt, args);
  }

  public cleanup(): void {
    super.cleanup();

    if (this.nwcPaymentHandler) {
      this.nwcPaymentHandler.cleanup();
    }
  }

  /**
   * Handle a prompt response event
   * @param event - Nostr event containing the response
   * @param context - Execution context
   * @param resolve - Function to resolve the promise
   * @param reject - Function to reject the promise
   */
  protected async handleResponse(
    event: NostrEvent,
    context: ExecutionContext,
    resolve: (value: GetPromptResult) => void,
    reject: (reason: Error) => void
  ): Promise<void> {
    if (event.kind === RESPONSE_KIND) {
      try {
        const response = JSON.parse(event.content);

        if (response.error) {
          this.cleanupExecution(context.executionId);
          reject(new Error(response.error.message || 'Unknown error'));
          return;
        }

        if (response.isError === true) {
          this.cleanupExecution(context.executionId);
          reject(
            new Error(
              typeof response.content === 'string'
                ? response.content
                : 'Prompt execution error'
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
            'Payment required for prompt execution. Invoice:',
            invoice
          );

          if (!this.nwcPaymentHandler) {
            loggerDiscovery(
              'NWC payment handler not configured. Cannot process payment automatically.'
            );
            this.cleanupExecution(context.executionId);
            reject(
              new Error(
                'Prompt requires payment but NWC is not configured. Please add NWC configuration to use paid prompts.'
              )
            );
            return;
          }

          const success = await this.nwcPaymentHandler.payInvoice(invoice);
          if (success) {
            loggerDiscovery(
              'Payment successful, waiting for prompt response...'
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
   * Create a prompt request event
   * @param id - ID of the prompt
   * @param item - Prompt capability
   * @param args - Prompt arguments
   * @returns Nostr event for the request
   */
  protected createRequest(
    id: string,
    item: PromptCapability,
    args: GetPromptRequest['params']['arguments']
  ): NostrEvent {
    const request = this.keyManager.createEventTemplate(REQUEST_KIND);

    const promptInfo = this.promptRegistry.getPromptInfo(id);
    if (!promptInfo) throw new Error(`Prompt ${id} not found`);

    const requestContent: GetPromptRequest = {
      method: 'prompts/get',
      params: {
        name: item.name,
        arguments: args,
      },
    };

    request.content = JSON.stringify(requestContent);

    if (promptInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, promptInfo.providerPubkey]);
    }
    request.tags.push([TAG_METHOD, requestContent.method]);

    if (promptInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, promptInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
