import { type Event as NostrEvent } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import type {
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry.js';
import type { ToolCapability } from './tool-registry.js';
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
import { BaseExecutor } from './base-executor';
import type { ExecutionContext } from './base-interfaces';

export class ToolExecutor extends BaseExecutor<
  ToolCapability,
  CallToolRequest['params'],
  CallToolResult
> {
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    relayHandler: RelayHandler,
    keyManager: ReturnType<typeof createKeyManager>,
    private toolRegistry: ToolRegistry
  ) {
    super(relayHandler, keyManager, toolRegistry);

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

    const tool = toolInfo.tool as ToolCapability;

    // Check if this is a built-in tool
    if (tool.isBuiltIn) {
      try {
        // Execute built-in tool directly
        return await this.toolRegistry.executeBuiltInTool(toolId, params);
      } catch (error) {
        loggerDiscovery(`Error executing built-in tool ${toolId}:`, error);
        throw error;
      }
    }

    // For external tools, use the base executor's execute method
    return this.execute(toolId, tool, params);
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
                : 'Tool execution error'
            )
          );
          return;
        }

        // Handle successful response
        this.cleanupExecution(context.executionId);
        resolve(response.content);
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
            'Payment required for tool execution. Invoice:',
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
                'Tool requires payment but NWC is not configured. Please add NWC configuration to use paid tools.'
              )
            );
            return;
          }

          // Pay the invoice using NWC
          const success = await this.nwcPaymentHandler.payInvoice(invoice);
          if (success) {
            loggerDiscovery('Payment successful, waiting for tool response...');
            // Payment successful, now we wait for the actual tool response
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

    // Create a properly typed CallToolRequest object
    const requestContent: CallToolRequest = {
      method: 'tools/call',
      params: {
        name: item.name,
        arguments: args,
      },
    };

    // Create a JSON-RPC request object according to the DVMCP specification
    request.content = JSON.stringify({
      ...requestContent,
    });

    // Target provider pubkey
    if (toolInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, toolInfo.providerPubkey]);
    }

    // Add method tag
    request.tags.push([TAG_METHOD, requestContent.method]);

    // Add server ID tag if available
    if (toolInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, toolInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
