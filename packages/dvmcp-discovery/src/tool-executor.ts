import { type Event } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry.js';
import {
  TOOL_REQUEST_KIND,
  TOOL_RESPONSE_KIND,
  DVM_NOTICE_KIND,
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

  public async executeTool(
    toolId: string,
    tool: Tool,
    params: unknown
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = this.createToolRequest(toolId, tool, params);
      const executionId = request.id;
      const context = this.createExecutionContext(executionId);

      const subscription = this.relayHandler.subscribeToRequests(
        (event) => {
          if (event.tags.some((t) => t[0] === 'e' && t[1] === executionId)) {
            this.handleToolResponse(event, context, resolve, reject);
          }
        },
        {
          kinds: [TOOL_RESPONSE_KIND, DVM_NOTICE_KIND],
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
    if (event.kind === TOOL_RESPONSE_KIND) {
      try {
        const result = JSON.parse(event.content);
        clearTimeout(context.timeoutId);
        context.cleanup();
        resolve(result.content);
      } catch (error) {
        clearTimeout(context.timeoutId);
        context.cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    } else if (event.kind === DVM_NOTICE_KIND) {
      const status = event.tags.find((t) => t[0] === 'status')?.[1];
      if (status === 'error') {
        clearTimeout(context.timeoutId);
        context.cleanup();
        reject(new Error(event.content));
      }
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
    const request = this.keyManager.createEventTemplate(TOOL_REQUEST_KIND);

    const parameters =
      !tool.inputSchema.properties ||
      Object.keys(tool.inputSchema.properties).length === 0
        ? {}
        : params;

    const toolInfo = this.toolRegistry.getToolInfo(toolId);
    if (!toolInfo) throw new Error(`Tool ${toolId} not found`);

    request.content = JSON.stringify({
      name: tool.name,
      parameters,
      providerPubkey: toolInfo.providerPubkey,
    });

    request.tags.push(['c', 'execute-tool']);
    request.tags.push(['p', toolInfo.providerPubkey]);
    return this.keyManager.signEvent(request);
  }
}
