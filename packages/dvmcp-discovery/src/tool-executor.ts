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
import logger from './logger';

interface ExecutionContext {
  timeoutId: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export class ToolExecutor {
  private executionSubscriptions: Map<string, () => void> = new Map();
  private static readonly EXECUTION_TIMEOUT = 30000;

  constructor(
    private relayHandler: RelayHandler,
    private keyManager: ReturnType<typeof createKeyManager>,
    private toolRegistry: ToolRegistry
  ) {}

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
  }

  private createExecutionContext(executionId: string): ExecutionContext {
    const timeoutId = setTimeout(() => {
      logger('Execution timeout for:', executionId);
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

  private handleToolResponse(
    event: Event,
    context: ExecutionContext,
    resolve: (value: unknown) => void,
    reject: (reason: Error) => void
  ): void {
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
