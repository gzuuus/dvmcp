import type { EventTemplate, Event as NostrEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { encrypt, decrypt } from 'nostr-tools/nip04';
import { GIFT_WRAP_KIND } from '../core';
import type { EncryptionConfig } from './types';
import {
  SEALED_DIRECT_MESSAGE_KIND,
  PRIVATE_DIRECT_MESSAGE_KIND,
} from './types';

/**
 * Shared encryption utilities for DVMCP using NIP-17/NIP-59
 * This class provides encryption/decryption functionality that can be used
 * by both bridge and discovery packages.
 */
export class EncryptionManager {
  constructor(private config: EncryptionConfig) {}

  /**
   * Check if encryption is enabled
   */
  isEncryptionEnabled(): boolean {
    return this.config.supportEncryption;
  }

  /**
   * Check if encryption should be preferred
   */
  shouldPreferEncryption(): boolean {
    return this.config.preferEncryption ?? false;
  }

  /**
   * Check if encryption should be used (enabled and preferred)
   */
  shouldEncrypt(): boolean {
    return this.isEncryptionEnabled() && this.shouldPreferEncryption();
  }

  /**
   * Encrypt a DVMCP message using NIP-17 (seal) + NIP-59 (gift wrap)
   * @param senderPrivateKey - Private key of the sender (hex string)
   * @param recipientPubkey - Public key of the recipient
   * @param eventTemplate - Event template to encrypt
   * @param conversationTitle - Optional conversation title
   * @param replyTo - Optional reply-to event ID
   * @returns Promise<NostrEvent> - Gift wrapped event (kind 1059)
   */
  async encryptMessage(
    senderPrivateKey: string,
    recipientPubkey: string,
    eventTemplate: EventTemplate,
    conversationTitle?: string,
    replyTo?: string
  ): Promise<NostrEvent> {
    try {
      const senderSecretKey = hexToBytes(senderPrivateKey);

      // Step 1: Create the original message (kind 14 - private direct message)
      const messageContent = JSON.stringify({
        kind: eventTemplate.kind,
        content: eventTemplate.content,
        tags: eventTemplate.tags,
        created_at: eventTemplate.created_at,
      });

      // Step 2: Create NIP-17 sealed message (kind 13)
      const sealedMessage = await this.createSealedMessage(
        senderSecretKey,
        recipientPubkey,
        messageContent,
        replyTo
      );

      // Step 3: Create NIP-59 gift wrap (kind 1059)
      const giftWrappedEvent = await this.createGiftWrap(
        sealedMessage,
        recipientPubkey
      );

      return giftWrappedEvent;
    } catch (error) {
      throw new Error(`Encryption failed: ${error}`);
    }
  }

  /**
   * Encrypt a DVMCP message for multiple recipients
   * @param senderPrivateKey - Private key of the sender (hex string)
   * @param recipientPubkeys - Array of recipient public keys
   * @param eventTemplate - Event template to encrypt
   * @param conversationTitle - Optional conversation title
   * @param replyTo - Optional reply-to event ID
   * @returns Promise<NostrEvent[]> - Array of gift wrapped events (kind 1059)
   */
  async encryptMessageForMany(
    senderPrivateKey: string,
    recipientPubkeys: string[],
    eventTemplate: EventTemplate,
    conversationTitle?: string,
    replyTo?: string
  ): Promise<NostrEvent[]> {
    try {
      const encryptedEvents: NostrEvent[] = [];

      // Encrypt for each recipient individually
      for (const recipientPubkey of recipientPubkeys) {
        const encryptedEvent = await this.encryptMessage(
          senderPrivateKey,
          recipientPubkey,
          eventTemplate,
          conversationTitle,
          replyTo
        );
        encryptedEvents.push(encryptedEvent);
      }

      return encryptedEvents;
    } catch (error) {
      throw new Error(`Multi-recipient encryption failed: ${error}`);
    }
  }

  /**
   * Decrypt a DVMCP message using NIP-17/NIP-59
   * @param wrappedEvent - Gift wrapped event (kind 1059)
   * @param recipientPrivateKey - Private key of the recipient (hex string)
   * @returns Promise<EventTemplate | null> - Decrypted event template or null if decryption failed
   */
  async decryptMessage(
    wrappedEvent: NostrEvent,
    recipientPrivateKey: string
  ): Promise<EventTemplate | null> {
    try {
      // Verify this is a gift wrapped event
      if (wrappedEvent.kind !== GIFT_WRAP_KIND) {
        return null;
      }

      const recipientSecretKey = hexToBytes(recipientPrivateKey);

      // Step 1: Unwrap the gift wrap to get the sealed message
      const sealedMessage = await this.unwrapGiftWrap(
        wrappedEvent,
        recipientSecretKey
      );
      if (!sealedMessage) {
        return null;
      }

      // Step 2: Unseal the message to get the original content
      const originalMessage = await this.unsealMessage(
        sealedMessage,
        recipientSecretKey
      );
      if (!originalMessage) {
        return null;
      }

      // Parse the decrypted message content
      const messageData = JSON.parse(originalMessage);

      const eventTemplate: EventTemplate = {
        kind: messageData.kind,
        content: messageData.content,
        tags: messageData.tags,
        created_at: messageData.created_at,
      };

      return eventTemplate;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if an event is encrypted (gift wrapped)
   * @param event - Nostr event to check
   * @returns boolean - True if the event is encrypted
   */
  isEncryptedEvent(event: NostrEvent): boolean {
    return event.kind === GIFT_WRAP_KIND;
  }

  /**
   * Determine if a recipient supports encryption based on their capabilities
   * @param recipientPubkey - Public key of the recipient
   * @param serverCapabilities - Server capabilities from announcements
   * @returns boolean - True if encryption is supported
   */
  recipientSupportsEncryption(
    recipientPubkey: string,
    serverCapabilities?: any
  ): boolean {
    // For now, we'll assume encryption support based on configuration
    // In a real implementation, this would check the recipient's announced capabilities
    if (serverCapabilities?.encryption?.supportEncryption) {
      return true;
    }

    // Default to false if no capability information is available
    return false;
  }

  /**
   * Create a sealed message (NIP-17, kind 13)
   * @private
   */
  private async createSealedMessage(
    senderSecretKey: Uint8Array,
    recipientPubkey: string,
    content: string,
    replyTo?: string
  ): Promise<NostrEvent> {
    // Create kind 14 (private direct message) event
    const dmEvent: EventTemplate = {
      kind: PRIVATE_DIRECT_MESSAGE_KIND,
      content,
      tags: replyTo ? [['e', replyTo]] : [],
      created_at: Math.floor(Date.now() / 1000),
    };

    // Encrypt the entire event for the recipient
    const encryptedContent = encrypt(
      senderSecretKey,
      recipientPubkey,
      JSON.stringify(dmEvent)
    );

    // Create sealed message (kind 13)
    const sealedTemplate: EventTemplate = {
      kind: SEALED_DIRECT_MESSAGE_KIND,
      content: encryptedContent,
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    return finalizeEvent(sealedTemplate, senderSecretKey);
  }

  /**
   * Create a gift wrap (NIP-59, kind 1059)
   * @private
   */
  private async createGiftWrap(
    sealedMessage: NostrEvent,
    recipientPubkey: string
  ): Promise<NostrEvent> {
    // Generate random ephemeral key for gift wrapping
    const ephemeralKey = generateSecretKey();

    // Encrypt the sealed message for the recipient
    const encryptedSealedMessage = encrypt(
      ephemeralKey,
      recipientPubkey,
      JSON.stringify(sealedMessage)
    );

    // Create gift wrap event
    const giftWrapTemplate: EventTemplate = {
      kind: GIFT_WRAP_KIND,
      content: encryptedSealedMessage,
      tags: [['p', recipientPubkey]],
      created_at: Math.floor(Date.now() / 1000),
    };

    return finalizeEvent(giftWrapTemplate, ephemeralKey);
  }

  /**
   * Unwrap a gift wrap to get the sealed message
   * @private
   */
  private async unwrapGiftWrap(
    giftWrapEvent: NostrEvent,
    recipientSecretKey: Uint8Array
  ): Promise<NostrEvent | null> {
    try {
      // Decrypt the gift wrap content to get the sealed message
      const decryptedContent = decrypt(
        recipientSecretKey,
        giftWrapEvent.pubkey,
        giftWrapEvent.content
      );

      // Parse the decrypted content as the sealed message
      const sealedMessage = JSON.parse(decryptedContent) as NostrEvent;

      // Verify it's a sealed message (kind 13)
      if (sealedMessage.kind !== SEALED_DIRECT_MESSAGE_KIND) {
        return null;
      }

      return sealedMessage;
    } catch (error) {
      return null;
    }
  }

  /**
   * Unseal a sealed message to get the original content
   * @private
   */
  private async unsealMessage(
    sealedMessage: NostrEvent,
    recipientSecretKey: Uint8Array
  ): Promise<string | null> {
    try {
      // Decrypt the sealed message content
      const decryptedContent = decrypt(
        recipientSecretKey,
        sealedMessage.pubkey,
        sealedMessage.content
      );

      return decryptedContent;
    } catch (error) {
      return null;
    }
  }
}
