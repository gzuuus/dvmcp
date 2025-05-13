import { TAG_EVENT_ID, TAG_PUBKEY } from '@dvmcp/commons/constants';
import { KeyManager } from '@dvmcp/commons/nostr/key-manager';

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

/**
 * Creates a standardized error response for JSON-RPC protocol errors
 * according to the DVMCP specification.
 *
 * @param eventId - The ID of the request event
 * @param pubkey - The public key of the requester
 * @param errorCode - Standard JSON-RPC error code
 * @param errorMessage - Human-readable error message
 * @param keyManager - Key manager for signing the response
 * @returns Signed NostrEvent with error response
 */
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
