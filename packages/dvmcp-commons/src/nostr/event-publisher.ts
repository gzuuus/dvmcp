import type { NostrEvent } from 'nostr-tools';
import type { RelayHandler } from './relay-handler';
import type { KeyManager } from './key-manager';
import type {
  EncryptionManager,
  EventTemplate,
} from '../encryption/encryption-manager';

export interface PublishOptions {
  encrypt?: boolean;
  recipientPublicKey?: string;
}

/**
 * Centralized event publishing utility with encryption support
 */
export class EventPublisher {
  constructor(
    private relayHandler: RelayHandler,
    private keyManager: KeyManager,
    private encryptionManager?: EncryptionManager
  ) {}

  /**
   * Publish an event with optional encryption
   */
  async publishEvent(
    event: NostrEvent,
    options: PublishOptions = {}
  ): Promise<void> {
    let eventToPublish = event;

    if (
      options.encrypt &&
      options.recipientPublicKey &&
      this.encryptionManager?.isEncryptionEnabled()
    ) {
      try {
        const eventTemplate: EventTemplate = {
          kind: event.kind,
          content: event.content,
          tags: event.tags,
          created_at: event.created_at,
        };

        const encryptedEvent = await this.encryptionManager.encryptMessage(
          this.keyManager.getPrivateKey(),
          options.recipientPublicKey,
          eventTemplate
        );

        if (encryptedEvent) {
          eventToPublish = encryptedEvent;
        }
      } catch (error) {
        console.warn('Failed to encrypt event, publishing unencrypted:', error);
      }
    }

    await this.relayHandler.publishEvent(eventToPublish);
  }

  /**
   * Publish a response event (convenience method)
   */
  async publishResponse(
    responseEvent: NostrEvent,
    recipientPublicKey: string,
    shouldEncrypt: boolean = false
  ): Promise<void> {
    await this.publishEvent(responseEvent, {
      encrypt: shouldEncrypt,
      recipientPublicKey,
    });
  }

  /**
   * Publish a notification event with optional encryption
   */
  async publishNotification(
    content: string,
    recipientPublicKey: string,
    tags: string[][] = [],
    shouldEncrypt: boolean = false
  ): Promise<void> {
    if (shouldEncrypt && this.encryptionManager?.isEncryptionEnabled()) {
      // Use the specialized notification encryption method
      const encryptedNotification =
        await this.encryptionManager.encryptNotification(
          this.keyManager.getPrivateKey(),
          recipientPublicKey,
          content,
          tags
        );

      if (encryptedNotification) {
        await this.relayHandler.publishEvent(encryptedNotification);
        return;
      }
    }

    // Publish unencrypted notification
    const notificationEvent = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(21316), // NOTIFICATION_KIND
      content,
      tags,
    });

    await this.relayHandler.publishEvent(notificationEvent);
  }
}
