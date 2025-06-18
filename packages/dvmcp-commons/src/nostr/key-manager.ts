/**
 * Key management utilities for Nostr
 */
import { hexToBytes } from '@noble/hashes/utils';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import type { Event, UnsignedEvent } from 'nostr-tools/pure';

/**
 * Interface for Nostr provider (compatible with NIP-07 extensions)
 */
export type NostrProvider = {
  getPublicKey(): Promise<string>;
  signEvent(
    event: Event & {
      pubkey: string;
      id: string;
    }
  ): Promise<Event>;
};

/**
 * Interface for key management operations
 */
export type KeyManager = {
  pubkey: string;
  signEvent(event: UnsignedEvent): Event;
  createEventTemplate(kind: number): UnsignedEvent;
  getPublicKey(): string;
  getPrivateKey(): string;
};

/**
 * Creates a key manager from a private key
 * @param privateKeyHex - The private key in hex format
 * @returns A key manager instance
 */
export const createKeyManager = (privateKeyHex: string): KeyManager => {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(privateKeyBytes);

  class Manager implements KeyManager {
    public readonly pubkey = pubkey;

    signEvent(eventInitial: UnsignedEvent): Event {
      return finalizeEvent(eventInitial, privateKeyBytes);
    }

    createEventTemplate(kind: number): UnsignedEvent {
      return {
        kind,
        pubkey: this.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: '',
      };
    }

    getPublicKey(): string {
      return this.pubkey;
    }

    getPrivateKey(): string {
      return privateKeyHex;
    }
  }

  return new Manager();
};

/**
 * Creates a Nostr provider from a key manager
 * @param keyManager - The key manager instance
 * @returns A Nostr provider instance
 */
export const createNostrProvider = (keyManager: KeyManager): NostrProvider => {
  return {
    getPublicKey: async (): Promise<string> => {
      return keyManager.getPublicKey();
    },

    signEvent: async (
      event: Event & { pubkey: string; id: string }
    ): Promise<Event> => {
      return keyManager.signEvent(event);
    },
  };
};
