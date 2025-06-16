/**
 * Bridge-specific encryption utilities
 * Re-exports the shared encryption functionality from commons with bridge-specific logging
 */

import {
  EncryptionManager as BaseEncryptionManager,
  type EncryptionConfig,
  type DecryptedMessage,
} from '@dvmcp/commons/encryption';
import type { EventTemplate, Event as NostrEvent } from 'nostr-tools';
import { loggerBridge } from '@dvmcp/commons/core';

/**
 * Bridge-specific encryption manager with enhanced logging
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
  ): Promise<NostrEvent | null> {
    loggerBridge('Encrypting DVMCP message for recipient:', recipientPubkey);

    try {
      const result = await super.encryptMessage(
        senderPrivateKey,
        recipientPubkey,
        eventTemplate
      );
      if (!result) {
        loggerBridge('Encryption failed, result is null');
        return null;
      }
      loggerBridge(
        'Message encrypted successfully, wrapped event kind:',
        result.kind
      );
      return result;
    } catch (error) {
      loggerBridge('Failed to encrypt message:', error);
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
    // Changed return type to include null
    loggerBridge(
      'Encrypting DVMCP message for multiple recipients:',
      recipientPubkeys.length
    );

    const encryptedMessages: NostrEvent[] = [];
    for (const recipientPubkey of recipientPubkeys) {
      try {
        const result = await this.encryptMessage(
          senderPrivateKey,
          recipientPubkey,
          eventTemplate,
          conversationTitle,
          replyTo
        );
        if (result) {
          encryptedMessages.push(result);
        }
      } catch (error) {
        loggerBridge(
          `Failed to encrypt message for ${recipientPubkey}:`,
          error
        );
      }
    }
    if (encryptedMessages.length === 0) {
      loggerBridge('No messages encrypted successfully for any recipient.');
      return null;
    }
    loggerBridge(
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
    // Changed return type to DecryptedMessage | null
    loggerBridge('Attempting to decrypt gift wrapped event');

    const result = await super.decryptMessage(
      wrappedEvent,
      recipientPrivateKey
    );

    if (!result) {
      loggerBridge(
        'Failed to decrypt event - may not be intended for this server'
      );
      return null;
    }

    loggerBridge(
      'Message decrypted successfully, original kind:',
      result.event.kind
    ); // Access kind from result.event.kind
    return result;
  }
}

// Re-export the interface for backward compatibility
export type { EncryptionConfig };
