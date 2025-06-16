import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import type { EncryptionManager } from '@dvmcp/commons/encryption';
import { ResponsePublisher } from './response-publisher';

// Singleton instance
let responsePublisher: ResponsePublisher | null = null;

/**
 * Get or create a singleton ResponsePublisher instance
 */
export function getResponsePublisher(
  relayHandler: RelayHandler,
  keyManager: KeyManager,
  encryptionManager?: EncryptionManager
): ResponsePublisher {
  if (!responsePublisher) {
    responsePublisher = new ResponsePublisher(
      relayHandler,
      keyManager,
      encryptionManager
    );
  }
  return responsePublisher;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetResponsePublisher(): void {
  responsePublisher = null;
}
