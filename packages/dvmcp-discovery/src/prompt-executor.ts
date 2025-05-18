import { type Event as NostrEvent } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { PromptRegistry, type PromptCapability } from './prompt-registry.js';
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
import { getConfig } from './config';
import type {
  GetPromptRequest,
  GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js';

export class PromptExecutor extends BaseExecutor<
  PromptCapability,
  GetPromptRequest['params']['arguments'],
  GetPromptResult
> {
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    relayHandler: RelayHandler,
    keyManager: ReturnType<typeof createKeyManager>,
    private promptRegistry: PromptRegistry
  ) {
    super(relayHandler, keyManager, promptRegistry);

    // Initialize the NWC payment handler if NWC is configured
    try {
      if (getConfig().nwc?.connectionString) {
        this.nwcPaymentHandler = new NWCPaymentHandler();
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

    const prompt = promptInfo.prompt as PromptCapability;

    // Use the base executor's execute method
    return this.execute(promptId, prompt, args);
  }

  public cleanup(): void {
    super.cleanup();

    // Clean up the NWC payment handler if it exists
    if (this.nwcPaymentHandler) {
      this.nwcPaymentHandler.cleanup();
    }
  }

  // These methods are now handled by the BaseExecutor class

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
        // Parse the response content according to the DVMCP specification
        const response = JSON.parse(event.content);

        // Check if it's an error response
        if (response.error) {
          this.cleanupExecution(context.executionId);
          reject(new Error(response.error.message || 'Unknown error'));
          return;
        }

        // Check if it's an execution error (isError flag)
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

        // Handle successful response
        this.cleanupExecution(context.executionId);

        // Process the response according to the MCP specification
        if (
          response.messages &&
          Array.isArray(response.messages) &&
          response.messages.length > 0
        ) {
          // Return the full structured response to support all content types
          // This allows the caller to handle different content types appropriately
          resolve(response);
        } else {
          // Fallback for non-standard responses
          resolve(response);
        }
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
            'Payment required for prompt execution. Invoice:',
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
                'Prompt requires payment but NWC is not configured. Please add NWC configuration to use paid prompts.'
              )
            );
            return;
          }

          // Pay the invoice using NWC
          const success = await this.nwcPaymentHandler.payInvoice(invoice);
          if (success) {
            loggerDiscovery(
              'Payment successful, waiting for prompt response...'
            );
            // Payment successful, now we wait for the actual prompt response
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
    // Use the new request kind
    const request = this.keyManager.createEventTemplate(REQUEST_KIND); // 25910

    const promptInfo = this.promptRegistry.getPromptInfo(id);
    if (!promptInfo) throw new Error(`Prompt ${id} not found`);

    // Create a JSON-RPC request object according to the DVMCP specification
    const requestContent: GetPromptRequest = {
      method: 'prompts/get',
      params: {
        name: item.name,
        arguments: args,
      },
    };

    request.content = JSON.stringify(requestContent);

    // Add required tags according to the spec
    // Target provider pubkey
    if (promptInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, promptInfo.providerPubkey]);
    }

    // Add method tag according to the DVMCP specification
    request.tags.push([TAG_METHOD, requestContent.method]);

    // Add server ID tag if available
    if (promptInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, promptInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
