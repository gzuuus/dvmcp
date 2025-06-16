import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools';
import { nip44 } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { finalizeEvent } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils';
import type { EncryptionConfig } from './types';
import { EncryptionMode } from './types';
import {
  SEALED_DIRECT_MESSAGE_KIND,
  PRIVATE_DIRECT_MESSAGE_KIND,
} from './types';
import { GIFT_WRAP_KIND } from '../core/constants';

export interface DecryptedMessage {
  content: any;
  sender: string;
  event: NostrEvent;
}

export interface EventTemplate {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

/**
 * Centralized encryption manager that handles all NIP-17/NIP-59 operations
 */
export class EncryptionManager {
  private mode: EncryptionMode;

  constructor(config: EncryptionConfig) {
    this.mode = config.mode ?? EncryptionMode.OPTIONAL;
  }

  public getEncryptionMode(): EncryptionMode {
    return this.mode;
  }

  public isEncryptionEnabled(): boolean {
    return this.mode !== EncryptionMode.DISABLED;
  }

  public isEncryptionRequired(): boolean {
    return this.mode === EncryptionMode.REQUIRED;
  }

  /**
   * Determines if we should encrypt outgoing messages based on incoming message format
   * @param incomingWasEncrypted - Whether the incoming message was encrypted
   */
  public shouldEncryptResponse(incomingWasEncrypted: boolean): boolean {
    switch (this.mode) {
      case EncryptionMode.DISABLED:
        return false;
      case EncryptionMode.REQUIRED:
        return true;
      case EncryptionMode.OPTIONAL:
        return incomingWasEncrypted; // Mirror the incoming format
      default:
        return false;
    }
  }

  /**
   * Determines if we should attempt encryption for outgoing requests (when no incoming context)
   */
  public shouldAttemptEncryption(): boolean {
    return this.mode === EncryptionMode.REQUIRED;
  }

  /**
   * Determines if we can accept unencrypted messages
   */
  public canAcceptUnencrypted(): boolean {
    return this.mode !== EncryptionMode.REQUIRED;
  }

  /**
   * Encrypt a message using NIP-17/NIP-59 gift wrap scheme
   * @param senderPrivateKey - Sender's private key
   * @param recipientPublicKey - Recipient's public key
   * @param eventTemplate - Event to encrypt
   * @returns Gift wrapped event or null if encryption fails
   */
  public async encryptMessage(
    senderPrivateKey: string,
    recipientPublicKey: string,
    eventTemplate: EventTemplate
  ): Promise<NostrEvent | null> {
    if (this.mode === EncryptionMode.DISABLED) {
      return null;
    }

    try {
      // Step 1: Create the rumor (original message without signature)
      const rumor = {
        ...eventTemplate,
        pubkey: getPublicKey(hexToBytes(senderPrivateKey)),
      };

      // Step 2: Create seal (kind 13) - encrypt the rumor
      const sealPrivateKey = generateSecretKey();
      const sealPublicKey = getPublicKey(sealPrivateKey);

      const encryptedRumor = nip44.v2.encrypt(
        JSON.stringify(rumor),
        nip44.v2.utils.getConversationKey(sealPrivateKey, recipientPublicKey)
      );

      const seal: UnsignedEvent = {
        kind: SEALED_DIRECT_MESSAGE_KIND,
        content: encryptedRumor,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: sealPublicKey,
      };

      const signedSeal = finalizeEvent(seal, sealPrivateKey);

      // Step 3: Create gift wrap (kind 1059) - encrypt the seal
      const giftWrapPrivateKey = generateSecretKey();
      const giftWrapPublicKey = getPublicKey(giftWrapPrivateKey);

      const encryptedSeal = nip44.v2.encrypt(
        JSON.stringify(signedSeal),
        nip44.v2.utils.getConversationKey(
          giftWrapPrivateKey,
          recipientPublicKey
        )
      );

      const giftWrap: UnsignedEvent = {
        kind: GIFT_WRAP_KIND,
        content: encryptedSeal,
        tags: [['p', recipientPublicKey]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: giftWrapPublicKey,
      };

      return finalizeEvent(giftWrap, giftWrapPrivateKey);
    } catch (error) {
      console.error('Encryption failed:', error);
      return null;
    }
  }

  /**
   * Decrypt a gift wrapped message and extract sender information
   * @param event - Gift wrap event to decrypt
   * @param recipientPrivateKey - Recipient's private key
   * @returns Decrypted message with sender info or null if decryption fails
   */
  public async decryptMessage(
    event: NostrEvent,
    recipientPrivateKey: string
  ): Promise<DecryptedMessage | null> {
    if (!this.isEncryptionEnabled() || event.kind !== GIFT_WRAP_KIND) {
      return null;
    }

    try {
      const recipientPublicKey = getPublicKey(hexToBytes(recipientPrivateKey));

      // Check if this gift wrap is for us
      const isForUs = event.tags.some(
        (tag) => tag[0] === 'p' && tag[1] === recipientPublicKey
      );

      if (!isForUs) {
        return null;
      }

      // Step 1: Decrypt the gift wrap to get the seal
      const conversationKey = nip44.v2.utils.getConversationKey(
        hexToBytes(recipientPrivateKey),
        event.pubkey
      );

      const decryptedSealJson = nip44.v2.decrypt(
        event.content,
        conversationKey
      );
      const seal = JSON.parse(decryptedSealJson) as NostrEvent;

      if (seal.kind !== SEALED_DIRECT_MESSAGE_KIND) {
        console.error('Invalid seal kind:', seal.kind);
        return null;
      }

      // Step 2: Decrypt the seal to get the rumor
      const sealConversationKey = nip44.v2.utils.getConversationKey(
        hexToBytes(recipientPrivateKey),
        seal.pubkey
      );

      const decryptedRumorJson = nip44.v2.decrypt(
        seal.content,
        sealConversationKey
      );
      const rumor = JSON.parse(decryptedRumorJson);

      // Step 3: Parse the rumor content
      let actualContent;
      if (rumor.kind === PRIVATE_DIRECT_MESSAGE_KIND) {
        // If it's a kind 14, the content might be JSON-encoded DVMCP message
        try {
          actualContent = JSON.parse(rumor.content);
        } catch {
          actualContent = rumor.content;
        }
      } else {
        actualContent = rumor;
      }

      return {
        content: actualContent,
        sender: rumor.pubkey,
        event: {
          ...rumor,
          id: event.id, // Keep original gift wrap ID for tracking
          sig: event.sig,
        } as NostrEvent,
      };
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  }

  /**
   * Decrypt an event and extract sender information (unified method)
   * Handles both gift wrapped and direct encrypted events
   */
  public async decryptEventAndExtractSender(
    event: NostrEvent,
    recipientPrivateKey: string
  ): Promise<{ decryptedEvent: NostrEvent; sender: string } | null> {
    const decrypted = await this.decryptMessage(event, recipientPrivateKey);

    if (!decrypted) {
      return null;
    }

    return {
      decryptedEvent: decrypted.event,
      sender: decrypted.sender,
    };
  }

  /**
   * Check if an event is encrypted for a specific recipient
   */
  public isEventForRecipient(
    event: NostrEvent,
    recipientPublicKey: string
  ): boolean {
    if (event.kind !== GIFT_WRAP_KIND) {
      return false;
    }

    return event.tags.some(
      (tag) => tag[0] === 'p' && tag[1] === recipientPublicKey
    );
  }

  /**
   * Encrypt a notification event
   */
  public async encryptNotification(
    senderPrivateKey: string,
    recipientPublicKey: string,
    notificationContent: string,
    tags: string[][] = []
  ): Promise<NostrEvent | null> {
    const eventTemplate: EventTemplate = {
      kind: 21316, // NOTIFICATION_KIND
      content: notificationContent,
      tags,
      created_at: Math.floor(Date.now() / 1000),
    };

    return this.encryptMessage(
      senderPrivateKey,
      recipientPublicKey,
      eventTemplate
    );
  }
}
