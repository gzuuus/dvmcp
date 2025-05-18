import type { NostrEvent } from 'nostr-tools';
import type { Capability, ExecutionContext } from './base-interfaces';
import { BaseRegistry } from './base-registry';
import { RESPONSE_KIND, NOTIFICATION_KIND } from '@dvmcp/commons/constants';
import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import type { KeyManager } from '@dvmcp/commons/nostr/key-manager';
import type { NWCPaymentHandler } from './nwc-payment';

export abstract class BaseExecutor<T extends Capability, P, R> {
  protected executionSubscriptions: Map<string, () => void> = new Map();
  protected static readonly EXECUTION_TIMEOUT = 30000;
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;

  constructor(
    protected relayHandler: RelayHandler,
    protected keyManager: KeyManager,
    protected registry: BaseRegistry<T>
  ) {}

  public updateRelayHandler(relayHandler: RelayHandler): void {
    this.relayHandler = relayHandler;
  }

  public cleanup(): void {
    this.executionSubscriptions.forEach((cleanupFn) => cleanupFn());
    this.executionSubscriptions.clear();
  }

  protected createExecutionContext(executionId: string): ExecutionContext {
    return {
      executionId,
      createdAt: Date.now(),
    };
  }

  protected cleanupExecution(executionId: string): void {
    const cleanupFn = this.executionSubscriptions.get(executionId);
    if (cleanupFn) {
      cleanupFn();
      this.executionSubscriptions.delete(executionId);
    }
  }

  protected abstract createRequest(id: string, item: T, params: P): NostrEvent;

  protected abstract handleResponse(
    event: NostrEvent,
    context: ExecutionContext,
    resolve: (value: R) => void,
    reject: (reason: Error) => void
  ): Promise<void>;

  public async execute(id: string, item: T, params: P): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      try {
        const request = this.createRequest(id, item, params);
        const executionId = request.id;
        const context = this.createExecutionContext(executionId);

        const timeoutId = setTimeout(() => {
          this.cleanupExecution(executionId);
          reject(new Error(`Execution timeout for: ${executionId}`));
        }, BaseExecutor.EXECUTION_TIMEOUT);

        const subscription = this.relayHandler.subscribeToRequests(
          (event: NostrEvent) => {
            const isResponseToOurRequest = event.tags.some(
              (t: string[]) => t[0] === 'e' && t[1] === executionId
            );

            if (isResponseToOurRequest) {
              clearTimeout(timeoutId);
              this.handleResponse(event, context, resolve, reject);
            }
          },
          {
            kinds: [RESPONSE_KIND, NOTIFICATION_KIND],
            since: Math.floor(Date.now() / 1000),
          }
        );

        this.executionSubscriptions.set(executionId, () => {
          clearTimeout(timeoutId);
          subscription.close();
        });

        this.relayHandler.publishEvent(request).catch((err: Error) => {
          this.cleanupExecution(executionId);
          reject(err);
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
