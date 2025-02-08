import { hexToBytes } from '@noble/hashes/utils';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/pure';
import { CONFIG } from '../config';

export type UnsignedEvent = Omit<Event, 'sig' | 'id'>;

export const createKeyManager = (privateKeyHex: string) => {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(privateKeyBytes);

  class Manager {
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
  }

  return new Manager();
};

export const keyManager = createKeyManager(CONFIG.nostr.privateKey);
