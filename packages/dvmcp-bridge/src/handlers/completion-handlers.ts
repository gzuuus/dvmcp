import { type Event as NostrEvent } from 'nostr-tools';
import { loggerBridge } from '@dvmcp/commons/core';
import { MCPPool } from '../mcp-pool';
import { RESPONSE_KIND, TAG_EVENT_ID, TAG_PUBKEY } from '@dvmcp/commons/core';
import type {
  CompleteRequest,
  CompleteResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { KeyManager } from '@dvmcp/commons/nostr';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import { getResponsePublisher } from '../utils/response-publisher.js';
import type { ResponseContext } from '../dvm-bridge.js';

/**
 * Handle a completion/complete request from a client
 */
export async function handleCompletionComplete(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext
): Promise<void> {
  const id = event.id;
  const pubkey = event.pubkey;

  try {
    const request: CompleteRequest = JSON.parse(event.content);

    const result: CompleteResult | undefined = await mcpPool.complete(
      request.params
    );

    if (!result) {
      return undefined;
    }

    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(result),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });

    const publisher = getResponsePublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await publisher.publishResponse(response, responseContext);
  } catch (error) {
    loggerBridge.error('[handleCompletionComplete] Error:', error);
    return undefined;
  }
}
