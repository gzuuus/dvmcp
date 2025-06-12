import type { NostrEvent } from 'nostr-tools';
import type { Capability, ExecutionContext } from './base-interfaces';
import { BaseRegistry } from './base-registry';
import {
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  GIFT_WRAP_KIND,
  TAG_PUBKEY,
} from '@dvmcp/commons/core';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import type { NWCPaymentHandler } from './nwc-payment';
import {
  PRIVATE_DIRECT_MESSAGE_KIND,
  type EncryptionManager,
} from '@dvmcp/commons/encryption';

export abstract class BaseExecutor<T extends Capability, P, R> {
  protected executionSubscriptions: Map<string, () => void> = new Map();
  protected static readonly EXECUTION_TIMEOUT = 30000;
  protected nwcPaymentHandler: NWCPaymentHandler | null = null;
  protected encryptionManager: EncryptionManager | null = null;

  constructor(
    protected relayHandler: RelayHandler,
    protected keyManager: KeyManager,
    protected registry: BaseRegistry<T>,
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

        const subscription = this.relayHandler.subscribeToRequests(
          async (event: NostrEvent) => {
            let isResponseToOurRequest = false;
            let processedEvent = event;

            // First check if it's a direct response (unencrypted)
            isResponseToOurRequest = event.tags.some(
              (t: string[]) => t[0] === 'e' && t[1] === executionId
            );

            // If not a direct response, check if it's an encrypted response for us
            if (
              !isResponseToOurRequest &&
              this.encryptionManager &&
              event.kind === GIFT_WRAP_KIND
            ) {
              const isForUs = event.tags.some(
                (t: string[]) =>
                  t[0] === 'p' && t[1] === this.keyManager.getPublicKey()
              );
              if (isForUs) {
                try {
                  const decryptedTemplate =
                    await this.encryptionManager.decryptMessage(
                      event,
                      this.keyManager.getPrivateKey()
                    );
                  if (decryptedTemplate) {
                    // The decrypted template is a kind 14 event containing the DVMCP response
                    // We need to parse the content to get the actual DVMCP response
                    let actualResponse;
                    if (
                      decryptedTemplate.kind === PRIVATE_DIRECT_MESSAGE_KIND
                    ) {
                      // Parse the kind 14 content to get the DVMCP response
                      try {
                        actualResponse = JSON.parse(decryptedTemplate.content);
                      } catch (parseError) {
                        console.error(
                          'Failed to parse kind 14 content:',
                          parseError
                        );
                        return;
                      }
                    } else {
                      actualResponse = decryptedTemplate;
                    }

                    // Check if the actual response is a response to our request
                    const isDecryptedResponse = actualResponse.tags?.some(
                      (t: string[]) => t[0] === 'e' && t[1] === executionId
                    );
                    console.error(
                      'is decrypted?',
                      isDecryptedResponse,
                      actualResponse,
                      'executionId expected:',
                      executionId
                    );
                    if (isDecryptedResponse) {
                      isResponseToOurRequest = true;
                      // Convert the actual response back to event format
                      processedEvent = {
                        ...actualResponse,
                        id: event.id, // Keep original ID for response matching
                        pubkey: actualResponse.pubkey || event.pubkey,
                        created_at:
                          actualResponse.created_at || event.created_at,
                        sig: event.sig,
                      } as NostrEvent;
                    }
                  }
                } catch (decryptError) {
                  // If decryption fails, ignore this event
                }
              }
            }
            // If it's an unencrypted response but we have encryption enabled, still try to decrypt
            else if (isResponseToOurRequest && this.encryptionManager) {
              try {
                const decryptedTemplate =
                  await this.encryptionManager.decryptMessage(
                    event,
                    this.keyManager.getPrivateKey()
                  );
                if (decryptedTemplate) {
                  // Handle kind 14 content parsing
                  let actualResponse;
                  if (decryptedTemplate.kind === PRIVATE_DIRECT_MESSAGE_KIND) {
                    try {
                      actualResponse = JSON.parse(decryptedTemplate.content);
                    } catch (parseError) {
                      actualResponse = decryptedTemplate;
                    }
                  } else {
                    actualResponse = decryptedTemplate;
                  }

                  // Convert actual response back to event format
                  processedEvent = {
                    ...actualResponse,
                    id: event.id, // Keep original ID for response matching
                    pubkey: actualResponse.pubkey || event.pubkey,
                    created_at: actualResponse.created_at || event.created_at,
                    sig: event.sig,
                  } as NostrEvent;
                }
              } catch (decryptError) {
                // If decryption fails, use the original event (not encrypted)
              }
            }

            if (isResponseToOurRequest) {
              clearTimeout(timeoutId);
              this.handleResponse(processedEvent, context, resolve, reject);
            }
          },
          {
            kinds: [RESPONSE_KIND, NOTIFICATION_KIND, GIFT_WRAP_KIND], // Include gift wrap events
            since: Math.floor(Date.now() / 1000),
          }
        );

        this.executionSubscriptions.set(executionId, () => {
          clearTimeout(timeoutId);
          subscription.close();
        });

        // Encrypt the request if encryption is enabled and should be used
        let eventToPublish = request;
        if (this.encryptionManager) {
          // Extract recipient from request tags (assuming it's in a 'pubkey' tag)
          const recipientPubkey = request.tags.find(
            (tag) => tag[0] === TAG_PUBKEY
          )?.[1];
          if (recipientPubkey) {
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
              eventToPublish = encryptedEvent;
            } catch (encryptError) {
              // If encryption fails, send the original unencrypted request
              console.warn(
                'Failed to encrypt request, sending unencrypted:',
                encryptError
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
