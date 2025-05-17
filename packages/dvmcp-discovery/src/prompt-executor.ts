import { type Event } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { PromptRegistry, type PromptDefinition } from './prompt-registry.js';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  TAG_PUBKEY,
  TAG_EVENT_ID,
  TAG_METHOD,
  TAG_SERVER_IDENTIFIER,
  TAG_STATUS,
} from '@dvmcp/commons/constants';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { NWCPaymentHandler } from './nwc-payment';
import { getConfig } from './config';
import type { GetPromptRequest } from '@modelcontextprotocol/sdk/types.js';

interface ExecutionContext {
  timeoutId: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export class PromptExecutor {
  private executionSubscriptions: Map<string, () => void> = new Map();
  private static readonly EXECUTION_TIMEOUT = 30000;
  private nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    private relayHandler: RelayHandler,
    private keyManager: ReturnType<typeof createKeyManager>,
    private promptRegistry: PromptRegistry
  ) {
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
    this.relayHandler = relayHandler;
    loggerDiscovery('Updated relay handler in prompt executor');
  }

  public async executePrompt(
    promptId: string,
    prompt: PromptDefinition,
    args: Record<string, string>
  ): Promise<unknown> {
    // Handle external prompts via Nostr
    return new Promise((resolve, reject) => {
      const request = this.createPromptRequest(promptId, prompt, args);
      const executionId = request.id;
      const context = this.createExecutionContext(executionId);

      const subscription = this.relayHandler.subscribeToRequests(
        (event) => {
          if (
            event.tags.some(
              (t) => t[0] === TAG_EVENT_ID && t[1] === executionId
            )
          ) {
            this.handlePromptResponse(event, context, resolve, reject);
          }
        },
        {
          kinds: [RESPONSE_KIND, NOTIFICATION_KIND],
          since: Math.floor(Date.now() / 1000),
        }
      );

      this.executionSubscriptions.set(executionId, subscription.close);

      this.relayHandler.publishEvent(request).catch((err) => {
        clearTimeout(context.timeoutId);
        context.cleanup();
        reject(err);
      });
    });
  }

  public cleanup(): void {
    for (const sub of this.executionSubscriptions.values()) {
      sub();
    }
    this.executionSubscriptions.clear();

    // Clean up the NWC payment handler if it exists
    if (this.nwcPaymentHandler) {
      this.nwcPaymentHandler.cleanup();
    }
  }

  private createExecutionContext(executionId: string): ExecutionContext {
    const timeoutId = setTimeout(() => {
      loggerDiscovery('Execution timeout for:', executionId);
      this.cleanupExecution(executionId);
    }, PromptExecutor.EXECUTION_TIMEOUT);

    const cleanup = () => this.cleanupExecution(executionId);
    return { timeoutId, cleanup };
  }

  private cleanupExecution(executionId: string): void {
    const sub = this.executionSubscriptions.get(executionId);
    if (sub) {
      sub();
      this.executionSubscriptions.delete(executionId);
    }
  }

  private async handlePromptResponse(
    event: Event,
    context: ExecutionContext,
    resolve: (value: unknown) => void,
    reject: (reason: Error) => void
  ): Promise<void> {
    if (event.kind === RESPONSE_KIND) {
      try {
        // Parse the response content according to the DVMCP specification
        const response = JSON.parse(event.content);

        // Check if it's an error response
        if (response.error) {
          clearTimeout(context.timeoutId);
          context.cleanup();
          reject(new Error(response.error.message || 'Unknown error'));
          return;
        }

        // Check if it's an execution error (isError flag)
        if (response.isError === true) {
          clearTimeout(context.timeoutId);
          context.cleanup();
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
        clearTimeout(context.timeoutId);
        context.cleanup();

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
        clearTimeout(context.timeoutId);
        context.cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    } else if (event.kind === NOTIFICATION_KIND) {
      // Check for method tag (MCP notification) or status tag (Nostr notification)
      const method = event.tags.find((t) => t[0] === TAG_METHOD)?.[1];
      const status = event.tags.find((t) => t[0] === TAG_STATUS)?.[1];

      // Handle error notifications
      if (status === 'error' || method === 'error') {
        clearTimeout(context.timeoutId);
        context.cleanup();
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
            clearTimeout(context.timeoutId);
            context.cleanup();
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
          clearTimeout(context.timeoutId);
          context.cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  private createPromptRequest(
    promptId: string,
    prompt: PromptDefinition,
    args: Record<string, string>
  ): Event {
    // Use the new request kind
    const request = this.keyManager.createEventTemplate(REQUEST_KIND); // 25910

    const promptInfo = this.promptRegistry.getPromptInfo(promptId);
    if (!promptInfo) throw new Error(`Prompt ${promptId} not found`);

    // Create a JSON-RPC request object according to the DVMCP specification
    const requestContent: GetPromptRequest = {
      method: 'prompts/get',
      params: {
        name: prompt.name,
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
    request.tags.push([TAG_METHOD, 'prompts/get']);

    // Add server ID tag if available
    if (promptInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, promptInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
