/**
 * Discovery-specific encryption utilities
 * Re-exports the shared encryption functionality from commons with discovery-specific logging
 */

import { EncryptionManager as BaseEncryptionManager } from '@dvmcp/commons/encryption';
import type { EncryptionConfig } from '@dvmcp/commons/encryption';
import type { EventTemplate, Event as NostrEvent } from 'nostr-tools';
import { loggerDiscovery } from '@dvmcp/commons/core';

/**
 * Discovery-specific encryption manager with enhanced logging
 */
export class EncryptionManager extends BaseEncryptionManager {
  constructor(config: EncryptionConfig) {
    super(config);
  }

  async encryptMessage(
    senderPrivateKey: string,
    recipientPubkey: string,
    eventTemplate: EventTemplate,
    conversationTitle?: string,
    replyTo?: string
  ): Promise<NostrEvent> {
    loggerDiscovery('Encrypting DVMCP message for recipient:', recipientPubkey);

    try {
      const result = await super.encryptMessage(
        senderPrivateKey,
        recipientPubkey,
        eventTemplate,
        conversationTitle,
        replyTo
      );
      loggerDiscovery(
        'Message encrypted successfully, wrapped event kind:',
        result.kind
      );
      return result;
    } catch (error) {
      loggerDiscovery('Failed to encrypt message:', error);
      throw error;
    }
  }

  async encryptMessageForMany(
    senderPrivateKey: string,
    recipientPubkeys: string[],
    eventTemplate: EventTemplate,
    conversationTitle?: string,
    replyTo?: string
  ): Promise<NostrEvent[]> {
    loggerDiscovery(
      'Encrypting DVMCP message for multiple recipients:',
      recipientPubkeys.length
    );

    try {
      const result = await super.encryptMessageForMany(
        senderPrivateKey,
        recipientPubkeys,
        eventTemplate,
        conversationTitle,
        replyTo
      );
      loggerDiscovery(
        'Message encrypted successfully for',
        result.length,
        'recipients'
      );
      return result;
    } catch (error) {
      loggerDiscovery(
        'Failed to encrypt message for multiple recipients:',
        error
      );
      throw error;
    }
  }

  async decryptMessage(
    wrappedEvent: NostrEvent,
    recipientPrivateKey: string
  ): Promise<EventTemplate | null> {
    loggerDiscovery('Attempting to decrypt gift wrapped event');

    const result = await super.decryptMessage(
      wrappedEvent,
      recipientPrivateKey
    );

    if (!result) {
      loggerDiscovery(
        'Failed to decrypt event - may not be intended for this client'
      );
      return null;
    }

    loggerDiscovery(
      'Message decrypted successfully, original kind:',
      result.kind
    );
    return result;
  }
}

// Re-export the interface for backward compatibility
export type { EncryptionConfig };
