import { keyManager } from './announcer';
import type { Event } from 'nostr-tools/pure';
import { loggerBridge } from '@dvmcp/commons/logger';

export const nostrAdapter = {
  getPublicKey: async (): Promise<string> => {
    try {
      const pubkey = keyManager.getPublicKey();
      loggerBridge(`nostrAdapter.getPublicKey: ${pubkey.slice(0, 8)}...`);
      return pubkey;
    } catch (error) {
      loggerBridge('Error in nostrAdapter.getPublicKey:', error);
      throw error;
    }
  },

  signEvent: async (event: Event): Promise<Event> => {
    try {
      loggerBridge(`nostrAdapter.signEvent: Signing event kind ${event.kind}`);
      const signedEvent = keyManager.signEvent(event);
      loggerBridge(
        `nostrAdapter.signEvent: Successfully signed event, id: ${signedEvent.id.slice(0, 8)}...`
      );

      return signedEvent;
    } catch (error) {
      loggerBridge('Error in nostrAdapter.signEvent:', error);
      throw error;
    }
  },

  // Add NIP-07 required properties to make the adapter more compatible
  enabled: true,
  isEnabled: async () => true,
  getRelays: async () => ({}),
};
