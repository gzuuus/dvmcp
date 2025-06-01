import { loggerBridge } from '@dvmcp/commons/core';
import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_STATUS,
  NOTIFICATION_KIND,
} from '@dvmcp/commons/core';
import type { KeyManager, RelayHandler } from '@dvmcp/commons/nostr';
import type { NostrEvent } from 'nostr-tools';
// TODO: actually cancel the job
/**
 * Handles the notifications/cancel method
 */
export async function handleNotificationsCancel(
  event: NostrEvent,
  keyManager: KeyManager,
  relayHandler: RelayHandler
): Promise<void> {
  const pubkey = event.pubkey;
  const tags = event.tags;

  // Find the event ID to cancel
  const eventIdToCancel = tags.find((tag) => tag[0] === TAG_EVENT_ID)?.[1];

  if (eventIdToCancel) {
    loggerBridge(`Received cancel request for job: ${eventIdToCancel}`);

    // Send cancellation acknowledgment
    const cancelAckStatus = keyManager.signEvent({
      ...keyManager.createEventTemplate(NOTIFICATION_KIND),
      content: JSON.stringify({
        method: 'notifications/progress',
        params: { message: 'cancellation-acknowledged' },
      }),
      tags: [
        [TAG_STATUS, 'cancelled'],
        [TAG_EVENT_ID, eventIdToCancel],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await relayHandler.publishEvent(cancelAckStatus);
  } else {
    loggerBridge('Received cancel notification without event ID');
  }
}
