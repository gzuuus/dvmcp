import type { NostrEvent } from 'nostr-tools';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import {
  RESPONSE_KIND,
  TAG_EVENT_ID,
  TAG_PUBKEY,
  loggerBridge,
} from '@dvmcp/commons/core';
import type { ResponseContext } from '../dvm-bridge.js';

/**
 * Helper function to publish response with encryption support
 */
async function publishResponse(
  response: NostrEvent,
  responseContext: ResponseContext
): Promise<void> {
  if (
    responseContext.shouldEncrypt &&
    responseContext.encryptionManager?.isEncryptionEnabled()
  ) {
    // Encrypt the response for the original requester
    try {
      // Convert signed event back to EventTemplate for encryption
      const eventTemplate = {
        kind: response.kind,
        content: response.content,
        tags: response.tags,
        created_at: response.created_at,
      };

      const encryptedEvent =
        await responseContext.encryptionManager.encryptMessage(
          responseContext.keyManager.getPrivateKey(),
          responseContext.recipientPubkey,
          eventTemplate
        );

      if (encryptedEvent) {
        await responseContext.relayHandler.publishEvent(encryptedEvent);
      } else {
        await responseContext.relayHandler.publishEvent(response);
      }
    } catch (error) {
      await responseContext.relayHandler.publishEvent(response);
    }
  } else {
    // Publish unencrypted response
    await responseContext.relayHandler.publishEvent(response);
  }
}

/**
 * Handle ping requests from clients
 * Responds with an empty object as per DVMCP ping specification
 */
export async function handlePing(
  event: NostrEvent,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext
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

    await publishResponse(response, responseContext);
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

    await publishResponse(errorResponse, responseContext);
  }
}
