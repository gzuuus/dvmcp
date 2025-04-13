import { hexToBytes } from '@noble/hashes/utils';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import type { Event, UnsignedEvent } from 'nostr-tools/pure';

export type NostrProvider = {
  getPublicKey(): Promise<string>;
  signEvent(
    event: Event & {
      pubkey: string;
      id: string;
    }
  ): Promise<Event>;
};

export type KeyManager = {
  pubkey: string;
  signEvent(event: UnsignedEvent): Event;
  createEventTemplate(kind: number): UnsignedEvent;
  getPublicKey(): string;
};

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
  }

  return new Manager();
};

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
