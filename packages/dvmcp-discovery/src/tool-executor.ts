import { type Event } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import {
  type CallToolRequest,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry.js';
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

interface ExecutionContext {
  timeoutId: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export class ToolExecutor {
  private executionSubscriptions: Map<string, () => void> = new Map();
  private static readonly EXECUTION_TIMEOUT = 30000;
  private nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    private relayHandler: RelayHandler,
    private keyManager: ReturnType<typeof createKeyManager>,
    private toolRegistry: ToolRegistry
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
    loggerDiscovery('Updated relay handler in tool executor');
  }

  public async executeTool(
    toolId: string,
    tool: Tool,
    params: unknown
  ): Promise<unknown> {
    // Get tool info to determine if it's built-in
    const toolInfo = this.toolRegistry.getToolInfo(toolId);

    // Check if this is a built-in tool
    if (toolInfo?.isBuiltIn) {
      try {
        // Execute built-in tool directly
        return await this.toolRegistry.executeBuiltInTool(toolId, params);
      } catch (error) {
        loggerDiscovery(`Error executing built-in tool ${toolId}:`, error);
        throw error;
      }
    }

    // Handle external tools via Nostr
    return new Promise((resolve, reject) => {
      const request = this.createToolRequest(toolId, tool, params);
      const executionId = request.id;
      const context = this.createExecutionContext(executionId);

      const subscription = this.relayHandler.subscribeToRequests(
        (event) => {
          if (
            event.tags.some(
              (t) => t[0] === TAG_EVENT_ID && t[1] === executionId
            )
          ) {
            this.handleToolResponse(event, context, resolve, reject);
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
    }, ToolExecutor.EXECUTION_TIMEOUT);

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

  private async handleToolResponse(
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
                : 'Tool execution error'
            )
          );
          return;
        }

        // Handle successful response
        clearTimeout(context.timeoutId);
        context.cleanup();
        resolve(response.content);
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
            'Payment required for tool execution. Invoice:',
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
          clearTimeout(context.timeoutId);
          context.cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  private createToolRequest(
    toolId: string,
    tool: Tool,
    params: unknown
  ): Event {
    // Use the new request kind
    const request = this.keyManager.createEventTemplate(REQUEST_KIND); // 25910

    const toolInfo = this.toolRegistry.getToolInfo(toolId);
    if (!toolInfo) throw new Error(`Tool ${toolId} not found`);

    // Format parameters according to tool schema
    const parameters =
      !tool.inputSchema.properties ||
      Object.keys(tool.inputSchema.properties).length === 0
        ? {}
        : (params as Record<string, unknown>);

    // Create a properly typed CallToolRequest object
    const requestContent: CallToolRequest = {
      method: 'tools/call',
      params: {
        name: tool.name,
        arguments: parameters,
      },
    };

    // Create a JSON-RPC request object according to the DVMCP specification
    // Add the id separately as it's part of the JSON-RPC standard but not the CallToolRequest type
    request.content = JSON.stringify({
      ...requestContent,
    });

    // Add required tags according to the spec
    // Target provider pubkey
    if (toolInfo.providerPubkey) {
      request.tags.push([TAG_PUBKEY, toolInfo.providerPubkey]);
    }

    // Add method tag according to the DVMCP specification
    request.tags.push([TAG_METHOD, 'tools/call']);

    // Add server ID tag if available
    if (toolInfo.serverId) {
      request.tags.push([TAG_SERVER_IDENTIFIER, toolInfo.serverId]);
    }

    return this.keyManager.signEvent(request);
  }
}
