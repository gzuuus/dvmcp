/**
 * Discovery-specific encryption utilities
 * Re-exports the shared encryption functionality from commons with discovery-specific logging
 */

import {
  EncryptionManager as BaseEncryptionManager,
  type DecryptedMessage,
} from '@dvmcp/commons/encryption';
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
    eventTemplate: EventTemplate
  ): Promise<NostrEvent | null> {
    loggerDiscovery('Encrypting DVMCP message for recipient:', recipientPubkey);

    try {
      const result = await super.encryptMessage(
        senderPrivateKey,
        recipientPubkey,
        eventTemplate
      );
      if (!result) {
        loggerDiscovery('Encryption failed, result is null');
        return null;
      }
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
  ): Promise<NostrEvent[] | null> {
    loggerDiscovery(
      'Encrypting DVMCP message for multiple recipients:',
      recipientPubkeys.length
    );

    const encryptedMessages: NostrEvent[] = [];
    for (const recipientPubkey of recipientPubkeys) {
      try {
        const result = await this.encryptMessage(
          senderPrivateKey,
          recipientPubkey,
          eventTemplate
        );
        if (result) {
          encryptedMessages.push(result);
        }
      } catch (error) {
        loggerDiscovery(
          `Failed to encrypt message for ${recipientPubkey}:`,
          error
        );
      }
    }
    if (encryptedMessages.length === 0) {
      loggerDiscovery('No messages encrypted successfully for any recipient.');
      return null;
    }
    loggerDiscovery(
      'Message encrypted successfully for',
      encryptedMessages.length,
      'recipients'
    );
    return encryptedMessages;
  }

  async decryptMessage(
    wrappedEvent: NostrEvent,
    recipientPrivateKey: string
  ): Promise<DecryptedMessage | null> {
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
      result.event.kind
    );
    return result;
  }
}

// Re-export the interface for backward compatibility
export type { EncryptionConfig };
