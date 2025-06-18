import { loggerBridge, MCPMETHODS } from '@dvmcp/commons/core';
import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_STATUS,
  TAG_METHOD,
} from '@dvmcp/commons/core';
import type { KeyManager, RelayHandler } from '@dvmcp/commons/nostr';
import { EventPublisher } from '@dvmcp/commons/nostr';
import type { NostrEvent } from 'nostr-tools';
import type { ResponseContext } from '../dvm-bridge';
// TODO: actually cancel the job
/**
 * Handles the notifications/cancel method
 */
export async function handleNotificationsCancel(
  event: NostrEvent,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext?: ResponseContext
): Promise<void> {
  const pubkey = event.pubkey;
  const tags = event.tags;

  // Find the event ID to cancel
  const eventIdToCancel = tags.find((tag) => tag[0] === TAG_EVENT_ID)?.[1];

  if (eventIdToCancel) {
    loggerBridge(`Received cancel request for job: ${eventIdToCancel}`);

    // Send cancellation acknowledgment using centralized event publisher
    const eventPublisher = new EventPublisher(
      relayHandler,
      keyManager,
      responseContext?.encryptionManager
    );

    await eventPublisher.publishNotification(
      JSON.stringify({
        method: MCPMETHODS.notificationsProgress,
        params: { message: 'cancellation-acknowledged' },
      }),
      pubkey,
      [
        [TAG_STATUS, 'cancelled'],
        [TAG_EVENT_ID, eventIdToCancel],
        [TAG_PUBKEY, pubkey],
        [TAG_METHOD, MCPMETHODS.notificationsProgress],
      ],
      responseContext?.shouldEncrypt || false
    );
  } else {
    loggerBridge('Received cancel notification without event ID');
  }
}
