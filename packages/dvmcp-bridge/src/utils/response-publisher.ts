import type { NostrEvent } from 'nostr-tools';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import { EventPublisher } from '@dvmcp/commons/nostr';
import type { EncryptionManager } from '@dvmcp/commons/encryption';
import type { ResponseContext } from '../dvm-bridge';

/**
 * Centralized response publishing utility for bridge handlers
 */
export class ResponsePublisher {
  private eventPublisher: EventPublisher;

  constructor(
    relayHandler: RelayHandler,
    keyManager: KeyManager,
    encryptionManager?: EncryptionManager
  ) {
    this.eventPublisher = new EventPublisher(
      relayHandler,
      keyManager,
      encryptionManager
    );
  }

  /**
   * Publish a response with encryption support
   */
  async publishResponse(
    response: NostrEvent,
    responseContext: ResponseContext
  ): Promise<void> {
    await this.eventPublisher.publishResponse(
      response,
      responseContext.recipientPubkey,
      responseContext.shouldEncrypt
    );
  }

  /**
   * Publish a notification with encryption support
   */
  async publishNotification(
    content: string,
    recipientPubkey: string,
    tags: string[][],
    shouldEncrypt: boolean = false
  ): Promise<void> {
    await this.eventPublisher.publishNotification(
      content,
      recipientPubkey,
      tags,
      shouldEncrypt
    );
  }
}

let responsePublisher: ResponsePublisher | null = null;

/**
 * Get or create a singleton ResponsePublisher instance
 */
export function getResponsePublisher(
  relayHandler: RelayHandler,
  keyManager: KeyManager,
  encryptionManager?: EncryptionManager
): ResponsePublisher {
  if (!responsePublisher) {
    responsePublisher = new ResponsePublisher(
      relayHandler,
      keyManager,
      encryptionManager
    );
  }
  return responsePublisher;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetResponsePublisher(): void {
  responsePublisher = null;
}
