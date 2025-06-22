import type { NostrEvent } from 'nostr-tools';
import type { Capability, ExecutionContext } from './base-interfaces';
import { BaseRegistry } from './base-registry';
import {
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  GIFT_WRAP_KIND,
  TAG_PUBKEY,
  loggerDiscovery,
  TAG_EVENT_ID,
} from '@dvmcp/commons/core';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import type { NWCPaymentHandler } from './nwc-payment';
import {
  EncryptionMode,
  type EncryptionManager,
} from '@dvmcp/commons/encryption';
import type { ServerRegistry } from './server-registry'; // Import ServerRegistry type

export abstract class BaseExecutor<T extends Capability, P, R> {
  protected executionSubscriptions: Map<string, () => void> = new Map();
  protected static readonly EXECUTION_TIMEOUT = 30000;
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;
  protected encryptionManager: EncryptionManager | null = null;

  constructor(
    protected relayHandler: RelayHandler,
    protected keyManager: KeyManager,
    protected registry: BaseRegistry<T>,
    protected serverRegistry: ServerRegistry, // Add ServerRegistry to constructor
    encryptionManager?: EncryptionManager | null
  ) {
    this.encryptionManager = encryptionManager || null;
  }

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

  /**
   * Handle a response event from the bridge
   * This method should parse the response content and pass it through without transformation
   * @param event - Nostr event containing the response
   * @param context - Execution context
   * @param resolve - Function to resolve the promise
   * @param reject - Function to reject the promise
   */
  protected abstract handleResponse(
    event: NostrEvent,
    context: ExecutionContext,
    resolve: (value: R) => void,
    reject: (reason: Error) => void
  ): Promise<void>;

  public async execute(id: string, item: T, params: P): Promise<R> {
    return new Promise<R>(async (resolve, reject) => {
      try {
        const request = this.createRequest(id, item, params);
        const executionId = request.id;
        const context = this.createExecutionContext(executionId);

        const timeoutId = setTimeout(() => {
          this.cleanupExecution(executionId);
          reject(new Error(`Execution timeout for: ${executionId}`));
        }, BaseExecutor.EXECUTION_TIMEOUT);

        // Helper to check if an event is a response to our request (unencrypted or encrypted)
        const isResponseEvent = async (
          event: NostrEvent
        ): Promise<{ match: boolean; event: NostrEvent }> => {
          // Direct (unencrypted) response
          if (
            event.tags.some(
              (t: string[]) => t[0] === TAG_EVENT_ID && t[1] === executionId
            )
          ) {
            return { match: true, event };
          }
          // Encrypted response
          if (this.encryptionManager && event.kind === GIFT_WRAP_KIND) {
            try {
              const decryptionResult =
                await this.encryptionManager.decryptEventAndExtractSender(
                  event,
                  this.keyManager.getPrivateKey()
                );
              if (decryptionResult) {
                if (
                  decryptionResult.decryptedEvent.tags?.some(
                    (t: string[]) =>
                      t[0] === TAG_EVENT_ID && t[1] === executionId
                  )
                ) {
                  // Convert decrypted event to NostrEvent format
                  const decryptedNostrEvent = {
                    id: event.id,
                    pubkey: decryptionResult.sender,
                    created_at: decryptionResult.decryptedEvent.created_at,
                    kind: decryptionResult.decryptedEvent.kind,
                    tags: decryptionResult.decryptedEvent.tags,
                    content: decryptionResult.decryptedEvent.content,
                    sig: event.sig,
                  } as NostrEvent;
                  return { match: true, event: decryptedNostrEvent };
                }
              }
            } catch {
              // Silently ignore decryption failures
            }
          }
          return { match: false, event };
        };

        const subscription = this.relayHandler.subscribeToRequests(
          async (event: NostrEvent) => {
            const { match, event: processedEvent } =
              await isResponseEvent(event);
            if (match) {
              clearTimeout(timeoutId);
              this.handleResponse(processedEvent, context, resolve, reject);
            }
          },
          {
            kinds: [RESPONSE_KIND, NOTIFICATION_KIND, GIFT_WRAP_KIND],
            since: Math.floor(Date.now() / 1000),
          }
        );

        this.executionSubscriptions.set(executionId, () => {
          clearTimeout(timeoutId);
          subscription.close();
        });

        // Decide if encryption is needed and possible
        let eventToPublish = request;
        if (this.encryptionManager) {
          const recipientPubkey = request.tags.find(
            (tag) => tag[0] === TAG_PUBKEY
          )?.[1];
          if (recipientPubkey) {
            const serverInfo =
              this.serverRegistry.getServerByPubkey(recipientPubkey);
            const encryptionMode = this.encryptionManager.getEncryptionMode();
            const canEncrypt =
              serverInfo?.supportsEncryption &&
              (encryptionMode === EncryptionMode.REQUIRED ||
                encryptionMode === EncryptionMode.OPTIONAL);

            if (canEncrypt) {
              try {
                const encryptedEvent =
                  await this.encryptionManager.encryptMessage(
                    this.keyManager.getPrivateKey(),
                    recipientPubkey,
                    {
                      kind: request.kind,
                      content: request.content,
                      tags: request.tags,
                      created_at: request.created_at,
                    }
                  );
                if (encryptedEvent) {
                  eventToPublish = encryptedEvent;
                }
              } catch (encryptError) {
                // If encryption fails, send the original unencrypted request
                loggerDiscovery.warn(
                  'Failed to encrypt request, sending unencrypted:',
                  encryptError
                );
              }
            } else if (encryptionMode === EncryptionMode.REQUIRED) {
              throw new Error(
                `Recipient server ${recipientPubkey} does not support encryption`
              );
            }
          }
        }

        this.relayHandler.publishEvent(eventToPublish).catch((err: Error) => {
          this.cleanupExecution(executionId);
          reject(err);
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
