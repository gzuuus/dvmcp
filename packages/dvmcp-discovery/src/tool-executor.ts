import { type Event as NostrEvent } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr';
import { createKeyManager } from '@dvmcp/commons/nostr';
import type {
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry';
import type { ToolCapability } from './tool-registry';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  TAG_PUBKEY,
  TAG_METHOD,
  TAG_SERVER_IDENTIFIER,
  TAG_STATUS,
} from '@dvmcp/commons/core';
import { loggerDiscovery } from '@dvmcp/commons/core';
import { NWCPaymentHandler } from './nwc-payment';
import type { DvmcpDiscoveryConfig } from './config-schema';
import { BaseExecutor } from './base-executor';
import type { ExecutionContext } from './base-interfaces';
import type { EncryptionManager } from '@dvmcp/commons/encryption';
import type { ServerRegistry } from './server-registry'; // Import ServerRegistry

export class ToolExecutor extends BaseExecutor<
  ToolCapability,
  CallToolRequest['params'],
  CallToolResult
> {
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    relayHandler: RelayHandler,
    keyManager: ReturnType<typeof createKeyManager>,
    private toolRegistry: ToolRegistry,
    protected serverRegistry: ServerRegistry, // Change to protected
    private config: DvmcpDiscoveryConfig,
    encryptionManager?: EncryptionManager
  ) {
    super(
      relayHandler,
      keyManager,
      toolRegistry,
      serverRegistry,
      encryptionManager
    );

    // Initialize NWC payment handler if needed
    this.initializeNWCPaymentHandler();
  }

  /**
   * Initialize the NWC payment handler
   * @private
   */
  private initializeNWCPaymentHandler(): void {
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
   * Execute a tool with the given ID and parameters
   * @param toolId - ID of the tool to execute
   * @param params - Parameters to pass to the tool
   * @returns Tool execution result
   */
  public async executeTool(
    toolId: string,
    params: CallToolRequest['params']
  ): Promise<CallToolResult> {
    const toolInfo = this.toolRegistry.getToolInfo(toolId);
    if (!toolInfo) {
      throw new Error(`Tool ${toolId} not found`);
    }

    const tool = toolInfo.item as ToolCapability;

    return this.execute(toolId, tool, params);
  }

  public cleanup(): void {
    super.cleanup();

    if (this.nwcPaymentHandler) {
      this.nwcPaymentHandler.cleanup();
    }
  }

  /**
   * Handle a tool response event
   * @param event - Nostr event containing the response
   * @param context - Execution context
   * @param resolve - Function to resolve the promise
   * @param reject - Function to reject the promise
   */
  protected async handleResponse(
    event: NostrEvent,
    context: ExecutionContext,
    resolve: (value: CallToolResult) => void,
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
                : 'Tool execution error'
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
            'Payment required for tool execution. Invoice:',
            invoice
          );

          if (!this.nwcPaymentHandler) {
            loggerDiscovery(
              'NWC payment handler not configured. Cannot process payment automatically.'
            );
            this.cleanupExecution(context.executionId);
            reject(
              new Error(
                'Tool requires payment but NWC is not configured. Please add NWC configuration to use paid tools.'
              )
            );
            return;
          }

          const success = await this.nwcPaymentHandler.payInvoice(invoice);
          if (success) {
            loggerDiscovery('Payment successful, waiting for tool response...');
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
   * Create a tool request event
   * @param id - ID of the tool
   * @param item - Tool capability
   * @param params - Tool parameters
   * @returns Nostr event for the request
   */
  protected createRequest(
    id: string,
    item: ToolCapability,
    args: CallToolRequest['params']['arguments']
  ): NostrEvent {
    const request = this.keyManager.createEventTemplate(REQUEST_KIND);

    const toolInfo = this.toolRegistry.getToolInfo(id);
    if (!toolInfo) throw new Error(`Tool ${id} not found`);

    const requestContent: CallToolRequest = {
      method: 'tools/call',
      params: {
        name: item.name,
        arguments: args,
      },
    };

    request.content = JSON.stringify({
      ...requestContent,
    });
    if (toolInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, toolInfo.providerPubkey]);
    }
    request.tags.push([TAG_METHOD, requestContent.method]);
    if (toolInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, toolInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
