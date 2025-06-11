import type { NostrEvent } from 'nostr-tools';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import {
  RESPONSE_KIND,
  TAG_EVENT_ID,
  TAG_PUBKEY,
  loggerBridge,
} from '@dvmcp/commons/core';

/**
 * Handle ping requests from clients
 * Responds with an empty object as per DVMCP ping specification
 */
export async function handlePing(
  event: NostrEvent,
  keyManager: KeyManager,
  relayHandler: RelayHandler
): Promise<void> {
  const pubkey = event.pubkey;
  const id = event.id;

  loggerBridge(`Handling ping request from ${pubkey}`);

  try {
    // Create ping response with empty content as per DVMCP spec
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({}),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });

    await relayHandler.publishEvent(response);
    loggerBridge(`Sent ping response to ${pubkey}`);
  } catch (error) {
    console.error('Error handling ping request:', error);

    // Send error response if something goes wrong
    const errorResponse = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({
        error: {
          code: -32603,
          message: 'Internal error processing ping request',
        },
      }),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });

    await relayHandler.publishEvent(errorResponse);
  }
}
