import { TAG_EVENT_ID, TAG_PUBKEY } from '@dvmcp/commons/core';
import { type KeyManager } from '@dvmcp/commons/nostr';
import { slugify } from '@dvmcp/commons/core';

export function getServerId(
  serverName: string,
  publicKey: string,
  configServerId?: string
): string {
  if (configServerId) {
    return slugify(configServerId);
  }
  const combinedId = `${serverName}-${publicKey.slice(0, 6)}`;

  return slugify(combinedId);
}

export function createProtocolErrorResponse(
  eventId: string,
  pubkey: string,
  errorCode: number,
  errorMessage: string,
  keyManager: KeyManager,
  responseKind: number
) {
  return keyManager.signEvent({
    ...keyManager.createEventTemplate(responseKind),
    content: JSON.stringify({
      error: {
        code: errorCode,
        message: errorMessage,
      },
    }),
    tags: [
      [TAG_EVENT_ID, eventId],
      [TAG_PUBKEY, pubkey],
    ],
  });
}

export function createExecutionErrorResponse(
  eventId: string,
  pubkey: string,
  errorMessage: string,
  keyManager: KeyManager,
  responseKind: number
) {
  return keyManager.signEvent({
    ...keyManager.createEventTemplate(responseKind),
    content: JSON.stringify({
      result: {
        content: [
          {
            type: 'text',
            text: errorMessage,
          },
        ],
        isError: true,
      },
    }),
    tags: [
      [TAG_EVENT_ID, eventId],
      [TAG_PUBKEY, pubkey],
    ],
  });
}
